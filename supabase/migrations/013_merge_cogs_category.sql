-- =============================================
-- RBN Sales & Cashflow System
-- Samakan "Pembelian Bahan Baku" dengan "Beban Pokok Pendapatan"
-- karena keduanya merepresentasikan biaya yang sama (HPP).
-- Kategori kanonik yang dipertahankan: "Beban Pokok Pendapatan".
-- Run AFTER 012_add_beban_transfer.sql
-- =============================================

DO $$
DECLARE
  v_cogs_id uuid;
  v_dup_id uuid;
  v_moved integer := 0;
BEGIN
  -- 1. Pastikan kategori kanonik "Beban Pokok Pendapatan" ada & aktif
  SELECT id INTO v_cogs_id
  FROM cashflow_categories
  WHERE lower(name) = 'beban pokok pendapatan'
    AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_cogs_id IS NULL THEN
    INSERT INTO cashflow_categories (name, default_type, description, is_active)
    VALUES (
      'Beban Pokok Pendapatan',
      'cash_out',
      'Beban pokok pendapatan / HPP (termasuk pembelian bahan baku)',
      true
    )
    RETURNING id INTO v_cogs_id;
  ELSE
    UPDATE cashflow_categories
    SET is_active = true,
        deleted_at = NULL,
        description = 'Beban pokok pendapatan / HPP (termasuk pembelian bahan baku)'
    WHERE id = v_cogs_id;
  END IF;

  -- 2. Pindahkan semua transaksi dari kategori duplikat ke kategori kanonik,
  --    lalu nonaktifkan kategori duplikat tersebut.
  FOR v_dup_id IN
    SELECT id
    FROM cashflow_categories
    WHERE lower(name) IN ('pembelian bahan baku', 'bahan baku')
      AND id <> v_cogs_id
  LOOP
    UPDATE cashflow_transactions
    SET category_id = v_cogs_id
    WHERE category_id = v_dup_id;

    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RAISE NOTICE 'Memindahkan % transaksi dari kategori % ke Beban Pokok Pendapatan', v_moved, v_dup_id;

    UPDATE cashflow_categories
    SET is_active = false,
        deleted_at = now()
    WHERE id = v_dup_id;
  END LOOP;
END $$;
