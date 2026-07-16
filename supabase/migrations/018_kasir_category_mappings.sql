-- =============================================
-- Migration 018: Kasir Category Mappings
-- Menyimpan pemetaan kategori/keterangan kas keluar dari sistem kasir
-- ke kategori cashflow lokal, supaya import berikutnya otomatis
-- terkategori dengan benar tanpa perlu dipetakan ulang manual tiap kali.
-- Contoh: kategori kasir "Balikin uang roti canai yang di cancel" -> "Food Waste"
--         kategori kasir "Bayar Maxim pergi dan pulang" -> "Transportasi Karyawan"
-- =============================================

CREATE TABLE IF NOT EXISTS kasir_category_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Teks kategori/keterangan persis seperti dari sistem kasir
  kasir_category TEXT NOT NULL,

  -- 'exact'    = harus sama persis (setelah normalisasi huruf besar/kecil, spasi, tanda baca)
  -- 'contains' = cocok kalau teks dari kasir MENGANDUNG kata/frasa ini
  match_type TEXT NOT NULL DEFAULT 'exact' CHECK (match_type IN ('exact', 'contains')),

  -- Kategori cashflow lokal tujuan
  local_category_id UUID NOT NULL REFERENCES cashflow_categories(id) ON DELETE CASCADE,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(kasir_category, match_type)
);

CREATE INDEX IF NOT EXISTS idx_kasir_category_mappings_category
  ON kasir_category_mappings(kasir_category);

CREATE INDEX IF NOT EXISTS idx_kasir_category_mappings_local_category
  ON kasir_category_mappings(local_category_id);

ALTER TABLE kasir_category_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_mappings_select" ON kasir_category_mappings
  FOR SELECT USING (is_user_active());

CREATE POLICY "category_mappings_insert" ON kasir_category_mappings
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "category_mappings_update" ON kasir_category_mappings
  FOR UPDATE USING (is_user_active());

CREATE POLICY "category_mappings_delete" ON kasir_category_mappings
  FOR DELETE USING (is_user_active());
