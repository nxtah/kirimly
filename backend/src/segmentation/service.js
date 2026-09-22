/**
 * Orkestrasi segmentasi: import prospek, jalankan K-Means, simpan hasil, ambil anggota cluster.
 * Semua query difilter per user_id (multi-tenant) — sama seperti fitur lain.
 */

const pool = require('../config/database');
const { ATTRS, validateRows } = require('./validate');
const { oneHotEncode } = require('./oneHot');
const { kmeans } = require('./kmeans');
const { silhouetteScore, suggestK: computeSuggestK } = require('./silhouette');
const { buildProfile } = require('./profile');

const MIN_K = 2;
const MAX_K = 10;
const SEED = 42;

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* ───────────────────────── import ───────────────────────── */

/**
 * Validasi + bersihkan baris, upsert ke prospects, dan sinkronkan ke contacts
 * (nama kontak yang sudah ada tidak ditimpa).
 */
async function importProspects(userId, rows) {
  const { valid, invalid, duplicates, missing } = validateRows(rows);

  let imported = 0;
  let updated = 0;

  if (valid.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const r of valid) {
        const { rows: contactRows } = await client.query(
          `INSERT INTO contacts (user_id, name, phone_number)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, phone_number) DO UPDATE SET updated_at = NOW()
           RETURNING id, (xmax = 0) AS created`,
          [userId, r.name, r.phone_number]
        );

        // Catat kontak yang benar-benar baru dibuat oleh import (untuk fitur Reset Data)
        if (contactRows[0].created) {
          await client.query(
            `INSERT INTO segmentation_contacts (contact_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [contactRows[0].id, userId]
          );
        }

        const { rows: pRows } = await client.query(
          `INSERT INTO prospects
             (user_id, contact_id, phone_number, name, program_studi, asal_sekolah, jurusan_sekolah, domisili)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id, phone_number) DO UPDATE SET
             contact_id = EXCLUDED.contact_id,
             name = EXCLUDED.name,
             program_studi = EXCLUDED.program_studi,
             asal_sekolah = EXCLUDED.asal_sekolah,
             jurusan_sekolah = EXCLUDED.jurusan_sekolah,
             domisili = EXCLUDED.domisili
           RETURNING (xmax = 0) AS inserted`,
          [userId, contactRows[0].id, r.phone_number, r.name, r.program_studi, r.asal_sekolah, r.jurusan_sekolah, r.domisili]
        );

        if (pRows[0].inserted) imported++;
        else updated++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    summary: {
      total: rows.length,
      imported,
      updated,
      invalid: invalid.length,
      duplicates: duplicates.length,
      missing_attributes: missing,
    },
    errors: invalid.slice(0, 100),
  };
}

/* ───────────────────────── prospects ───────────────────────── */

async function listProspects(userId, { page = 1, limit = 20, search = null } = {}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const params = [userId];
  let where = 'user_id = $1';
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (name ILIKE $2 OR phone_number ILIKE $2 OR program_studi ILIKE $2
                    OR asal_sekolah ILIKE $2 OR domisili ILIKE $2)`;
  }

  const [data, total] = await Promise.all([
    pool.query(
      `SELECT id, contact_id, name, phone_number, program_studi, asal_sekolah, jurusan_sekolah, domisili, created_at
       FROM prospects WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, (p - 1) * l]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM prospects WHERE ${where}`, params),
  ]);

  const n = total.rows[0].n;
  return {
    prospects: data.rows,
    pagination: { page: p, limit: l, total: n, total_pages: Math.ceil(n / l) },
  };
}

async function prospectSummary(userId) {
  const [{ rows: totalRows }, { rows: createdRows }, ...dists] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS n FROM segmentation_contacts WHERE user_id = $1', [userId]),
    ...ATTRS.map((attr) =>
      // attr berasal dari konstanta ATTRS, bukan input user
      pool.query(
        `SELECT ${attr} AS value, COUNT(*)::int AS count FROM prospects
         WHERE user_id = $1 GROUP BY ${attr} ORDER BY count DESC, value ASC LIMIT 8`,
        [userId]
      )
    ),
  ]);

  const distribution = {};
  ATTRS.forEach((attr, i) => { distribution[attr] = dists[i].rows; });
  return { total: totalRows[0].n, created_contacts: createdRows[0].n, distribution };
}

