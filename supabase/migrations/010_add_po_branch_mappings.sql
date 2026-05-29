-- =============================================
-- Migration 010: PO Branch Mappings
-- Menyimpan pemetaan nama cabang dari sistem purchase order
-- ke cabang lokal (branches). Dibuat manual oleh admin/owner.
-- =============================================

CREATE TABLE IF NOT EXISTS po_branch_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nama cabang persis seperti yang datang dari API purchase order
  po_name TEXT NOT NULL,

  -- Cabang lokal yang sesuai
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(po_name)
);

CREATE INDEX IF NOT EXISTS idx_po_branch_mappings_name
  ON po_branch_mappings(po_name);

ALTER TABLE po_branch_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_branch_mappings_select" ON po_branch_mappings
  FOR SELECT USING (is_user_active());

CREATE POLICY "po_branch_mappings_insert" ON po_branch_mappings
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "po_branch_mappings_update" ON po_branch_mappings
  FOR UPDATE USING (is_user_active());

CREATE POLICY "po_branch_mappings_delete" ON po_branch_mappings
  FOR DELETE USING (is_user_active());

COMMENT ON TABLE po_branch_mappings IS
  'Pemetaan nama cabang dari sistem purchase order ke cabang lokal untuk import pengeluaran bahan baku';
