# PRD Auto Split Pengeluaran "Kurir bawa Bahan" ke Semua Cabang

## 1. Ringkasan

Dokumen ini mendefinisikan kebutuhan produk dan teknis untuk fitur auto split pengeluaran kategori **"Kurir bawa Bahan"** pada sistem RBN Sales & Cashflow.

Saat user membuat kas keluar dengan kategori tersebut, sistem harus otomatis membagi nominal pengeluaran secara rata ke semua cabang/outlet aktif. Setiap cabang aktif mendapat satu transaksi `cash_out` aktif di `cashflow_transactions`, sehingga laporan cashflow per cabang, posisi kas, export, dan analisa P&L tetap memakai pola data yang sudah ada.

Fitur ini hanya berlaku untuk kategori **"Kurir bawa Bahan"**. Kategori lain, termasuk kategori kurir umum seperti "Kurir", "Beban Kurir", "Ongkir", atau kategori lain yang hanya mengandung kata "kurir", tidak boleh ikut terkena aturan auto split ini kecuali namanya benar-benar kategori kanonik tersebut.

## 2. Basis Analisis Codebase

PRD ini dibuat berdasarkan pembacaan struktur project dan modul berikut:

- `package.json`
- `SETUP.md`
- `src/types/database.ts`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_add_delete_support.sql`
- `supabase/migrations/004_fix_unique_cashflow_constraint.sql`
- `supabase/migrations/006_add_raw_material_import.sql`
- `supabase/migrations/007_add_kasir_import.sql`
- `supabase/migrations/012_add_beban_transfer.sql`
- `supabase/migrations/013_merge_cogs_category.sql`
- `supabase/migrations/014_exclude_setoran_tunai.sql`
- `src/app/(dashboard)/cashflow/page.tsx`
- `src/app/(dashboard)/cashflow/SplitExpenseModal.tsx`
- `src/app/api/cashflow/split/route.ts`
- `src/app/api/cashflow/beban-transfer/route.ts`
- `src/app/api/cashflow/export/route.ts`
- `src/app/api/cashflow/export-arus-kas/route.ts`
- `src/app/(dashboard)/cashflow/analysis/page.tsx`
- `src/app/(dashboard)/cashflow/categories/page.tsx`
- `src/lib/validations/cashflow.ts`
- `src/lib/kasir-import/shared.ts`
- `src/lib/kasir-import/server.ts`
- `src/lib/kasir-sync/server.ts`
- `src/app/api/kasir-sync/confirm/route.ts`

## 3. Tech Stack Saat Ini

Sistem menggunakan:

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Supabase Auth, Supabase Postgres, RLS
- `@supabase/ssr` dan `@supabase/supabase-js`
- React Hook Form dan Zod untuk form validation
- ExcelJS, XLSX, FileSaver untuk export
- Recharts untuk analisa visual
- Lucide React untuk icon

Saat ini sebagian operasi cashflow manual dilakukan langsung dari client component dengan Supabase browser client. Untuk fitur ini, karena perlu membuat parent record, banyak child record, audit log, anti duplikasi, dan rollback atomik, implementasi tidak disarankan langsung dari client. Gunakan API route server-side yang memanggil RPC SQL atau function Postgres agar proses multi-step berjalan dalam satu transaksi database.

## 4. Kondisi Sistem Saat Ini

### 4.1 Data cabang/outlet

Cabang disimpan di tabel `branches`.

Kolom relevan:

- `id`
- `name`
- `address`
- `is_active`
- `deleted_at`
- `created_at`
- `updated_at`

Cabang aktif pada kode saat ini biasanya diambil dengan filter:

```sql
where is_active = true
and deleted_at is null
```

Pola ini digunakan di halaman cashflow, analisa, import kasir, sync kasir, dan beberapa helper lainnya.

### 4.2 Kategori cashflow

Kategori disimpan di tabel `cashflow_categories`.

Kolom relevan:

- `id`
- `name`
- `default_type`: `cash_in`, `cash_out`, atau `both`
- `description`
- `is_active`
- `deleted_at`
- `created_at`
- `updated_at`

Kategori dikelola dari `src/app/(dashboard)/cashflow/categories/page.tsx`.

Seed awal saat ini belum memiliki kategori persis "Kurir bawa Bahan". Seed hanya memiliki kategori "Kurir". Karena fitur baru harus spesifik pada "Kurir bawa Bahan", migration atau action owner/admin perlu memastikan kategori kanonik tersebut tersedia dan aktif.

### 4.3 Tabel cashflow utama

Transaksi cashflow disimpan di `cashflow_transactions`.

Kolom relevan:

- `id`
- `transaction_date`
- `branch_id`
- `transaction_type`: `cash_in` atau `cash_out`
- `category_id`
- `description`
- `cash_in`
- `cash_out`
- `amount`
- `source`
- `source_id`
- `import_key`
- `source_label`
- `source_metadata`
- `reference_group_id`
- `status`: `active` atau `void`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Cashflow report, export, posisi kas, dan analisa saat ini pada umumnya menghitung transaksi dari `cashflow_transactions` dengan `status = 'active'`.

### 4.4 Sumber data kas keluar saat ini

Kas keluar dapat muncul dari beberapa jalur:

1. Manual dari halaman `/cashflow`.
2. Import gabungan kasir dari `src/lib/kasir-import/server.ts`.
3. Sync kasir dari `src/lib/kasir-sync/server.ts`.
4. Import bahan baku/purchase order.
5. Transfer beban antar cabang.

Fitur baru harus dipertimbangkan untuk semua jalur yang dapat menghasilkan kas keluar kategori "Kurir bawa Bahan".

### 4.5 Split kurir yang sudah ada

Saat ini sudah ada fitur split manual:

- UI: `src/app/(dashboard)/cashflow/SplitExpenseModal.tsx`
- API: `src/app/api/cashflow/split/route.ts`

Fitur tersebut membuat beberapa row `cashflow_transactions` dengan `reference_group_id` yang sama. Fitur ini mendeteksi kategori kurir secara luas, misalnya nama kategori berisi kata `kurir`.

Import kasir juga sudah memiliki auto mapping untuk pengeluaran kurir:

- Helper `isKurirExpense()` di `src/lib/kasir-import/shared.ts` mendeteksi banyak variasi seperti `kurir`, `ongkir`, `ongkos kirim`, dan `biaya pengiriman`.
- `getExpensesPreview()` otomatis membuat mapping `split_equal` ke semua cabang aktif untuk item yang dianggap kurir.
- `importExpenses()` membuat child row per cabang dengan `reference_group_id`.

Requirement baru berbeda dari perilaku ini. Deteksi harus diperketat menjadi kategori kanonik **"Kurir bawa Bahan"** saja.

### 4.6 Saldo/posisi kas

Tidak ditemukan tabel saldo kas terpisah. Posisi kas dihitung dari transaksi cashflow aktif:

```text
posisi_kas = SUM(cash_in) - SUM(cash_out)
```

Dampak fitur ini berarti setiap child split `cash_out` aktif akan mengurangi posisi kas cabang masing-masing. Parent/header auto split tidak boleh ikut dihitung agar nominal tidak dobel.

## 5. Tujuan

1. Membuat aturan auto split kas keluar khusus kategori "Kurir bawa Bahan".
2. Membagi nominal total secara rata ke seluruh cabang aktif.
3. Menyimpan hasil split per cabang sebagai transaksi cashflow aktif yang reportable.
4. Menyimpan parent/header auto split agar transaksi asal, child split, audit, edit, dan cancel memiliki relasi yang jelas.
5. Menjamin total child split selalu sama dengan total pengeluaran awal.
6. Mencegah double split, double submit, dan data ganda.
7. Memastikan laporan cabang, laporan admin, posisi kas, export, dan analisa tidak double count.
8. Menjaga kategori lain tetap berjalan seperti sekarang.

## 6. Non-Goals

Fitur ini tidak mencakup:

- Membuat sistem akuntansi baru atau jurnal umum lengkap.
- Mengubah definisi semua kategori kurir lama menjadi "Kurir bawa Bahan".
- Mengubah seluruh logic import kasir selain deteksi kategori yang relevan.
- Mengubah konsep saldo kas menjadi saldo fisik kasir.
- Membuat cabang aktif historis berdasarkan periode tanggal, karena tabel `branches` saat ini belum memiliki effective date.
- Menghapus fitur split manual "Bagi Kurir" yang sudah ada, kecuali owner memutuskan fitur manual lama tidak diperlukan.

## 7. Definisi Istilah

- Kategori kanonik: kategori aktif di `cashflow_categories` dengan nama normalisasi sama dengan `kurir bawa bahan`.
- Parent/header auto split: record metadata di tabel baru yang menyimpan transaksi awal, total nominal, kategori, pembuat, status, dan snapshot cabang.
- Child split: row `cashflow_transactions` per cabang yang benar-benar dihitung di laporan cashflow.
- Outlet aktif: row `branches` dengan `is_active = true` dan `deleted_at is null`.
- Reportable transaction: transaksi `cashflow_transactions.status = 'active'` yang masuk laporan.
- Void/cancel: pembatalan transaksi tanpa menghapus jejak audit.
- Hard delete: penghapusan permanen dari tabel operasional, hanya jika pola existing mengizinkan dan audit snapshot sudah dibuat.

## 8. User Flow

### 8.1 Create kas keluar manual kategori "Kurir bawa Bahan"

1. User membuka halaman `/cashflow`.
2. User klik `Tambah Transaksi`.
3. User memilih:
   - Tanggal
   - Tipe `Cash Out`
   - Cabang pencatat/origin
   - Kategori `Kurir bawa Bahan`
   - Nominal total
   - Deskripsi
4. Setelah kategori dipilih, UI menampilkan info:

   ```text
   Pengeluaran dengan kategori Kurir bawa Bahan akan otomatis dibagi rata ke semua outlet aktif.
   ```

5. UI mengambil cabang aktif dan menampilkan preview:
   - Total outlet aktif
   - Total nominal
   - Nominal per outlet
   - Jika ada pembulatan, tampilkan cabang yang menerima sisa pembulatan
6. User klik Simpan.
7. Backend membuat parent/header auto split.
8. Backend membuat satu child `cashflow_transactions` per outlet aktif.
9. UI menampilkan sukses dan refresh cashflow, posisi kas, analisa, dan dashboard cache.

### 8.2 Create kas keluar manual kategori lain

1. User mengisi form kas keluar seperti biasa.
2. Jika kategori bukan "Kurir bawa Bahan", sistem menyimpan satu row `cashflow_transactions` seperti pola existing.
3. Tidak ada preview auto split.
4. Tidak ada child split tambahan.

### 8.3 Edit transaksi dari kategori lain menjadi "Kurir bawa Bahan"

1. User mengedit transaksi cash out manual normal.
2. User mengganti kategori menjadi "Kurir bawa Bahan".
3. UI menampilkan preview auto split.
4. Saat disimpan, backend:
   - Membuat parent/header auto split baru.
   - Membatalkan atau menghapus row normal lama sesuai pola cancel/delete yang dipilih.
   - Membuat child split per cabang aktif.
   - Mencatat audit perubahan kategori normal -> auto split.

### 8.4 Edit transaksi "Kurir bawa Bahan" menjadi kategori lain

1. User mengedit parent/header auto split.
2. User mengganti kategori ke kategori non "Kurir bawa Bahan".
3. Backend:
   - Membatalkan parent/header auto split.
   - Membatalkan child split aktif.
   - Membuat satu transaksi normal baru dengan kategori baru, jika UI memang mengizinkan konversi.
4. Jika implementasi ingin lebih aman, konversi ini dapat dibuat 2 langkah:
   - Cancel auto split lama.
   - Buat transaksi baru kategori lain.

Rekomendasi: gunakan 2 langkah untuk MVP agar relasi historis lebih mudah diaudit.

### 8.5 Delete/cancel transaksi auto split

1. User membuka detail auto split.
2. User klik Void/Cancel.
3. Backend mengubah `cashflow_auto_split_groups.status` menjadi `void`.
4. Backend mengubah semua child `cashflow_transactions` terkait menjadi `void`.
5. Laporan cashflow tidak lagi menghitung child tersebut.
6. Audit log menyimpan snapshot parent dan seluruh child sebelum/ setelah cancel.

## 9. Business Rules

### BR-1: Kategori yang memicu auto split

Auto split hanya berjalan jika semua kondisi ini terpenuhi:

- `transaction_type = 'cash_out'`
- kategori aktif
- kategori tidak soft-deleted
- `cashflow_categories.default_type` adalah `cash_out` atau `both`
- nama kategori setelah normalisasi sama persis dengan `kurir bawa bahan`

Normalisasi nama kategori:

```text
lowercase
trim kiri-kanan
ubah underscore dan whitespace berulang menjadi 1 spasi
hapus perbedaan huruf besar/kecil
```

Contoh yang dianggap sama:

- `Kurir bawa Bahan`
- `kurir bawa bahan`
- ` KURIR   BAWA   BAHAN `
- `kurir_bawa_bahan`

Contoh yang tidak boleh memicu auto split:

- `Kurir`
- `Beban Kurir`
- `Ongkir`
- `Biaya Pengiriman`
- `Kurir Bawa Bahan Baku`
- `Kurir bawa barang`
- kategori typo seperti `Kurir bawah bahan`

### BR-2: Kategori lain berjalan normal

Jika kategori bukan "Kurir bawa Bahan", create/update cashflow harus tetap menggunakan pola existing:

- satu transaksi per input
- `source = 'manual'` untuk input manual
- tidak membuat parent auto split
- tidak membuat child split

### BR-3: Cabang yang dibebankan

Cabang yang dibebankan adalah semua cabang aktif pada saat auto split dibuat:

```sql
select id, name
from branches
where is_active = true
and deleted_at is null
order by name asc, id asc;
```

Cabang nonaktif atau soft-deleted tidak ikut dibebankan.

### BR-4: Snapshot cabang

Daftar cabang aktif yang dipakai saat split harus disimpan sebagai snapshot di parent/header auto split. Perubahan status aktif cabang setelah transaksi dibuat tidak boleh mengubah transaksi historis secara otomatis.

Saat parent auto split diedit:

- Jika hanya deskripsi/tanggal berubah, update child existing.
- Jika nominal berubah, hitung ulang nominal child berdasarkan snapshot cabang parent.
- Jika owner/admin memilih action eksplisit `Recalculate outlet aktif saat ini`, sistem boleh mengambil ulang daftar cabang aktif saat edit dan mencatat audit bahwa daftar outlet berubah.

Untuk MVP, gunakan snapshot cabang yang sama saat edit agar laporan historis tidak berubah karena status cabang saat ini.

### BR-5: Pembagian rata

Nominal dibagi rata ke semua cabang aktif yang masuk snapshot.

Karena UI saat ini memakai input nominal integer (`step=1`) dan format Rupiah tanpa desimal, rekomendasi MVP adalah memakai integer Rupiah.

Algoritma:

```text
base = floor(total_amount / outlet_count)
remainder = total_amount - (base * outlet_count)

