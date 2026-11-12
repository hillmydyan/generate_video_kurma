# PRD — SnapGen Studio: Dashboard Generator Video & Gambar Multi-Model (snapgen.ai)

> **Status:** Draft · **Versi:** 1.6 · **Tanggal:** 12 November 2026
> **Owner:** Internal · **Audience:** Developer, DevOps, Product, Desain
> **Basis:** project baru, dibangun dari nol tanpa memakai ulang kode project lain. **Tampilan mengikuti file Figma SnapGen Studio** (4 layar: Studio, Pabrik Video, Gallery Kreasi, Admin Panel; §7, §8).

> **Perubahan v1.1 (12 Nov 2026):**
> - Divisi awal: **Kantor A** dan **Kantor B**, masing-masing 15 anggota tim marketing.
> - Tahap awal memakai **2 API key total** (1 per kantor) karena keterbatasan biaya; slot akun sekunder menjadi opsional (§5).
> - Tidak ada saling pinjam key antar divisi (§5, §15).
> - Ambang peringatan kredit rendah dinaikkan dari 100 ke 300 kredit (§5).
> - Satu generate = satu klip 5–10 detik; penggabungan klip jadi video panjang di luar cakupan (§3.3, §15).
>
> **Perubahan v1.2 (12 Nov 2026):**
> - **Pembatasan model per divisi:** Super Admin menentukan model yang boleh dipakai tiap kantor dan model default-nya; user tidak bisa memilih model di luar daftar itu (§3.4, §6.2, §7.4, §7.6, §7.7, §11, §12).
>
> **Perubahan v1.3 (12 Nov 2026):**
> - **Project fresh:** semua rujukan ke FlowStudio / `intercept-google-flow` dihapus; daftar "Di Luar Cakupan" dibersihkan dari sisa project lama (§15).
> - **Stack baru:** frontend React + Vite (SPA) disajikan Nginx, menggantikan Next.js; database PostgreSQL saja, SQLite dihapus (§12, §13).
> - **Desain:** §7 (tata letak & menu) dan §8 (token visual) akan disesuaikan dengan file Figma; isi saat ini berstatus sementara (§16).
>
> **Perubahan v1.4 (12 Nov 2026) — desain Figma dimasukkan:**
> - **§7 ditulis ulang mengikuti Figma:** navigasi jadi navbar atas (tanpa sidebar); tiap halaman punya tabel pemetaan elemen Figma → data nyata, karena isi contoh di Figma (model Runway/Luma/Midjourney, metrik GPU/cluster) adalah placeholder.
> - **Studio:** satu prompt = satu klip, dengan canvas, timeline, dan prompt dock; form multi-prompt dihapus. Tambahan dari Figma: "Perkaya Prompt" dan dikte suara.
> - **Pabrik Video diganti jadi batch matriks** (Multi-Prompt / Multi-Aset / Matriks CSV, formula prompt dengan variabel, Jeda/Batal, unduh ZIP). Alur lama "foto model + link produk → gambar → video" **dihapus**.
> - **Gallery:** grid aset dengan centang & unduh ZIP, strip statistik, pagination 24; tidak lagi dikelompokkan per batch.
> - **Admin:** tab Overview Sistem / Alokasi Divisi / Kesehatan Engine / Audit Log sesuai Figma, ditambah tab Akun dan Users yang belum ada desainnya.
> - **§8:** token warna diverifikasi dari export Figma (tetap tema gelap).
>
> **Perubahan v1.5 (12 Nov 2026) — layar yang belum ada di Figma dilengkapi:**
> - Ditambahkan spesifikasi tampilan untuk **Login** (§7.3), tab Admin **Alokasi Divisi, Kesehatan Engine, Audit Log, Akun, Users** (§7.7), **popup, panel & state** (§7.8), dan **tampilan mobile** (§7.9), semuanya disesuaikan dari gaya 4 layar Figma.
> - Asumsi v1.4 ditetapkan sebagai keputusan: alur Pabrik lama dihapus, aturan kombinasi Pabrik, Pabrik hanya video (§16).
> - Kuota user bisa diatur per divisi (§6.5); konfigurasi LLM untuk Perkaya Prompt (§13).
>
> **Perubahan v1.6 (12 Nov 2026) — dokumentasi API snapgen.ai dimasukkan:**
> - **Lampiran A (§18) baru:** base URL, auth `x-api-key`, endpoint tiap model beserta parameternya, respons submit, polling hasil, dan cek saldo, diambil dari `openapi.json` dan halaman "Extend Veo".
> - Progres task memakai persen nyata dari API (`status_percentage`); biaya memakai `estimated_credit` / `used_credit` dari API; saldo dari `GET /uapi/v1/account` (§3.3, §4, §5, §6.3).
> - Durasi tiap model disesuaikan dengan API (mis. Kling 3–15 dtk); API juga punya Extend dan Storyboard untuk video lebih panjang, dicatat sebagai keputusan terbuka (§16).
> - Model yang endpoint atau id-nya belum terdokumentasi (Omni Flash, Minimax, Nano Banana, Black Forest Labs, Vela AI, Muse AI) dinonaktifkan dulu di katalog (§3.1).

---

## 1. Ringkasan Eksekutif

**SnapGen Studio** adalah web dashboard internal untuk menghasilkan, memantau, dan mengelola video & gambar AI memakai **API snapgen.ai** (Veo, Kling, Seedance, Grok, Nano Banana, dll.). Satu antarmuka untuk banyak divisi dan anggota: pilih model, tulis prompt (+ gambar referensi), lihat biaya kredit & **estimasi waktu** sebelum kirim, pantau antrean real-time, dan unduh hasil dari galeri terpusat.

### Pernyataan Masalah
Memakai snapgen.ai langsung berarti satu akun dipakai bergantian tanpa kontrol: tidak ada pembagian kuota antar anggota, kredit habis tanpa peringatan, tidak ada antrean bersama per divisi, tidak ada estimasi kapan hasil jadi, dan hasil tersebar di banyak sesi browser.

### Proposisi Nilai

| Dimensi | snapgen.ai manual | SnapGen Studio |
|---|---|---|
| **Akun per divisi** | Login/ganti akun manual | 1 API key per divisi (Kantor A, Kantor B), terpisah antar divisi; slot sekunder opsional untuk rotasi otomatis |
| **Pilihan model** | Pilih per halaman model | Satu Studio: semua model video & gambar + biaya kredit tampil sebelum kirim |
| **Estimasi waktu** | Tidak ada | Estimasi per model + ETA antrean, belajar dari durasi aktual |
| **Manajemen antrean** | Per tab browser | Antrean server-side per divisi, adil (round-robin) antar anggota |
| **Kuota & monitoring** | Tidak ada | Kuota per user (rolling window), saldo kredit per akun, status real-time (SSE) |
| **Hasil** | Tersebar | Galeri terpusat, reuse prompt 1-klik, unduh satuan atau ZIP |
| **Generate massal** | Satu per satu | Pabrik Video: satu formula prompt + aset → puluhan variasi sekaligus |

---

## 2. Target Pengguna & Peran

| Segmen | Deskripsi | Use case utama |
|---|---|---|
| Content Creator | Anggota divisi pembuat konten | Generate video 9:16 produk/iklan |
| Prompt Engineer | Mengiterasi prompt & model | Membandingkan model, reuse prompt |
| Admin Divisi | Pengelola anggota divisi | Memantau antrean & kuota divisinya |
| Super Admin | Pengelola sistem | Akun/API key, divisi, user, kode reset, log |

### Matriks peran (RBAC)

| Kemampuan | SUPER_ADMIN | DIVISION_ADMIN | DIVISION_MEMBER |
|---|---|---|---|
| Generate, galeri, Pabrik Video milik sendiri | ✓ | ✓ | ✓ |
| Lihat/hapus task anggota divisinya | ✓ (semua) | ✓ (divisi sendiri) | – |
| Kelola user | ✓ (semua) | ✓ (divisi sendiri, tak bisa membuat SUPER_ADMIN) | – |
| Kelola divisi (buat/ubah/hapus) | ✓ | – | – |
| Akun snapgen & API key, katalog model, rotasi | ✓ | lihat saja (saldo kredit) | – |
| Model yang diizinkan & model default per divisi | ✓ | lihat saja | – |
| Kode reset password | ✓ | – | – |
| Perkaya Prompt (LLM) | ✓ | ✓ | ✓ |
| Admin Panel: audit log, kesehatan engine, "Uji cepat" | ✓ | ✓ (divisi sendiri) | – |

Aturan:
- User pertama yang mendaftar di DB kosong otomatis **SUPER_ADMIN**; setelah itu registrasi mandiri tertutup.
- Endpoint admin yang dipanggil non-admin menjawab **404** (bukan 403) agar keberadaannya tidak bocor.
- `/api/users/{id}/*` hanya untuk pemiliknya (`require_self`); admin memakai endpoint `/api/admin/*`.
- Divisi bawaan: `default` ("Umum"). Divisi awal yang dibuat saat setup: `kantor_a` ("Kantor A") dan `kantor_b` ("Kantor B"), masing-masing 15 anggota tim marketing dengan akun login sendiri-sendiri. Username konvensi `<nama>_<divisi>`.

---

## 3. Katalog Model & Kredit (sumber: snapgen.ai/pricing, diakses 11 Nov 2026)

### 3.1 Model

| Jenis | Model (label UI) | Kredit / generate | Catatan |
|---|---|---|---|
| Video | Veo | 7 | Paket Veo Max: video ≤ 8 dtk |
| Video | Omni Flash | 5 | |
| Video | Grok Video | 10 | |
| Video | Bytedance Seedance | 20 | |
| Video | Kling | 26 | |
| Video | Minimax | 1 | |
| Gambar | Nano Banana | 3 | |
| Gambar | Grok Image | 2 | |
| Gambar | Black Forest Labs | 2 | |
| Gambar | Vela AI | 2 | |
| Gambar | Muse AI | 1 | |
| Gambar | GPT Image 2 | *belum tercantum* ("50% OFF") | Wajib diisi admin sebelum diaktifkan |

Status dukungan API per model (detail di Lampiran A.2):

| Model | Endpoint di OpenAPI | Status katalog awal |
|---|---|---|
| Veo, Grok Video, Bytedance Seedance, Kling | Ada | Aktif (Veo & Seedance: nilai `model` perlu dikonfirmasi) |
| Grok Image, GPT Image 2 | Ada | Aktif (GPT Image 2: kredit diisi dari `estimated_credit` uji pertama) |
| Nano Banana, Black Forest Labs, Vela AI, Muse AI | Kemungkinan lewat `generate_image`, nilai `model` belum terdokumentasi | Nonaktif sampai dikonfirmasi |
| Omni Flash, Minimax | Tidak ada | Nonaktif sampai dikonfirmasi |

### 3.2 Paket akun snapgen

| Paket | Harga | Isi |
|---|---|---|
| Free | $0 | Semua model, pemakaian dasar |
| Premium (pay-as-you-go) | $10 = 2.000 kredit (promo 100% bonus) | Semua model, **akses API**, rate limit lebih tinggi |
| Veo Max | $20/bulan | ≤ 300 video Veo/hari, 6.000/bulan, 5 paralel, ≤ 8 dtk, **tanpa API** |
| Image Max | $10/bulan | 50 Grok + 200 Nano Banana/hari, 5 paralel, **tanpa API** |
| Enterprise | Custom | – |

> Karena integrasi memakai API, akun yang dipasang **harus paket dengan akses API** (Premium/Enterprise). Veo Max/Image Max tidak bisa dipakai lewat sistem ini.

### 3.3 Katalog config-driven
- Katalog disimpan di `config/models.json` (di-track git) dan dapat diubah Super Admin dari Admin › Kesehatan Engine tanpa restart.
- Skema per model:
  ```json
  {
    "key": "kling", "label": "Kling", "type": "video",
    "credits": 26, "enabled": true,
    "options": { "aspect": ["9:16","16:9","1:1"], "duration": [5,10] },
    "supports_image_ref": true,
    "est_seconds": 240,
    "endpoint": "/uapi/v1/video-gen/kling", "body": "form",
    "provider_model_id": "kling-video-3-0",
    "provider_params": { "mode": "standard" }
  }
  ```
