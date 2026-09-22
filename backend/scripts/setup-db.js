/**
 * Idempotent database bootstrap:
 *   1. creates the database if it does not exist
 *   2. applies database/schema.sql if the tables are missing
 *   3. applies the migrations (safe to re-run)
 *   4. seeds the first admin (ADMIN_USERNAME / ADMIN_PASSWORD) if no admin exists yet
 *
 * Usage: npm run db:setup
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { hashPassword } = require('../src/utils/password');

const DB_DIR = path.resolve(__dirname, '../../database');

const conn = (database) => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database,
});

async function ensureDatabase(name) {
  const admin = new Client(conn('postgres'));
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`✔ Database "${name}" created`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  const dbName = process.env.DB_NAME || 'kirimly';
  await ensureDatabase(dbName);

  const db = new Client(conn(dbName));
  await db.connect();

  try {
    const { rows } = await db.query("SELECT to_regclass('public.users') AS t");
    if (!rows[0].t) {
      await db.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf-8'));
      console.log('✔ Schema applied');
    } else {
      console.log('• Schema already present');
    }

    for (const file of fs.readdirSync(DB_DIR).filter((f) => /^migration-.*\.sql$/.test(f)).sort()) {
      await db.query(fs.readFileSync(path.join(DB_DIR, file), 'utf-8'));
      console.log(`✔ ${file} applied`);
    }

    const { rowCount } = await db.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    if (rowCount === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      await db.query(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES ($1, $2, $3, 'admin')`,
        [username, await hashPassword(password), `Admin ${username}`]
      );
      console.log(`✔ Admin "${username}" created (password from ADMIN_PASSWORD)`);
    } else {
      console.log('• Admin already exists');
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('DB setup failed:', err.message);
  process.exit(1);
});
