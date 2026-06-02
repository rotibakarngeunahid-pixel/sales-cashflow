-- =============================================
-- Add DELETE RLS policies for import log tables
-- Required for bulk data deletion via Manajemen Data page
-- =============================================

CREATE POLICY "raw_material_import_logs_delete_active_user" ON raw_material_import_logs
  FOR DELETE USING (is_user_active());

CREATE POLICY "kasir_import_logs_delete_active_user" ON kasir_import_logs
  FOR DELETE USING (is_user_active());
