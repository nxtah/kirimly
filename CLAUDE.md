# Kirimly Project — Developer Notes

## ⚠️ CRITICAL: Frontend CWD rule
Semua perintah Next.js WAJIB dijalankan dari `/mnt/IMPORTANTE/natah/PROJECTS/kirimly/frontend`.
Jangan pernah dari root project — itu bikin `.next/` corrupt & 404 CSS/JS.

```bash
cd /mnt/IMPORTANTE/natah/PROJECTS/kirimly/frontend
npm run dev      # ✅
npx next build   # ✅
```

## Run project
```bash
# Terminal 1 - Backend
cd /mnt/IMPORTANTE/natah/PROJECTS/kirimly/backend && node src/index.js

# Terminal 2 - Frontend
cd /mnt/IMPORTANTE/natah/PROJECTS/kirimly/frontend && npm run dev
```
