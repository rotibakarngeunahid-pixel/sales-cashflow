-- =============================================
-- Migration 016: Food Waste Import (dari Sistem Inventori)
-- Run AFTER 015_auto_split_kurir_bawa_bahan.sql
--
-- Bahan rusak/terbuang yang dilaporkan staff di Sistem Inventori
-- ditarik ke cashflow sebagai pengeluaran kategori "Food Waste".
-- Nilai kerugian = jumlah terbuang x harga satuan master inventori.
-- =============================================

-- -----------------------------------------------
-- 1. Tambah source 'inventori_waste' di cashflow_transactions
-- -----------------------------------------------
ALTER TABLE cashflow_transactions DROP CONSTRAINT IF EXISTS cashflow_transactions_source_check;
ALTER TABLE cashflow_transactions ADD CONSTRAINT cashflow_transactions_source_check
  CHECK (source IN (
    'manual',
    'sales',
    'purchase_order',
    'kasir_sales',
    'kasir_expenses',
    'beban_transfer',
    'auto_split_kurir',
    'inventori_waste'
  ));

-- -----------------------------------------------
-- 2. Mapping nama cabang inventori -> cabang lokal
--    (fallback bila nama tidak cocok otomatis)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inventori_branch_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nama cabang persis seperti yang datang dari API inventori
  inventori_name TEXT NOT NULL,

  -- Cabang lokal yang sesuai
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(inventori_name)
);

CREATE INDEX IF NOT EXISTS idx_inventori_branch_mappings_name
  ON inventori_branch_mappings(inventori_name);

ALTER TABLE inventori_branch_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventori_branch_mappings_select" ON inventori_branch_mappings
  FOR SELECT USING (is_user_active());

CREATE POLICY "inventori_branch_mappings_insert" ON inventori_branch_mappings
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "inventori_branch_mappings_update" ON inventori_branch_mappings
  FOR UPDATE USING (is_user_active());

CREATE POLICY "inventori_branch_mappings_delete" ON inventori_branch_mappings
  FOR DELETE USING (is_user_active());

COMMENT ON TABLE inventori_branch_mappings IS
  'Pemetaan nama cabang dari Sistem Inventori ke cabang lokal untuk import food waste';

-- -----------------------------------------------
-- 3. food_waste_import_logs — riwayat per proses sync/import
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS food_waste_import_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Statistik hasil
  branch_count INTEGER NOT NULL DEFAULT 0 CHECK (branch_count >= 0),
  total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  missing_price_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_price_count >= 0),

  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  message TEXT,

  -- 'scheduler' untuk cron; selain itu diisi user id (kolom created_by)
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_waste_import_logs_imported_at
  ON food_waste_import_logs(imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_waste_import_logs_period
  ON food_waste_import_logs(period_start, period_end);

ALTER TABLE food_waste_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "food_waste_import_logs_select_active_user" ON food_waste_import_logs
  FOR SELECT USING (is_user_active());

CREATE POLICY "food_waste_import_logs_insert_active_user" ON food_waste_import_logs
  FOR INSERT WITH CHECK (is_user_active());

COMMENT ON TABLE food_waste_import_logs IS
  'Riwayat sinkronisasi food waste dari Sistem Inventori (manual maupun cron)';
