#!/usr/bin/env bash
set -e

echo "=================================================="
echo "  KurmaFlow VPS Deployment Script (v1.6.0)"
echo "=================================================="

# 1. Pastikan Docker & Docker Compose terpasang
if ! command -v docker >/dev/null 2>&1; then
  echo "[INFO] Docker belum terpasang. Memasang Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

# 2. Siapkan folder runtime data & logs
mkdir -p data/videos data/images data/uploads logs

# 3. Buat file .env otomatis jika belum ada
if [ ! -f .env ]; then
  echo "[INFO] Membuat file .env dari .env.example dengan secret acak..."
  cp .env.example .env
  RAND_AUTH=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)
  RAND_KEY=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)
  sed -i "s|AUTH_SECRET=.*|AUTH_SECRET=${RAND_AUTH}|g" .env
  sed -i "s|ACCOUNT_KEY_SECRET=.*|ACCOUNT_KEY_SECRET=${RAND_KEY}|g" .env
  echo "[OK] File .env berhasil dibuat."
else
  echo "[INFO] File .env sudah ada, mempertahankan konfigurasi saat ini."
fi

# 4. Build & jalankan seluruh container (PostgreSQL, Backend FastAPI, Web Nginx)
echo "[INFO] Membangun dan menjalankan container KurmaFlow..."
docker compose up -d --build

echo ""
echo "=================================================="
echo "  Deployment Selesai!"
echo "=================================================="
docker compose ps
echo ""
echo "Akses aplikasi di: http://<IP-VPS-ANDA>:3001"
echo "Cek log realtime : docker compose logs -f backend"
