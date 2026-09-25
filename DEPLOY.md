# Kirimly — Panduan Deploy ke VPS Oracle Cloud (Ubuntu)

## 1. Prasyarat VPS

```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx (opsional, untuk reverse proxy)
sudo apt install -y nginx
```

## 2. Clone Project

```bash
cd /opt
sudo mkdir -p kirimly
sudo chown $USER:$USER kirimly
git clone <repo-url> kirimly
# atau copy manual pake SCP
```

## 3. Setup Database

```bash
sudo -u postgres psql

# Di dalam psql:
CREATE DATABASE kirimly;
CREATE USER kirimly_user WITH PASSWORD 'password_kuat_disini';
GRANT ALL PRIVILEGES ON DATABASE kirimly TO kirimly_user;
\c kirimly
GRANT ALL ON SCHEMA public TO kirimly_user;
\q
```

Schema, migrasi (termasuk `migration-003-segmentation.sql` untuk fitur segmentasi), dan akun admin dibuat otomatis oleh `npm run db:setup` (langkah 4). Untuk server yang sudah berjalan, cukup jalankan `npm run db:setup` lagi setelah `git pull` — migrasi bersifat idempotent.

## 4. Setup Backend

```bash
cd /opt/kirimly/backend
cp .env.example .env
nano .env  # isi konfigurasi sesuai VPS
```

**.env (wajib diisi):**
```
PORT=3001
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kirimly
DB_USER=kirimly_user
DB_PASSWORD=password_kuat_disini
JWT_SECRET=isi_random_64_karakter
JWT_EXPIRES_IN=24h
BLAST_DELAY_MIN_MS=5000
BLAST_DELAY_MAX_MS=10000
BLAST_WAVE_DELAY_MIN_MS=900000
BLAST_WAVE_DELAY_MAX_MS=1200000
BLAST_MAX_WAVES=100
BLAST_MAX_PER_WAVE=20
CORS_ORIGIN=https://domain-anda.com
TRUST_PROXY=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password_admin_kuat
```

```bash
npm install
# Buat schema + migrasi + akun admin (aman dijalankan ulang)
npm run db:setup
```

## 5. Setup Frontend

```bash
cd /opt/kirimly/frontend
nano .env.local
```

**.env.local:**
```
# Lewat Nginx (langkah 7), API ada di origin yang sama dengan frontend
NEXT_PUBLIC_API_URL=https://domain-anda.com
```

```bash
npm install
npm run build
```

## 6. Jalankan dengan PM2

```bash
# Backend
pm2 start /opt/kirimly/backend/src/index.js --name kirimly-backend

# Frontend (production mode)
pm2 start npm --name kirimly-frontend --cwd /opt/kirimly/frontend -- run start

# Simpan PM2 config agar auto-restart saat reboot
pm2 save
pm2 startup
```

## 7. Nginx Reverse Proxy (opsional, recommended)

```bash
sudo nano /etc/nginx/sites-available/kirimly
```

```nginx
server {
    listen 80;
    server_name domain-anda.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kirimly /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL dengan Certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d domain-anda.com
```

## 8. Firewall (UFW)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 9. Akses

```
User: https://domain-anda.com/login
Admin: https://domain-anda.com/admin/login
```

## 10. Monitoring & Logs

```bash
# Cek status
pm2 status
pm2 logs kirimly-backend
pm2 logs kirimly-frontend

# Restart
pm2 restart kirimly-backend
pm2 restart kirimly-frontend
```

## Troubleshooting

**Backend 500 / ECONNREFUSED:**
- Cek PostgreSQL: `sudo systemctl status postgresql`
- Cek kredensial DB di `.env`

**Frontend blank / 502:**
- Cek `pm2 status`
- Cek `npm run build` di frontend — mungkin ada error kompilasi

**404 CSS/JS:**
- Pastikan `npm run build` jalan dari `/opt/kirimly/frontend/`
- Hapus `.next` jika ada di folder lain

**Port sudah dipakai:**
```bash
sudo lsof -i :3000
sudo lsof -i :3001
```
