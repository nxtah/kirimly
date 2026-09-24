const service = require('../segmentation/service');

const MAX_IMPORT_ROWS = 500; // sama dengan ukuran batch di frontend (body parser global = 1 MB)

function handleError(res, err, label) {
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${label} error:`, err);
  res.status(500).json({ error: 'Internal server error' });
}

function parseId(value) {
  const id = parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── POST /api/segmentation/prospects/import ──
async function importProspects(req, res) {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(400).json({ error: `Maksimal ${MAX_IMPORT_ROWS} baris per request` });
  }

  // dry_run=true → hanya hitung ringkasan preprocessing (pratinjau), tidak menulis apa pun
  const dryRun = req.query.dry_run === 'true';
  const importId = req.body.import_id != null ? parseInt(req.body.import_id, 10) : null;
  const meta = req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

  try {
    const result = await service.importProspects(req.user.user_id, rows, {
      dryRun,
      importId: Number.isInteger(importId) ? importId : null,
      meta,
    });
    const { imported, updated, invalid, duplicates } = result.summary;
    res.status(dryRun ? 200 : 201).json({
      message: `${dryRun ? 'Pratinjau' : 'Import selesai'}: ${imported} baru, ${updated} diperbarui, ${duplicates} duplikat dilewati, ${invalid} tidak valid`,
      ...result,
    });
  } catch (err) {
    handleError(res, err, 'Import prospects');
  }
}

// ── GET /api/segmentation/prospects ──
async function listProspects(req, res) {
  try {
    res.json(await service.listProspects(req.user.user_id, {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search || null,
    }));
  } catch (err) {
    handleError(res, err, 'List prospects');
  }
}

// ── GET /api/segmentation/prospects/summary ──
async function prospectSummary(req, res) {
  try {
    res.json(await service.prospectSummary(req.user.user_id));
  } catch (err) {
    handleError(res, err, 'Prospect summary');
  }
}

// ── DELETE /api/segmentation/prospects/:id ──
async function deleteProspect(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid prospect ID' });

  try {
    const ok = await service.deleteProspect(req.user.user_id, id);
    if (!ok) return res.status(404).json({ error: 'Prospect not found' });
    res.json({ message: 'Prospect deleted' });
  } catch (err) {
    handleError(res, err, 'Delete prospect');
  }
}

// ── DELETE /api/segmentation/prospects?delete_contacts=true ──
async function resetProspects(req, res) {
  const deleteContacts = req.query.delete_contacts === 'true';

  try {
    const result = await service.resetProspects(req.user.user_id, { deleteContacts });
    res.json({
      message: `Data direset: ${result.prospects} calon mahasiswa, ${result.runs} hasil cluster` +
        (deleteContacts ? `, ${result.contacts} kontak dihapus` : ''),
      ...result,
    });
  } catch (err) {
    handleError(res, err, 'Reset prospects');
  }
}

// ── GET /api/segmentation/suggest-k ──
async function suggestK(req, res) {
  try {
    res.json(await service.suggestK(req.user.user_id, req.query.max));
  } catch (err) {
    handleError(res, err, 'Suggest K');
  }
}

// ── POST /api/segmentation/runs ──
async function createRun(req, res) {
  const k = typeof req.body.k === 'string' ? parseInt(req.body.k, 10) : req.body.k;
  const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 150) : null;

  try {
    const run = await service.runClustering(req.user.user_id, { k, name });
    res.status(201).json({ message: 'Clustering selesai', run });
  } catch (err) {
    handleError(res, err, 'Run clustering');
  }
}

// ── GET /api/segmentation/runs ──
async function listRuns(req, res) {
  try {
    res.json({ runs: await service.listRuns(req.user.user_id) });
  } catch (err) {
    handleError(res, err, 'List runs');
  }
}

// ── GET /api/segmentation/runs/:id ──
async function getRun(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid run ID' });

  try {
    const run = await service.getRun(req.user.user_id, id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ run });
  } catch (err) {
    handleError(res, err, 'Get run');
  }
}

// ── DELETE /api/segmentation/runs/:id ──
async function deleteRun(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid run ID' });

  try {
    const ok = await service.deleteRun(req.user.user_id, id);
    if (!ok) return res.status(404).json({ error: 'Run not found' });
    res.json({ message: 'Run deleted' });
  } catch (err) {
    handleError(res, err, 'Delete run');
  }
}

// ── GET /api/segmentation/runs/:id/details?cluster=&page=&limit= ──
async function runDetails(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid run ID' });
  const cluster = req.query.cluster != null && req.query.cluster !== '' ? parseId(req.query.cluster) : null;
  if (req.query.cluster != null && req.query.cluster !== '' && !cluster) {
    return res.status(400).json({ error: 'Invalid cluster number' });
  }

  try {
    const result = await service.getRunDetails(req.user.user_id, id, {
      cluster, page: req.query.page, limit: req.query.limit,
    });
    if (!result) return res.status(404).json({ error: 'Run not found' });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Run details');
  }
}

// ── GET /api/segmentation/runs/:id/segments/:no/members ──
async function segmentMembers(req, res) {
  const id = parseId(req.params.id);
  const no = parseId(req.params.no);
  if (!id || !no) return res.status(400).json({ error: 'Invalid run or cluster number' });

  try {
    const result = await service.getSegmentMembers(req.user.user_id, id, no, req.query.limit);
    if (!result) return res.status(404).json({ error: 'Cluster not found' });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Segment members');
  }
}

module.exports = {
  importProspects, listProspects, prospectSummary, deleteProspect, resetProspects,
  suggestK, createRun, listRuns, getRun, deleteRun, segmentMembers, runDetails,
};
