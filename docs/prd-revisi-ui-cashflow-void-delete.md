# PRD Revisi UI Responsif, Posisi Kas Cabang, dan Hapus Void

## 1. Ringkasan

Dokumen ini mendefinisikan revisi untuk sistem RBN Sales & Cashflow agar:

1. Tampilan laporan lebih responsif dan tidak memaksa user geser kanan-kiri untuk membaca data utama.
2. Halaman cashflow menampilkan posisi kas saat ini per cabang, misalnya Buduk, Dalung, dan cabang lain.
3. Transaksi atau laporan berstatus void dapat dihapus permanen sehingga datanya benar-benar hilang dari tabel operasional, bukan hanya tampil dengan status void.

PRD ini dibuat berdasarkan pembacaan kode pada modul:

- `src/app/(dashboard)/sales/reports/page.tsx`
- `src/app/(dashboard)/cashflow/page.tsx`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/ui/FilterBar.tsx`
- `src/app/globals.css`
- `src/types/database.ts`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_add_delete_support.sql`
- `supabase/migrations/003_add_submitted_status.sql`
- `supabase/migrations/004_fix_unique_cashflow_constraint.sql`

## 2. Latar Belakang Kondisi Saat Ini

### 2.1 UI laporan

Halaman laporan penjualan saat ini memakai tabel lebar dengan banyak kolom:

- Tanggal
- Cabang
- Cash
- QRIS
- GoFood
- GrabFood
- Shopee
- Offline
- Online Nett
- Grand Total
- Status
- Aksi

Container tabel memakai `overflow-x-auto`, sehingga ketika kolom tidak muat layar, user harus scroll horizontal. Ini terlihat pada screenshot laporan penjualan.

### 2.2 Cashflow dan posisi kas

Halaman cashflow saat ini menghitung:

- Total Cash In
- Total Cash Out
- Nett Cashflow

Perhitungan ini berdasarkan transaksi yang sedang tampil di filter tanggal dan hanya transaksi dengan status `active`. Belum ada ringkasan posisi kas kumulatif per cabang.

Di database, `cashflow_transactions` memiliki:

- `branch_id`
- `transaction_type`: `cash_in` atau `cash_out`
- `amount`
- `cash_in`
- `cash_out`
- `source`: `manual` atau `sales`
- `source_id`
- `status`: `active` atau `void`

Sales yang di-post otomatis masuk ke cashflow lewat trigger `sync_sales_to_cashflow`.

### 2.3 Void dan delete

Untuk laporan penjualan:

- Action void hanya mengubah `sales_reports.status` menjadi `void`.
- Jika laporan dari status `posted` berubah ke `void`, trigger database ikut mengubah cashflow terkait menjadi `void`.
- Delete permanen saat ini hanya tersedia untuk status `draft` dan `submitted`.
- Data `void` tetap tampil jika filter status memilih `Void` atau semua status.

Untuk cashflow:

- Transaksi manual dapat di-void.
- Transaksi manual dapat dihapus permanen.
- Transaksi dari sales (`source = sales`) tidak bisa diedit/hapus langsung dari halaman cashflow, hanya ditandai "Dari Sales".

RLS database saat ini membatasi delete pada `sales_reports` dan `cashflow_transactions` hanya untuk role `owner`.

## 3. Tujuan Produk

### 3.1 UI responsif

User dapat membaca data utama laporan tanpa scroll horizontal pada desktop, tablet, maupun mobile.

### 3.2 Posisi kas cabang

Owner/admin dapat melihat saldo atau posisi kas saat ini per cabang langsung dari halaman cashflow.

### 3.3 Hapus data void

Owner dapat menghapus permanen transaksi/laporan void agar tidak lagi muncul di laporan operasional, list, export, maupun perhitungan.

## 4. Non-Goals

Revisi ini tidak mencakup:

- Mengubah sistem login dan role selain penyesuaian visibility tombol sesuai role.
- Mengubah struktur dasar kategori cashflow.
- Menghapus audit log historis. Audit log tetap disimpan sebagai jejak tindakan.
- Membuat modul akuntansi lengkap seperti buku besar, jurnal, atau rekonsiliasi bank.

