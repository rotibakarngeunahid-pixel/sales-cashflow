# Setup Guide — RBN Sales & Cashflow System

## Persyaratan
- Node.js 18+ (https://nodejs.org)
- npm atau yarn
- Akun Supabase (https://supabase.com)

---

## 1. Setup Supabase

### A. Buat project Supabase
Project ID yang digunakan: `paebvobxukhnyvttkavj`

### B. Jalankan SQL Migration
1. Buka Supabase Dashboard → SQL Editor
2. Jalankan file pertama: `supabase/migrations/001_initial_schema.sql`
3. Lalu jalankan file kedua: `supabase/migrations/002_add_username.sql`
4. Migration ini akan:
   - Membuat semua tabel (profiles, branches, sales_reports, cashflow_categories, cashflow_transactions, audit_logs)
   - Membuat trigger auto-sync sales → cashflow
   - Mengaktifkan RLS dengan semua policy
   - Seed 7 cabang awal
   - Seed 15 kategori cashflow awal

### C. Buat user owner pertama
1. Buka Supabase Dashboard → Authentication → Users
2. Klik "Add User" → masukkan email dan password: `gameadit4521`
3. Setelah user dibuat, buka SQL Editor dan jalankan:

```sql
UPDATE profiles 
SET role = 'owner', full_name = 'Owner RBN', username = 'owner'
WHERE email = 'EMAIL_OWNER_ANDA@gmail.com';
```

Ganti `EMAIL_OWNER_ANDA@gmail.com` dengan email Anda, dan `owner` dengan username yang Anda inginkan (misalnya `adithya`).

**Username ini yang dipakai untuk login** — bukan email.

### D. Ambil Anon Key
1. Buka Supabase Dashboard → Settings → API
2. Copy "anon public" key
3. Ini yang akan digunakan di `.env.local`

---

## 2. Setup Project Lokal

### A. Install dependencies
```bash
npm install
```

### B. Buat file `.env.local`
Copy file `.env.example` menjadi `.env.local`:
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://paebvobxukhnyvttkavj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=MASUKKAN_ANON_KEY_ANDA_DISINI
```

### C. Tambahkan logo
Taruh file `rbngeunahicon.webp` di folder `/public/rbngeunahicon.webp`

### D. Jalankan development server
```bash
npm run dev
```

Buka http://localhost:3000

---

## 3. Login Pertama

1. Buka http://localhost:3000/login
2. Login dengan email dan password owner yang sudah dibuat di Supabase
3. Anda akan diarahkan ke dashboard utama

---

## 4. Deploy ke Vercel

### A. Push ke GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin URL_REPO_GITHUB_ANDA
git push -u origin main
```

### B. Import di Vercel
1. Buka https://vercel.com
2. Import repository dari GitHub
3. Tambahkan environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = https://paebvobxukhnyvttkavj.supabase.co
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key dari Supabase
4. Deploy

### C. Update Supabase Auth URL
1. Buka Supabase → Authentication → URL Configuration
2. Tambahkan Vercel URL ke "Redirect URLs"

---

## 5. Fitur yang Tersedia

| Fitur | Status |
|-------|--------|
| Login / Logout | ✅ |
| Route Protection | ✅ |
| Role Owner & Admin | ✅ |
| User Inactive Block | ✅ |
| Dashboard Sales + Charts | ✅ |
| Input Penjualan (Draft) | ✅ |
| Post Sales → Auto Cashflow | ✅ |
| Void Sales → Auto Void Cashflow | ✅ |
| Anti Duplikasi Cashflow | ✅ (DB unique constraint) |
| Laporan Penjualan + Filter | ✅ |
| Export Excel / CSV | ✅ |
| Cashflow Manual | ✅ |
| Kategori Cashflow CRUD | ✅ |
| Dashboard Cashflow | ✅ |
| Manajemen Cabang | ✅ |
| User Management (Owner only) | ✅ |
| Audit Log | ✅ |
| Settings / Ganti Password | ✅ |
| Supabase Auth | ✅ |
| RLS Aktif | ✅ |
| Responsive | ✅ |
| Branding RBN (Merah/Orange/Kuning) | ✅ |

---

## 6. Hal yang Perlu Diisi Manual

1. **Supabase Anon Key** — Masukkan di `.env.local`
2. **Email Owner** — Buat di Supabase Auth, update role di tabel profiles
3. **Logo** — Taruh `rbngeunahicon.webp` di folder `/public/`
4. **Alamat Cabang** — Update di halaman Cabang setelah login
5. **Vercel URL** — Tambahkan ke Supabase Auth Redirect URLs saat deploy

---

## 7. Catatan Keamanan

- ✅ Password tidak disimpan plain text (Supabase Auth)
- ✅ Anon key hanya di environment variable
- ✅ Service role key tidak digunakan di frontend
- ✅ RLS aktif untuk semua tabel
- ✅ User inactive tidak bisa akses sistem
- ✅ Admin tidak bisa mengubah/nonaktifkan owner
- ✅ Cashflow dari sales tidak bisa diedit langsung
- ✅ `.env.local` tidak di-commit (ada di .gitignore)

---

## 8. Struktur Project

```
src/
├── app/
│   ├── (auth)/login/         # Halaman login
│   ├── (dashboard)/
│   │   ├── dashboard/        # Dashboard utama
│   │   ├── sales/input/      # Input penjualan
│   │   ├── sales/reports/    # Laporan penjualan
│   │   ├── cashflow/         # Cashflow manual
│   │   ├── cashflow/categories/ # Kategori cashflow
│   │   ├── branches/         # Manajemen cabang
│   │   ├── users/            # User management
│   │   ├── audit-log/        # Audit log
│   │   └── settings/         # Settings
│   └── layout.tsx
├── components/
│   ├── layout/               # Sidebar, Header
│   ├── sales/                # Form sales
│   └── ui/                   # Komponen UI reusable
├── lib/
│   ├── supabase/             # Client & Server
│   ├── utils/                # Format, calculations, export
│   └── validations/          # Zod schemas
└── types/                    # TypeScript types
```