- **Satu generate = satu klip.** Pilihan durasi di katalog awal dibatasi 5–10 detik, walau API mengizinkan lebih (Kling 3.0: 3–15 dtk; Kling 4.0: 3–30 dtk; Lampiran A.2). Video yang lebih panjang untuk sementara disusun user di aplikasi edit; opsi Extend/Storyboard dari API dicatat di §16.
- `endpoint`, `body` (`multipart` / `form`), `provider_model_id`, dan `provider_params` (parameter tetap per model, mis. `mode`) diisi dari Lampiran A. `options` hanya boleh berisi nilai yang diterima endpoint model itu; adapter menerjemahkan nama parameter yang berbeda antar endpoint (mis. rasio 9:16 → `portrait` untuk Grok).
- Angka `credits` di katalog hanya untuk **pratinjau** sebelum kirim. Biaya nyata tiap task diambil dari `estimated_credit` (respons submit) lalu `used_credit` (riwayat); bila berbeda dari katalog lebih dari 3 kali berturut-turut, admin mendapat alert untuk memperbarui katalog.
- `GET /api/models` mengembalikan katalog aktif ke frontend; biaya total dihitung server (`credits × jumlah output`) dan dikembalikan sebagai pratinjau.
- Model default: **Video → Veo**, **Gambar → Grok Image** untuk sementara; kembali ke Nano Banana setelah nilai `model`-nya dikonfirmasi (bisa diubah di `config.json`: `DEFAULT_VIDEO_MODEL`, `DEFAULT_IMAGE_MODEL`).

### 3.4 Pembatasan model per divisi

Tujuan: kantor bisa dikunci ke model tertentu (mis. hanya Veo) supaya hasil seragam dan biaya kredit terkendali; user tidak bisa mengganti ke model lain.

- Setiap divisi punya **daftar model yang diizinkan** (`allowed_models`, berisi `key` model) yang diatur Super Admin dari kartu divisi (Admin › Alokasi Divisi). Daftar **kosong = semua model aktif diizinkan** (perilaku bawaan).
- Model yang bisa dipakai user = model `enabled` di katalog **dan** ada di `allowed_models` divisinya. Toggle `enabled` tetap berlaku global; `allowed_models` mempersempitnya per divisi.
- Setiap divisi punya **model default** sendiri (`default_video_model`, `default_image_model`); bila kosong, memakai default global (`DEFAULT_VIDEO_MODEL`, `DEFAULT_IMAGE_MODEL`). Model default harus termasuk daftar yang diizinkan.
- Video dan gambar diatur dalam satu daftar. Bila tidak ada model video (atau gambar) yang diizinkan, jenis itu dinonaktifkan untuk divisi tersebut. **Pabrik Video butuh minimal 1 model video** yang diizinkan.
- **Ditegakkan di server:** `GET /api/models` hanya mengembalikan model yang diizinkan untuk divisi pemanggil, dan intake menolak model di luar daftar (§6.2). Menyembunyikan pilihan di UI saja tidak cukup.
- **Berlaku untuk semua jalur:** Studio, Pabrik Video (semua mode, termasuk Matriks CSV), Reuse dari Gallery (bila model lama sudah tidak diizinkan → diganti model default divisi + `note-warn`), dan "Uji cepat".
- **Pengecualian:** SUPER_ADMIN tidak dibatasi (untuk uji model). DIVISION_ADMIN mengikuti batasan divisinya dan hanya bisa melihat daftarnya.
- Perubahan daftar hanya memengaruhi kiriman baru; task yang sudah di antrean tetap diproses dengan model semula.
- Konfigurasi awal Kantor A dan Kantor B belum ditentukan (§16).

---

## 4. Estimasi Waktu Generate

Tujuan: user tahu **berapa lama** sebelum menekan Generate, dan berapa lama lagi untuk task yang sedang berjalan.

- **Estimasi dasar per model:** `est_seconds` di katalog (nilai awal = asumsi, wajib diukur saat uji M1).
- **Progres nyata:** selama task berjalan, persen progres diambil dari `status_percentage` API (Lampiran A.4). Estimasi waktu di bawah dipakai untuk "sisa ≈ m:ss" dan sebagai cadangan bila persen tidak bergerak. `delay_seconds` dari respons submit ditambahkan ke ETA.
- **Belajar dari data:** setiap task selesai mencatat `gen_sec` (submit → hasil siap) di tabel `prompt_behavior`. Estimasi efektif = **median `gen_sec` 20 task terakhir yang selesai** untuk model+opsi tersebut; fallback ke `est_seconds` bila < 5 sampel.
- **ETA antrean:** `eta = (posisi_dalam_antrean_divisi / slot_paralel_divisi) × est_model + est_model`. `slot_paralel_divisi` = jumlah akun aktif divisi × `MAX_INFLIGHT_PER_ACCOUNT`.
- **Tampil di:**
  - Popup model (Studio) dan select model (Pabrik): "≈ 3 mnt".
  - Baris hint prompt dock Studio: "Biaya 26 KR · estimasi ≈ 3 mnt"; note sukses: "estimasi selesai ≈ HH:MM WIB".
  - Canvas Studio & kartu aset Gallery: *Queued* → "mulai ≈ m:ss"; *Generating* → cincin progres waktu berjalan vs estimasi + "sisa ≈ m:ss" (jika lewat estimasi: "lebih lama dari biasanya").
  - Pabrik: "estimasi ≈ m mnt" di kartu biaya, ESTIMASI SISA di kartu batch aktif.
- Endpoint: `GET /api/queue/outlook` (posisi, ETA per task antre) dan field `est_seconds`, `started_at` di setiap task.
- Format durasi memakai `fmtDuration` ("45s", "3m 10s", "1j 5m").

---

## 5. Akun snapgen & Rotasi (1 akun per divisi, sekunder opsional)

> **Keputusan v1.1:** karena keterbatasan biaya, tahap awal memakai **2 API key total**: 1 untuk Kantor A dan 1 untuk Kantor B. Key tidak saling dipinjam antar divisi, supaya gangguan di satu kantor tidak memperlambat antrean atau menguras kredit kantor lain.

- **Akun = 1 API key snapgen.ai** (paket ber-API). Disimpan terenkripsi di DB (`provider_accounts.api_key_enc`, kunci dari `ACCOUNT_KEY_SECRET` di `.env`); UI hanya menampilkan 4 karakter terakhir.
- **Setiap divisi punya 1 akun wajib (`primary`) dan 1 slot `secondary` opsional.** Tahap awal: Kantor A → key A, Kantor B → key B, slot sekunder kosong.
- **Peringatan kartu divisi** (Admin › Alokasi Divisi) hanya muncul bila divisi **tidak punya akun primer aktif**. Peringatan "kurang dari 2 akun" mati secara default (`REQUIRE_SECONDARY_ACCOUNT`, default `false`).
- **Akun terikat ke satu divisi.** Key satu divisi tidak pernah dipakai divisi lain secara otomatis (tidak ada failover lintas divisi).
- **Penanganan gangguan akun primer** (kode HTTP di bawah masih asumsi; OpenAPI hanya mencantumkan 422, pemetaan final dari uji M1, Lampiran A.7):
  - respons 401/403 (key tidak valid) → akun ditandai **expired**;
  - 402 / kredit < biaya → akun ditandai **kredit habis**;
  - 429 / rate limit → **circuit breaker** (jeda eksponensial 60 dtk → maks `ACCOUNT_BREAKER_MAX_SEC`, default 1800), lalu lanjut otomatis di akun yang sama;
  - bila slot sekunder **terisi** → submit berpindah ke sekunder; bila **kosong** → task menunggu di antrean sampai akun primer pulih (isi ulang kredit, ganti key, atau breaker selesai);
  - opsional (hanya bila sekunder terisi): rotasi tiap `ROTATION_EVERY_OUTPUTS` output (default 0 = mati) untuk meratakan pemakaian.
- Bila tidak ada akun divisi yang tersedia: task tetap **queued** (tidak gagal), kartu divisi & banner Studio menampilkan "Akun divisi sedang tidak tersedia — antrean ditahan", alert webhook terkirim.
- **Pinning task:** task yang sudah dikirim ke provider terikat pada akun itu (`account_id`) — polling hasil selalu memakai akun yang sama.
- **Saldo kredit:** dibaca dari `GET /uapi/v1/account` → `user_credit.available_credit` (Lampiran A.6; `locked_credit` ditampilkan sebagai "tertahan"; cache `CREDITS_TTL_SEC`, default 300), ditampilkan per akun; di bawah `CREDIT_BALANCE_FLOOR` (default **300**, dinaikkan dari 100 karena tidak ada akun cadangan) → badge amber + alert, supaya ada waktu isi ulang sebelum antrean berhenti.
- **Status akun:** `Aktif`, `Kredit rendah`, `Kredit habis`, `Rate-limited (sisa m:ss)`, `Expired`, `Nonaktif`. Penghitung: output hari ini, output total, kredit terpakai hari ini.
- **Pemindahan manual (darurat):** Super Admin dapat memindahkan akun ke divisi lain atau menekan "Jadikan primer" dari Admin › Akun; tindakan ini tidak menandai akun lama sebagai bermasalah.
- **Menambah key nanti:** key ketiga/keempat cukup dipasang di slot sekunder dari Admin › Akun; rotasi otomatis langsung berlaku tanpa perubahan sistem.

---

## 6. Alur Task & Antrean

### 6.1 Siklus status
`queued → generating → downloading → completed`, atau `→ failed` dari mana saja.
- Tidak ada status `scheduled` — semua task langsung masuk antrean.
- *In-flight* = queued + generating + downloading.

### 6.2 Intake (`POST /api/users/{id}/generate`)
Body:
```json
{
  "model_key": "veo", "media_type": "video",
  "options": { "aspect": "9:16", "duration": 8 },
  "entries": [ { "prompt": "…", "count": 2, "image_path": "uploads/…" } ],
  "image_mode": "shared | per_entry | none",
  "clear_pending": false
}
```
Validasi berurutan: rate limit intake (`GENERATE_INTAKE_PER_MIN`), model aktif, **model diizinkan untuk divisi user** (bila tidak → 403 `model_not_allowed`, §3.4) & opsi valid, maks 50 output per kirim, kuota user, guard duplikat (batch identik dalam `DUP_WINDOW_SEC`), peringatan topik sudah dibuat (`TOPIC_DONE_DAYS`). Respons: `{queued, tasks[], quota, warnings[], estimate: {per_output_sec, total_sec}, credits_total}`.

### 6.3 Worker
- **Satu antrean + satu worker per divisi.** Satu batch berisi task dari satu user; antar user bergiliran **round-robin**.
- `MAX_BATCH_SIZE` (default 4), jeda antar submit `SUBMIT_GAP_SEC`, maks in-flight per akun `MAX_INFLIGHT_PER_ACCOUNT` (default 2; maks 5 sesuai batas paralel snapgen).
- Adapter `SnapgenClient` (kontrak di Lampiran A): `submit(task)` → `POST` ke `endpoint` model dengan header `x-api-key` → simpan `uuid` sebagai `provider_job_id` dan `estimated_credit`; `poll(uuid)` → `GET /uapi/v1/history/{uuid}` tiap `POLL_INTERVAL_SEC` (default 10) → `status` 1/2/3 + `status_percentage`; `download()` dari `generated_video[0].video_url` atau `generated_image[0].file_download_url` ke `data/videos/<user>/` atau `data/images/<user>/` sebelum `expired_at`; `account()` → `GET /uapi/v1/account`. Semua pemanggilan snapgen hanya lewat adapter ini.
- **Idempoten:** `provider_job_id` disimpan segera setelah submit; restart server me-*resume* polling, **tidak** submit ulang.
- **Pemeriksaan kualitas** (semua task video): probe durasi via ffprobe (< `MIN_VIDEO_SEC` → gagal), deteksi frame hitam (`BLACKDETECT`). Gagal kualitas → retry 1× di akun yang sama.