## 5. Definisi Istilah

- Posisi kas saat ini: total kumulatif transaksi cashflow aktif per cabang sampai tanggal acuan, dihitung dari `cash_in - cash_out`.
- Tanggal acuan: tanggal batas akhir perhitungan posisi kas. Default adalah hari ini.
- Hard delete: penghapusan permanen dari tabel operasional Supabase menggunakan `.delete()`.
- Void: status pembatalan transaksi/laporan yang membuat data tidak dihitung, tetapi record masih ada.

## 6. Kebutuhan Fungsional

### FR-1: Laporan Penjualan Tanpa Scroll Horizontal

Halaman `Laporan Penjualan` harus menampilkan data utama tanpa horizontal scroll.

Kolom utama yang wajib selalu terlihat:

- Tanggal
- Cabang
- Offline
- Online Nett
- Grand Total
- Status
- Aksi

Detail platform yang tidak wajib selalu terlihat:

- Cash
- QRIS
- GoFood
- GrabFood
- Shopee

Detail platform dipindahkan ke salah satu pola berikut:

1. Row expandable: user klik row atau tombol detail, lalu detail channel muncul di bawah row.
2. Detail modal/drawer: tombol detail membuka rincian sales yang sudah tersedia saat ini.
3. Column visibility: user bisa memilih kolom tambahan, tetapi default tetap tidak menyebabkan scroll horizontal.

Rekomendasi: gunakan default tabel ringkas + detail modal/drawer karena modal detail sudah ada di kode saat ini.

Acceptance criteria:

- Pada lebar desktop, tabel laporan penjualan tidak membutuhkan scroll horizontal untuk membaca data utama.
- Pada tablet dan mobile, data berubah menjadi layout card/list per laporan.
- Aksi utama tetap bisa dijalankan tanpa membuka scroll horizontal.
- Nilai uang tetap rata kanan pada tabel desktop dan mudah discan pada card mobile.

### FR-2: Cashflow Tanpa Scroll Horizontal

Halaman `Cashflow` harus mengikuti pola responsif yang sama.

Kolom utama yang wajib selalu terlihat:

- Tanggal
- Cabang
- Tipe
- Kategori
- Nominal
- Sumber
- Status
- Aksi

Kolom `Cash In` dan `Cash Out` dapat digabung menjadi satu kolom `Nominal`:

- Cash in tampil positif dengan warna hijau.
- Cash out tampil negatif atau warna merah.

Deskripsi panjang harus dipindah ke detail row atau detail modal agar tidak memaksa tabel melebar.

Acceptance criteria:

- Tidak ada horizontal scroll untuk data utama cashflow.
- Deskripsi panjang tidak merusak layout.
- Pada mobile, setiap transaksi tampil sebagai card ringkas.

### FR-3: Filter Responsif

Komponen filter tanggal dan select harus responsif.

Acceptance criteria:

- Pada mobile, input tanggal start dan end turun ke dua baris atau grid 2 kolom yang tetap muat layar.
- Tombol Refresh tidak membuat filter melebar keluar viewport.
- Select cabang/status/type memakai `w-full` pada mobile dan ukuran konten pada desktop.

Catatan kode:

- Saat ini `DateRangeFilter` memakai `flex items-center gap-2`, sehingga dua input date bisa tetap memanjang pada layar kecil.
- `SelectFilter` belum memakai aturan `w-full sm:w-auto`.

### FR-4: Kartu Ringkasan Responsif

Kartu ringkasan sales dan cashflow harus memakai grid yang turun otomatis.

Acceptance criteria:

- Mobile: 1 kolom atau 2 kolom jika masih nyaman.
- Tablet: 2 kolom.
- Desktop: 3 atau 4 kolom sesuai halaman.
- Tidak ada angka Rupiah yang keluar dari card.

### FR-5: Posisi Kas Saat Ini Per Cabang