async function deleteProspect(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM prospects WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

/**
 * Reset dataset segmentasi milik user: hapus semua prospek + semua hasil cluster
 * (hasil cluster adalah snapshot dari dataset itu, jadi tidak berguna tanpanya).
 * Opsional: hapus juga kontak yang DIBUAT oleh import (kontak yang sudah ada sebelumnya
 * tidak pernah dihapus). Riwayat blast tetap utuh (blast_messages.contact_id → NULL).
 */
async function resetProspects(userId, { deleteContacts = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let contacts = 0;
    if (deleteContacts) {
      // segmentation_contacts ikut terhapus lewat ON DELETE CASCADE
      const res = await client.query(
        `DELETE FROM contacts
         WHERE user_id = $1 AND id IN (SELECT contact_id FROM segmentation_contacts WHERE user_id = $1)`,
        [userId]
      );
      contacts = res.rowCount;
    }

    const runs = (await client.query('DELETE FROM cluster_runs WHERE user_id = $1', [userId])).rowCount;
    const prospects = (await client.query('DELETE FROM prospects WHERE user_id = $1', [userId])).rowCount;

    await client.query('COMMIT');
    return { prospects, runs, contacts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ───────────────────────── clustering ───────────────────────── */

async function loadDataset(userId) {
  const { rows } = await pool.query(
    `SELECT id, ${ATTRS.join(', ')} FROM prospects WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

async function suggestK(userId, maxK = 8) {
  const rows = await loadDataset(userId);
  if (rows.length < 3) throw httpError(400, 'Minimal 3 data calon mahasiswa untuk menyarankan K');

  const max = Math.min(Math.max(parseInt(maxK, 10) || 8, MIN_K), MAX_K);
  const { matrix } = oneHotEncode(rows, ATTRS);
  const { scores, recommended } = computeSuggestK(matrix, { minK: MIN_K, maxK: max, seed: SEED });

  return { n_samples: rows.length, scores, recommended };
}

async function runClustering(userId, { k, name = null }) {
  if (!Number.isInteger(k) || k < MIN_K || k > MAX_K) {
    throw httpError(400, `K harus bilangan bulat ${MIN_K}–${MAX_K}`);
  }

  const rows = await loadDataset(userId);
  if (rows.length < k) {
    throw httpError(400, `Data calon mahasiswa (${rows.length}) lebih sedikit dari jumlah cluster (${k})`);
  }

  const { matrix, columns } = oneHotEncode(rows, ATTRS);
  const result = kmeans(matrix, k, { seed: SEED });
  const silhouette = silhouetteScore(matrix, result.labels, k, { seed: SEED });

  // Kelompokkan anggota; nomor cluster diurutkan dari yang terbesar (1 = terbanyak)
  const groups = Array.from({ length: k }, () => []);
  rows.forEach((row, i) => groups[result.labels[i]].push(row));
  const ordered = groups.filter((g) => g.length > 0).sort((a, b) => b.length - a.length);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: runRows } = await client.query(
      `INSERT INTO cluster_runs (user_id, name, k, n_samples, inertia, silhouette, iterations, seed, params)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        name || `Cluster ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        ordered.length,
        rows.length,
        result.inertia,
        silhouette,
        result.iterations,
        result.seed,
        JSON.stringify({ attributes: ATTRS, feature_count: columns.length, features: columns }),
      ]
    );
    const runId = runRows[0].id;

    for (let i = 0; i < ordered.length; i++) {
      const members = ordered[i];
      const profile = buildProfile(members, ATTRS);

      const { rows: segRows } = await client.query(
        `INSERT INTO cluster_segments (run_id, cluster_no, size, profile)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [runId, i + 1, members.length, JSON.stringify(profile)]
      );

      await client.query(
        `INSERT INTO cluster_members (segment_id, prospect_id)
         SELECT $1, UNNEST($2::int[])`,
        [segRows[0].id, members.map((m) => m.id)]
      );
    }

    await client.query('COMMIT');
    return getRun(userId, runId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ───────────────────────── hasil ───────────────────────── */

async function listRuns(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, k, n_samples, silhouette, inertia, created_at
     FROM cluster_runs WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [userId]
  );
  return rows;
}

async function getRun(userId, runId) {
  const { rows } = await pool.query(
    `SELECT id, name, k, n_samples, silhouette, inertia, iterations, seed, created_at
     FROM cluster_runs WHERE id = $1 AND user_id = $2`,
    [runId, userId]
  );
  if (rows.length === 0) return null;

  const { rows: segments } = await pool.query(
    `SELECT cluster_no, size, profile FROM cluster_segments WHERE run_id = $1 ORDER BY cluster_no`,
    [runId]
  );
  return { ...rows[0], segments };
}

async function deleteRun(userId, runId) {
  const { rowCount } = await pool.query('DELETE FROM cluster_runs WHERE id = $1 AND user_id = $2', [runId, userId]);
  return rowCount > 0;
}

/**
 * Anggota cluster yang siap dikirimi blast: punya kontak, tidak diblokir.
 * Yang belum pernah dikirimi (last_sent_at NULL) didahulukan.
 */
async function getSegmentMembers(userId, runId, clusterNo, limit = 60) {
  const l = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 500);

  const { rows: seg } = await pool.query(
    `SELECT s.id, s.size
     FROM cluster_segments s JOIN cluster_runs r ON r.id = s.run_id
     WHERE r.id = $1 AND r.user_id = $2 AND s.cluster_no = $3`,
    [runId, userId, clusterNo]
  );
  if (seg.length === 0) return null;

  const base = `FROM cluster_members m
                JOIN prospects p ON p.id = m.prospect_id
                JOIN contacts c ON c.id = p.contact_id AND c.user_id = $2
                WHERE m.segment_id = $1 AND c.is_blocked = FALSE`;

  const [members, count] = await Promise.all([
    pool.query(
      `SELECT c.id AS contact_id, c.name, c.phone_number, c.last_sent_at
       ${base}
       ORDER BY c.last_sent_at ASC NULLS FIRST, c.id ASC
       LIMIT $3`,
      [seg[0].id, userId, l]
    ),
    pool.query(`SELECT COUNT(*)::int AS n ${base}`, [seg[0].id, userId]),
  ]);

  return {
    cluster_no: clusterNo,
    size: seg[0].size,
    eligible: count.rows[0].n,   // anggota yang bisa dikirimi (bukan blocked, kontak masih ada)
    members: members.rows,
  };
}

module.exports = {
  importProspects,
  listProspects,
  prospectSummary,
  deleteProspect,
  resetProspects,
  suggestK,
  runClustering,
  listRuns,
  getRun,
  deleteRun,
  getSegmentMembers,
  MIN_K,
  MAX_K,
};