### 6.4 Pemulihan & retensi
- Watchdog tiap 60 dtk: task *generating* > `TASK_STUCK_SEC` (default 25 mnt) → requeue (maks `TASK_REQUEUE_MAX` = 2), hard limit `TASK_HARD_TIMEOUT_SEC` (90 mnt) → failed.
- Kuota dikonsumsi saat task dibuat, **dikembalikan bila task failed**.
- Retensi: media + task selesai dihapus otomatis setelah `HISTORY_RETENTION_DAYS` (3); task failed setelah `DEAD_TASK_TTL_DAYS` (2). Task yang belum selesai tidak pernah dihapus karena umur. Ledger kuota terpisah (menghapus riwayat tidak memulihkan kuota).

### 6.5 Kuota user
- `USER_QUOTA_OUTPUTS` per `USER_QUOTA_WINDOW_DAYS` (rolling; 0 = tanpa batas). Opsional `USER_QUOTA_CREDITS` (batas kredit per window).
- Kuota bisa dioverride per divisi dari Admin › Alokasi Divisi (`quota_outputs`, `quota_window_days` di tabel `divisions`; kosong = ikut setelan global).
- Catatan: satu video jadi biasanya tersusun dari beberapa klip (video 1 menit ≈ 8 klip Veo), jadi `USER_QUOTA_OUTPUTS` perlu diset cukup longgar.
- `GET /api/users/{id}/quota` → `{used, limit, remaining, window_days, next_free_at, retention_days}`.

---

## 7. Fitur & Tata Letak per Halaman

> **Sumber tampilan:** file Figma SnapGen Studio, 4 layar desktop 1280px (Studio, Pabrik Video, Gallery Kreasi, Admin Panel), export 12 Nov 2026. Tata letak, urutan elemen, dan gaya visual **mengikuti Figma**.
>
> **Isi contoh di Figma adalah placeholder**, bukan spesifikasi: nama model (Runway, Luma, Midjourney, FLUX), nama divisi, angka, serta metrik infrastruktur (node GPU, cluster, latency, FPS/frame, region server). Sistem ini memanggil API snapgen.ai dan tidak punya GPU sendiri, jadi tiap elemen dipetakan ke data nyata pada tabel "Pemetaan data" di tiap halaman. Model yang tampil selalu dari katalog (§3), divisi dari data nyata (Kantor A, Kantor B).
>
> **Belum ada di Figma, dispesifikasikan di PRD dengan gaya yang sama:** Login (§7.3), tab Admin selain Overview Sistem (§7.7), popup/panel/state (§7.8), dan tampilan mobile (§7.9).

Bahasa UI: **Indonesia**; badge status task **Inggris** (Queued, Generating, Downloading, Completed, Failed). Angka `toLocaleString("id-ID")`, kredit ditulis "1.250 KR". Semua waktu **WIB**.

### 7.1 Routing

| URL | Akses | Fungsi |
|---|---|---|
| `/` | semua | Redirect → `/studio` (login) atau `/login` |
| `/login` | publik | Masuk / reset password / buat admin pertama |
| `/studio` | semua peran | Generate satu klip/gambar: canvas + timeline + prompt dock |
| `/pabrik` | semua peran | Pabrik Video: generate massal (batch matriks) |
| `/gallery` | semua peran | Gallery Kreasi: semua hasil milik user |
| `/admin` | SUPER_ADMIN, DIVISION_ADMIN | Tab Overview Sistem / Alokasi Divisi / Kesehatan Engine / Audit Log / Akun / Users (hash URL) |
| `/api/events` | – | SSE; diteruskan Nginx ke backend dengan `proxy_buffering off` |

Guard di layout shell (React Router, `ShellLayout`): tanpa sesi → `/login`; peran tidak cocok → `/studio`; saat memuat → "Memuat sesi…".

### 7.2 Shell (semua halaman setelah login)

Navigasi memakai **navbar atas**, tanpa sidebar.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [◉] SnapGen FLOW   ( Studio  Pabrik  Gallery  Admin* )   ●Online ⚡1.250 KR (AB) │ ← Navbar 64px
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Konten (maks 1280px, padding 32px, center)                             │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ SnapGen FLOW Studio Engine / v{versi}              {status sistem}       │ ← Footer
└──────────────────────────────────────────────────────────────────────────┘
                                                            * hanya admin
```

- **Navbar** (fixed, 64px, garis bawah tipis):
  - Kiri: logo + "SnapGen" + badge mono "FLOW".
  - Menu dalam satu wadah pill: **Studio**, **Pabrik**, **Gallery**, **Admin** (hanya SUPER_ADMIN/DIVISION_ADMIN). Item aktif = pill terisi lebih terang dengan teks lebih besar.
  - Kanan: chip koneksi SSE (dot emerald "Online" / amber "Menyambung…" / rose "Offline"), **chip kredit** "⚡ 1.250 KR", avatar (menu: nama, peran · divisi, "Keluar").
- **Footer:** kiri "SnapGen FLOW Studio Engine / v{versi aplikasi}"; kanan status watchdog.

| Elemen Figma | Data nyata |
|---|---|
| Chip "1.250 KR" | Saldo kredit akun divisi user (primer + sekunder bila ada), poll 60 dtk; amber bila < `CREDIT_BALANCE_FLOOR`, rose bila habis |
| Chip "Online" | Status koneksi SSE (§9) |
| Footer "v4.2.0-cinematic" | Versi aplikasi dari build |
| Footer "Obsidian Telemetry Active" | Status watchdog: "Semua sistem aktif" / "Ada peringatan" (klik → Admin, khusus admin) |

### 7.3 `/login` (belum ada di Figma; disesuaikan dari gaya layar lain)

```
              (latar --studio-bg, tanpa navbar)

                    [◉] SnapGen FLOW
           ┌────────────────────────────────┐
           │ ● AKSES STUDIO                 │
           │ Masuk                          │
           │ USERNAME                       │
           │ [ nama.pengguna              ] │
           │ PASSWORD                       │
           │ [ ••••••••               (👁) ] │
           │ [          ⚡ Masuk           ] │
           │ Lupa password?                 │
           └────────────────────────────────┘
           SnapGen FLOW Studio Engine / v{versi}
```

- Latar gelap seperti Studio (`--studio-bg`), tanpa navbar. Brand di atas kartu; teks versi di bawah kartu (gaya footer).
- Satu kartu di tengah, maks 388px, gaya kartu §8; kicker "● AKSES STUDIO" seperti kicker halaman lain.
- Judul per mode: "Masuk" / "Setel ulang password" / "Buat akun admin pertama" (mode terakhir hanya muncul bila `GET /api/auth/bootstrap` → `open: true`).
- Field (label kicker): Username (placeholder "nama.pengguna"), Nama tampilan (register), Kode reset (`XXXX-XXXX`, mono, reset), Password / "Password baru" + toggle mata.
- Error di `note-error` (mis. "Username dan password wajib diisi.").
- Tombol utama penuh, indigo seperti tombol Generate: "Masuk" / "Setel & masuk" / "Buat akun & masuk" (spinner saat proses).
- Link bawah: "Lupa password?" ↔ "← Kembali ke masuk"; "Buat akun pertama" (bila bootstrap terbuka). Di mode reset ada hint "Minta kode reset ke admin."
- API: `/api/auth/bootstrap`, `/login`, `/register`, `/reset-password`, `/logout`, `/media-token`.

### 7.4 `/studio` — Studio

Satu prompt menghasilkan **satu** klip atau gambar. Generate massal dilakukan di Pabrik (§7.6). Latar halaman lebih gelap dari halaman lain (`--studio-bg`).

```
● CANVAS LIVE PREVIEW · KANTOR A                              ID: #SG-9821
┌──────────────────────────────────────────────────────────────────────┐
│ (●Completed) (Kling) (16:9 · 5s · 1080p)              (↻) (⤓) (⛶)   │
│                                                                      │
│                              ( ▶ )                                   │
│                                                                      │
│ Prompt: Krim pelembab herbal wajah di atas batu…       00:05 · 26 KR │
├──────────────────────────────────────────────────────────────────────┤
│ TIMELINE        [▣ 5s] [▣ 68%] [▣ Ref] [ + ]                    (🕘) │
└──────────────────────────────────────────────────────────────────────┘

     (⚡ Kling · 26 KR ▾) (▭ 16:9 ▾) (◷ 5 Detik) (▣ Aset Referensi)   ✦ Perkaya Prompt
     ┌────────────────────────────────────────────────────────────────┐
     │ Deskripsikan scene video yang ingin kamu buat…   (🎤) [⚡ Generate ↵] │
     └────────────────────────────────────────────────────────────────┘
       Tekan Ctrl + Enter · Biaya 26 KR · estimasi ≈ 3 mnt · kuota sisa 6