Halaman cashflow harus menampilkan section baru `Posisi Kas Saat Ini`.

Data yang ditampilkan per cabang:

- Nama cabang
- Total cash in aktif sampai tanggal acuan
- Total cash out aktif sampai tanggal acuan
- Posisi kas: total cash in - total cash out
- Indikator positif/negatif

Default tanggal acuan:

- Hari ini.

Filter:

- Jika user memilih cabang tertentu, section hanya menampilkan cabang tersebut.
- Jika semua cabang, section menampilkan seluruh cabang aktif.
- Tanggal acuan dapat mengikuti `endDate` filter cashflow atau dibuat input terpisah `Posisi per tanggal`.

Rekomendasi produk:

- Gunakan `endDate` sebagai tanggal acuan agar konsisten dengan filter cashflow.
- Tambahkan label kecil: `Posisi sampai [tanggal endDate]`.

Formula:

```text
posisi_kas_cabang = SUM(cash_in) - SUM(cash_out)
where status = 'active'
and branch_id = cabang terkait
and transaction_date <= tanggal_acuan
```

Catatan penting:

- Void tidak dihitung.
- Draft/submitted sales tidak masuk cashflow dan tidak dihitung.
- Sales posted masuk cashflow lewat trigger, sehingga ikut dihitung.
- Jika bisnis ingin "kas fisik di laci" saja, perlu requirement tambahan karena sistem sekarang memasukkan sales posted sebagai cashflow berdasarkan `grand_total_nett_sales`, bukan hanya field `cash`.

Acceptance criteria:

- Owner/admin bisa melihat posisi kas Buduk, Dalung, dan semua cabang lain.
- Angka posisi kas berubah ketika ada cashflow aktif baru.
- Angka posisi kas tidak berubah ketika transaksi di-void atau dihapus.
- Export cashflow opsional dapat menambahkan sheet `Posisi Kas`.

### FR-6: Hapus Permanen Laporan Penjualan Void

Halaman laporan penjualan harus menyediakan aksi `Hapus Permanen` untuk laporan berstatus `void`.

Aturan:

- Hanya role `owner` yang boleh melihat dan menjalankan tombol hapus permanen.
- Admin tidak melihat tombol, atau jika terlihat harus gagal dengan pesan permission yang jelas.
- Saat laporan void dihapus, cashflow terkait dengan `source = sales` dan `source_id = sales_reports.id` juga harus dihapus permanen.
- Audit log `sales_deleted` tetap dibuat sebelum delete.

Flow user:

1. User membuka Laporan Penjualan.
2. User melihat laporan status `Void`.
3. Owner klik icon hapus.
4. Sistem menampilkan confirm modal dengan peringatan data akan hilang permanen.
5. Owner dapat mengisi alasan hapus.
6. Sistem menghapus cashflow terkait lalu menghapus sales report.
7. Row hilang dari list setelah refresh.

Acceptance criteria:

- Laporan void tidak muncul lagi setelah dihapus permanen.
- Cashflow auto dari sales void terkait juga hilang permanen.
- Audit log tetap mencatat data lama dan alasan.
- Jika delete gagal karena RLS, user melihat pesan error yang jelas.

### FR-7: Hapus Permanen Transaksi Cashflow Void

Halaman cashflow harus memastikan transaksi berstatus `void` dapat dihapus permanen jika transaksi tersebut boleh dikelola dari halaman cashflow.

Aturan:

- Transaksi manual status `void` dapat dihapus permanen oleh owner.
- Transaksi dari sales (`source = sales`) tidak dihapus langsung dari cashflow agar tidak memutus relasi bisnis; user diarahkan untuk menghapus laporan sales void dari halaman Laporan Penjualan.
- Jika tim bisnis menginginkan source sales juga bisa dihapus dari cashflow, sistem harus menghapus pasangan sales report-nya atau minimal meminta konfirmasi bahwa relasi akan terputus. Rekomendasi: tetap hapus dari Laporan Penjualan.

