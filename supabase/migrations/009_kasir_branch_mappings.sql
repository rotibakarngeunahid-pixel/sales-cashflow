-- =============================================
-- Migration 009: Kasir Branch Mappings
-- Menyimpan pemetaan nama cabang dari sistem kasir
-- ke cabang lokal (branches). Dibuat manual oleh owner.
-- =============================================

CREATE TABLE IF NOT EXISTS kasir_branch_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nama cabang persis seperti yang datang dari API kasir
  kasir_name TEXT NOT NULL,

  -- Cabang lokal yang sesuai
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(kasir_name)
);

CREATE INDEX IF NOT EXISTS idx_kasir_branch_mappings_name
  ON kasir_branch_mappings(kasir_name);

ALTER TABLE kasir_branch_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_mappings_select" ON kasir_branch_mappings
  FOR SELECT USING (is_user_active());

CREATE POLICY "branch_mappings_insert" ON kasir_branch_mappings
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "branch_mappings_update" ON kasir_branch_mappings
  FOR UPDATE USING (is_user_active());
