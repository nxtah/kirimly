require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');

const authRoutes     = require('./routes/authRoutes');
const waRoutes       = require('./routes/waRoutes');
const contactRoutes  = require('./routes/contacts');
const templateRoutes = require('./routes/templates');
const blastRoutes    = require('./routes/blasts');
const logsRoutes     = require('./routes/logs');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes     = require('./routes/admin');
const segmentationRoutes = require('./routes/segmentation');
const cmabRoutes = require('./routes/cmab');

const app = express();

// ── Middleware global ──
// CORS_ORIGIN: comma-separated allowed origins (unset = allow all, fine for local dev)
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.use(express.json({ limit: '1mb' }));

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ──
app.use('/api/auth',     authRoutes);
app.use('/api/wa',       waRoutes);
app.use('/api/contacts',  contactRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/blasts',    blastRoutes);
app.use('/api/logs',      logsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/segmentation', segmentationRoutes);
app.use('/api/cmab', cmabRoutes);

// ── 404 handler ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