Acceptance criteria:

- Transaksi manual void bisa hilang permanen dari cashflow.
- Transaksi sales void tidak membingungkan user; ada action atau teks arahan yang jelas.
- Perhitungan posisi kas hanya memakai transaksi `active`, sehingga void dan deleted tidak masuk hitungan.

### FR-8: Export Mengikuti Data Operasional

Export Excel/CSV harus mengikuti data yang tampil dan aturan baru.

Acceptance criteria:

- Data yang sudah dihapus permanen tidak ikut export.
- Void tetap bisa ikut export hanya jika filter status/tipe memang menampilkan void.
- Jika section posisi kas ditambahkan ke export, hanya transaksi aktif yang dihitung.

## 7. Kebutuhan Non-Fungsional

### NFR-1: Performance

- Query list tetap memakai filter tanggal.
- Query posisi kas boleh memakai agregasi client-side untuk dataset kecil, tetapi sebaiknya disiapkan RPC/view SQL jika data bertambah besar.

Rekomendasi awal:

- Ambil transaksi aktif sampai `endDate` dengan kolom minimum: `branch_id, transaction_type, cash_in, cash_out, amount`.
- Hitung per cabang di client untuk implementasi cepat.

Rekomendasi lanjutan:

- Buat view SQL atau RPC `get_cash_position_by_branch(as_of_date date)` untuk agregasi di database.

### NFR-2: Security

- Tombol hard delete hanya tampil untuk owner.
- Tetap andalkan RLS database sebagai lapisan utama.
- Jangan memakai service role key di frontend.

### NFR-3: Auditability

- Hard delete boleh menghapus record operasional, tetapi audit log harus tetap menyimpan snapshot `old_data`.
- Audit log perlu menambahkan action yang konsisten:
  - `sales_deleted`
  - `cashflow_deleted`

### NFR-4: Responsive Quality

- Tidak boleh ada horizontal scroll pada viewport umum:
  - Mobile 360px
  - Mobile 390px
  - Tablet 768px
  - Desktop 1366px
- Teks tombol dan angka Rupiah tidak boleh keluar dari container.
- Action button tetap dapat diklik minimal 40px tinggi/lebar area sentuh pada mobile.

## 8. Rekomendasi Desain UI

### 8.1 Laporan Penjualan Desktop

Gunakan tabel ringkas:

| Tanggal | Cabang | Offline | Online Nett | Grand Total | Status | Aksi |
|---|---|---:|---:|---:|---|---|

Tombol `Eye` membuka rincian:

- Cash
- QRIS
- GoFood nett
- GrabFood nett
- ShopeeFood nett
- Total online gross
- Total potongan online
- Catatan

### 8.2 Laporan Penjualan Mobile

Gunakan card per laporan:

- Header: tanggal, cabang, status.
- Body: grand total besar, offline, online nett.
- Footer: aksi icon.

### 8.3 Cashflow Desktop

Gunakan tabel ringkas:

| Tanggal | Cabang | Tipe | Kategori | Nominal | Sumber | Status | Aksi |
|---|---|---|---|---:|---|---|---|

Detail transaksi berisi deskripsi, cash in, cash out, source id bila perlu.

### 8.4 Cashflow Mobile

Gunakan card per transaksi:

- Header: tanggal, cabang, status.
- Body: kategori, deskripsi pendek, nominal.
- Footer: sumber dan aksi.

### 8.5 Posisi Kas Cabang

Section baru ditempatkan di atas tabel cashflow, setelah summary card.

Format desktop:

| Cabang | Cash In | Cash Out | Posisi Kas |
|---|---:|---:|---:|

Format mobile:

- Grid card cabang.
- Cabang sebagai judul.
- Posisi kas sebagai angka utama.
- Cash in/out sebagai detail kecil.

## 9. Catatan Teknis Implementasi

### 9.1 File yang kemungkinan diubah

