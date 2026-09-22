/**
 * Local development Postgres — no installation needed.
 * Runs an embedded Postgres (data in backend/.pgdata), creates the database,
 * applies the schema and seeds the admin, then keeps running until Ctrl+C.
 *
 * Usage: npm run dev:db   (or `npm run dev:embedded` from the repo root)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

async function main() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const dataDir = path.resolve(__dirname, '../.pgdata');
  const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    persistent: true,
  });

  // Marker file that tells `wait-for-db.js --marker` the DB is fully provisioned
  const marker = path.resolve(__dirname, '../.db-ready');
  fs.rmSync(marker, { force: true });

  if (fresh) await pg.initialise();
  await pg.start();
  console.log(`Embedded Postgres running on port ${process.env.DB_PORT || 5432}`);

  const setup = spawnSync(process.execPath, [path.join(__dirname, 'setup-db.js')], { stdio: 'inherit' });
  if (setup.status !== 0) {
    await pg.stop();
    process.exit(setup.status || 1);
  }

  fs.writeFileSync(marker, new Date().toISOString());

  const shutdown = async () => {
    console.log('\nStopping embedded Postgres…');
    fs.rmSync(marker, { force: true });
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Embedded Postgres failed:', err);
  process.exit(1);
});