```

- **Baris kicker:** kiri "● CANVAS LIVE PREVIEW · {nama divisi}"; kanan "ID: #{id pendek task}".
- **Canvas** (kartu radius besar, area media 16:9; media rasio lain di-letterbox): menampilkan task yang dipilih di timeline.
  - Kiri atas: chip status, chip model, chip "rasio · durasi · resolusi".
  - Kanan atas (tombol bulat): **Ulangi** (kirim ulang prompt + setelan yang sama sebagai task baru), **Unduh**, **Layar penuh**.
  - Tengah: tombol play (video). Bawah: "Prompt: …" satu baris terpotong; kanan durasi + kredit terpakai.
  - State: *Queued* → "Antre posisi n · mulai ≈ m:ss"; *Generating* → cincin progres (persen dari API `status_percentage`; cadangan: waktu berjalan vs estimasi) + "sisa ≈ m:ss" ("lebih lama dari biasanya" bila lewat); *Failed* → pesan error + "Coba lagi"; kosong → "Belum ada hasil — tulis prompt di bawah".
- **Timeline** (strip di bawah canvas): thumbnail 24 task terakhir user (scroll horizontal, terbaru di kiri); yang dipilih berborder aksen. Lencana pojok: durasi ("5s") bila selesai, persen bila berjalan, "Ref" untuk aset referensi yang sedang dipasang. Tile "+" = unggah aset referensi. Ikon riwayat di kanan → `/gallery`.
- **Prompt dock** (di bawah, tengah, maks ±896px):
  - **Chip Model** "⚡ {label} · {kredit} KR ▾": popup **hanya berisi daftar model** (dikelompokkan Video / Gambar; tiap baris label · kredit · "≈ m mnt"), tanpa opsi lain. Hanya model yang diizinkan untuk divisi user (§3.4); bila hanya satu → chip terkunci (ikon `lock`, hint "Model ditentukan admin").
  - **Chip Rasio** (dropdown dari `options.aspect`; resolusi ikut di dropdown ini bila model punya pilihan), **Chip Durasi** (dari `options.duration`; disembunyikan untuk model gambar), **Chip Aset Referensi** (unggah/pilih gambar PNG/JPG/WEBP; nonaktif dengan hint bila model tidak menerima gambar referensi).
  - Kanan: **"✦ Perkaya Prompt"** — menulis ulang prompt di textarea agar lebih detail lewat LLM (`POST /api/prompts/enhance`); hasil bisa di-undo; disembunyikan bila LLM belum dikonfigurasi.
  - Textarea (placeholder "Deskripsikan scene video yang ingin kamu buat… (e.g. …)"), ikon mikrofon (dikte suara lewat Web Speech API; disembunyikan bila browser tidak mendukung), tombol indigo **"⚡ Generate ↵"**.
  - Baris hint: "Tekan Ctrl + Enter untuk sintesis instan · Biaya {n} KR · estimasi ≈ {m} mnt · kuota sisa {n}".
- **Peringatan** (note di atas dock): kuota kurang, kredit divisi tidak cukup, "Akun divisi sedang tidak tersedia — antrean ditahan", warnings server. Sukses: "Task masuk antrean · estimasi selesai ≈ HH:MM WIB" (hilang 9 dtk).
- **Reuse:** membaca `sessionStorage.snapgen_reuse` (diisi dari Gallery) → prefill prompt, aset, model, opsi.
- API: `GET /api/models`, `GET /api/users/{id}/quota`, `POST /api/upload`, `POST /api/users/{id}/generate` (1 entry, `count: 1`), `POST /api/prompts/enhance`, `GET /api/queue/outlook`, `DELETE /api/tasks/{id}`.

| Elemen Figma | Data nyata |
|---|---|
| "CLUSTER JAK-02" | Nama divisi user |
| "Kling v1.6 Pro", "Kling 1.6 Pro · 26 KR" | Label & kredit model dari katalog (§3.1) |
| "Pemakaian otomatis dialokasikan dari kredit divisi" | Diganti baris biaya · estimasi · kuota |

### 7.5 `/gallery` — Gallery Kreasi

- **Toolbar:** search "Cari prompt, ID aset, atau model…" (pintasan Ctrl/⌘ + K); pill filter **Semua / Video 9:16 / Video 16:9 / Gambar**; kanan select **"Status: Semua"** (Semua / Selesai / Berjalan / Gagal) dan tombol **"Unduh Terpilih (n)"** (ZIP dari aset yang dicentang; saat ada pilihan muncul juga "Hapus Terpilih").
- **Strip statistik** (4 sel dalam satu kartu): TOTAL GENERASI, OUTPUT HARI INI, ANTREAN PIPELINE, SUCCESS RATE.
- **Grid** (6 kolom di 1280px): kartu potret (9:16) selebar 1 kolom, kartu lanskap (16:9) selebar 2 kolom; 24 aset per halaman.
  - **Kartu aset:** media penuh; kiri atas chip rasio + durasi (gambar: "IMG"; resolusi bila ada); kanan atas kotak centang; overlay gradien bawah: judul (prompt, 1 baris), model (mono, aksen), kredit (amber), "n jam lalu", resolusi. Video dimuat saat masuk viewport, play saat hover. Hover: Preview, Reuse, Unduh, Hapus.
  - **Kartu berjalan:** badge amber "RENDER" + id; cincin progres % (persen dari API `status_percentage`; cadangan: waktu berjalan vs estimasi) + "sisa ≈ m:ss"; panel kecil: judul prompt, model, "ETA: ≈ n detik", "Est. n KR". *Queued*: "Antre · mulai ≈ m:ss".
  - **Kartu gagal:** border rose, pesan error singkat, "Coba lagi" & hapus.
- **Bar bawah:** kiri "Menampilkan 1 – 24 dari N kreasi • Hasil dihapus otomatis setelah N hari"; kanan pagination.
- State: loading 12 skeleton; kosong "Belum ada hasil"; filter tanpa hasil "Tidak ada yang cocok".
- **PreviewModal** (satu-satunya modal): overlay gelap + blur, maks 768px, tutup Esc. Header: prompt, id task, badge model & status. Body: player video / gambar penuh / pesan error. Footer: "Download .mp4"/"Download .png" atau "Salin pesan error". Konfirmasi hapus memakai `window.confirm`.
- API: `GET /api/tasks` (filter jenis, rasio, status, `q`, `page`), `GET /api/users/{id}/stats`, `POST /api/users/{id}/tasks/zip`, `DELETE /api/tasks/{id}`, `DELETE /api/users/{id}/tasks?ids=|status=`.

| Elemen Figma | Data nyata |
|---|---|
| TOTAL GENERASI "1.428 aset" | Jumlah aset user yang masih tersimpan |
| OUTPUT HARI INI "+84 ↗18%" | Output selesai hari ini; persen vs kemarin |
| ANTREAN PIPELINE "3 aktif render" | Task in-flight milik user |
| SUCCESS RATE GPU "98.4% A100/H100" | Completed ÷ (completed + failed) 7 hari terakhir; label GPU dihapus; sparkline = per hari |
| "Frame 86/120" | Tidak tersedia dari API → diganti "sisa ≈ m:ss" |
| "Server Region: Jakarta Edge 01" | Diganti catatan retensi |

### 7.6 `/pabrik` — Pabrik Video

Generate massal: satu konfigurasi menghasilkan banyak tugas (batch). Setiap sub-tugas adalah task biasa yang masuk lewat intake yang sama (§6.2), sehingga kuota, antrean, estimasi, dan pembatasan model berlaku sama.

- **Kartu header:** kicker "BATCH PIPELINE ENGINE", judul "Pabrik Video", subjudul; kanan chip "n BATCH AKTIF" dan chip slot paralel.
- **Dua kolom** (kiri ±500px = form; kanan = batch aktif + antrean sub-tugas).

**Kiri — "Konfigurasi Parameter Batch"** (kanan atas "ID: B-{nomor}-NEW"):
1. **Nama batch kampanye** (input, wajib, maks 80 karakter).
2. **Mode matriks generasi** (segmented):
   - **Multi-Prompt:** formula prompt + nilai variabel → kombinasi = hasil kali jumlah nilai tiap variabel; aset terpilih dipasangkan bergiliran ke kombinasi.
   - **Multi-Aset:** satu prompt dijalankan untuk tiap aset terpilih → kombinasi = jumlah aset; `{product_name}` diisi dari label aset.
   - **Matriks CSV:** unggah CSV; tiap baris = satu kombinasi (kolom = nama variabel, opsional kolom `aset`); template bisa diunduh; baris tidak valid ditampilkan dengan alasannya.
3. **Aset master produk** ("n/10 terpilih", PNG/JPG/WEBP): grid thumbnail 4 kolom dengan nama file, tile "+ TAMBAH"; maks 10 aset, tiap file ≤ `UPLOAD_MAX_MB`.
4. **Model & parameter output** (4 select): Model video (hanya yang diizinkan divisi, §3.4), Rasio kanvas, Durasi klip, Variasi per prompt (1–4).
5. **Formula prompt dinamis:** textarea dengan token variabel `{nama}` yang disorot; tombol "+ {product}" dan "+ {lighting}" menyisipkan token; klik token membuka popover untuk mengisi daftar nilainya (satu per baris). Di bawahnya validator: "Syntax Validator: Valid (n variabel terdeteksi)" dan "n Kombinasi Terhitung".
6. **Estimasi biaya komputasi:** "{N} Video × {kredit} KR = {total} KR"; badge "SALDO CUKUP" / "SALDO KURANG"; "Sisa: {saldo − total} KR"; ditambah "estimasi ≈ m mnt" dan peringatan kuota.
7. **CTA** (indigo, penuh): "Mulai Batch Pabrik ({N} Tugas)".

Jumlah tugas = kombinasi × variasi per prompt, maks `FACTORY_MAX_TASKS` (default 50) per batch.

**Kanan atas — kartu batch aktif** (garis progres gradien di tepi atas):
- "Batch #B-{nomor}" + badge status (ANTRE / SEDANG RENDERING / DIJEDA / SELESAI / SELESAI SEBAGIAN / DIBATALKAN), judul batch; tombol **Jeda** / **Lanjut** dan **Batal**.
- 4 angka: PROGRES RENDER (%), VIDEO SELESAI (n/N), ESTIMASI SISA (~m s), THROUGHPUT (video selesai per menit, 10 menit terakhir).
- Bar progres; di bawahnya "n / N Video Siap Ekspor" dan "Pipeline: {model}".
- **Jeda:** sub-tugas yang belum dikirim ditahan, yang sedang berjalan diselesaikan. **Batal:** sub-tugas yang masih antre dibatalkan dan kuotanya dikembalikan.
- Bila ada lebih dari satu batch: pemilih batch (dropdown riwayat) di kartu ini.

**Kanan bawah — "Antrean Sub-Tugas Multi-Skenario":**
- Tab: Semua (n) / Rendering (n) / Selesai (n) / Antre (n) (+ Gagal bila ada).
- Baris sub-tugas: thumbnail (cincin % bila rendering, lencana durasi bila selesai, ikon jam pasir bila antre); "#{no} • {aset} / {label kombinasi}" + badge status; "Variasi {A–D} • {prompt terisi}"; baris detail: rendering → "sisa ≈ n dtk"; selesai → "1080×1920 MP4 · 14,8 MB · Rendered in 52s" + tombol **Preview**; antre → "Menunggu slot" + "Posisi: n". Menu ⋮: Batalkan / Ulangi.
- Bar bawah: "Hasil tersimpan di Gallery · dihapus otomatis setelah N hari"; tombol **"Unduh Batch ZIP (n Selesai)"**.

Update lewat SSE (`task_update`, `factory_update`). Batas batch aktif per user: `FACTORY_MAX_CONCURRENT`.

API: `POST /api/factory/preview` (validasi formula → kombinasi, biaya, estimasi), `GET|POST /api/users/{id}/factory/batches`, `GET …/batches/{id}`, `POST …/batches/{id}/pause|resume|cancel`, `GET …/batches/{id}/zip`, `GET /api/factory/template.csv`.

| Elemen Figma | Data nyata |
|---|---|
| "12 Node GPU Siap" | "Slot paralel: n" = akun aktif divisi × `MAX_INFLIGHT_PER_ACCOUNT` |
| Tag "AUTO-SYNC" di nama batch | Dihapus (draf form disimpan otomatis di browser) |
| "Thread GPU #04: Active Multi-sampling" | "Akun {Primer/Sekunder} · n sedang diproses" |
| "Latency: 48ms" + sparkline | Dihapus |
| "Frame 94/120 · FPS: 24 · Est: 14s" | "sisa ≈ n dtk" (frame/FPS tidak tersedia dari API) |
| "Node #03", "Menunggu alokasi GPU Node #03" | Dihapus / "Menunggu slot" |
| "Semua klip otomatis diekspor ke Google Drive / Pabrik_B104" | Di luar cakupan v1 (§15) → diganti catatan Gallery & retensi |

### 7.7 `/admin` — Admin Panel

- **Header:** kicker "● KONSOL SISTEM & DIVISI / ID: {nama instance}", judul "Admin Panel", subjudul; kanan **tab pill**: Overview Sistem · Alokasi Divisi · Kesehatan Engine · Audit Log · **Akun** (Super Admin) · **Users**. Dua tab terakhir belum ada di Figma. Tab aktif disimpan di hash URL.
- Data dipoll saat tab terlihat (§9); DIVISION_ADMIN hanya melihat data divisinya.

**Overview Sistem** (sesuai Figma):
1. **Empat kartu statistik** (pemetaan di tabel bawah).
2. **Kartu "Alokasi Kuota Divisi"** (kiri): subjudul; tombol aksen "+ Tambah Alokasi" (= buat divisi baru, Super Admin). Tabel: UNIT DIVISI (nama; "n Akun • Lead: {nama}"), KUOTA PRIMER, SEKUNDER, GENERASI, STATUS, AKSI (ikon `tune` → panel atur divisi: ubah nama, **atur model** §3.4, kuota user, hapus). Bawah: status sinkron saldo (klik = refresh `/api/admin/credits?refresh=1`) dan "Lihat Semua Divisi →" (ke tab Alokasi Divisi).
3. **Kartu status antrean** (kiri bawah, ikon `auto_awesome`) + chip "Load: n%".
4. **Kartu "Health Metric Engine"** (kanan) + chip status keseluruhan: satu baris per **model aktif** di katalog: nama, waktu generate median, bar success rate, output 24 jam.
5. **Kartu terminal audit** (kanan bawah, tiga dot + "audit.stream.pipe" + "● LIVE WIB"): 10 baris log terakhir (live tail 3 dtk), "Buffer: n/2048 records", "Unduh Log (.json)".

| Elemen Figma | Data nyata |
|---|---|
| PENGGUNAAN TOTAL KREDIT "14.820 / 20.000 KR", "74,1% terpakai", "+1.140 KR 24j" | Kredit terpakai bulan ini ÷ (terpakai + saldo semua akun); persen; kredit terpakai 24 jam |
| STATUS WORKER CLUSTER "8 / 10 Aktif Online", "Worker: Kling-4, Gen3-2…", "2 Standby Hot-Spare" | Akun aktif ÷ total akun; "Worker: {divisi yang worker-nya berjalan}"; jumlah akun sekunder terpasang |
| DIVISI & OPERATOR "6 Unit Bisnis", "28 Akun Operator Bersertifikasi", "Concurrency avg 19 pipeline" | Jumlah divisi; jumlah user aktif; task in-flight saat ini |
| RATE LIMIT TELEMETRY "85% Tier Cap", "Runway Gen-3 Provider Pool", "Siap Dialihkan" | In-flight ÷ kapasitas paralel (puncak 1 jam); akun yang sedang rate-limited + sisa breaker; status "Normal" / "Antrean ditahan" |
| Kolom KUOTA PRIMER / SEKUNDER | Saldo kredit akun primer / sekunder divisi ("–" bila slot kosong) |
| Kolom GENERASI "1.432 vids" | Output selesai divisi bulan ini |
| STATUS CUKUP / LOW / DEPLETED | Saldo ≥ `CREDIT_BALANCE_FLOOR` / di bawahnya / kredit habis atau key expired |
| "6 Akun • Lead: Rian W." | Jumlah anggota • nama DIVISION_ADMIN |
| "Syncing with Billing Engine v4" | "Saldo diperbarui n dtk lalu" |
| "Batch Generator Ready — kapasitas 48 job simultan tanpa antrean", "Load: 31%" | "Antrean kosong — n slot paralel siap" atau "n task antre"; in-flight ÷ kapasitas |
| Baris Health: "Kling AI Engine v1.5", "Latency: 420ms", "Throughput 98.4%", "Worker: 4/4 Online" | Model katalog; median waktu generate ("≈ 3m 10s"); success rate 24 jam; output 24 jam. Bar emerald ≥ 95%, amber < 95% atau akun rate-limited, rose < 80% |
| "All Systems Active" | Ringkasan watchdog (§14) |

Lima tab berikut belum ada di Figma. Semuanya memakai komponen yang sama dengan Overview Sistem (kartu statistik, tabel bergaris zebra, kartu terminal, chip status) supaya terlihat satu keluarga.

**Alokasi Divisi**

```
[ Divisi: 2 ] [ Total saldo: 3.400 KR ] [ Divisi bermasalah: 0 ]
┌ Alokasi Kuota Divisi ───────── [+ Tambah Alokasi] ┐ ┌ Detail Divisi ──────────┐
│ UNIT DIVISI  PRIMER  SEKUNDER  GENERASI  MODEL    │ │ Kantor A   id: kantor_a │
│              ANGGOTA  STATUS   AKSI               │ │ AKUN  [Primer] [+Sekunder]│
│ Kantor A   1.900 KR   –   412 vids  VEO · NANO    │ │ MODEL DIIZINKAN  ☑ ☑ ☐  │
│ Kantor B   1.500 KR   –   388 vids  Semua model   │ │ KUOTA USER  [10] / [3] hr│
└───────────────────────────────────────────────────┘ │ ANGGOTA (15)  Kelola →  │
                                                      │ [Hapus divisi]          │
                                                      └─────────────────────────┘
