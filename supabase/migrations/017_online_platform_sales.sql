-- =============================================
-- Migration 017: Penjualan Online (GoFood/GrabFood/ShopeeFood)
-- Run AFTER 016_add_food_waste_import.sql
--
-- Import Kasir & Kasir Sync sebelumnya MEMBUANG transaksi dengan metode
-- bayar GoFood/GrabFood/ShopeeFood (lihat SKIP_PAYMENT_METHODS di
-- src/lib/kasir-import/shared.ts) — nominal yang tercatat di kasir untuk
-- transaksi ini adalah NETT (sudah dipotong komisi/biaya platform), bukan
-- harga jual asli. Migration ini menambah tabel untuk menampung transaksi
-- yang terdeteksi (bukan dibuang lagi) dan tabel rekonsiliasi agregat
-- per (tanggal, cabang, platform) tempat admin melengkapi gross + rincian
-- potongan, dengan nett dihitung otomatis (atau input manual).
-- =============================================

-- -----------------------------------------------
-- 1. Tambah source 'online_sales' di cashflow_transactions
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
    'inventori_waste',
    'online_sales'
  ));

-- -----------------------------------------------
-- 2. online_sales_reports — rekonsiliasi agregat
--    satu baris per (report_date, branch_id, platform)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS online_sales_reports (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  report_date        DATE NOT NULL,
  branch_id          UUID NOT NULL REFERENCES branches(id),
  platform           TEXT NOT NULL CHECK (platform IN ('gofood', 'grabfood', 'shopeefood')),

  gross_amount       NUMERIC NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  total_deduction    NUMERIC NOT NULL DEFAULT 0 CHECK (total_deduction >= 0),
  nett_amount        NUMERIC NOT NULL DEFAULT 0 CHECK (nett_amount >= 0),
  nett_input_mode    TEXT NOT NULL DEFAULT 'calculated' CHECK (nett_input_mode IN ('calculated', 'manual')),

  -- Snapshot total nett yang terdeteksi dari kasir saat terakhir disimpan
  -- (untuk menampilkan selisih vs data kasir asli di UI)
  detected_nett_amount NUMERIC NOT NULL DEFAULT 0,

  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  notes              TEXT DEFAULT '',

  created_by         UUID REFERENCES profiles(id),
  updated_by         UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(report_date, branch_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_online_sales_reports_date ON online_sales_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_online_sales_reports_branch ON online_sales_reports(branch_id);
CREATE INDEX IF NOT EXISTS idx_online_sales_reports_status ON online_sales_reports(status);

CREATE TRIGGER update_online_sales_reports_updated_at
  BEFORE UPDATE ON online_sales_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------
-- 3. online_sales_deductions — rincian potongan (bisa lebih dari satu jenis)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS online_sales_deductions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id     UUID NOT NULL REFERENCES online_sales_reports(id) ON DELETE CASCADE,
  deduction_type TEXT NOT NULL CHECK (deduction_type IN ('commission', 'promo', 'other')),
  label         TEXT DEFAULT '',   -- dipakai untuk deduction_type = 'other'
  amount        NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_sales_deductions_report_id ON online_sales_deductions(report_id);

-- -----------------------------------------------
-- 4. online_sales_detections — transaksi individual terdeteksi dari kasir
--    (Import Kasir manual maupun Kasir Sync otomatis)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS online_sales_detections (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  transaction_date      DATE NOT NULL,
  branch_id             UUID REFERENCES branches(id),   -- nullable: cabang belum cocok
  branch_name_raw       TEXT NOT NULL,                  -- nama cabang persis dari kasir

  platform              TEXT NOT NULL CHECK (platform IN ('gofood', 'grabfood', 'shopeefood')),
  kasir_transaction_id  TEXT NOT NULL,
  time_wita             TEXT,

  detected_nett_amount  NUMERIC NOT NULL CHECK (detected_nett_amount >= 0),

  import_key            TEXT NOT NULL UNIQUE,
  source                TEXT NOT NULL CHECK (source IN ('kasir_import', 'kasir_sync')),
  raw_data              JSONB,

  -- Diisi setelah admin melengkapi & menyimpan rekonsiliasi untuk
  -- (branch_id, platform, transaction_date) yang bersangkutan.
  online_sales_report_id UUID REFERENCES online_sales_reports(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_sales_detections_pending
  ON online_sales_detections(branch_id, platform, transaction_date)
  WHERE online_sales_report_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_online_sales_detections_report_id
  ON online_sales_detections(online_sales_report_id)
  WHERE online_sales_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_online_sales_detections_date ON online_sales_detections(transaction_date DESC);

-- -----------------------------------------------
-- 5. Tambah kolom online_detected_count di kasir_sync_batches
-- -----------------------------------------------
ALTER TABLE kasir_sync_batches
  ADD COLUMN IF NOT EXISTS online_detected_count INTEGER NOT NULL DEFAULT 0;

-- -----------------------------------------------
-- 6. Trigger: sync online_sales_reports -> cashflow_transactions
--    Pola sama seperti sync_sales_to_cashflow (migration 001):
--    posted -> insert/upsert cash_in; posted->void -> void cashflow;
--    posted & data berubah -> re-sync amount.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION sync_online_sales_to_cashflow()
RETURNS TRIGGER AS $$
DECLARE
  v_category_id uuid;
  v_branch_name text;
  v_platform_label text;
  v_description text;
BEGIN
  SELECT id INTO v_category_id
  FROM cashflow_categories
  WHERE name = 'Penjualan' AND is_active = true
  LIMIT 1;

  SELECT name INTO v_branch_name
  FROM branches
  WHERE id = NEW.branch_id;

  v_platform_label := CASE NEW.platform
    WHEN 'gofood' THEN 'GoFood'
    WHEN 'grabfood' THEN 'GrabFood'
    WHEN 'shopeefood' THEN 'ShopeeFood'
    ELSE NEW.platform
  END;

  v_description := 'Penjualan Online ' || v_platform_label || ' - ' || COALESCE(v_branch_name, '') ||
    ' - ' || to_char(NEW.report_date, 'DD/MM/YYYY');

  -- INSERT langsung sebagai posted
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'posted' THEN
      INSERT INTO cashflow_transactions (
        transaction_date, branch_id, transaction_type, category_id,
        description, cash_in, cash_out, amount, source, source_id,
        status, created_by, updated_by
      ) VALUES (
        NEW.report_date, NEW.branch_id, 'cash_in', v_category_id,
        v_description, NEW.nett_amount, 0, NEW.nett_amount,
        'online_sales', NEW.id, 'active', NEW.created_by, NEW.created_by
      )
      ON CONFLICT ON CONSTRAINT unique_cashflow_source DO UPDATE SET
        transaction_date = excluded.transaction_date,
        branch_id = excluded.branch_id,
        description = excluded.description,
        cash_in = excluded.cash_in,
        amount = excluded.amount,
        status = 'active',
        updated_by = excluded.updated_by,
        updated_at = now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: status berubah jadi posted
  IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status <> 'posted') THEN
    INSERT INTO cashflow_transactions (
      transaction_date, branch_id, transaction_type, category_id,
      description, cash_in, cash_out, amount, source, source_id,
      status, created_by, updated_by
    ) VALUES (
      NEW.report_date, NEW.branch_id, 'cash_in', v_category_id,
      v_description, NEW.nett_amount, 0, NEW.nett_amount,
      'online_sales', NEW.id, 'active', NEW.updated_by, NEW.updated_by
    )
    ON CONFLICT ON CONSTRAINT unique_cashflow_source DO UPDATE SET
      transaction_date = excluded.transaction_date,
      branch_id = excluded.branch_id,
      description = excluded.description,
      cash_in = excluded.cash_in,
      amount = excluded.amount,
      status = 'active',
      updated_by = excluded.updated_by,
      updated_at = now();
  END IF;

  -- UPDATE: posted -> void
  IF NEW.status = 'void' AND OLD.status = 'posted' THEN
    UPDATE cashflow_transactions
    SET status = 'void', updated_by = NEW.updated_by, updated_at = now()
    WHERE source = 'online_sales' AND source_id = NEW.id;
  END IF;

  -- UPDATE: sudah posted, data berubah -> re-sync amount
  IF NEW.status = 'posted' AND OLD.status = 'posted' AND (
    NEW.nett_amount <> OLD.nett_amount OR
    NEW.report_date <> OLD.report_date OR
    NEW.branch_id <> OLD.branch_id
  ) THEN
    UPDATE cashflow_transactions
    SET
      transaction_date = NEW.report_date,
      branch_id = NEW.branch_id,
      description = v_description,
      cash_in = NEW.nett_amount,
      amount = NEW.nett_amount,
      updated_by = NEW.updated_by,
      updated_at = now()
    WHERE source = 'online_sales' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_online_sales_cashflow_insert ON online_sales_reports;
CREATE TRIGGER sync_online_sales_cashflow_insert
  AFTER INSERT ON online_sales_reports
  FOR EACH ROW EXECUTE FUNCTION sync_online_sales_to_cashflow();

DROP TRIGGER IF EXISTS sync_online_sales_cashflow_update ON online_sales_reports;
CREATE TRIGGER sync_online_sales_cashflow_update
  AFTER UPDATE ON online_sales_reports
  FOR EACH ROW EXECUTE FUNCTION sync_online_sales_to_cashflow();

-- -----------------------------------------------
-- 7. RLS
-- -----------------------------------------------
ALTER TABLE online_sales_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_sales_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_sales_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "online_sales_reports_select" ON online_sales_reports
  FOR SELECT USING (is_user_active());
CREATE POLICY "online_sales_reports_insert" ON online_sales_reports
  FOR INSERT WITH CHECK (is_user_active());
CREATE POLICY "online_sales_reports_update" ON online_sales_reports
  FOR UPDATE USING (is_user_active());
CREATE POLICY "online_sales_reports_delete_owner" ON online_sales_reports
  FOR DELETE USING (get_user_role() = 'owner' AND is_user_active());

CREATE POLICY "online_sales_deductions_select" ON online_sales_deductions
  FOR SELECT USING (is_user_active());
CREATE POLICY "online_sales_deductions_insert" ON online_sales_deductions
  FOR INSERT WITH CHECK (is_user_active());
CREATE POLICY "online_sales_deductions_update" ON online_sales_deductions
  FOR UPDATE USING (is_user_active());
CREATE POLICY "online_sales_deductions_delete" ON online_sales_deductions
  FOR DELETE USING (is_user_active());

CREATE POLICY "online_sales_detections_select" ON online_sales_detections
  FOR SELECT USING (is_user_active());
CREATE POLICY "online_sales_detections_insert" ON online_sales_detections
  FOR INSERT WITH CHECK (is_user_active());
CREATE POLICY "online_sales_detections_update" ON online_sales_detections
  FOR UPDATE USING (is_user_active());

COMMENT ON TABLE online_sales_reports IS
  'Rekonsiliasi agregat penjualan online per tanggal/cabang/platform: gross, rincian potongan, dan nett (dihitung otomatis atau manual)';
COMMENT ON TABLE online_sales_deductions IS
  'Rincian potongan (komisi, promo, biaya lain) untuk satu online_sales_reports — bisa lebih dari satu baris';
COMMENT ON TABLE online_sales_detections IS
  'Transaksi individual GoFood/GrabFood/ShopeeFood yang terdeteksi dari Import Kasir/Kasir Sync, sebelum dilengkapi gross+potongan';
