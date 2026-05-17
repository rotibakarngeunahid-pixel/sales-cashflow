-- =============================================
-- RBN Sales & Cashflow System - Add 'submitted' status
-- Run this AFTER 002_add_delete_support.sql
-- =============================================

-- Drop existing check constraint and add new one that includes 'submitted'
ALTER TABLE sales_reports DROP CONSTRAINT IF EXISTS sales_reports_status_check;
ALTER TABLE sales_reports ADD CONSTRAINT sales_reports_status_check
  CHECK (status IN ('draft', 'submitted', 'posted', 'void'));

-- Rebuild status index to cover new value
DROP INDEX IF EXISTS idx_sales_reports_status;
CREATE INDEX idx_sales_reports_status ON sales_reports(status);