```

- **Atas:** 3 kartu statistik kecil: jumlah divisi, total saldo semua akun, jumlah divisi berstatus LOW/DEPLETED.
- **Kiri (2/3):** tabel divisi lengkap. Kolom sama dengan Overview ditambah MODEL (chip model diizinkan atau "Semua model") dan ANGGOTA. Klik baris = pilih divisi.
- **Kanan (1/3) — "Detail Divisi"** (untuk divisi terpilih; di Overview dibuka sebagai panel samping lewat ikon `tune`):
  - Nama (edit inline) dan id divisi.
  - **Akun:** 2 kartu slot. Primer: label, `••••abcd`, saldo, badge status. Sekunder kosong: tile garis putus "+ Pasang akun sekunder" (Super Admin).
  - **Model diizinkan** (§3.4): checklist dikelompokkan Video / Gambar, select default video & default gambar, tombol "Simpan". DIVISION_ADMIN hanya melihat.
  - **Kuota user:** output per window dan panjang window (hari); kosong = ikut setelan global (§6.5).
  - **Anggota:** daftar avatar + nama + peran; tautan "Kelola di Users →".
  - **Hapus divisi** (tombol danger; nonaktif bila masih ada anggota atau task in-flight).
- API `/api/admin/divisions…`.

**Kesehatan Engine**

```
( ● All Systems Active )                         watchdog: 12 dtk lalu
┌ Health Metric Engine ──────────────┐ ┌ Uji cepat generate ───────────┐
│ ● Veo        median ≈ 3m 10s       │ │ Model ▾   [prompt pendek…]    │
│ ▓▓▓▓▓▓▓▓▓░ success 98,4% · 214/24j │ │ [Kirim uji]  aktual vs estimasi│
│ ● Kling      median ≈ 4m 02s       │ └───────────────────────────────┘
│ ▓▓▓▓▓▓▓░░░ success 91,0% · 67/24j  │ ┌ Watchdog ─────────────────────┐
└────────────────────────────────────┘ │ ● credits_low   ● disk_low …  │
┌ Katalog model (Super Admin) ───────────────────────────────────────────┐
│ MODEL  JENIS  KREDIT  ESTIMASI (default / median)  AKTIF  OPSI         │
└────────────────────────────────────────────────────────────────────────┘
```

- **Kiri:** daftar model lengkap dengan baris seperti kartu Health di Overview, ditambah jumlah gagal 24 jam dan pesan error terakhir. Model nonaktif tampil redup.
- **Kanan atas — "Uji cepat generate":** select model, textarea prompt pendek, tombol "Kirim uji" → 1 task uji (`test_now`); hasil: status, durasi aktual vs estimasi, thumbnail.
- **Kanan bawah — "Watchdog":** satu baris per pemeriksaan (`credits_low`, `account_unavailable`, `disk_low`, `worker_stalled`, `failure_rate`) dengan dot status, nilai, dan waktu cek terakhir (`/api/admin/health`).
- **Bawah (lebar penuh) — "Katalog model"** (Super Admin; DIVISION_ADMIN melihat saja): tabel Model, Jenis, Kredit, Estimasi (default / median aktual), Aktif (toggle), Opsi; edit inline → `PATCH /api/admin/models/{key}`.

**Audit Log**
- Satu kartu terminal selebar konten, setinggi sisa layar; kepala kartu sama dengan kartu terminal Overview (tiga dot, "audit.stream.pipe", "● LIVE WIB").
- Toolbar di atas kartu: search "Cari di tampilan…", select level (INFO/WARN/ERROR/HEARTBEAT), filter "user / divisi", Pause/Resume, Bersihkan, "Unduh Log (.json)".
- Warna level: INFO teks biasa, WARN amber, ERROR rose, HEARTBEAT emerald. Footer "Live tail tiap 3 detik · N baris · Buffer: n/2048 records". Inkremental via `latest_seq`. API `/api/admin/logs`.

**Akun** (Super Admin)

```
[Tambah akun] [Petakan divisi otomatis] [Refresh]
┌ Key Kantor A   (● Aktif) ┐ ┌ Key Kantor B (● Kredit rendah) ┐ ┌ Rotasi ────────────┐
│ ••••abcd · Premium       │ │ ••••wxyz · Premium             │ │ ☐ Rotasi otomatis  │
│ Saldo 1.900 KR           │ │ Saldo 240 KR                   │ │ Ambang rendah [300]│
│ Hari ini 126 KR · 18 out │ │ Hari ini 310 KR · 44 out       │ ├ Kode reset ────────┤
│ Kantor A · Primer        │ │ Kantor B · Primer              │ │ ABCD-1234 [Putar]  │
│ [Uji key][Ganti key] ⋮   │ │ [Uji key][Ganti key] ⋮         │ ├ File yatim ────────┤
└──────────────────────────┘ └────────────────────────────────┘ │ 0 file  [Hapus]    │
                                                                └────────────────────┘
```

- **Toolbar:** "Tambah akun" (form inline: Label, API key, Paket, Divisi, Slot Primer/Sekunder), "Petakan divisi otomatis", "Refresh".
- **Kartu per akun** (grid 2 kolom): badge status (§5); Label, API key (`••••abcd`), Paket, Saldo kredit, Kredit terpakai hari ini, Output hari ini/total, Terakhir dipakai, Breaker (sisa m:ss), Divisi & slot. Tombol: "Uji key", "Ganti key"; menu ⋮: "Jadikan primer", "Pindah divisi", "Reset breaker", "Nonaktifkan", "Hapus".
- **Kolom kanan:** kartu "Rotasi" (toggle Rotasi otomatis dan `ROTATION_EVERY_OUTPUTS`, hanya berlaku untuk divisi yang slot sekundernya terisi; ambang kredit rendah; toggle "Wajibkan akun sekunder" `REQUIRE_SECONDARY_ACCOUNT`), kartu "Kode reset password" (tampil + "Putar kode"), kartu "File yatim" (media tanpa task, hapus).

**Users**
- **Toolbar:** search "Cari nama atau username…", pill filter divisi (Semua / Kantor A / Kantor B / …), tombol aksen "+ User baru" → form inline (Username "mis. rina", Nama, Password "minimal 6 karakter", Peran, Divisi).
- **Tabel** (gaya sama dengan tabel Alokasi), dikelompokkan dengan baris kepala per divisi: User (avatar, nama, username), Peran, Divisi, Status, Task, Kuota, Kredit terpakai, Aksi. Peran/Divisi diedit inline via select; aksi: Log aktivitas, Setel password baru, Nonaktifkan user.
- **Panel aktivitas user** (panel samping): tabel Prompt, Model, Status, Media, Durasi, Waktu (`/api/admin/tasks`).
- DIVISION_ADMIN hanya melihat dan mengelola user divisinya, dan tidak bisa membuat SUPER_ADMIN.

### 7.8 Popup, panel & state (belum ada di Figma)

Semua popup memakai permukaan `--surface-high`, radius kartu, bayangan `--elev-3`, muncul menempel pada pemicunya, dan tutup dengan Esc atau klik di luar.

| Elemen | Isi |
|---|---|
| **Popup model** (Studio; lebar ±320px) | Kicker "VIDEO" lalu "GAMBAR"; tiap baris: ikon, label, kanan "{kredit} KR · ≈ {m} mnt"; pilihan aktif bertanda centang + border aksen. Hanya model yang diizinkan. **Tidak ada opsi lain di popup ini.** Navigasi panah + Enter. |
| **Dropdown rasio** | Daftar rasio dengan ikon bentuk kecil (9:16, 16:9, 1:1); di bawahnya kicker "RESOLUSI" bila model punya pilihan. |
| **Dropdown durasi** | Daftar dari `options.duration` ("5 Detik", "8 Detik"). |
| **Popover aset referensi** (±360px) | Dropzone "Seret atau klik · PNG/JPG/WEBP · maks 10 MB" + grid 8 aset terakhir user; pilih satu; tombol "Lepas aset". |
| **Popover nilai variabel** (Pabrik) | Judul `{nama_variabel}`, textarea satu nilai per baris, penghitung "n nilai", tombol "Simpan". |
| **Menu avatar** | Nama, peran · divisi, kuota ("4/10 terpakai · sisa 6"), "Keluar". |
| **Panel samping** (kanan, 420px; bukan modal) | Detail Divisi (dari ikon `tune`) dan aktivitas user. Konten di belakang tetap terlihat. |

| Halaman | Loading | Kosong | Gagal memuat |
|---|---|---|---|
| Studio | Skeleton canvas + 5 thumbnail | Canvas: ikon + "Belum ada hasil — tulis prompt di bawah" | Note error di atas dock + "Coba lagi" |
| Gallery | 12 kartu skeleton | "Belum ada hasil" + tombol "Buka Studio"; filter tanpa hasil: "Tidak ada yang cocok" | Kartu error selebar grid |
| Pabrik | Skeleton dua kolom | Kanan: "Belum ada batch — isi konfigurasi di kiri" | Note error di kartu terkait |
| Admin | Skeleton per kartu | Tabel: "Belum ada data" | `CardError` per kartu, kartu lain tetap tampil |

### 7.9 Tampilan mobile (belum ada di Figma)

- **≤ 1024px:** menu pindah ke **bottom bar** 4 ikon berlabel (Studio `movie_filter`, Pabrik `factory`, Gallery `photo_library`, Admin `admin_panel_settings`); navbar menyisakan brand, chip kredit, avatar; chip "Online" menjadi dot saja. Padding konten 16px. Target sentuh minimal 44px.
- **Studio:** canvas selebar layar; timeline scroll horizontal; prompt dock menempel di atas bottom bar; baris chip scroll horizontal; hint diringkas jadi "{n} KR · ≈ {m} mnt".
- **Pabrik:** dua kolom menjadi dua tab ("Konfigurasi" / "Batch aktif"); grid aset 3 kolom; baris sub-tugas menjadi kartu.
- **Gallery:** grid 2 kolom (kartu lanskap selebar 2 kolom); pill filter scroll horizontal; strip statistik 2×2; "Unduh Terpilih" menjadi bar bawah saat ada pilihan.
- **Admin:** kartu statistik 2×2 (1 kolom di ≤ 640px); tab pill scroll horizontal; tabel menjadi daftar kartu per baris; kartu Health dan terminal selebar layar; panel samping menjadi layar penuh.

---

## 8. Desain Sistem "Obsidian Flow"

> **Sumber:** file Figma SnapGen Studio (export 12 Nov 2026). Nilai warna di bawah sudah dicocokkan dengan sampel piksel dari export PNG keempat layar. Ukuran font, radius, dan bayangan perlu dicek ulang langsung di Figma saat implementasi.

Hanya **mode gelap** (`color-scheme: dark`). Tailwind v4 via plugin `@tailwindcss/vite`, token di `@theme` dalam `src/index.css` (tanpa `tailwind.config`).

### 8.1 Token warna

| Grup | Token → nilai |
|---|---|
| Dasar | `--bg #09151a` (halaman), `--studio-bg #06090b` (khusus Studio), `--obsidian #0b0f17` (navbar, terminal) |
| Permukaan | `--surface-lowest #041014`, `--surface-low #111d22`, `--surface #152126`, `--surface-high #202c31`, `--surface-highest #2b373c` |
| Input & garis | `--input #1a2226`, `--border rgba(255,255,255,.08)`, `--border-solid #24333a` |
| Teks | `--text #d8e5eb`, `--muted #8f9286`, `--muted-2 #4a5a62` |
| Aksen (moss) | `--accent #9cb080`, `--accent-bright #b9ce9b`, `--accent-dim #7f9668`, `--on-accent #22330f`, `--secondary-container #2d5132` |
| Status | `--emerald #10b981` (selesai/terhubung), `--amber #f59e0b` (peringatan/kredit rendah/berjalan), `--amber-soft #ffd28a` (angka kredit & sorotan), `--rose #fb7185` (gagal/habis), `--indigo #4f46e5` (tombol Generate), gradien `#5d56e9 → #9ea0fd` (CTA Pabrik), `--indigo-bright #9ea0fd` (token variabel prompt) |
| State | `--state-hover rgba(255,255,255,.06)`, `--state-focus rgba(255,255,255,.1)` |

