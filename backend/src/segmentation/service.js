/**
 * Orkestrasi segmentasi: import prospek, jalankan K-Means, simpan hasil, ambil anggota cluster.
 * Semua query difilter per user_id (multi-tenant) — sama seperti fitur lain.
 */

const pool = require('../config/database');
const { ATTRS, validateRows, isComplete } = require('./validate');
const { UNKNOWN } = require('./normalize');
const { oneHotEncode } = require('./oneHot');
const { kmeans } = require('./kmeans');
const { silhouetteScore, suggestK: computeSuggestK } = require('./silhouette');
const { daviesBouldin } = require('./metrics');
const { buildProfile } = require('./profile');
const { buildNormalizationReport, mergeReports, similarValues } = require('./report');

const MIN_K = 2;
const MAX_K = 10;
const EVAL_MAX_K = 6; // rentang evaluasi default: K = 2..6
const SEED = 42;
const MAX_SIMILAR_DISTINCT = 1500; // batas jumlah kategori unik untuk deteksi nilai mirip (O(n²))

// Kondisi SQL "keempat variabel clustering terisi" (ATTRS dari konstanta, bukan input user)
const COMPLETE_SQL = ATTRS.map((a) => `${a} <> '${UNKNOWN}'`).join(' AND ');

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* ───────────────────────── import ───────────────────────── */

