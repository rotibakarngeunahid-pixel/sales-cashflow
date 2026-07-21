-- =============================================
-- Migration 019: Hapus fitur deteksi Penjualan Online (revert migration 017)
-- Run AFTER 018_kasir_category_mappings.sql
--
-- Fitur deteksi & rekonsiliasi GoFood/GrabFood/ShopeeFood dari Import Kasir/
-- Kasir Sync dihapus. Import Kasir & Kasir Sync kembali mengabaikan metode
-- bayar online (seperti sebelum migration 017). Pencatatan penjualan online
-- kembali dilakukan lewat input manual di form Input Penjualan, yang sudah
-- punya field GoFood/GrabFood/ShopeeFood (gross/promo/komisi/nett) sejak
-- migration 001.
--
-- Baris cashflow_transactions dengan source='online_sales' yang sudah
-- ter-posting (kalau ada) SENGAJA TIDAK disentuh/dihapus di sini -- itu
-- transaksi pemasukan yang sah dan tetap valid meski jalur pembuatannya
-- (tabel online_sales_reports) dihapus. 'online_sales' tetap dibiarkan
-- sebagai nilai source yang diizinkan di constraint, walau tidak ada lagi
-- kode yang menghasilkannya.
-- =============================================

DROP TRIGGER IF EXISTS sync_online_sales_cashflow_insert ON online_sales_reports;
DROP TRIGGER IF EXISTS sync_online_sales_cashflow_update ON online_sales_reports;
DROP FUNCTION IF EXISTS sync_online_sales_to_cashflow();

DROP TABLE IF EXISTS online_sales_deductions;
DROP TABLE IF EXISTS online_sales_detections;
DROP TABLE IF EXISTS online_sales_reports;

ALTER TABLE kasir_sync_batches DROP COLUMN IF EXISTS online_detected_count;