### 8.2 Tipografi, bentuk, elevasi
- Font: **Plus Jakarta Sans** (heading), **Inter** (body 14px), **JetBrains Mono** (id, waktu, countdown, kredit, terminal).
- Radius: `--radius 0.625rem`; skala `sm 0.6× · md 0.8× · lg 1× · xl 1.4× · 2xl 1.8× · 3xl 2.2×`. Kartu 12px, input/tombol radius×1.4, pill/badge 999px.
- Elevasi solid ala Material, tanpa blur besar:
  - `--elev-1: 0 1px 2px rgba(0,0,0,.35), 0 1px 3px 1px rgba(0,0,0,.18)`
  - `--elev-2: 0 1px 2px rgba(0,0,0,.35), 0 2px 6px 2px rgba(0,0,0,.2)`
  - `--elev-3: 0 4px 8px 3px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.4)`
- Layout: tanpa sidebar; `--navbar-h 64px`, konten maks 1280px dengan padding 32px, footer di bawah konten.

### 8.3 Kelas komponen
`.glass-card`, `.glass-panel`, `.glass-input` (fokus: border aksen + ring 2px) · `.btn` + `-primary/-ghost/-danger/-indigo/-sm` · `.badge-processing/-queued/-completed/-failed/-role/-model` · `.nav-pill/.nav-pill-active` · `.kicker` (10px, uppercase, letter-spacing .14em) · `.kpi`, `.stat-card` (bar nada 2px saat hover), `.stat-card-label` · `.progress-*` · `.data-table` · `.terminal` · `.toggle` (38×22) · `.stepper` · `.dropzone` · `.pill[data-tone=indigo|amber|moss]` · `.seg` (segmented) · `.note-error/-warn/-info` · `.skeleton` (shimmer).

### 8.4 Animasi & ikon
- `pulse-emerald`, `glow-amber`, `fs-spin` (1s), `fs-blink`, `fs-fade-in` (0.2s), `fs-shimmer`; hormati `prefers-reduced-motion`.
- Ikon: **Material Symbols Outlined** dari paket npm `material-symbols` (self-host, tanpa CDN), 20px default, varian `.filled`.

### 8.5 Primitif `components/ui`
Icon, GlassCard, StatusBadge, ModelBadge, ChipSelect, ProgressRing, AssetCard, StatStrip, TerminalCard, RoleBadge, Countdown, CountStepper, Toggle, KpiCard, Skeleton, EmptyState, Spinner, Dropzone. Helper admin (`components/admin/common.tsx`): StatusChip, Dot, CardHead, CardError, peta `TONE`, `useRunner`, `pollWhenVisible`.

### 8.6 Pola umpan balik
Tidak ada sistem toast global: umpan balik berupa `note` inline (dapat ditutup; Studio auto-hilang 9 dtk). Satu modal (PreviewModal); detail divisi dan aktivitas user memakai panel samping, bukan modal (§7.8). Konfirmasi destruktif via `window.confirm` (hapus riwayat: 2×).

---

## 9. Realtime & Polling

- **Satu koneksi SSE per shell** (`lib/useEvents.ts`, `EventsProvider`), dibuka setelah media token siap: `EventSource /api/events?token=<media_token>` (SSE & `<video>` tidak bisa mengirim header).
- Context: `useEventsCtx` (tasks, connState, reloadTasks), `useEventsLog` (200 event mentah terakhir).
- Event: `snapshot` (≤ 300 task + `me`), `task_update`, `task_deleted`, `tasks_deleted`, `user_updated`, `factory_update`, `account_update` (admin; status/saldo akun), `ping`.
- Reconnect: backoff eksponensial + jitter; deteksi stall (tanpa pesan 45 dtk, cek tiap 10 dtk); status "offline" setelah 15 dtk; reconnect langsung saat `online`/tab terlihat; reload penuh bila offline > 2 mnt atau halaman > 6 jam & idle 60 dtk (min 5 mnt antar reload, tidak saat dialog terbuka).

| Polling | Interval |
|---|---|
| Admin users | 5 dtk |
| Logs | 3 dtk (inkremental `latest_seq`) |
| Queue outlook | 15 dtk, hanya saat ada task queued |
| Statistik Gallery | 60 dtk |
| Admin Overview (statistik, health) | 15 dtk |
| Kredit divisi (chip navbar) | 60 dtk |
| Countdown & progres waktu | 1 dtk |

Semua polling **berhenti saat `document.hidden`**.

---

## 10. Waktu & Format

- Seluruh sistem memakai **WIB (Asia/Jakarta)**, tidak bergantung jam VPS/browser. Backend: `config/clock.py` (`APP_TIMEZONE`, `now()`, `now_aware()`, `today_str()`; proses `TZ` diset). Frontend: `APP_TZ = "Asia/Jakarta"`, `parseServerDate` menambahkan `+07:00` ke ISO naif dari server.
- `lib/format.ts`: `fmtLocal` ("16 Agu, 23:04"), `fmtTime` (HH:MM:SS), `fmtAgo` ("baru saja", "N dtk/mnt/jam/hari lalu"), `fmtDuration` ("Ns", "Nm Ns", "Nj Nm"), `fmtBytes`, `fmtCountdown`, `fmtCredits` (baru, "1.250 kr"), `initials`, `truncate`, `pad2`, `wibParts`; admin `fmtSecAgo`, `fmtLeft`.
- `STATUS_META`: queued "Queued", generating "Generating", downloading "Downloading", completed "Completed", failed "Failed".

---

## 11. API

Auth level: `none` publik · `user` Bearer · `media` media token (query) · `ADMIN` SUPER/DIVISION admin (non-admin → 404) · `SUPER` super admin.

| Method | Path | Level | Fungsi |
|---|---|---|---|
| GET | /api/auth/bootstrap | none | Registrasi pertama masih terbuka? |
| POST | /api/auth/register · /login · /reset-password | none | Auth (reset pakai kode harian) |
| POST | /api/auth/logout · /media-token | user | Cabut token (`token_version`++) · token media |
| GET | /api/users · POST /api/users/{id} · DELETE /api/users/{id} | user | Profil |
| POST | /api/upload | user | Upload gambar referensi |
| GET | /api/models | user | Katalog model aktif **yang diizinkan untuk divisi pemanggil** + default divisi + estimasi efektif |
| POST | /api/users/{id}/generate | user | Intake (§6.2) |
| GET | /api/users/{id}/quota | user | Status kuota |
| GET | /api/tasks · /api/tasks/{id} | user | Daftar/detail (scope RBAC) |
| GET | /api/queue/outlook | user | Posisi & ETA |
| DELETE | /api/tasks/{id} · /api/users/{id}/tasks | user | Batal/hapus (filter status/batch) |
| GET | /videos/{user}/{file} · /images/{user}/{file} | media | File hasil |
| GET | /api/events | media | SSE |
| GET | /api/health | none | Liveness |
| GET | /api/divisions | user | Daftar divisi |
| * | /api/factory/…, /api/users/{id}/factory/… | user | Pabrik Video (§7.6) |
| GET | /api/admin/users · /tasks · /logs · /orphans | ADMIN | Monitoring (scope divisi) |
| POST/PATCH/DELETE | /api/admin/users[/{id}] | ADMIN | Kelola user |
| POST/PATCH/DELETE | /api/admin/divisions[/{id}] | SUPER | Kelola divisi |
| GET · PUT | /api/admin/divisions/{id}/models | ADMIN (GET) · SUPER (PUT) | Lihat / atur model yang diizinkan & model default divisi |
| GET · POST | /api/admin/reset-code · /reset-code/rotate | SUPER | Kode reset harian |
| POST | /api/admin/users/{id}/admin | SUPER | Grant/revoke admin (anti-lockout) |
| GET | /api/admin/credits[?refresh=1] | ADMIN | Saldo kredit per akun |
| GET | /api/admin/accounts | ADMIN | Status akun |
| POST/PATCH/DELETE | /api/admin/accounts[/{id}] | SUPER | Tambah/ganti key/nonaktif/hapus |
| POST | /api/admin/accounts/{id}/test · /primary · /breaker/reset | SUPER | Uji key, jadikan primer, reset breaker |
| POST | /api/admin/accounts/automap | SUPER | Petakan akun ke divisi otomatis (primer dulu, sekunder bila ada sisa) |
| PATCH | /api/admin/models/{key} · POST /api/admin/settings/rotation | SUPER | Katalog & rotasi |
| POST | /api/prompts/enhance | user | Perkaya Prompt (LLM; 503 bila belum dikonfigurasi) |
| GET | /api/users/{id}/stats | user | Statistik Gallery (total, hari ini, in-flight, success rate) |
| POST | /api/users/{id}/tasks/zip | user | Unduh aset terpilih sebagai ZIP |
| GET | /api/admin/overview | ADMIN | Statistik Overview Sistem + health per model |
| GET | /api/admin/health | ADMIN | Snapshot watchdog |

