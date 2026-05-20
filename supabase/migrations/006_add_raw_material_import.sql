-- =============================================
-- RBN Sales & Cashflow System - Raw Material Import
-- Run this AFTER 005_add_qris_mdr.sql
-- =============================================

-- Allow imported raw material expenses to have their own source.
ALTER TABLE cashflow_transactions DROP CONSTRAINT IF EXISTS cashflow_transactions_source_check;
ALTER TABLE cashflow_transactions ADD CONSTRAINT cashflow_transactions_source_check
  CHECK (source IN ('manual', 'sales', 'purchase_order'));

-- Import key is the stable anti-duplication key from period + branch.
ALTER TABLE cashflow_transactions
  ADD COLUMN IF NOT EXISTS import_key text,
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS unique_cashflow_import_key
  ON cashflow_transactions(import_key)
  WHERE import_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashflow_transactions_import_key
  ON cashflow_transactions(import_key)
  WHERE import_key IS NOT NULL;

-- Operational import history for the admin page.
CREATE TABLE IF NOT EXISTS raw_material_import_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  imported_at timestamptz NOT NULL DEFAULT now(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  branch_count integer NOT NULL DEFAULT 0 CHECK (branch_count >= 0),
  total_amount numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  message text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_material_import_logs_imported_at
  ON raw_material_import_logs(imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_material_import_logs_period
  ON raw_material_import_logs(period_start, period_end);

ALTER TABLE raw_material_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_material_import_logs_select_active_user" ON raw_material_import_logs
  FOR SELECT USING (is_user_active());

CREATE POLICY "raw_material_import_logs_insert_active_user" ON raw_material_import_logs
  FOR INSERT WITH CHECK (is_user_active());
