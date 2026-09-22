/**
 * Blocks until Postgres accepts connections (max ~60s), so the backend doesn't start
 * before the database is up. Used by `npm run dev:embedded` at the repo root.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');

const fs = require('fs');
const path = require('path');

async function main() {
  // --marker: also wait for the embedded DB to finish provisioning (avoids noisy early connection attempts)
  if (process.argv.includes('--marker')) {
    const marker = path.resolve(__dirname, '../.db-ready');
    for (let i = 0; i < 120 && !fs.existsSync(marker); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  for (let i = 0; i < 60; i++) {
    const client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'kirimly',
    });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error('Database not reachable after 60s');
  process.exit(1);
}

main();