---

## 12. Model Data

DB: **PostgreSQL** saja (`POSTGRES_URL`; produksi memakai PostgreSQL bersama di VPS, lokal memakai container `postgres`). Migrasi skema dengan Alembic, dijalankan saat startup. State kerja di memori (`server/state.py`), DB sebagai mirror tahan-restart lewat **satu penulis DB** (`_db_writer`, antrean tulis).

| Tabel | Kolom utama |
|---|---|
| `users` | id, name, password_hash, salt (PBKDF2-SHA256 100k), role, division_id, is_active, token_version, created_at |
| `divisions` | id, name, **allowed_models_json** (kosong = semua), **default_video_model, default_image_model, quota_outputs, quota_window_days** (kosong = global), created_at |
| `provider_accounts` | id, label, api_key_enc, plan, division_id, slot (`primary`/`secondary`), status, breaker_until, credits_cached, credits_checked_at, outputs_today, outputs_total, last_used_at, created_at |
| `tasks` | task_id, user_id, division_id, batch_id, status, prompt, prompt_index, total_prompts, group_index, copy_index, image_path, image_mode, **model_key, media_type, options_json, credit_cost, credit_estimated, credit_used, provider_job_id, provider_pct, provider_expired_at, account_id, est_seconds, started_at, finished_at**, result_url, error, task_retries, requeued_at, created_at, updated_at |
| `quota_usage` | task_id, user_id, credits, created_at (ledger terpisah) |
| `prompt_behavior` | id, user_id, division_id, model_key, options_hash, prompt_hash, prompt_len, has_image, result, gen_sec, account_id, created_at |
| `factory_batches` | batch_id, user_id, division_id, name, mode (`multi_prompt`/`multi_asset`/`csv`), status, paused, config (JSON: aset, formula, variabel, model, opsi, variasi), total_tasks, created_at, finished_at |

Berkas di `DATA_DIR`: `videos/<user>/`, `images/<user>/`, `uploads/`, `reset_code.json` (0600), `.auth_secret`, `health.json`.

---

## 13. Arsitektur & Technology Stack

```
┌──────────────────────────────────────────────────────────────┐
│       React + Vite SPA (build statis), disajikan Nginx       │
│  UI (Studio, Gallery, Pabrik, Admin)   Proxy same-origin     │
│                                        /api /videos /images  │
│                                        /uploads → backend    │
└──────────────────────────────────────────────┬───────────────┘
                                               │
                              ┌────────────────▼───────────────┐
                              │ FastAPI backend :8005          │
                              │ auth · RBAC · intake · kuota   │
                              │ antrean+worker per divisi      │
                              │ akun pool (1-2/divisi)+breaker │
                              │ watchdog · retensi · SSE       │
                              │ db_writer → PostgreSQL         │
                              └───────┬───────────────┬────────┘
                                      │ SnapgenClient │ httpx
                              ┌───────▼──────┐  ┌─────▼───────────────┐
                              │ snapgen.ai   │  │ LLM Perkaya Prompt  │
                              │ API          │  │ (opsional)          │
                              └──────────────┘  └─────────────────────┘
```

- **Frontend:** React + Vite + TypeScript (SPA, tanpa server-side rendering), Tailwind v4, React Router (routing & guard peran), TanStack Query (fetch, cache, polling), `material-symbols`. Hasil build berupa file statis. **Node.js 24** hanya dipakai saat build (`node:24-alpine` sebagai build stage, `.nvmrc` = 24, `engines.node ">=24 <25"`, CI `node-version: 24`).
- **Backend:** Python 3.12 + FastAPI + uvicorn, httpx (async) untuk snapgen.ai, ffmpeg/ffprobe untuk pemeriksaan kualitas.
- **Konfigurasi:** `.env` (rahasia: `AUTH_SECRET`, `ACCOUNT_KEY_SECRET`, `POSTGRES_URL`, `SNAPGEN_API_BASE` (default `https://api.snapgen.ai`), `LLM_API_BASE` / `LLM_API_KEY` / `LLM_MODEL` (Perkaya Prompt, endpoint kompatibel OpenAI, opsional), webhook, DSN) > `config.json` (di-track, setelan non-rahasia; kunci rahasia di sini **diabaikan**) > default kode. Kunci yang sama dipakai semua mesin.
- **Auth:** token HMAC-SHA256 stateless `user_id.purpose.version.expiry.sig` (purpose `session`/`media`, TTL 30 hari), dicabut via `token_version`. Reset password memakai **kode reset harian** yang dipegang admin (tanpa email).
- **Deploy:** `docker-compose.yml` — `backend` (127.0.0.1:8005, volume `./data`, `./logs`, `config.json`) dan `web` (Nginx, 3001→80: menyajikan `dist/` dengan fallback `index.html`, mem-proxy `/api`, `/videos`, `/images`, `/uploads` ke `http://backend:8005`, `proxy_buffering off` untuk `/api/events`). Container `postgres` hanya untuk lokal. TZ Asia/Jakarta di semua container.
- **Antrean:** worker berjalan di dalam proses backend (asyncio); tidak memakai Redis atau layanan antrean terpisah untuk v1.

---

## 14. Kebutuhan Non-Fungsional

- **Keamanan:** password PBKDF2; API key snapgen terenkripsi at-rest, tidak pernah dikirim ke frontend; rate limit per IP (auth) dan per user (`GENERATE_INTAKE_PER_MIN`, `FACTORY_INTAKE_PER_MIN`); validasi CSV matriks Pabrik (ukuran file, maks `FACTORY_CSV_MAX_ROWS` baris); upload dibatasi tipe (PNG/JPG/WEBP) & ukuran (`UPLOAD_MAX_MB`, default 10); CORS `ALLOWED_ORIGINS`.
- **Keandalan:** resume setelah restart (task queued tidak hilang, polling `provider_job_id` dilanjutkan); requeue terbatas; tidak ada submit ganda.
- **Observabilitas:** log ring-buffer (Admin › Logs) + file `logs/`; GlitchTip/Sentry opsional (`GLITCHTIP_DSN`); watchdog 60 dtk menulis `health.json` dan mengirim alert (log, SSE admin, `ALERT_WEBHOOK_URL`, mute per pemicu) untuk: `credits_low`, `account_unavailable`, `disk_low` (`DISK_FLOOR_GB`), `worker_stalled`, `failure_rate` (> `FAILURE_RATE_THRESHOLD` dari 20 task terakhir).
- **Kinerja UI:** galeri render bertahap (48), video lazy-load saat terlihat, polling berhenti saat tab tersembunyi.
- **Penyimpanan:** retensi 3 hari + pembersihan file yatim.

---

## 15. Di Luar Cakupan

| Item | Alasan |
|---|---|
| Penjadwalan task (status `scheduled`, jendela waktu, jeda/resume antrean terjadwal) | Semua task langsung dieksekusi |
| Aplikasi desktop atau mobile native | Cukup web responsif untuk v1 |
| Ekspor otomatis ke Google Drive (ada di Figma Pabrik) | Butuh integrasi Google Drive; v1 memakai Gallery + unduh ZIP |
| Metrik infrastruktur di Figma (node GPU, cluster, latency ms, FPS/frame, region) | Sistem memanggil API snapgen.ai, tidak punya GPU sendiri; diganti data nyata (§7) |
| Alur Pabrik lama (foto model + link produk → gambar produk → video, import job Excel) | Diganti batch matriks sesuai Figma |
| Failover lintas divisi (key Kantor A jadi cadangan Kantor B dan sebaliknya) | Gangguan satu kantor akan memperlambat antrean dan menguras kredit kantor lain |
| Video panjang: Extend, Storyboard, durasi > 10 dtk | API mendukungnya (Lampiran A.3), tetapi v1 tetap satu klip 5–10 dtk sesuai keputusan awal; kandidat utama versi berikutnya (§16) |

---

## 16. Asumsi & Pertanyaan Terbuka

1. **Terjawab sebagian (v1.6):** kontrak API ada di Lampiran A. Yang masih belum terdokumentasi (kode error, batas rate, nilai `model`, webhook, watermark) didaftar di Lampiran A.7 dan ditetapkan lewat uji M1.
2. **Terjawab (v1.6):** biaya nyata per task dibaca dari `estimated_credit` / `used_credit` API, termasuk GPT Image 2; angka katalog hanya pratinjau.
3. Nilai `est_seconds` awal adalah asumsi; diukur pada uji M1 lalu diperbarui otomatis (§4).
4. Apakah satu API key boleh dipakai paralel ≥ 2 request? (menentukan `MAX_INFLIGHT_PER_ACCOUNT`). Jawaban ini juga menentukan apakah 1 key cukup untuk 15 anggota per kantor: 30 klip bersamaan butuh ≈ 45 mnt pada 2 paralel atau ≈ 18 mnt pada 5 paralel (asumsi 3 mnt/klip, belum diukur).
5. **Diputuskan (v1.5):** aturan kombinasi Pabrik mengikuti §7.6 — Multi-Prompt memasangkan aset bergiliran ke kombinasi variabel, dan nilai variabel diisi lewat popover token (§7.8). Alur Pabrik lama (foto model + link produk) dihapus.
6. Model apa saja yang diizinkan untuk Kantor A dan Kantor B, dan apa model default masing-masing? Sampai diisi, kedua kantor memakai semua model aktif (§3.4).
7. Layar yang belum ada di Figma (Login, 5 tab Admin, popup/panel/state, mobile) sudah dispesifikasikan di §7.3 dan §7.7–§7.9 dengan gaya layar yang ada. Bila nanti desain Figma-nya dibuat dan berbeda, Figma yang berlaku.
8. **Perkaya Prompt** memakai LLM apa? PRD menyiapkan konfigurasi endpoint kompatibel OpenAI (`LLM_API_BASE`, `LLM_API_KEY`, `LLM_MODEL`); sampai diisi, tombolnya disembunyikan.
9. Ekspor otomatis ke Google Drive (ada di Figma Pabrik) tetap di luar cakupan v1 (§15); bisa ditambahkan di versi berikutnya.
10. **Diputuskan (v1.5):** Pabrik hanya untuk video di v1, sesuai Figma. Gambar dibuat satuan lewat Studio.
11. **Video lebih panjang lewat API:** Extend (Veo/Grok/Kling/Seedance), Storyboard Grok (maks 45 dtk, klip disambung otomatis), dan Kling 4.0 (sampai 30 dtk) bisa memenuhi kebutuhan video 15–60 detik tanpa edit manual. Mau dimasukkan ke v1 (mis. tombol "Perpanjang" di canvas Studio), atau tetap versi berikutnya?
12. Model Figma "Kling 1.6 Pro" tidak ada di API; yang tersedia `kling-video-3-0` dan keluarga 4.0. Varian mana yang dipakai sebagai "Kling" di katalog?

---

## 17. Milestone

