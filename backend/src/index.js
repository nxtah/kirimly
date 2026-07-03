const app = require('./app');
const { restoreAllSessions } = require('./services/waSessionManager');
const { markOrphanedBlasts, processScheduledBlasts } = require('./services/blastService');

const PORT = process.env.PORT || 3001;

// ── Process-level error handlers (prevent silent crash) ──
process.on('uncaughtException', (err) => {
  console.error('FATAL uncaught exception:', err);
  setTimeout(() => process.exit(1), 1000).unref();
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// ── Start listening FIRST, then restore sessions in background ──
app.listen(PORT, () => {
  console.log(`Kirimly backend running on port ${PORT}`);

  // Restore persisted WA sessions without blocking server start
  restoreAllSessions().catch((err) => {
    console.error('Session restore error:', err);
  });

  // Mark any blasts stuck in 'sending' status as failed (server restart)
  markOrphanedBlasts().catch((err) => {
    console.error('Orphan blast cleanup error:', err);
  });

  // Poll for scheduled blasts every 30 seconds
  setInterval(() => {
    processScheduledBlasts().catch((err) => {
      console.error('Scheduled blast processor error:', err);
    });
  }, 30000).unref();
});
