-- =============================================
-- RBN Sales & Cashflow System - Fix unique_cashflow_source
-- Run this AFTER 003_add_submitted_status.sql
-- =============================================
-- The trigger sync_sales_to_cashflow uses:
--   ON CONFLICT ON CONSTRAINT unique_cashflow_source
-- This syntax requires a named UNIQUE CONSTRAINT, but the original schema
-- created it as a partial unique INDEX, which PostgreSQL treats differently.
-- Fix: drop the index and recreate as a proper named UNIQUE CONSTRAINT.
-- PostgreSQL UNIQUE constraints also allow multiple NULLs, preserving
-- the original intent (only deduplicate rows where source_id IS NOT NULL).

DROP INDEX IF EXISTS unique_cashflow_source;

ALTER TABLE cashflow_transactions
  ADD CONSTRAINT unique_cashflow_source UNIQUE (source, source_id);
