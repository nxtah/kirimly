#!/bin/bash
# ============================================================
# Kirimly — Deploy Script untuk Ubuntu 24.04 VPS
# Cara pakai: chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -e

# ── Warna ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Kirimly Deploy Script${NC}"
echo -e "${GREEN}========================================${NC}"

# ── Cek root ──
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Jalankan sebagai root (sudo su)${NC}"
  exit 1
fi

# ── Input konfigurasi ──
echo ""
echo -e "${YELLOW}Masukkan konfigurasi database:${NC}"
GEN_DB_PASS="$(openssl rand -hex 12)"
read -p "DB Password (default: random): " DB_PASS
DB_PASS="${DB_PASS:-$GEN_DB_PASS}"

read -p "DB User (default: kirimly_user): " DB_USER
DB_USER="${DB_USER:-kirimly_user}"

read -p "Nama Database (default: kirimly): " DB_NAME
DB_NAME="${DB_NAME:-kirimly}"

echo ""
echo -e "${YELLOW}Masukkan konfigurasi admin:${NC}"
read -p "Admin Username (default: admin): " ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

GEN_ADMIN_PASS="$(openssl rand -hex 8)"
read -sp "Admin Password (default: random): " ADMIN_PASS
ADMIN_PASS="${ADMIN_PASS:-$GEN_ADMIN_PASS}"
echo ""

echo ""
echo -e "${YELLOW}IP / Domain untuk frontend:${NC}"
DETECTED_IP="$(curl -s -m 5 ifconfig.me || hostname -I | awk '{print $1}')"
read -p "IP / Domain VPS (default: ${DETECTED_IP}): " VPS_IP
VPS_IP="${VPS_IP:-$DETECTED_IP}"

read -p "Port frontend (default: 3000): " FE_PORT
FE_PORT="${FE_PORT:-3000}"

echo ""
echo -e "${YELLOW}Mulai deploy...${NC}"
sleep 2

# ── 1. Install Node.js 20 ──
echo -e "${GREEN}[1/9] Install Node.js 20...${NC}"
apt update -qq
apt install -y -qq curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
apt install -y -qq nodejs nginx
echo "Node: $(node -v), NPM: $(npm -v)"

# ── 2. Install PostgreSQL ──
echo -e "${GREEN}[2/9] Install PostgreSQL...${NC}"
apt install -y -qq postgresql postgresql-contrib
systemctl start postgresql

# ── 3. Setup database ──
echo -e "${GREEN}[3/9] Setup database...${NC}"
su - postgres -c "psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\" 2>/dev/null || true"
su - postgres -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\" 2>/dev/null || true"
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\" 2>/dev/null || true"
su - postgres -c "psql -d ${DB_NAME} -c \"GRANT ALL ON SCHEMA public TO ${DB_USER};\" 2>/dev/null || true"

# ── 4. Cek project ──
echo -e "${GREEN}[4/9] Cek project...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "backend/package.json" ]; then
  echo -e "${RED}Project tidak ditemukan di $SCRIPT_DIR${NC}"
  echo "Pastikan folder berisi: backend/, frontend/, database/"
  exit 1
fi

# ── 5. Setup backend ──
echo -e "${GREEN}[5/9] Setup backend...${NC}"
cd backend

# Buat .env
cat > .env << EOF
PORT=3001
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=24h
BLAST_DELAY_MIN_MS=5000
BLAST_DELAY_MAX_MS=10000
BLAST_WAVE_DELAY_MIN_MS=900000
BLAST_WAVE_DELAY_MAX_MS=1200000
BLAST_MAX_WAVES=100
BLAST_MAX_PER_WAVE=20
CORS_ORIGIN=http://${VPS_IP}:${FE_PORT}
TRUST_PROXY=true
ADMIN_USERNAME=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}
EOF
chmod 600 .env

npm install --silent 2>/dev/null

# Schema + migrations + admin (idempotent, safe to re-run)
echo "Setup database..."
node scripts/setup-db.js

# ── 6. Setup frontend ──
echo -e "${GREEN}[6/9] Setup frontend...${NC}"
cd ../frontend

cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://${VPS_IP}:${FE_PORT}
EOF

npm install --silent 2>/dev/null
npm run build

# ── 7. Install PM2 ──
echo -e "${GREEN}[7/9] Install PM2...${NC}"
npm install -g pm2 --silent

# ── 8. Start PM2 ──
echo -e "${GREEN}[8/9] Start dengan PM2...${NC}"
cd ../backend

pm2 delete kirimly-backend 2>/dev/null || true
pm2 delete kirimly-frontend 2>/dev/null || true

pm2 start src/index.js --name kirimly-backend
cd ../frontend
pm2 start npm --name kirimly-frontend -- run start

pm2 save
pm2 startup 2>/dev/null

# ── 9. Setup Nginx ──
echo -e "${GREEN}[9/9] Setup Nginx...${NC}"
cat > /etc/nginx/sites-available/kirimly << EOF
server {
    listen ${FE_PORT};
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

ln -sf /etc/nginx/sites-available/kirimly /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Buka firewall
ufw allow 22/tcp 2>/dev/null || true
ufw allow ${FE_PORT}/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

# ── Selesai ──
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  DEPLOY SELESAI!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Frontend:  http://${VPS_IP}:${FE_PORT}"
echo -e "  Admin:     http://${VPS_IP}:${FE_PORT}/admin/login"
echo -e "  Backend:   http://${VPS_IP}:${FE_PORT}/api/health (via Nginx)"
echo ""
echo -e "  Admin login:"
echo -e "    Username: ${ADMIN_USER}"
echo -e "    Password: ${ADMIN_PASS}"
echo ""
echo -e "${YELLOW}PENTING:${NC}"
echo -e "  - Kalo mau ganti port, edit /etc/nginx/sites-available/kirimly"
echo -e "  - Cek status: pm2 status"
echo -e "  - Cek log:    pm2 logs kirimly-backend"
echo -e "========================================${NC}"
