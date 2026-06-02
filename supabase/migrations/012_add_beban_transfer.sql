-- =============================================
-- RBN Sales & Cashflow System - Beban Transfer
-- Transfer beban pokok antar cabang
-- Run AFTER 007_add_kasir_import.sql
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
    'kasir_expenses',
    'beban_transfer'
  ));

-- -----------------------------------------------
-- 2. Tabel log transfer beban pokok antar cabang
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS beban_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_date date NOT NULL,
  from_branch_id uuid NOT NULL REFERENCES branches(id),
  to_branch_id uuid NOT NULL REFERENCES branches(id),
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  reference_group_id text NOT NULL UNIQUE,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beban_transfers_different_branches CHECK (from_branch_id <> to_branch_id)
);

CREATE INDEX IF NOT EXISTS idx_beban_transfers_date
  ON beban_transfers(transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_beban_transfers_from_branch
  ON beban_transfers(from_branch_id);

CREATE INDEX IF NOT EXISTS idx_beban_transfers_to_branch
  ON beban_transfers(to_branch_id);

CREATE INDEX IF NOT EXISTS idx_beban_transfers_reference_group
  ON beban_transfers(reference_group_id);

ALTER TABLE beban_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "beban_transfers_select" ON beban_transfers
  FOR SELECT USING (is_user_active());

CREATE POLICY "beban_transfers_insert" ON beban_transfers
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "beban_transfers_delete" ON beban_transfers
  FOR DELETE USING (get_user_role() = 'owner' AND is_user_active());
