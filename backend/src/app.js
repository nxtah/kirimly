require('dotenv').config();

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

const app = express();

// ── Middleware global ──
app.use(cors());
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