Untuk outlet urutan 1 sampai remainder:
  amount = base + 1

Untuk outlet sisanya:
  amount = base
```

Urutan outlet harus stabil: `branches.name asc, branches.id asc`.

Dengan aturan ini:

- total child selalu sama dengan total awal
- pembulatan hanya beda maksimal Rp1 antar outlet
- hasil deterministik dan bisa diaudit

### BR-6: Total split harus sama dengan total awal

Backend wajib memvalidasi:

```text
SUM(child.amount) = parent.total_amount
SUM(child.cash_out) = parent.total_amount
semua child.cash_in = 0
semua child.transaction_type = 'cash_out'
```

Jika total tidak sama, transaksi harus gagal dan tidak boleh ada data parsial.

### BR-7: Nominal minimum

Untuk integer Rupiah, setiap cabang harus mendapat nominal lebih dari 0. Jika total nominal lebih kecil dari jumlah cabang aktif, sistem harus menolak transaksi.

Contoh:

- Total Rp3
- Outlet aktif 5
- Tidak mungkin semua outlet mendapat nominal minimal Rp1

Pesan error:

```text
Nominal Kurir bawa Bahan minimal Rp5 karena ada 5 outlet aktif.
```

Jika di masa depan sistem mendukung desimal, rule ini dapat diubah menjadi pembagian decimal `total / outlet_count`.

### BR-8: Parent tidak boleh dihitung di laporan

Parent/header auto split tidak boleh disimpan sebagai row `cashflow_transactions` aktif yang reportable, karena akan menyebabkan double count.

Rekomendasi:

- Simpan parent/header di tabel baru `cashflow_auto_split_groups`.
- Simpan beban per cabang sebagai child row di `cashflow_transactions`.
- Laporan hanya menghitung child row aktif.

### BR-9: Relasi parent-child wajib jelas

Setiap child split wajib menyimpan:

- `auto_split_group_id` ke parent/header
- `reference_group_id` sama dengan group id untuk kompatibilitas pola existing
- `source = 'auto_split_kurir'`
- `source_metadata` berisi snapshot detail parent dan pembagian

### BR-10: Cegah double split

Satu parent/header aktif tidak boleh memiliki lebih dari satu child aktif untuk cabang yang sama.

Backend harus memakai:

- `idempotency_key` untuk double submit dari UI
- unique index untuk child active per group per branch
- transaksi database/RPC agar insert parent dan child atomik

### BR-11: Edit parent memperbarui child

Jika parent/header auto split diedit:

- Update `transaction_date`, `category_id`, `description`, dan total parent.
- Hitung ulang child.
- Update child rows atau void/delete lalu recreate child dalam satu transaksi.
- Audit log harus menyimpan old allocation dan new allocation.

### BR-12: Delete/cancel parent membatalkan child

Jika parent/header auto split di-void/cancel:

- Parent status menjadi `void`.
- Semua child aktif terkait menjadi `void`.
- Child void tidak dihitung dalam cashflow, posisi kas, export aktif, dan analisa.
- Audit log menyimpan reason.

### BR-13: Import dan sync kasir

Jika kas keluar dari kasir memiliki kategori "Kurir bawa Bahan", sistem juga harus melakukan auto split menggunakan aturan yang sama.

Jika kategori kasir bukan "Kurir bawa Bahan", sistem tidak boleh auto split hanya karena mengandung kata "kurir".

Ini berarti helper broad `isKurirExpense()` tidak boleh menjadi dasar fitur baru ini. Buat helper baru, misalnya:

```ts
const KURIR_BAWA_BAHAN_CATEGORY_NAME = 'Kurir bawa Bahan'

