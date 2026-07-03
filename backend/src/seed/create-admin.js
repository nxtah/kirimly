/**
 * Seed script untuk membuat akun admin pertama.
 *
 * Cara pakai:
 *   node src/seed/create-admin.js
 *
 * Akan prompt input username & password secara interaktif.
 * Untuk non-interaktif (CI/otomatis):
 *   node src/seed/create-admin.js --username=admin --password=rahasia123
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const readline = require('readline');
const pool = require('../config/database');
const { hashPassword } = require('../utils/password');

async function createAdmin(username, password) {
  const hashed = await hashPassword(password);

  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name,
           updated_at = NOW()
     RETURNING id, username, role, created_at`,
    [username, hashed, `Admin ${username}`]
  );

  console.log(`\n✔ Admin user "${rows[0].username}" (id=${rows[0].id}, role=${rows[0].role}) siap.`);
  return rows[0];
}

// ── Parse CLI args ──
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  });
  return args;
}

// ── Interactive prompt ──
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const args = parseArgs();
  let username = args.username;
  let password = args.password;

  if (!username) username = await prompt('Username admin: ');
  if (!password) password = await prompt('Password admin: ');
  if (!password || password.length < 6) {
    console.error('Password minimal 6 karakter.');
    process.exit(1);
  }

  try {
    await createAdmin(username, password);
  } catch (err) {
    console.error('Gagal membuat admin:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
