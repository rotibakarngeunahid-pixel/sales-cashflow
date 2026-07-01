-- =============================================================
-- Verifikasi manual: pastikan Reset Data Cabang benar-benar bersih
-- Jalankan di Supabase SQL Editor SETELAH menjalankan reset.
--
-- Cara pakai: ganti ':branch_name' di bawah dengan nama cabang yang
-- baru direset (persis sama, case-sensitive), lalu jalankan seluruh
-- file ini. Semua angka pada kolom "remaining" harus 0 untuk modul
-- yang tadi dipilih saat reset. Baris > 0 = ada sisa data yang
-- seharusnya sudah terhapus.
-- =============================================================

with target_branch as (
  select id, name
  from branches
  where name = :'branch_name'
)

-- Penjualan
select 'sales_reports' as table_name, null as source, count(*) as remaining
from sales_reports, target_branch
where sales_reports.branch_id = target_branch.id

union all
select 'cashflow_transactions', 'sales', count(*)
from cashflow_transactions, target_branch
where cashflow_transactions.branch_id = target_branch.id
  and cashflow_transactions.source = 'sales'

-- Cashflow manual (termasuk auto split kurir yang asalnya manual)
union all
select 'cashflow_transactions', 'manual', count(*)
from cashflow_transactions, target_branch
where cashflow_transactions.branch_id = target_branch.id
  and cashflow_transactions.source = 'manual'

union all
select 'cashflow_transactions', 'auto_split_kurir (manual_cashflow)', count(*)
from cashflow_transactions ct, target_branch, cashflow_auto_split_groups g
where ct.branch_id = target_branch.id
  and ct.source = 'auto_split_kurir'
  and ct.auto_split_group_id = g.id
  and g.entry_source = 'manual_cashflow'

-- Kasir (import, sync queue pending/confirmed, cashflow terkait, auto split dari kasir)
union all
select 'kasir_import_logs', null, count(*)
from kasir_import_logs, target_branch
where kasir_import_logs.branch_id = target_branch.id

union all
select 'kasir_sync_queue', 'pending/confirmed', count(*)
from kasir_sync_queue, target_branch
where kasir_sync_queue.branch_id = target_branch.id
  and kasir_sync_queue.status in ('pending', 'confirmed')

union all
select 'cashflow_transactions', 'kasir_sales/kasir_expenses/purchase_order', count(*)
from cashflow_transactions, target_branch
where cashflow_transactions.branch_id = target_branch.id
  and cashflow_transactions.source in ('kasir_sales', 'kasir_expenses', 'purchase_order')

union all
select 'cashflow_transactions', 'auto_split_kurir (kasir_import/kasir_sync)', count(*)
from cashflow_transactions ct, target_branch, cashflow_auto_split_groups g
where ct.branch_id = target_branch.id
  and ct.source = 'auto_split_kurir'
  and ct.auto_split_group_id = g.id
  and g.entry_source in ('kasir_import', 'kasir_sync')

-- Transfer beban (sebagai pengirim maupun penerima)
union all
select 'beban_transfers', null, count(*)
from beban_transfers, target_branch
where beban_transfers.from_branch_id = target_branch.id
   or beban_transfers.to_branch_id = target_branch.id

union all
select 'cashflow_transactions', 'beban_transfer', count(*)
from cashflow_transactions, target_branch
where cashflow_transactions.branch_id = target_branch.id
  and cashflow_transactions.source = 'beban_transfer'

order by remaining desc, table_name, source;