function isKurirBawaBahanCategory(name?: string | null): boolean {
  return normalizeStrictCategoryName(name) === 'kurir bawa bahan'
}
```

## 10. Contoh Perhitungan

### Contoh 1

Input:

- Total pengeluaran: Rp50.000
- Kategori: Kurir bawa Bahan
- Jumlah outlet aktif: 5

Hasil:

| Outlet | Beban |
|---|---:|
| Outlet A | Rp10.000 |
| Outlet B | Rp10.000 |
| Outlet C | Rp10.000 |
| Outlet D | Rp10.000 |
| Outlet E | Rp10.000 |

Validasi:

```text
Rp10.000 x 5 = Rp50.000
```

### Contoh 2

Input:

- Total pengeluaran: Rp55.000
- Jumlah outlet aktif: 4

Karena Rp55.000 bisa dibagi rata persis ke 4 outlet:

| Outlet | Beban |
|---|---:|
| Outlet 1 | Rp13.750 |
| Outlet 2 | Rp13.750 |
| Outlet 3 | Rp13.750 |
| Outlet 4 | Rp13.750 |

Validasi:

```text
Rp13.750 x 4 = Rp55.000
```

### Contoh 3: Tidak habis dibagi rata integer

Input:

- Total pengeluaran: Rp50.003
- Jumlah outlet aktif: 5

Perhitungan:

```text
base = floor(50003 / 5) = 10000
remainder = 50003 - (10000 x 5) = 3
```

Jika outlet diurutkan berdasarkan `name asc, id asc`:

| Outlet | Beban |
|---|---:|
| Outlet 1 | Rp10.001 |
| Outlet 2 | Rp10.001 |
| Outlet 3 | Rp10.001 |
| Outlet 4 | Rp10.000 |
| Outlet 5 | Rp10.000 |

Validasi:

```text
10001 + 10001 + 10001 + 10000 + 10000 = 50003
```

## 11. Database Design

### 11.1 Rekomendasi desain

Gunakan kombinasi:

1. Tabel baru `cashflow_auto_split_groups` sebagai parent/header.
2. Tabel existing `cashflow_transactions` sebagai child split reportable.
3. Kolom baru `auto_split_group_id` di `cashflow_transactions`.
4. Source baru `auto_split_kurir` di `cashflow_transactions.source`.

Alasan:

- Parent/header tidak ikut laporan sehingga tidak double count.
- Child tetap memakai sistem laporan existing.
- Relasi parent-child eksplisit.
- Edit/cancel bisa dilakukan di level parent.
- Tidak perlu mengubah semua laporan agar mengecualikan parent.

### 11.2 Migration SQL rekomendasi

Buat migration baru, misalnya:

```text
supabase/migrations/015_auto_split_kurir_bawa_bahan.sql
```

Isi migration rekomendasi:

```sql
-- =============================================
-- Migration 015: Auto Split Kurir bawa Bahan
-- =============================================

-- 1. Pastikan kategori kanonik ada dan aktif.
do $$
declare
  v_category_id uuid;
