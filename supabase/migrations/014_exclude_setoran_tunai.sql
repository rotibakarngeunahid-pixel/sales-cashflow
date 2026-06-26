-- =============================================
-- Migration 014: Exclude "Setoran Tunai" from Kas Keluar
-- =============================================
-- Setoran tunai = transfer kas internal dari outlet ke HQ.
-- Ini BUKAN beban operasional, sehingga tidak boleh muncul di kas keluar.
--
-- Mulai sekarang baris setoran tunai sudah di-skip saat import/sync
-- (lihat src/lib/kasir-import/server.ts & src/lib/kasir-sync/server.ts).
-- Migration ini membersihkan data yang terlanjur masuk sebelum perbaikan tsb.
--
-- Aman dijalankan berulang (idempotent): hanya menyentuh baris yang
-- benar-benar setoran tunai dari import/sync kasir.
-- =============================================

-- Normalisasi nilai agar cocok dengan helper isSetoranTunai() di kode:
--   lower → ganti underscore/spasi beruntun jadi satu spasi → trim
--   cocok jika hasilnya 'setoran tunai' atau 'setoran'.

-- -----------------------------------------------
-- 1. Hapus kas keluar setoran tunai yang sudah terlanjur diimport
--    (sumber: import manual kasir & sinkronisasi otomatis kasir)
-- -----------------------------------------------
DELETE FROM cashflow_transactions
WHERE source = 'kasir_expenses'
  AND transaction_type = 'cash_out'
  AND (
        regexp_replace(lower(trim(coalesce(source_metadata->>'category',      ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    OR  regexp_replace(lower(trim(coalesce(source_metadata->>'expense_name',  ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    OR  regexp_replace(lower(trim(coalesce(source_metadata->>'kategori',      ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    OR  regexp_replace(lower(trim(coalesce(source_metadata->>'category_name', ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    OR  regexp_replace(lower(trim(coalesce(source_metadata->>'nama_kategori', ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    -- Fallback: nama/kategori ada di segmen pertama description ("<nama> - <cabang> - <tgl>")
    OR  regexp_replace(lower(trim(split_part(coalesce(description, ''), ' - ', 1))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
  );

-- -----------------------------------------------
-- 2. Tolak item antrian sinkronisasi yang masih pending & berupa setoran tunai
--    (agar tidak bisa dikonfirmasi menjadi kas keluar)
-- -----------------------------------------------
UPDATE kasir_sync_queue
SET status        = 'rejected',
    rejected_at   = now(),
    reject_reason = 'Setoran tunai — transfer kas internal, bukan beban operasional'
WHERE item_type = 'kas_keluar'
  AND status = 'pending'
  AND (
        regexp_replace(lower(trim(coalesce(kategori,   ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
    OR  regexp_replace(lower(trim(coalesce(keterangan, ''))), '[_\s]+', ' ', 'g') IN ('setoran tunai', 'setoran')
  );
