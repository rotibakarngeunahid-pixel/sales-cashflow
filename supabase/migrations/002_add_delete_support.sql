-- =============================================
-- RBN Sales & Cashflow System - Delete Support
-- Run this AFTER 001_initial_schema.sql
-- =============================================

-- Add soft-delete column to branches
-- Used when hard delete is blocked by FK constraints (branch still has transactions/reports)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add soft-delete column to cashflow_categories
-- Used when hard delete is blocked by FK constraints (category still referenced in transactions)
ALTER TABLE cashflow_categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast filtering of non-deleted records
CREATE INDEX IF NOT EXISTS idx_branches_deleted_at ON branches (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_categories_deleted_at ON cashflow_categories (deleted_at) WHERE deleted_at IS NULL;