- `src/app/(dashboard)/sales/reports/page.tsx`
- `src/app/(dashboard)/cashflow/page.tsx`
- `src/components/ui/FilterBar.tsx`
- `src/app/globals.css`
- `src/lib/utils/export.ts` jika export posisi kas ikut dibuat
- `src/types/database.ts` jika ada tipe tambahan untuk agregasi

### 9.2 Perubahan di Sales Reports

Perubahan utama:

- Ubah tabel default menjadi kolom ringkas.
- Tambahkan layout card untuk mobile.
- Tampilkan tombol hapus untuk status `void` khusus owner.
- Ubah copy modal dari "Hapus Draft Penjualan" menjadi dinamis:
  - Draft/submitted: "Hapus Laporan Penjualan"
  - Void: "Hapus Permanen Laporan Void"
- Ubah pesan sukses agar tidak selalu "Draft berhasil dihapus."

Pseudo logic tombol hapus:

```text
canDeleteSales =
  profile.role == 'owner'
  and report.status in ['draft', 'submitted', 'void']
```

Pseudo delete:

```text
insert audit_logs sales_deleted
delete from cashflow_transactions
  where source = 'sales'
  and source_id = deleteTarget.id
delete from sales_reports
  where id = deleteTarget.id
```

### 9.3 Perubahan di Cashflow

Perubahan utama:

- Tambah state `cashPositions`.
- Query transaksi aktif sampai `endDate` untuk semua cabang atau cabang terpilih.
- Hitung posisi per cabang.
- Render section `Posisi Kas Saat Ini`.
- Ubah tabel menjadi ringkas dengan kolom `Nominal`.
- Buat card mobile.

Pseudo query:

```text
from cashflow_transactions
select branch_id, cash_in, cash_out, amount, transaction_type, branch:branches(id,name)
where status = 'active'
and transaction_date <= endDate
if filterBranch exists: branch_id = filterBranch
```

Pseudo hitung:

```text
for each tx:
  cashIn = tx.cash_in
  cashOut = tx.cash_out
  position[branch].cashIn += cashIn
  position[branch].cashOut += cashOut
  position[branch].balance = cashInTotal - cashOutTotal
```

### 9.4 Perubahan di FilterBar

Rekomendasi class:

- `SelectFilter`: `w-full sm:w-auto`
- `DateRangeFilter`: `grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr]` atau layout yang wrap di mobile.
- Input date: `w-full sm:w-auto`.

### 9.5 Perubahan CSS Table

Pertimbangkan menambahkan class reusable:

```text
.responsive-table-desktop
.responsive-card-list
.money-cell
```

Atau langsung pakai Tailwind di page jika scope masih kecil.

## 10. Data dan Migrasi

Tidak wajib ada migrasi database untuk kebutuhan minimum.

Namun untuk performa posisi kas, disarankan migrasi opsional:

```sql
create or replace function get_cash_position_by_branch(p_as_of_date date)
returns table (
  branch_id uuid,
  branch_name text,
  total_cash_in numeric,
  total_cash_out numeric,
  balance numeric
)
language sql
security definer
as $$
  select
    b.id,
    b.name,
    coalesce(sum(case when c.status = 'active' then c.cash_in else 0 end), 0) as total_cash_in,
    coalesce(sum(case when c.status = 'active' then c.cash_out else 0 end), 0) as total_cash_out,
    coalesce(sum(case when c.status = 'active' then c.cash_in - c.cash_out else 0 end), 0) as balance
  from branches b
  left join cashflow_transactions c
    on c.branch_id = b.id
   and c.transaction_date <= p_as_of_date
  where b.is_active = true
    and b.deleted_at is null
  group by b.id, b.name
  order by b.name;
$$;
```

Catatan:

- Jika RPC dibuat, tambahkan type di `src/types/database.ts`.
- Pastikan policy/RLS tetap sesuai kebutuhan. Untuk implementasi cepat, query biasa dari client sudah cukup karena RLS select sudah aktif untuk user aktif.

## 11. Edge Cases

