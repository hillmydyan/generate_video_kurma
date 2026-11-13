# Panduan Deploy KurmaFlow ke VPS (Ubuntu / Debian)

## 1. Persiapan Cepat (1 Perintah di VPS)

Masuk ke VPS Anda melalui SSH, lalu jalankan perintah berikut:

```bash
git clone https://github.com/hillmydyan/generate_video_kurma.git
cd generate_video_kurma
bash deploy.sh
```

Skrip `deploy.sh` akan otomatis:
1. Memeriksa dan memasang **Docker + Docker Compose** jika belum tersedia di VPS.
2. Membuat direktori penyimpanan `data/videos`, `data/images`, `data/uploads`, dan `logs`.
3. Membuat file `.env` otomatis dengan `AUTH_SECRET` dan `ACCOUNT_KEY_SECRET` acak yang aman jika `.env` belum ada.
4. Menjalankan `docker compose up -d --build` untuk menyalakan:
   - `kurmaflow_backend` (FastAPI + Worker Antrean Per Kantor + FFmpeg)
   - `kurmaflow_web` (React Production Build + Nginx Reverse Proxy di `127.0.0.1:3001`)

> **Database:** app ini TIDAK membawa container PostgreSQL sendiri. Dipakai PostgreSQL bersama di VPS
> (container `postgres`, network Docker `internal`), database + user `snapgen`. Tabel dibuat otomatis
> oleh backend saat start (`init_db` + `migrations`). Sebelum deploy pertama, pastikan:
> - network `internal` sudah ada (`docker network create internal` bila belum),
> - database/user `snapgen` sudah dibuat di postgres bersama,
> - `POSTGRES_URL` di `.env` mengarah ke `postgresql+asyncpg://snapgen:<password>@postgres:5432/snapgen`.
>
> Akses publik lewat Cloudflare Tunnel: `https://kurmaflow.kurmagroup.com` -> service HTTP `kurmaflow_web:80`.

---

## 2. Langkah Setelah Container Menyala

1. Buka browser dan akses:
   ```text
   https://kurmaflow.kurmagroup.com
   ```
2. Saat pertama kali dibuka (database masih kosong), halaman **Setup Super Admin** (`/register` bootstrap) akan terbuka otomatis:
   - Buat akun Super Admin (mis. username `itkurma`, password `kurmagroup`).
3. Masuk ke menu **Admin** (`/admin`):
   - Tambahkan **API Key SnapGen** Anda pada bagian **Akun Provider** untuk `Kantor A` (`primary`).
   - Klik tombol **Sinkronisasi Saldo** di kanan atas untuk memuat saldo KR terbaru.
4. Halaman **Studio** (`/studio`), **Pabrik Foto + Multi Prompt** (`/pabrik`), dan **Gallery** (`/gallery`) siap digunakan.

---

## 3. Cara Update di VPS Saat Ada Perubahan Kode Baru

Cukup jalankan di folder project pada VPS:

```bash
git pull origin master
docker compose up -d --build
```

Data database PostgreSQL (`pgdata`), video (`./data/videos`), dan foto upload (`./data/uploads`) tersimpan di *volume* sehingga **tidak akan hilang** saat container di-*rebuild* atau di-*restart*.

---

## 4. Opsional: Pasang Domain & HTTPS (Nginx Host / Cloudflare)

Jika ingin menggunakan domain (misalnya `kurmaflow.domainanda.com`):
- Arahkan A Record domain ke IP VPS Anda.
- Atau ubah `WEB_PORT=80` di dalam file `.env` lalu jalankan `docker compose up -d`.