/** Catat / gabungkan hasil satu batch ke satu baris riwayat import (bukti preprocessing TA). */
async function recordImport(client, userId, importId, meta, batch) {
  let row;
  if (importId) {
    const { rows } = await client.query(
      'SELECT * FROM segmentation_imports WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [importId, userId]
    );
    row = rows[0];
    if (!row) throw httpError(404, 'Import tidak ditemukan');
  } else {
    const { rows } = await client.query(
      `INSERT INTO segmentation_imports (user_id, source_name, sheets, missing, normalization)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        userId,
        typeof meta.source_name === 'string' ? meta.source_name.slice(0, 255) : null,
        JSON.stringify(Array.isArray(meta.sheets) ? meta.sheets.slice(0, 50) : []),
        JSON.stringify(Object.fromEntries(ATTRS.map((a) => [a, 0]))),
        JSON.stringify({}),
      ]
    );
    row = rows[0];
  }

  const missing = { ...(row.missing || {}) };
  for (const a of ATTRS) missing[a] = (missing[a] || 0) + (batch.missing[a] || 0);
  const normalization = mergeReports(row.normalization || {}, batch.normalization);

  await client.query(
    `UPDATE segmentation_imports
     SET total_rows = total_rows + $2, valid_rows = valid_rows + $3, invalid_rows = invalid_rows + $4,
         duplicate_rows = duplicate_rows + $5, missing = $6, normalization = $7
     WHERE id = $1`,
    [row.id, batch.total, batch.valid, batch.invalid, batch.duplicates, JSON.stringify(missing), JSON.stringify(normalization)]
  );
  return row.id;
}

/**
 * Validasi + bersihkan baris, upsert ke prospects, dan sinkronkan ke contacts
 * (nama kontak yang sudah ada tidak ditimpa).
 *
 * @param {object} opts
 *   dryRun   true = hanya hitung ringkasan preprocessing, TIDAK menulis apa pun
 *   importId lanjutkan riwayat import yang sama (import dikirim per batch 500 baris)
 *   meta     { source_name, sheets, extra_duplicates } — extra_duplicates = duplikat yang sudah
 *            dibuang client (mis. nomor sama antar-sheet) agar total & duplikat tetap akurat
 */
async function importProspects(userId, rows, opts = {}) {
  const { dryRun = false, importId = null, meta = {} } = opts;
  const { valid, invalid, duplicates, missing, events, phoneFixed } = validateRows(rows);
  const extraDup = Math.max(parseInt(meta.extra_duplicates, 10) || 0, 0);
  const normalization = buildNormalizationReport(events);
  const excluded = valid.filter((r) => !isComplete(r)).length;

  let imported = 0;
  let updated = 0;
  let resultImportId = importId;

  if (dryRun) {
    // Berapa baris yang sudah ada (akan diperbarui) vs baru — tanpa menulis apa pun
    if (valid.length > 0) {
      const { rows: existing } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1 AND phone_number = ANY($2::text[])',
        [userId, valid.map((r) => r.phone_number)]
      );
      updated = existing[0].n;
      imported = valid.length - updated;
    }
  } else {
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

      resultImportId = await recordImport(client, userId, importId, meta, {
        total: rows.length + extraDup,
        valid: valid.length,
        invalid: invalid.length,
        duplicates: duplicates.length + extraDup,
        missing,
        normalization,
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    import_id: resultImportId,
    dry_run: dryRun,
    summary: {
      total: rows.length + extraDup,
      valid: valid.length,
      imported,
      updated,
      invalid: invalid.length,
      duplicates: duplicates.length + extraDup,
      missing_attributes: missing,
      excluded_from_clustering: excluded,
      phone_fixed: phoneFixed,
    },
    normalization,
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

/**
 * Ringkasan data + preprocessing untuk menu Segmentasi (Data Summary & Preprocessing Summary).
 * Field lama (total, created_contacts, distribution) dipertahankan.
 */
async function prospectSummary(userId) {
  const [{ rows: totalRows }, { rows: createdRows }, { rows: completeRows }, { rows: importRows }, ...dists] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS n FROM segmentation_contacts WHERE user_id = $1', [userId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1 AND ${COMPLETE_SQL}`, [userId]),
    pool.query(
      `SELECT id, source_name, sheets, total_rows, valid_rows, invalid_rows, duplicate_rows, missing, normalization, created_at
       FROM segmentation_imports WHERE user_id = $1 ORDER BY id`,
      [userId]
    ),
    ...ATTRS.map((attr) =>
      // attr berasal dari konstanta ATTRS, bukan input user
      pool.query(
        `SELECT ${attr} AS value, COUNT(*)::int AS count FROM prospects
         WHERE user_id = $1 GROUP BY ${attr} ORDER BY count DESC, value ASC`,
        [userId]
      )
    ),
  ]);

  const distribution = {};
  const similar = {};
  ATTRS.forEach((attr, i) => {
    const all = dists[i].rows.filter((r) => r.value !== UNKNOWN);
    distribution[attr] = dists[i].rows.slice(0, 8);
    similar[attr] = all.length <= MAX_SIMILAR_DISTINCT
      ? similarValues(new Map(all.map((r) => [r.value, r.count])))
      : [];
  });

  // Jumlah fitur One-Hot dihitung dari dataset clustering yang sebenarnya
  const dataset = await loadDataset(userId);
  const { columns } = dataset.length > 0 ? oneHotEncode(dataset, ATTRS) : { columns: [] };
  const featuresByAttr = Object.fromEntries(ATTRS.map((a) => [a, columns.filter((c) => c.attr === a).length]));

  // Gabungan seluruh riwayat import
  let normalization = {};
  const missing = Object.fromEntries(ATTRS.map((a) => [a, 0]));
  const agg = { count: importRows.length, total_rows: 0, valid_rows: 0, invalid_rows: 0, duplicate_rows: 0, missing, sources: [], last_at: null };
  for (const r of importRows) {
    agg.total_rows += r.total_rows;
    agg.valid_rows += r.valid_rows;
    agg.invalid_rows += r.invalid_rows;
    agg.duplicate_rows += r.duplicate_rows;
    for (const a of ATTRS) missing[a] += (r.missing || {})[a] || 0;
    normalization = mergeReports(normalization, r.normalization || {});
    agg.sources.push({ id: r.id, name: r.source_name, sheets: r.sheets || [], rows: r.total_rows, created_at: r.created_at });
    agg.last_at = r.created_at;
  }

  const total = totalRows[0].n;
  const complete = completeRows[0].n;
  return {
    total,
    created_contacts: createdRows[0].n,
    distribution,
    clustering: {
      complete,
      excluded: total - complete,
      feature_count: columns.length,
      features_by_attr: featuresByAttr,
    },
    imports: agg,
    normalization,
    similar_values: similar,
  };
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
    // Riwayat preprocessing ikut direset: angka "total awal/valid/invalid" hanya berarti untuk dataset yang sama
    await client.query('DELETE FROM segmentation_imports WHERE user_id = $1', [userId]);

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

/**
 * Dataset untuk clustering: hanya baris yang keempat variabelnya terisi.
 * Baris dengan variabel kosong tetap tersimpan (sebagai kontak), tetapi tidak ikut One-Hot/K-Means
 * karena kategori palsu "Tidak Diketahui" akan menghasilkan cluster artefak.
 */
