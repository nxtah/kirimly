// Removes a stale backend/.db-ready marker (left behind if the embedded DB was killed instead of stopped)
require('fs').rmSync(require('path').resolve(__dirname, '../backend/.db-ready'), { force: true });