begin
  select id into v_category_id
  from cashflow_categories
  where regexp_replace(lower(trim(name)), '[_\s]+', ' ', 'g') = 'kurir bawa bahan'
  order by created_at
  limit 1;

  if v_category_id is null then
    insert into cashflow_categories (name, default_type, description, is_active)
    values (
      'Kurir bawa Bahan',
      'cash_out',
      'Biaya kurir pembawa bahan yang otomatis dibagi rata ke semua outlet aktif',
      true
    );
  else
    update cashflow_categories
    set
      name = 'Kurir bawa Bahan',
      default_type = 'cash_out',
      description = 'Biaya kurir pembawa bahan yang otomatis dibagi rata ke semua outlet aktif',
      is_active = true,
      deleted_at = null
    where id = v_category_id;
  end if;
end $$;

-- 2. Parent/header auto split.
create table if not exists cashflow_auto_split_groups (
  id uuid primary key default uuid_generate_v4(),
  transaction_date date not null,
  original_branch_id uuid references branches(id),
  category_id uuid not null references cashflow_categories(id),
  description text default '',
  total_amount numeric not null check (total_amount > 0),
  branch_count integer not null check (branch_count > 0),
  split_rule text not null default 'equal_active_branches'
    check (split_rule in ('equal_active_branches')),
  rounding_rule text not null default 'floor_remainder_by_branch_order'
    check (rounding_rule in ('floor_remainder_by_branch_order')),
  status text not null default 'active'
    check (status in ('active', 'void')),
  entry_source text not null default 'manual_cashflow'
    check (entry_source in ('manual_cashflow', 'kasir_import', 'kasir_sync')),
  source_ref text,
  idempotency_key text,
  branch_snapshot jsonb not null default '[]'::jsonb,
  allocation_snapshot jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text
);

create index if not exists idx_cashflow_auto_split_groups_date
  on cashflow_auto_split_groups(transaction_date desc);

create index if not exists idx_cashflow_auto_split_groups_category
  on cashflow_auto_split_groups(category_id);

create index if not exists idx_cashflow_auto_split_groups_status
  on cashflow_auto_split_groups(status);

create index if not exists idx_cashflow_auto_split_groups_created_by
  on cashflow_auto_split_groups(created_by);