async function loadDataset(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, phone_number, ${ATTRS.join(', ')} FROM prospects
     WHERE user_id = $1 AND ${COMPLETE_SQL} ORDER BY id`,
    [userId]
  );
  return rows;
}

/**
 * Evaluasi kandidat K (default 2..6): SSE, Silhouette, Davies-Bouldin + rekomendasi dari 3 metrik.
 */
async function suggestK(userId, maxK = EVAL_MAX_K) {
  const rows = await loadDataset(userId);
  if (rows.length < 3) throw httpError(400, 'Minimal 3 data calon mahasiswa (dengan keempat variabel terisi) untuk mengevaluasi K');

  const max = Math.min(Math.max(parseInt(maxK, 10) || EVAL_MAX_K, MIN_K), MAX_K);
  const { matrix, columns } = oneHotEncode(rows, ATTRS);
  const { scores, recommendation, recommended } = computeSuggestK(matrix, { minK: MIN_K, maxK: max, seed: SEED });

  return { n_samples: rows.length, feature_count: columns.length, scores, recommendation, recommended };
}

/** Ringkasan preprocessing yang disimpan bersama tiap hasil clustering (bukti untuk dokumentasi). */
async function preprocessingSnapshot(userId, nSamples, featureCount) {
  const [{ rows: totalRows }, { rows: importRows }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1', [userId]),
    pool.query(
      'SELECT total_rows, valid_rows, invalid_rows, duplicate_rows, missing FROM segmentation_imports WHERE user_id = $1',
      [userId]
    ),
  ]);

  const missing = Object.fromEntries(ATTRS.map((a) => [a, 0]));
  const sums = { total_rows: 0, valid_rows: 0, invalid_rows: 0, duplicate_rows: 0 };
  for (const r of importRows) {
    for (const key of Object.keys(sums)) sums[key] += r[key];
    for (const a of ATTRS) missing[a] += (r.missing || {})[a] || 0;
  }

  return {
    total_prospects: totalRows[0].n,
    used_for_clustering: nSamples,
    excluded_missing: totalRows[0].n - nSamples,
    feature_count: featureCount,
    variables: ATTRS,
    imports: { count: importRows.length, ...sums, missing },
  };
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
  const dbi = daviesBouldin(matrix, result.labels, result.centroids);

  // Evaluasi K ikut disimpan bersama hasil, supaya tiap run berdiri sendiri sebagai bukti (SSE pada
  // tabel = SSE run untuk K yang sama karena seed & konfigurasi K-Means identik).
  const evaluation = computeSuggestK(matrix, { minK: MIN_K, maxK: Math.min(Math.max(EVAL_MAX_K, k), MAX_K), seed: SEED });
  const preprocessing = await preprocessingSnapshot(userId, rows.length, columns.length);

  // Kelompokkan anggota; nomor cluster diurutkan dari yang terbesar (1 = terbanyak)
  const groups = Array.from({ length: k }, () => []);
  rows.forEach((row, i) => groups[result.labels[i]].push(row));
  const ordered = groups.filter((g) => g.length > 0).sort((a, b) => b.length - a.length);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: runRows } = await client.query(
      `INSERT INTO cluster_runs
         (user_id, name, k, n_samples, inertia, silhouette, davies_bouldin, iterations, seed, params, evaluation, preprocessing)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        userId,
        name || `Cluster ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        ordered.length,
        rows.length,
        result.inertia,
        silhouette,
        dbi,
        result.iterations,
        result.seed,
        JSON.stringify({ attributes: ATTRS, feature_count: columns.length, features: columns }),
        JSON.stringify({ scores: evaluation.scores, recommendation: evaluation.recommendation }),
        JSON.stringify(preprocessing),
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
    `SELECT id, name, k, n_samples, silhouette, davies_bouldin, inertia, created_at
     FROM cluster_runs WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [userId]
  );
  return rows;
}

async function getRun(userId, runId) {
  const { rows } = await pool.query(
    `SELECT id, name, k, n_samples, silhouette, davies_bouldin, inertia, iterations, seed,
            evaluation, preprocessing, params, created_at
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

/**
 * Detail anggota untuk keperluan analisis/dokumentasi (BUKAN untuk kirim blast — itu memakai
 * getSegmentMembers): nama, nomor, keempat variabel, dan label cluster. Tidak difilter is_blocked.
 * @param {object} opts { cluster?: number, page, limit }
 */
async function getRunDetails(userId, runId, { cluster = null, page = 1, limit = 50 } = {}) {
  const { rows: run } = await pool.query('SELECT id, k FROM cluster_runs WHERE id = $1 AND user_id = $2', [runId, userId]);
  if (run.length === 0) return null;

  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);
  const params = [runId];
  let where = 's.run_id = $1';
  if (cluster != null) {
    params.push(cluster);
    where += ` AND s.cluster_no = $${params.length}`;
  }

  const base = `FROM cluster_members m
                JOIN cluster_segments s ON s.id = m.segment_id
                JOIN prospects pr ON pr.id = m.prospect_id
                WHERE ${where}`;

  const [data, total] = await Promise.all([
    pool.query(
      `SELECT s.cluster_no, pr.id AS prospect_id, pr.name, pr.phone_number,
              pr.program_studi, pr.asal_sekolah, pr.jurusan_sekolah, pr.domisili
       ${base}
       ORDER BY s.cluster_no ASC, pr.name ASC, pr.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, (p - 1) * l]
    ),
    pool.query(`SELECT COUNT(*)::int AS n ${base}`, params),
  ]);

  const n = total.rows[0].n;
  return {
    run_id: runId,
    members: data.rows,
    pagination: { page: p, limit: l, total: n, total_pages: Math.ceil(n / l) },
  };
}

module.exports = {
  getRunDetails,
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
