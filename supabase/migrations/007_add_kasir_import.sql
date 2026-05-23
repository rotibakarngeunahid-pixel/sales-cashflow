-- =============================================
-- RBN Kasir Import Integration
-- Run AFTER 006_add_raw_material_import.sql
-- =============================================

-- -----------------------------------------------
-- 1. Extend cashflow_transactions source types
-- -----------------------------------------------
ALTER TABLE cashflow_transactions DROP CONSTRAINT IF EXISTS cashflow_transactions_source_check;
ALTER TABLE cashflow_transactions ADD CONSTRAINT cashflow_transactions_source_check
  CHECK (source IN (
    'manual',
    'sales',
    'purchase_order',
    'kasir_sales',
    'kasir_expenses'
  ));

-- -----------------------------------------------
-- 2. Add reference_group_id for split-expense tracking
--    (multiple cashflow rows from 1 kasir expense)
-- -----------------------------------------------
ALTER TABLE cashflow_transactions
  ADD COLUMN IF NOT EXISTS reference_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_cashflow_transactions_reference_group_id
  ON cashflow_transactions(reference_group_id)
  WHERE reference_group_id IS NOT NULL;

-- -----------------------------------------------
-- 3. kasir_import_logs — audit trail per import run
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS kasir_import_logs (
  id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type           text        NOT NULL CHECK (import_type IN ('sales', 'expenses')),
  imported_at           timestamptz NOT NULL DEFAULT now(),

  -- Rentang tanggal yang diimport
  period_start          date        NOT NULL,
  period_end            date        NOT NULL,

  -- Filter yang dipakai
  branch_id             uuid        REFERENCES branches(id),
  branch_filter         text,           -- nama cabang jika difilter
  payment_method_filter text,           -- Tunai / QRIS / Tunai+QRIS (hanya untuk sales)

  -- Statistik hasil
  total_found           integer     NOT NULL DEFAULT 0 CHECK (total_found >= 0),
  total_success         integer     NOT NULL DEFAULT 0 CHECK (total_success >= 0),
  total_failed          integer     NOT NULL DEFAULT 0 CHECK (total_failed >= 0),
  total_skipped         integer     NOT NULL DEFAULT 0 CHECK (total_skipped >= 0),
  total_amount          numeric     NOT NULL DEFAULT 0 CHECK (total_amount >= 0),

  -- Status
  status                text        NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  message               text,
  error_details         jsonb,

  -- Siapa yang import
  created_by            uuid        REFERENCES profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kasir_import_logs_imported_at
  ON kasir_import_logs(imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_kasir_import_logs_import_type
  ON kasir_import_logs(import_type);

CREATE INDEX IF NOT EXISTS idx_kasir_import_logs_period
  ON kasir_import_logs(period_start, period_end);

ALTER TABLE kasir_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kasir_import_logs_select_active_user" ON kasir_import_logs
  FOR SELECT USING (is_user_active());

CREATE POLICY "kasir_import_logs_insert_active_user" ON kasir_import_logs
  FOR INSERT WITH CHECK (is_user_active());

-- -----------------------------------------------
-- 4. Tambahkan comment untuk kolom baru
-- -----------------------------------------------
COMMENT ON COLUMN cashflow_transactions.reference_group_id IS
  'UUID grup untuk melacak baris-baris dari 1 kas-keluar yang dibagi ke beberapa outlet';

COMMENT ON TABLE kasir_import_logs IS
  'Audit trail setiap proses import data dari sistem kasir (penjualan & kas keluar)';
