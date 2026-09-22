/**
 * Creates backend/.env and frontend/.env.local from their .example files if missing.
 * The backend .env gets a freshly generated JWT_SECRET. Never overwrites existing files.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

function ensure(target, example, transform = (s) => s) {
  const t = path.join(root, target);
  if (fs.existsSync(t)) return console.log(`• ${target} already exists`);
  fs.writeFileSync(t, transform(fs.readFileSync(path.join(root, example), 'utf-8')));
  console.log(`✔ ${target} created`);
}

ensure('backend/.env', 'backend/.env.example', (s) =>
  s.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`)
);
ensure('frontend/.env.local', 'frontend/.env.local.example');