| Milestone | Isi | Kriteria selesai |
|---|---|---|
| **M1 — Inti** | Auth & peran, shell + desain sistem, `SnapgenClient` (Lampiran A), katalog model, Studio, Gallery, SSE, retensi; **uji API**: jalankan tiap endpoint sekali dan isi Lampiran A.7 | 1 user bisa generate video & gambar dari 3 model berbeda dan melihatnya di galeri; butir Lampiran A.7 nomor 1–3 terisi |
| **M2 — Akun & kuota** | Divisi Kantor A & Kantor B dengan 1 akun masing-masing (sekunder opsional), breaker + rotasi, saldo kredit & alert kredit rendah, kuota user, estimasi waktu & ETA antrean | Mematikan key Kantor A → task Kantor A tertahan di antrean (tidak gagal) dan lanjut setelah key pulih, Kantor B tidak terganggu; bila sekunder dipasang, task lanjut di sekunder; estimasi tampil di Studio & kartu aset Gallery |
| **M3 — Admin** | Overview Sistem, Alokasi Divisi (+pembatasan model per divisi), Kesehatan Engine (+katalog model), Audit Log, Akun, Users, kode reset, watchdog & alert | Super Admin mengelola divisi/akun/user sepenuhnya dari UI; divisi yang dikunci ke satu model tidak bisa generate dengan model lain, baik dari UI maupun langsung ke API |
| **M4 — Pabrik Video** | Form batch (3 mode matriks), formula prompt dengan variabel, kartu batch aktif (Jeda/Lanjut/Batal), antrean sub-tugas, unduh ZIP | 3 aset × formula 2 variabel × 4 variasi → jumlah tugas & biaya di pratinjau sama dengan yang dijalankan; batch bisa dijeda, dilanjutkan, dan diunduh sebagai ZIP |

---

## 18. Lampiran A — Kontrak API snapgen.ai

Sumber: file `openapi.json` ("GeminiGen Backend Public API" v1.0.0) dan halaman dokumentasi "Extend Veo" dari docs.snapgen.ai, diterima 12 Nov 2026. Hal yang **tidak ada** di kedua sumber itu ditandai "belum terdokumentasi" dan ditetapkan lewat uji M1 (A.7).

### A.1 Dasar
- **Base URL:** `https://api.snapgen.ai` (`SNAPGEN_API_BASE`).
- **Auth:** header `x-api-key: <API key>` di semua endpoint.
- **Pola kerja asinkron:** `POST` submit → langsung mengembalikan riwayat generate (`uuid`, `status: 1`) → hasil diambil dengan polling `GET /uapi/v1/history/{uuid}` atau lewat webhook.
- **Format body:** `multipart/form-data` atau `application/x-www-form-urlencoded`, berbeda per endpoint (A.2). Bukan JSON.

### A.2 Endpoint generate

| Model (label UI) | Endpoint | Body | Parameter utama (default) |
|---|---|---|---|
| Veo | `POST /uapi/v1/video-gen/veo` | multipart | `prompt`*, `model`*, `resolution` (720p), `aspect_ratio` (16:9), `duration` (int), `files` / `file_urls` / `ref_images`, `ref_videos`, `ref_history`, `mode_image`, `voice_media_id`, `provider` |
| Grok Video | `POST /uapi/v1/video-gen/grok` | multipart | `prompt`*, `model` (grok-video), `duration` (6), `resolution` (480p), `mode` (custom), `aspect_ratio` (landscape), `skip_audio` (false), `files` / `file_urls` / `ref_images` |
| Grok Video v2 | `POST /uapi/v2/video-gen/grok` | multipart | Seperti v1 + `image_mode` (frame / ingredient), `first_frame`, `last_frame` |
| Bytedance Seedance | `POST /uapi/v1/video-gen/seedance` | form-urlencoded | `prompt`*, `model`*, `resolution` (720p), `aspect_ratio` (16:9), `duration` ("4"), `mode` (fast), `ref_images`, `ref_videos`, `ref_audios` |
| Kling | `POST /uapi/v1/video-gen/kling` | form-urlencoded | `prompt`*, `model`*, `mode` (standard), `aspect_ratio` (16:9), `duration` ("5"), `ref_images`, `ref_videos`, `mode_image` (frame) |
| Gambar umum | `POST /uapi/v1/generate_image` | multipart | `prompt`*, `model`*, `aspect_ratio` (1:1), `number_of_images` (1, maks 4), `output_format` (png), `resolution` (1K), `files` / `file_urls`, `ref_histories` |
| Grok Image | `POST /uapi/v1/imagen/grok` (v2: `/uapi/v2/imagen/grok`) | multipart (v2: form-urlencoded) | `prompt`*, `orientation` (landscape), `num_result` (1), `mode`, `resolution`, `ref_history` + `files` (v2: `ref_images`) |
| GPT Image 2 | `POST /uapi/v1/imagen/gpt-image-2` | multipart | `prompt`*, `aspect_ratio` (1:1; juga 16:9, 9:16, 4:3, 21:9, 3:2, 2:3, 3:4), `mode` (low; medium, high), `resolution` (2K; 1k–12k), `background` (auto), `ref_history`, `files` |
| Meta AI (gambar) | `POST /uapi/v1/meta_ai/generate` | multipart | `prompt`*, `orientation` (landscape), `ref_history`, `files` |

\* wajib. `prompt` maks 32.000 karakter.

Catatan per model:
- **Kling:** `kling-video-3-0` → `mode` standard / professional / relax / professional_audio, rasio 16:9 / 9:16 / 1:1, durasi **3–15 dtk**. Keluarga 4.0 (`kling-video-4-0`, `kling-video-motion-4`) → `mode` berisi resolusi (720p / 1080p), durasi **3–30 dtk**, tiap detik video referensi ditagih tambahan.
- **Grok:** rasio memakai kata (`landscape` / `portrait` / `square`), bukan angka; adapter memetakan 16:9 → landscape, 9:16 → portrait, 1:1 → square. `mode` dikunci `custom` oleh sistem (tidak ditampilkan ke user).
- **Veo:** contoh respons memakai `model_name: "veo-2"`; daftar nilai `model` yang sah belum terdokumentasi.
- **Belum ada endpoint di OpenAPI** untuk Omni Flash dan Minimax (video). Nano Banana, Black Forest Labs, Vela AI, dan Muse AI kemungkinan lewat `generate_image` dengan nilai `model` masing-masing, tetapi nilainya belum terdokumentasi. Model-model ini `enabled: false` di katalog sampai dikonfirmasi.

Gambar referensi dari user dikirim sebagai file (`files` / `ref_images`); hasil generate sebelumnya bisa dirujuk dengan `ref_history` (uuid) tanpa unggah ulang.

### A.3 Endpoint lanjutan (video lebih panjang)

| Fungsi | Endpoint | Keterangan |
|---|---|---|
| Extend Veo | `POST /uapi/v1/video-extend/veo` | `prompt`*, `ref_history`* (uuid video Veo), `last_frame`, `provider`. Model, rasio, dan resolusi mengikuti video asal dan tidak bisa diubah. |
| Extend Grok | `POST /uapi/v1/video-extend/grok` | `prompt`*, `ref_history`*, `duration` (4–10 dtk), `mode`, `resolution` (480p / 720p). Memakai frame terakhir video asal. |
| Extend Kling / Seedance | `POST /uapi/v1/video-extend/kling`, `…/seedance` | `prompt`*, `ref_history`*, `mode` (fast) |
| Storyboard Grok | `POST /uapi/v1/video-storyboard/grok` | `scenes`* (JSON string: `[{"prompt","duration","mode"}]`), 2–10 scene, durasi per scene 6 atau 10 dtk, total ≤ 45 dtk; klip disambung otomatis jadi satu video; tidak tersedia di paket Free. |
| Suara Veo | `GET /uapi/v1/video-gen/veo/voice` | Daftar preset suara untuk `voice_media_id`. |

Endpoint ini **belum dipakai di v1** (§15), tetapi membuka jalan untuk video 15–60 detik tanpa menyambung manual (§16).

### A.4 Respons submit

Contoh (dari dokumentasi Extend Veo):
```json
{
  "id": 12345, "uuid": "e1bb12be-c917-11f0-98b0-0242ac120004",
  "model_name": "veo-2", "type": "video", "media_type": "video",
  "status": 1, "status_percentage": 1,
  "error_code": "", "error_message": "",
  "estimated_credit": 20, "delay_seconds": 0,
  "created_at": "2025-11-24T09:28:05", "expired_at": null
}
```

| Field | Dipakai untuk |
|---|---|
| `uuid` | Disimpan sebagai `provider_job_id` segera setelah submit (kunci idempoten & polling) |
| `status` | `1` processing → *Generating*; `2` completed → *Downloading*; `3` failed → *Failed* |
| `status_percentage` | Persen progres nyata (0–100) untuk cincin progres di UI |
| `estimated_credit` | Biaya nyata task; disimpan di `credit_estimated` dan dipakai untuk ledger kuota kredit |
| `delay_seconds` | Jeda sebelum provider mulai memproses; ditambahkan ke ETA |
| `error_code`, `error_message` | Ditampilkan di kartu gagal dan dipakai untuk klasifikasi gangguan akun (A.7) |

### A.5 Status & hasil — `GET /uapi/v1/history/{uuid}`

Field tambahan dibanding respons submit:

| Field | Dipakai untuk |
|---|---|
| `used_credit` | Kredit yang benar-benar terpakai; menimpa `estimated_credit` di catatan task |
| `generated_video[]` → `video_url`, `duration`, `aspect_ratio`, `resolution`, `has_watermark` | URL unduh video + metadata kartu |
| `generated_image[]` → `image_url`, `file_download_url`, `thumbnails[]`, `aspect_ratio`, `resolution` | URL unduh gambar (`file_download_url` diutamakan) |
| `thumbnail_url`, `last_frame_url` | Thumbnail kartu; frame terakhir untuk Extend |
| `file_size` | Ukuran file di baris sub-tugas Pabrik |
| `expired_at` | Batas waktu file di server snapgen — **file harus sudah diunduh ke server kita sebelum waktu ini** |
| `watermark_removal[]` | Status penghapusan watermark (tidak dipakai di v1) |

Aturan polling: tiap `POLL_INTERVAL_SEC` (default 10) per task in-flight, selalu dengan API key akun yang men-submit (pinning, §5). `status: 2` → unduh file ke `data/videos|images/<user>/` → *Completed*. Satu submit gambar dengan `number_of_images` > 1 menghasilkan beberapa entri `generated_image[]`; sistem tetap memakai 1 output per task (nilai 1) agar kuota dan antrean konsisten.

Daftar riwayat: `GET /uapi/v1/histories?filter_by=&items_per_page=&page=` → `{success, total, result[]}`; dipakai watchdog untuk rekonsiliasi task yang `provider_job_id`-nya hilang. Hapus riwayat di sisi snapgen: `DELETE /uapi/v1/history/{id}` (opsional, setelah file aman diunduh).

**Webhook** tersedia (halaman `getting-started/webhooks` di dokumentasi), tetapi isinya belum diterima; v1 memakai polling, webhook menyusul sebagai optimasi.

### A.6 Akun & saldo — `GET /uapi/v1/account`

| Field | Dipakai untuk |
|---|---|
| `user_credit.available_credit` | Saldo kredit akun (chip navbar, kolom KUOTA PRIMER/SEKUNDER, ambang kredit rendah) |
| `user_credit.locked_credit` | Kredit yang sedang ditahan task berjalan; ditampilkan sebagai "tertahan" di kartu akun |
| `plan_id`, `user_benefits[]` (`product`, `expire_at`, `estimated_remaining`) | Paket akun & masa berlaku di kartu akun |
| `is_active`, `email`, `full_name` | Validasi akun; "Uji key" memanggil endpoint ini |

### A.7 Belum terdokumentasi — ditetapkan lewat uji M1

1. **Kode HTTP & `error_code`** untuk key salah, kredit habis, dan rate limit (OpenAPI hanya mencantumkan 200 dan 422). Sampai diuji, adapter memakai asumsi §5 (401/403, 402, 429) dan mencatat semua respons gagal mentah ke log untuk dipetakan.
2. **Batas rate & jumlah request paralel per API key.**
3. **Nilai `model` yang sah** untuk Veo, Seedance, dan `generate_image` (Nano Banana, Black Forest Labs, Vela AI, Muse AI).
4. **Endpoint Omni Flash dan Minimax.**
5. **Format payload webhook** dan cara verifikasinya.
6. **Watermark:** kapan `has_watermark` bernilai 1 pada akun Premium.
7. **Lama `expired_at`** setelah hasil selesai.