create unique index if not exists unique_cashflow_auto_split_groups_idempotency
  on cashflow_auto_split_groups(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists unique_cashflow_auto_split_groups_source_ref
  on cashflow_auto_split_groups(entry_source, source_ref)
  where source_ref is not null;

drop trigger if exists update_cashflow_auto_split_groups_updated_at on cashflow_auto_split_groups;

create trigger update_cashflow_auto_split_groups_updated_at
  before update on cashflow_auto_split_groups
  for each row execute function update_updated_at_column();

-- 3. Relasi child split ke parent/header.
alter table cashflow_transactions
  add column if not exists auto_split_group_id uuid
  references cashflow_auto_split_groups(id);

create index if not exists idx_cashflow_transactions_auto_split_group
  on cashflow_transactions(auto_split_group_id)
  where auto_split_group_id is not null;

create unique index if not exists unique_active_auto_split_child_per_branch
  on cashflow_transactions(auto_split_group_id, branch_id)
  where auto_split_group_id is not null
    and status = 'active';

-- 4. Tambahkan source baru.
alter table cashflow_transactions drop constraint if exists cashflow_transactions_source_check;

alter table cashflow_transactions add constraint cashflow_transactions_source_check
  check (source in (
    'manual',
    'sales',
    'purchase_order',
    'kasir_sales',
    'kasir_expenses',
    'beban_transfer',
    'auto_split_kurir'
  ));

-- 5. RLS untuk parent/header.
alter table cashflow_auto_split_groups enable row level security;

create policy "auto_split_groups_select_active_user" on cashflow_auto_split_groups
  for select using (is_user_active());

create policy "auto_split_groups_insert_active_user" on cashflow_auto_split_groups
  for insert with check (is_user_active());

create policy "auto_split_groups_update_active_user" on cashflow_auto_split_groups
  for update using (is_user_active());

create policy "auto_split_groups_delete_owner" on cashflow_auto_split_groups
  for delete using (get_user_role() = 'owner' and is_user_active());
```

### 11.3 TypeScript type update

Update `src/types/database.ts`:

- Tambahkan `auto_split_kurir` ke `CashflowSource`.
- Tambahkan interface `CashflowAutoSplitGroup`.
- Tambahkan table typing `cashflow_auto_split_groups`.
- Tambahkan field `auto_split_group_id` pada `CashflowTransaction`.
- Jika RPC dibuat, tambahkan typing di `Database.public.Functions`.

Contoh tipe:

```ts
export type CashflowSource =
  | 'manual'
  | 'sales'
  | 'purchase_order'
  | 'kasir_sales'
  | 'kasir_expenses'
  | 'beban_transfer'
  | 'auto_split_kurir'
```

### 11.4 Kenapa tidak memakai parent di `cashflow_transactions`

Jika parent juga disimpan sebagai `cashflow_transactions.status = 'active'`, semua query existing yang memakai `status = 'active'` akan menghitung parent dan child sekaligus. Ini menyebabkan double count.

Menyimpan parent di tabel terpisah menghindari perubahan besar pada semua report existing.

## 12. Backend/API Design

### 12.1 Prinsip implementasi backend

Implementasi harus dipusatkan di server-side. Jangan membuat parent dan child langsung dari client component.

Rekomendasi struktur:

- `src/app/api/cashflow/transactions/route.ts`
- `src/app/api/cashflow/transactions/[id]/route.ts`
- `src/lib/cashflow/auto-split-kurir.ts`
- RPC Postgres untuk transaksi atomik, misalnya:
  - `create_auto_split_kurir_bawa_bahan`
  - `update_auto_split_kurir_bawa_bahan`
  - `void_auto_split_kurir_bawa_bahan`

Jika tidak memakai RPC, API route harus melakukan rollback manual seperti pola `src/app/api/cashflow/beban-transfer/route.ts`. Namun RPC lebih aman karena semua statement berada dalam satu transaksi database.

### 12.2 Helper deteksi kategori

Buat helper tunggal yang dipakai oleh:

- cashflow manual create/update
- import kasir preview/import
- sync kasir confirm
- validasi API split

Contoh:

```ts
export const KURIR_BAWA_BAHAN_CATEGORY_NAME = 'Kurir bawa Bahan'

export function normalizeStrictCategoryName(name?: string | null) {
  return (name || '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim()
}

export function isKurirBawaBahanCategory(name?: string | null) {
  return normalizeStrictCategoryName(name) === 'kurir bawa bahan'
}
```

Jangan gunakan:

```ts
name.includes('kurir')
```

untuk fitur ini.

### 12.3 POST create pengeluaran cabang

Endpoint rekomendasi:

```text
POST /api/cashflow/transactions
```

Request body:

```json
{
  "transaction_date": "2026-06-30",
  "branch_id": "uuid-cabang-pencatat",
  "transaction_type": "cash_out",
  "category_id": "uuid-kategori-kurir-bawa-bahan",
  "description": "Kurir ambil bahan pusat",
  "amount": 50000,
  "idempotency_key": "client-generated-uuid"
}
```

Flow backend:

1. Validasi session user.
2. Validasi tanggal format `YYYY-MM-DD`.
3. Validasi amount integer dan `> 0`.
4. Ambil kategori by `category_id`.
5. Jika kategori bukan "Kurir bawa Bahan", insert normal ke `cashflow_transactions` memakai logic existing.
6. Jika kategori "Kurir bawa Bahan":
   - Validasi `transaction_type = 'cash_out'`.
   - Ambil semua cabang aktif.
   - Jika tidak ada cabang aktif, return error.
   - Jika `amount < active_branch_count`, return error.
   - Hitung allocation.
   - Insert parent/header `cashflow_auto_split_groups`.
   - Insert child rows ke `cashflow_transactions`.
   - Insert audit log.
   - Return parent dan allocation.

Response sukses auto split:

```json
{
  "success": true,
  "mode": "auto_split_kurir",
  "group_id": "uuid-group",
  "total_amount": 50000,
  "branch_count": 5,
  "allocations": [
    { "branch_id": "uuid-a", "branch_name": "Outlet A", "amount": 10000 },
    { "branch_id": "uuid-b", "branch_name": "Outlet B", "amount": 10000 }
  ],
  "transaction_ids": ["uuid-child-1", "uuid-child-2"],
  "message": "Pengeluaran Kurir bawa Bahan berhasil dibagi ke 5 outlet aktif."
}
```

Response sukses normal:

```json
{
  "success": true,
  "mode": "normal",
  "transaction_id": "uuid",
  "message": "Transaksi cashflow berhasil ditambahkan."
}
```

### 12.4 Child row payload

Setiap child split di `cashflow_transactions`:

```ts
{
  transaction_date: parent.transaction_date,
  branch_id: allocation.branch_id,
  transaction_type: 'cash_out',
  category_id: parent.category_id,
  description: `${parent.description} (auto split Kurir bawa Bahan)`,
  cash_in: 0,
  cash_out: allocation.amount,
  amount: allocation.amount,
  source: 'auto_split_kurir',
  source_id: null,
  reference_group_id: groupId,
  auto_split_group_id: groupId,
  source_label: 'Auto Split Kurir bawa Bahan',
  source_metadata: {
    auto_split_type: 'kurir_bawa_bahan',
    original_branch_id: parent.original_branch_id,
    original_amount: parent.total_amount,
    branch_count: parent.branch_count,
    rounding_rule: parent.rounding_rule,
    branch_order: allocation.order,
    idempotency_key
  },
  status: 'active',
  created_by: user.id,
  updated_by: user.id
}
```

Catatan penting: `source_id` harus tetap `null` untuk child split, karena constraint existing `unique_cashflow_source` unik pada `(source, source_id)`. Jika semua child memakai `source_id = groupId`, insert child kedua akan gagal.

### 12.5 PATCH update pengeluaran cabang

Endpoint rekomendasi:

```text
PATCH /api/cashflow/transactions/:id
```

Untuk transaksi normal:

- Jika tetap kategori normal, update `cashflow_transactions` seperti existing.
- Jika berubah ke "Kurir bawa Bahan", convert menjadi auto split.

Untuk child auto split:

- Jangan izinkan edit langsung pada child.
- Return error:

```text
Transaksi ini adalah hasil auto split. Edit transaksi induk untuk mengubah pembagian.
```

Untuk parent/header auto split:

Gunakan endpoint khusus atau parameter:

```text
PATCH /api/cashflow/auto-split-groups/:groupId
```

Flow update parent:

1. Load parent group active.
2. Load child active.
3. Validasi kategori masih "Kurir bawa Bahan".
4. Hitung ulang allocation memakai `branch_snapshot`.
5. Update parent.
6. Update child existing per branch.
7. Jika daftar branch berubah karena action eksplisit recalculate, void child lama yang tidak ada di allocation baru dan insert child baru.
8. Insert audit `cashflow_auto_split_updated`.

### 12.6 DELETE/cancel pengeluaran cabang

Karena sistem saat ini memakai `void` untuk pembatalan, endpoint cancel lebih aman daripada hard delete.

Endpoint:

```text
POST /api/cashflow/auto-split-groups/:groupId/void
```

Body:

```json
{
  "reason": "Salah input"
}
```

Flow:

1. Validasi session.
2. Load parent.
3. Update parent `status = 'void'`, `voided_at`, `voided_by`, `void_reason`.
4. Update child active menjadi `status = 'void'`.
5. Insert audit `cashflow_auto_split_voided`.
6. Invalidate cache client terkait.

Hard delete optional:

```text
DELETE /api/cashflow/auto-split-groups/:groupId
```

Aturan:

- Hanya role owner.
- Audit snapshot parent dan child dulu.
- Delete child lalu parent, atau delete parent dengan cascade jika migration memakai cascade.
- Untuk konsistensi pola existing, hard delete sebaiknya hanya tersedia untuk parent dan child yang sudah void.

### 12.7 Import kasir

File relevan:

- `src/lib/kasir-import/shared.ts`
- `src/lib/kasir-import/server.ts`
- `src/app/api/kasir-import/combined/route.ts`

Perubahan:

1. Tambahkan helper `isKurirBawaBahanCategory`.
2. Di `getExpensesPreview()`, ganti auto split broad `isKurirExpense()` menjadi deteksi spesifik:

   ```ts
   const isAutoSplitKurirBawaBahan = isKurirBawaBahanCategory(item.category)
   ```

3. Jika item kategori "Kurir bawa Bahan":
   - mapping default `split_equal` ke semua cabang aktif.
   - status tidak bergantung pada cabang asal matched, selama ada cabang aktif.
4. Jika item kategori lain:
   - jangan auto split.
   - tetap mapping original/remap seperti existing.
5. Saat import save:
   - gunakan parent/header `cashflow_auto_split_groups` untuk item auto split, atau minimal isi `auto_split_group_id` child.
   - simpan `entry_source = 'kasir_import'`.
   - simpan `source_ref = expenseId` atau base import key.
   - child tetap punya `import_key` unik per branch:

     ```text
     kasir-expenses:{original_branch_slug}:{expenseId}:split:{branchId}
     ```

### 12.8 Sync kasir

File relevan:

- `src/lib/kasir-sync/server.ts`
- `src/app/api/kasir-sync/confirm/route.ts`

Perubahan:

1. Saat `confirmKasKeluar()`, jika `item.kategori` adalah "Kurir bawa Bahan", backend harus membuat mapping split_equal otomatis jika UI tidak mengirim mapping manual.
2. Jangan split kategori lain berdasarkan broad keyword.
3. Jika item sudah pernah diimport sebagai split, gunakan pengecekan existing import_key seperti pola saat ini.
4. Simpan parent/header dengan `entry_source = 'kasir_sync'` dan `source_ref = item.kasir_id` atau `sync_queue_id`.
5. Update `kasir_sync_queue.cashflow_transaction_id` dengan salah satu child id atau group id jika kolom baru ditambah. Karena kolom saat ini mengarah ke `cashflow_transactions`, gunakan child pertama untuk kompatibilitas dan simpan group id di `source_metadata`.

### 12.9 Error handling

Error yang wajib ditangani:

- User tidak login: HTTP 401.
- Kategori tidak ditemukan: HTTP 400.
- Kategori bukan cash out/both: HTTP 400.
- Kategori bukan "Kurir bawa Bahan": jalur normal, bukan error.
- Tidak ada cabang aktif: HTTP 400.
- Nominal tidak valid: HTTP 400.
- Nominal kurang dari jumlah outlet aktif: HTTP 400.
- Duplicate idempotency key: return response sukses existing, bukan membuat data baru.
- Unique child per branch gagal: rollback dan return HTTP 409 jika bukan idempotent retry.
- Database insert/update gagal: HTTP 500 dengan pesan aman.

### 12.10 Transaction safety

Semua langkah auto split harus atomik.

Satu transaksi database harus mencakup:

- insert/update parent
- insert/update/void child
- insert audit log
- validasi total allocation

Jika salah satu gagal, tidak boleh ada child split parsial.

## 13. Frontend/UI Design

### 13.1 Halaman cashflow

File utama:

- `src/app/(dashboard)/cashflow/page.tsx`

Perubahan UI:

1. Saat kategori dipilih, deteksi apakah kategori adalah "Kurir bawa Bahan".
2. Jika ya, tampilkan info:

   ```text
   Pengeluaran dengan kategori Kurir bawa Bahan akan otomatis dibagi rata ke semua outlet aktif.
   ```

3. Tampilkan preview alokasi:
   - Total outlet aktif
   - Total nominal
   - Beban per outlet
   - Rincian outlet dan nominal
   - Info pembulatan jika ada
4. Label cabang pada form berubah menjadi `Cabang pencatat` atau `Cabang asal pencatatan`, bukan cabang beban tunggal.
5. Tombol submit disable saat preview gagal.
6. Jika tidak ada outlet aktif, tampilkan error dan disable submit.
7. Jika nominal lebih kecil dari jumlah outlet aktif, tampilkan error.
8. Setelah sukses, toast:

   ```text
   Pengeluaran Kurir bawa Bahan berhasil dibagi ke 5 outlet aktif.
   ```

### 13.2 Preview split

Preview boleh dihitung di frontend untuk UX cepat, tetapi backend tetap menjadi sumber kebenaran.

Frontend harus memakai daftar cabang aktif yang sama pola filternya:

```ts
branches where is_active = true and deleted_at is null order by name
```

Jika data frontend stale, backend boleh mengembalikan allocation berbeda. UI harus memakai response backend setelah save.

### 13.3 Tabel/list cashflow

Child split tampil sebagai transaksi cash out per cabang.

Tambahkan label source:

```text
Auto Split Kurir
```

Untuk child auto split:

- Tombol edit langsung disembunyikan.
- Tombol void langsung disembunyikan atau diarahkan ke parent.
- Tampilkan action detail group.

Contoh label:

```text
Auto Split Kurir - Group 5 outlet
```

### 13.4 Detail parent/group

Tambahkan modal/detail untuk parent auto split:

Informasi:

- Tanggal
- Cabang pencatat
- Kategori
- Deskripsi
- Total nominal
- Jumlah outlet
- Status
- Dibuat oleh
- Dibuat pada
- Daftar alokasi per outlet
- Total validasi

Aksi:

- Edit parent
- Void/cancel parent
- Hard delete jika owner dan status void

### 13.5 Import kasir UI

Di preview import gabungan:

- Jika item kategori "Kurir bawa Bahan", tampilkan badge:

  ```text
  Auto split ke {n} outlet
  ```

- Tampilkan detail allocation pada expand row atau modal.
- Kategori lain tidak boleh tampil sebagai auto split hanya karena ada kata kurir.

### 13.6 Responsif mobile dan desktop

UI harus tetap responsif:

- Preview allocation di desktop dapat berupa tabel.
- Preview allocation di mobile berupa card/list.
- Nominal Rupiah tidak boleh keluar container.
- Tombol submit tetap mudah dijangkau.
- Tidak ada horizontal scroll untuk form utama.

## 14. Cashflow dan Reporting Impact

### 14.1 Laporan cashflow cabang

Setiap cabang melihat beban sesuai child split masing-masing:

```text
branch_id = cabang terkait
transaction_type = cash_out
category = Kurir bawa Bahan
amount = nominal split cabang tersebut
status = active
```

Karena laporan cabang sudah membaca `cashflow_transactions`, tidak perlu menambah query laporan utama selama parent disimpan di tabel terpisah.

### 14.2 Laporan admin/pusat

Admin pusat perlu melihat:

- Total pengeluaran awal.
- Daftar pembagian per cabang.
- Child rows di cashflow jika melihat per cabang.

Untuk menghindari double count:

- Report operasional dan export menghitung child active saja.
- Parent/header hanya tampil di detail group/admin view, bukan sebagai transaksi cashflow aktif tambahan.

### 14.3 Posisi kas cabang

Current position di `/cashflow` dan `/cashflow/analysis` dihitung dari:

```text
cash_in - cash_out
where status = active
```

Dampak:

- Child split mengurangi posisi kas cabang masing-masing.
- Parent/header tidak mempengaruhi posisi kas.
- Jika parent di-void, child menjadi void sehingga posisi kas kembali seperti sebelum transaksi.

### 14.4 Export cashflow

`src/app/api/cashflow/export/route.ts` menerima transaksi yang dikirim dari UI. Karena child split adalah `cashflow_transactions`, export akan memasukkan beban per cabang.

Tambahan yang disarankan:

- Kolom `Sumber` menampilkan `Auto Split Kurir`.
- Kolom `Group ID` opsional untuk audit.
- Sheet tambahan `Detail Auto Split` opsional, berisi parent dan allocation.

### 14.5 Export arus kas

`src/app/api/cashflow/export-arus-kas/route.ts` mengambil transaksi aktif berdasarkan `branch_id`. Child split otomatis masuk sebagai kas keluar cabang.

Tidak perlu menghitung parent.

### 14.6 Analisa cashflow/P&L

`src/app/(dashboard)/cashflow/analysis/page.tsx` menghitung beban dari cashflow active.

Dampak:

- Beban kategori "Kurir bawa Bahan" akan tersebar ke semua cabang.
- Komposisi beban kategori tetap akurat karena total child sama dengan total parent.
- Profit bersih per cabang berubah sesuai alokasi child.

## 15. Audit Log

Sistem sudah memiliki tabel `audit_logs`.

Fitur ini wajib mencatat:

### 15.1 Create auto split

Action:

```text
cashflow_auto_split_created
```

`new_data` minimal:

- group id
- transaction date
- category id dan category name
- original branch
- total amount
- branch count
- rounding rule
- allocation list
- child transaction ids
- idempotency key
- created by
- created at

### 15.2 Update auto split

Action:

```text
cashflow_auto_split_updated
```

`old_data`:

- parent lama
- allocation lama
- child ids lama

`new_data`:

- parent baru
- allocation baru
- child ids baru
- field yang berubah

### 15.3 Void/cancel auto split

Action:

```text
cashflow_auto_split_voided
```

`old_data`:

- parent active
- child active

`new_data`:

- parent status void
- child status void
- void reason

### 15.4 Hard delete auto split

Action:

```text
cashflow_auto_split_deleted
```

Hanya owner. Audit harus dibuat sebelum delete.

`old_data` wajib berisi snapshot parent dan seluruh child.

### 15.5 Import/sync

Untuk import/sync kasir:

- `kasir_expenses_imported` atau `kasir_sync_confirmed` tetap boleh dipakai untuk child.
- Tambahkan audit group-level `cashflow_auto_split_created` agar parent-child terlihat jelas.

## 16. Validasi dan Edge Cases

### 16.1 Tidak ada outlet aktif

Backend return error:

```text
Tidak ada outlet aktif. Aktifkan minimal 1 outlet sebelum menyimpan Kurir bawa Bahan.
```

Tidak boleh membuat parent atau child.

### 16.2 Hanya ada 1 outlet aktif

Sistem tetap membuat parent/header dan satu child untuk satu outlet aktif.

Hasil:

```text
child.amount = total_amount
```

Ini menjaga pola data tetap konsisten.

### 16.3 Nominal lebih kecil dari jumlah outlet aktif

Untuk integer Rupiah, tolak transaksi karena tidak semua outlet bisa mendapat nominal positif.

Contoh:

- Total Rp3
- Outlet aktif 5

Error:

```text
Nominal Kurir bawa Bahan minimal Rp5 karena ada 5 outlet aktif.
```

### 16.4 Nominal tidak habis dibagi rata

Gunakan floor + remainder ke outlet awal berdasarkan urutan stabil.

Total hasil akhir wajib sama dengan total awal.

### 16.5 Kategori typo atau beda huruf besar/kecil

- Beda huruf besar/kecil dan spasi ekstra tetap dianggap match.
- Typo kata tidak dianggap match.
- Broad keyword `kurir` tidak dianggap match.

### 16.6 Double click submit

Frontend:

- Disable tombol saat saving.

Backend:

- Wajib menerima `idempotency_key`.
- Unique index pada `idempotency_key`.
- Jika request yang sama dikirim ulang, return group existing.

### 16.7 Edit dari kategori lain menjadi "Kurir bawa Bahan"

Backend convert normal transaction menjadi auto split.

Rekomendasi aman:

- Void transaksi normal lama.
- Buat auto split group baru.
- Audit relasi old normal id -> new group id.

### 16.8 Edit dari "Kurir bawa Bahan" menjadi kategori lain

Rekomendasi MVP:

- Jangan convert otomatis dalam satu form.
- Minta user void auto split lama lalu buat transaksi baru kategori lain.

Jika tetap diimplementasikan:

- Void parent dan child lama.
- Buat transaksi normal baru.
- Audit harus jelas agar tidak terlihat seperti child hilang tanpa alasan.

### 16.9 Transaksi dihapus/dibatalkan

- Cancel/void parent harus void semua child.
- Hard delete parent harus menghapus semua child atau child harus sudah void lalu dihapus.
- Audit snapshot wajib dibuat sebelum hard delete.

### 16.10 Outlet aktif berubah setelah transaksi dibuat

Tidak retroaktif.

Parent menyimpan `branch_snapshot` dan `allocation_snapshot`. Jika outlet baru ditambahkan besok, transaksi kemarin tidak berubah.

Jika owner ingin re-split dengan daftar outlet aktif terbaru, perlu action eksplisit `Recalculate outlet aktif saat ini`.

### 16.11 Saldo cabang tidak cukup

Saat ini sistem tidak memiliki tabel saldo kas dan tidak terlihat ada validasi saldo cukup. Posisi kas hanya hasil perhitungan dari cashflow aktif.

Untuk MVP:

- Jangan blokir jika posisi kas cabang menjadi negatif.
- Tampilkan seperti pola laporan existing.

Jika nanti bisnis membutuhkan saldo tidak boleh negatif:

- Backend harus menghitung posisi kas tiap cabang sebelum insert child.
- Jika salah satu cabang tidak cukup, seluruh auto split gagal.
- Pesan error harus menyebut cabang yang tidak cukup.

### 16.12 Child split diedit langsung

Tidak boleh.

UI harus menyembunyikan edit/void child dan mengarahkan user ke parent group.

Backend harus tetap menolak edit langsung jika `auto_split_group_id` tidak null.

### 16.13 Parent active tetapi sebagian child hilang

Ini data corrupt.

Tambahkan check di detail group:

```text
branch_count parent != jumlah child active
```

Tampilkan warning untuk owner/admin dan sediakan action repair/recreate child dari snapshot, hanya jika diperlukan.

## 17. Testing Checklist

### 17.1 Manual cashflow create

- Buat kas keluar kategori "Kurir bawa Bahan" total Rp50.000 dengan 5 outlet aktif.
- Pastikan sistem membuat 5 child cash out Rp10.000.
- Pastikan parent/header dibuat.
- Pastikan total child Rp50.000.
- Pastikan child punya `auto_split_group_id`.
- Pastikan child punya `source = auto_split_kurir`.
- Pastikan audit `cashflow_auto_split_created` dibuat.

### 17.2 Kategori lain tidak terkena auto split

- Buat kas keluar kategori "Kurir".
- Buat kas keluar kategori "Beban Kurir".
- Buat kas keluar kategori "Ongkir".
- Buat kas keluar kategori "Pembelian Gas".
- Pastikan masing-masing hanya membuat satu transaksi normal.

### 17.3 Pembulatan

- Buat total Rp50.003 dengan 5 outlet aktif.
- Pastikan 3 outlet pertama mendapat Rp10.001 dan 2 outlet lain Rp10.000.
- Pastikan total tetap Rp50.003.

### 17.4 Satu outlet aktif

- Nonaktifkan semua outlet kecuali 1 pada environment test.
- Buat Kurir bawa Bahan Rp50.000.
- Pastikan satu child Rp50.000.

### 17.5 Tidak ada outlet aktif

- Nonaktifkan semua outlet pada environment test.
- Coba simpan Kurir bawa Bahan.
- Pastikan gagal dengan pesan jelas.
- Pastikan tidak ada parent/child parsial.

### 17.6 Nominal kurang dari outlet aktif

- Dengan 5 outlet aktif, coba simpan Rp3.
- Pastikan gagal.
- Pastikan tidak ada data tersimpan.

### 17.7 Double submit

- Simulasikan double click atau kirim request POST dua kali dengan idempotency key sama.
- Pastikan hanya satu parent dibuat.
- Pastikan hanya satu child aktif per cabang.
- Response kedua mengembalikan group existing atau status idempotent success.

### 17.8 Edit parent

- Buat auto split Rp50.000 ke 5 outlet.
- Edit nominal menjadi Rp55.000.
- Pastikan child terupdate menjadi total Rp55.000.
- Pastikan tidak ada child ganda.
- Pastikan audit update menyimpan old/new allocation.

### 17.9 Edit kategori normal -> Kurir bawa Bahan

- Buat transaksi normal cash out.
- Edit kategori ke "Kurir bawa Bahan".
- Pastikan transaksi normal lama tidak double count.
- Pastikan auto split child dibuat.
- Pastikan laporan total benar.

### 17.10 Void/cancel parent

- Buat auto split.
- Void parent.
- Pastikan semua child menjadi `void`.
- Pastikan laporan cashflow cabang tidak menghitung child.
- Pastikan posisi kas kembali.
- Pastikan audit void dibuat.

### 17.11 Import kasir

- Siapkan item kas keluar dari kasir kategori "Kurir bawa Bahan".
- Preview harus menampilkan auto split ke semua outlet aktif.
- Save/import harus membuat parent dan child.
- Kategori "Kurir" atau "Ongkir" tidak boleh auto split.
- Duplicate import tidak boleh membuat child baru.

### 17.12 Sync kasir

- Tarik queue item `kas_keluar` kategori "Kurir bawa Bahan".
- Confirm tanpa mapping manual.
- Pastikan auto split dibuat.
- Confirm ulang tidak membuat data ganda.
- Kategori lain tidak split otomatis.

### 17.13 Laporan dan export

- Laporan cabang menampilkan beban child sesuai cabang.
- Laporan admin total child sama dengan total parent.
- Export cashflow tidak double count parent.
- Export arus kas cabang menampilkan child.
- Analisa P&L per cabang berubah sesuai child.

### 17.14 UI responsive

- Test desktop 1366px.
- Test tablet 768px.
- Test mobile 390px.
- Preview allocation tidak keluar viewport.
- Tombol submit, cancel, dan detail group tetap mudah digunakan.
- Tidak ada error console browser.
- Tidak ada error backend/server.

### 17.15 Regression existing behavior

- Create cash in manual tetap normal.
- Create cash out manual kategori lain tetap normal.
- Void transaksi manual tetap normal.
- Delete transaksi manual void owner tetap normal.
- Import penjualan kasir tetap normal.
- Import bahan baku tetap normal.
- Transfer beban tetap normal.

## 18. Acceptance Criteria

Fitur dianggap selesai jika:

1. Kategori "Kurir bawa Bahan" tersedia dan aktif sebagai cash out.
2. Create kas keluar manual dengan kategori tersebut otomatis membuat child ke semua outlet aktif.
3. Kategori lain tidak auto split.
4. Total child selalu sama dengan total parent.
5. Tidak ada double count di laporan cashflow, posisi kas, export, dan analisa.
6. Parent-child relation tersimpan dan bisa diaudit.
7. Edit parent memperbarui child tanpa duplikasi.
8. Void parent membatalkan semua child.
9. Double submit tidak membuat data ganda.
10. Import/sync kasir kategori "Kurir bawa Bahan" mengikuti aturan yang sama.
11. UI menampilkan informasi dan preview split.
12. Mobile dan desktop aman.
13. Audit log mencatat create, update, void, dan delete.

## 19. Deployment Notes

### 19.1 Urutan deployment

1. Backup database Supabase.
2. Jalankan migration `015_auto_split_kurir_bawa_bahan.sql` di Supabase SQL Editor.
3. Update `src/types/database.ts`.
4. Tambahkan helper deteksi kategori kanonik.
5. Tambahkan API/RPC create/update/void.
6. Update UI cashflow.
7. Update import kasir dan sync kasir.
8. Update export/source label jika diperlukan.
9. Jalankan:

   ```bash
   npm run lint
   npm run build
   ```

10. Deploy ke Vercel.
11. Smoke test di production dengan nominal kecil.

### 19.2 Rollback teknis

Jika fitur harus dimatikan cepat:

1. Matikan UI trigger auto split dengan feature flag, misalnya env:

   ```text
   NEXT_PUBLIC_ENABLE_AUTO_SPLIT_KURIR_BAWA_BAHAN=false
   ```

2. Backend tetap harus mempertahankan data existing.
3. Jangan drop tabel baru selama masih ada data parent/child.
4. Jika ada data salah, owner void parent group terkait, bukan menghapus child satu per satu.

### 19.3 Cache invalidation

Setelah create/update/void auto split, invalidasi cache client yang sudah dipakai di kode:

```ts
invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
```

Tambahkan cache key baru jika parent/group list memakai cache sendiri.

## 20. Manual Action untuk Owner/Admin

Bahasa non-programmer:

1. Pastikan daftar outlet sudah benar.
   - Buka menu Cabang.
   - Outlet yang masih dipakai harus aktif.
   - Outlet yang sudah tidak dipakai harus nonaktif.

2. Pastikan kategori "Kurir bawa Bahan" ada.
   - Buka menu Cashflow -> Kategori.
   - Cari kategori `Kurir bawa Bahan`.
   - Pastikan tipenya `Cash Out`.
   - Pastikan statusnya aktif.

3. Jika data kasir memakai nama kategori berbeda, samakan di sistem kasir.
   - Nama yang disarankan: `Kurir bawa Bahan`.
   - Jangan memakai `Kurir`, `Ongkir`, atau `Beban Kurir` jika ingin auto split baru berjalan.

4. Setelah deploy, coba transaksi kecil dulu.
   - Contoh Rp5.000.
   - Cek apakah semua outlet aktif mendapat bagian.
   - Cek laporan cashflow tiap outlet.

5. Jika salah input, jangan hapus child satu per satu.
   - Buka detail auto split.
   - Void/cancel transaksi induk.
   - Sistem akan membatalkan semua pembagian sekaligus.

## 21. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Deteksi kategori terlalu luas | Kategori "Kurir" ikut tersplit padahal tidak diminta | Gunakan exact normalized match `kurir bawa bahan`, jangan `includes('kurir')` |
| Parent ikut dihitung laporan | Pengeluaran double count | Parent disimpan di tabel `cashflow_auto_split_groups`, child saja yang masuk `cashflow_transactions` |
| Double submit | Data ganda | `idempotency_key`, unique index, disable tombol saat saving |
| Child diedit langsung | Total parent-child tidak sinkron | UI hide edit child, backend reject update child dengan `auto_split_group_id` |
| Cabang aktif berubah | Histori berubah tidak sengaja | Simpan branch snapshot di parent |
| Insert parsial | Laporan tidak seimbang | Pakai RPC/transaction database |
| Source enum lupa diupdate | Insert child gagal | Migration update constraint source dan TypeScript type |
| Unique `(source, source_id)` bentrok | Child kedua gagal insert | Jangan isi `source_id` dengan group id untuk child split |
| Import kasir masih broad split | Kategori lain ikut auto split | Ganti helper import/sync ke deteksi spesifik |

## 22. Rekomendasi Implementasi Bertahap

### P0

- Migration tabel parent dan kolom child.
- Helper deteksi kategori "Kurir bawa Bahan".
- API/RPC create auto split manual.
- UI preview di form cashflow.
- Child tidak bisa diedit langsung.
- Void parent membatalkan child.
- Audit create/void.

### P1

- Edit parent auto split.
- Import kasir kategori "Kurir bawa Bahan" auto split memakai parent group.
- Sync kasir confirm auto split memakai parent group.
- Detail group modal.
- Export menampilkan source/group.

### P2

- Recalculate outlet aktif saat ini sebagai action eksplisit.
- Repair tool untuk parent-child mismatch.
- Feature flag admin.
- Automated tests jika test runner ditambahkan ke project.

## 23. Catatan Developer

1. Sistem saat ini sudah memiliki pola split dengan `reference_group_id`, tetapi belum memiliki parent/header kuat. Fitur baru sebaiknya tidak hanya menambah child row tanpa parent karena requirement edit/delete/rollback meminta relasi transaksi utama.
2. Existing helper `distributeSplitAmounts(total, count)` sudah cocok untuk pembagian integer dengan remainder. Helper ini bisa dipakai ulang, tetapi pastikan validasi `amount >= branchCount`.
3. Existing `canManageCashflowTx()` di halaman cashflow harus diubah agar child auto split tidak dapat diedit/void langsung.
4. Existing `CashflowSourceLabel` perlu menambahkan label `auto_split_kurir`.
5. Query laporan yang menghitung `cashflow_transactions.status = 'active'` tetap aman selama parent tidak berada di tabel transaksi aktif.
6. Jangan memakai service role key di frontend. API server-side boleh memakai session user; RPC `security definer` harus tetap memvalidasi user aktif.
