-- Add QRIS MDR (Merchant Discount Rate) tracking to sales_reports
ALTER TABLE sales_reports
  ADD COLUMN IF NOT EXISTS qris_gross NUMERIC DEFAULT 0 CHECK (qris_gross >= 0),
  ADD COLUMN IF NOT EXISTS qris_mdr NUMERIC DEFAULT 0 CHECK (qris_mdr >= 0);

-- Backfill: treat existing qris (net) values as gross since MDR was not previously tracked
UPDATE sales_reports
SET qris_gross = qris
WHERE qris_gross = 0;