- Cabang tanpa transaksi tetap muncul dengan posisi Rp 0 jika semua cabang dipilih.
- Transaksi void tidak dihitung.
- Transaksi deleted tidak mungkin dihitung karena record sudah tidak ada.
- Delete sales void yang cashflow terkaitnya sudah tidak ada tetap dianggap sukses selama sales report berhasil dihapus.
- Jika user admin mencoba delete, sistem harus menampilkan pesan tidak punya izin, bukan gagal diam-diam.
- Jika filter status laporan adalah `Void`, setelah delete row langsung hilang.
- Jika semua transaksi cabang negatif, posisi kas tampil merah/oranye.

## 12. Acceptance Test Checklist

### Responsive

- Buka `/sales/reports` pada 390px, tidak ada horizontal scroll halaman.
- Buka `/sales/reports` pada 1366px, data utama terlihat tanpa scroll horizontal.
- Buka `/cashflow` pada 390px, transaksi tampil sebagai card dan tidak melebar.
- Filter tanggal dan cabang tetap muat layar kecil.

### Posisi Kas

- Tambah cashflow manual cash in Buduk Rp 100.000, posisi Buduk naik Rp 100.000.
- Tambah cashflow manual cash out Buduk Rp 30.000, posisi Buduk menjadi Rp 70.000.
- Void cash out Buduk Rp 30.000, posisi Buduk kembali Rp 100.000.
- Post sales Dalung Rp 80.000, posisi Dalung naik Rp 80.000.
- Void sales Dalung, posisi Dalung turun sesuai cashflow yang menjadi void.

### Hapus Void

- Buat sales posted, void, lalu hapus permanen sebagai owner.
- Sales void hilang dari `/sales/reports`.
- Cashflow source sales terkait hilang dari `/cashflow`.
- Audit log menyimpan action `sales_deleted`.
- Login sebagai admin tidak bisa melakukan hard delete.

## 13. Prioritas Implementasi

### P0

- Tambah posisi kas per cabang di cashflow.
- Tambah hard delete untuk sales void khusus owner.
- Pastikan hard delete menghapus cashflow terkait.

### P1

- Ubah tabel sales reports dan cashflow menjadi layout ringkas tanpa horizontal scroll.
- Tambahkan card mobile untuk kedua halaman.
- Perbaiki filter responsive.

### P2

- Tambahkan export sheet posisi kas.
- Tambahkan RPC/view untuk agregasi posisi kas jika data makin besar.
- Tambahkan column visibility jika user tetap ingin melihat channel detail langsung di tabel desktop.

## 14. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| User menganggap posisi kas sebagai kas fisik, padahal sistem menghitung semua cashflow aktif | Angka bisa dianggap tidak sesuai uang tunai fisik | Tampilkan label "berdasarkan cashflow aktif" dan validasi definisi bisnis |
| Hard delete menghapus data yang masih dibutuhkan audit | Riwayat operasional hilang dari list | Simpan snapshot lengkap di audit log sebelum delete |
| Admin melihat tombol delete tapi gagal karena RLS | UX membingungkan | Sembunyikan tombol berdasarkan `profile.role` |
| Tabel ringkas dianggap kurang detail | User perlu klik detail | Detail modal sudah ada; tambahkan ringkasan channel di modal/card |
| Query posisi kas lambat saat data besar | Halaman cashflow lambat | Naikkan ke RPC/view agregasi database |

## 15. Keputusan Produk yang Perlu Dikonfirmasi

1. Apakah `posisi kas` yang dimaksud adalah semua cashflow aktif (`cash_in - cash_out`) atau hanya uang tunai fisik dari sales `cash`?
2. Apakah admin boleh menghapus void, atau tetap hanya owner sesuai RLS saat ini?
3. Apakah transaksi `source = sales` boleh dihapus dari halaman cashflow, atau harus selalu lewat laporan penjualan?

Rekomendasi default:

- Posisi kas memakai semua cashflow aktif.
- Hard delete hanya owner.
- Data sales-origin dihapus lewat halaman laporan penjualan agar relasi sales dan cashflow tetap konsisten.
