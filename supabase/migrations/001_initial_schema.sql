-- =============================================
-- RBN Sales & Cashflow System - Initial Schema
-- =============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =============================================
-- UTILITY FUNCTIONS
-- =============================================

-- Auto-update updated_at trigger
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================
-- TABLES
-- =============================================

-- profiles (linked to auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at_column();

-- branches
create table if not exists branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_branches_updated_at
  before update on branches
  for each row execute function update_updated_at_column();

-- cashflow_categories
create table if not exists cashflow_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  default_type text not null check (default_type in ('cash_in', 'cash_out', 'both')),
  description text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_cashflow_categories_updated_at
  before update on cashflow_categories
  for each row execute function update_updated_at_column();

-- sales_reports
create table if not exists sales_reports (
  id uuid primary key default uuid_generate_v4(),
  report_date date not null,
  branch_id uuid not null references branches(id),
  cash numeric not null default 0 check (cash >= 0),
  qris numeric not null default 0 check (qris >= 0),
  gofood_gross numeric not null default 0 check (gofood_gross >= 0),
  gofood_promo numeric not null default 0 check (gofood_promo >= 0),
  gofood_commission numeric not null default 0 check (gofood_commission >= 0),
  gofood_nett numeric not null default 0 check (gofood_nett >= 0),
  grabfood_gross numeric not null default 0 check (grabfood_gross >= 0),
  grabfood_promo numeric not null default 0 check (grabfood_promo >= 0),
  grabfood_commission numeric not null default 0 check (grabfood_commission >= 0),
  grabfood_ads numeric not null default 0 check (grabfood_ads >= 0),
  grabfood_nett numeric not null default 0 check (grabfood_nett >= 0),
  shopeefood_gross numeric not null default 0 check (shopeefood_gross >= 0),
  shopeefood_promo numeric not null default 0 check (shopeefood_promo >= 0),
  shopeefood_commission numeric not null default 0 check (shopeefood_commission >= 0),
  shopeefood_nett numeric not null default 0 check (shopeefood_nett >= 0),
  total_offline numeric not null default 0,
  total_online_gross numeric not null default 0,
  total_online_nett numeric not null default 0,
  total_online_deduction numeric not null default 0,
  grand_total_nett_sales numeric not null default 0,
  online_deduction_percentage numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  notes text default '',
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sales_reports_branch_id on sales_reports(branch_id);
create index idx_sales_reports_report_date on sales_reports(report_date desc);
create index idx_sales_reports_status on sales_reports(status);
create index idx_sales_reports_date_branch on sales_reports(report_date, branch_id);

create trigger update_sales_reports_updated_at
  before update on sales_reports
  for each row execute function update_updated_at_column();

-- cashflow_transactions
create table if not exists cashflow_transactions (
  id uuid primary key default uuid_generate_v4(),
  transaction_date date not null,
  branch_id uuid not null references branches(id),
  transaction_type text not null check (transaction_type in ('cash_in', 'cash_out')),
  category_id uuid references cashflow_categories(id),
  description text default '',
  cash_in numeric not null default 0 check (cash_in >= 0),
  cash_out numeric not null default 0 check (cash_out >= 0),
  amount numeric not null default 0,
  source text not null default 'manual' check (source in ('manual', 'sales')),
  source_id uuid,
  status text not null default 'active' check (status in ('active', 'void')),
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Anti-duplication: one cashflow per sales report
create unique index unique_cashflow_source
  on cashflow_transactions(source, source_id)
  where source_id is not null;

create index idx_cashflow_transactions_branch_id on cashflow_transactions(branch_id);
create index idx_cashflow_transactions_date on cashflow_transactions(transaction_date desc);
create index idx_cashflow_transactions_status on cashflow_transactions(status);
create index idx_cashflow_transactions_source on cashflow_transactions(source, source_id);

create trigger update_cashflow_transactions_updated_at
  before update on cashflow_transactions
  for each row execute function update_updated_at_column();

-- audit_logs
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);

create index idx_audit_logs_table_name on audit_logs(table_name);
create index idx_audit_logs_record_id on audit_logs(record_id);
create index idx_audit_logs_changed_at on audit_logs(changed_at desc);

-- =============================================
-- AUTH TRIGGER - Create profile on signup
-- =============================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'admin'),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================
-- SALES → CASHFLOW SYNC TRIGGERS
-- =============================================

create or replace function sync_sales_to_cashflow()
returns trigger as $$
declare
  v_category_id uuid;
  v_branch_name text;
  v_description text;
begin
  select id into v_category_id
  from cashflow_categories
  where name = 'Penjualan' and is_active = true
  limit 1;

  select name into v_branch_name
  from branches
  where id = new.branch_id;

  v_description := 'Penjualan harian ' || coalesce(v_branch_name, '') || ' - ' || to_char(new.report_date, 'DD/MM/YYYY');

  -- Status changed TO posted
  if new.status = 'posted' and (old.status is null or old.status <> 'posted') then
    insert into cashflow_transactions (
      transaction_date, branch_id, transaction_type, category_id,
      description, cash_in, cash_out, amount, source, source_id,
      status, created_by, updated_by
    ) values (
      new.report_date, new.branch_id, 'cash_in', v_category_id,
      v_description, new.grand_total_nett_sales, 0, new.grand_total_nett_sales,
      'sales', new.id, 'active', new.updated_by, new.updated_by
    )
    on conflict on constraint unique_cashflow_source
    do update set
      transaction_date = excluded.transaction_date,
      branch_id = excluded.branch_id,
      description = excluded.description,
      cash_in = excluded.cash_in,
      amount = excluded.amount,
      status = 'active',
      updated_by = excluded.updated_by,
      updated_at = now();
  end if;

  -- Status changed TO void FROM posted (void cashflow)
  if new.status = 'void' and old.status = 'posted' then
    update cashflow_transactions
    set
      status = 'void',
      updated_by = new.updated_by,
      updated_at = now()
    where source = 'sales' and source_id = new.id;
  end if;

  -- Already posted but data changed (re-sync amount)
  if new.status = 'posted' and old.status = 'posted' and
     (new.grand_total_nett_sales <> old.grand_total_nett_sales or
      new.report_date <> old.report_date or
      new.branch_id <> old.branch_id) then
    update cashflow_transactions
    set
      transaction_date = new.report_date,
      branch_id = new.branch_id,
      description = v_description,
      cash_in = new.grand_total_nett_sales,
      amount = new.grand_total_nett_sales,
      updated_by = new.updated_by,
      updated_at = now()
    where source = 'sales' and source_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger sync_sales_cashflow_update
  after update on sales_reports
  for each row execute function sync_sales_to_cashflow();

-- Handle direct insert as posted
create or replace function sync_sales_to_cashflow_insert()
returns trigger as $$
declare
  v_category_id uuid;
  v_branch_name text;
begin
  if new.status = 'posted' then
    select id into v_category_id
    from cashflow_categories
    where name = 'Penjualan' and is_active = true
    limit 1;

    select name into v_branch_name
    from branches
    where id = new.branch_id;

    insert into cashflow_transactions (
      transaction_date, branch_id, transaction_type, category_id,
      description, cash_in, cash_out, amount, source, source_id,
      status, created_by, updated_by
    ) values (
      new.report_date, new.branch_id, 'cash_in', v_category_id,
      'Penjualan harian ' || coalesce(v_branch_name, '') || ' - ' || to_char(new.report_date, 'DD/MM/YYYY'),
      new.grand_total_nett_sales, 0, new.grand_total_nett_sales,
      'sales', new.id, 'active', new.created_by, new.created_by
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger sync_sales_cashflow_insert
  after insert on sales_reports
  for each row execute function sync_sales_to_cashflow_insert();

-- =============================================
-- RLS - Row Level Security
-- =============================================

alter table profiles enable row level security;
alter table branches enable row level security;
alter table sales_reports enable row level security;
alter table cashflow_categories enable row level security;
alter table cashflow_transactions enable row level security;
alter table audit_logs enable row level security;

-- Helper: check if current user is active
create or replace function is_user_active()
returns boolean as $$
begin
  return exists (
    select 1 from profiles
    where id = auth.uid() and is_active = true
  );
end;
$$ language plpgsql security definer stable;

-- Helper: get current user role
create or replace function get_user_role()
returns text as $$
begin
  return (
    select role from profiles
    where id = auth.uid() and is_active = true
    limit 1
  );
end;
$$ language plpgsql security definer stable;

-- profiles policies
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create policy "profiles_owner_all" on profiles
  for all using (get_user_role() = 'owner' and is_user_active());

create policy "profiles_admin_select" on profiles
  for select using (get_user_role() = 'admin' and is_user_active());

-- branches policies
create policy "branches_select_active_user" on branches
  for select using (is_user_active());

create policy "branches_owner_all" on branches
  for all using (get_user_role() = 'owner' and is_user_active());

create policy "branches_admin_all" on branches
  for all using (get_user_role() = 'admin' and is_user_active());

-- sales_reports policies
create policy "sales_select_active_user" on sales_reports
  for select using (is_user_active());

create policy "sales_insert_active_user" on sales_reports
  for insert with check (is_user_active());

create policy "sales_update_active_user" on sales_reports
  for update using (is_user_active());

create policy "sales_delete_owner" on sales_reports
  for delete using (get_user_role() = 'owner' and is_user_active());

-- cashflow_categories policies
create policy "categories_select_active_user" on cashflow_categories
  for select using (is_user_active());

create policy "categories_all_active_user" on cashflow_categories
  for all using (is_user_active());

-- cashflow_transactions policies
create policy "cashflow_select_active_user" on cashflow_transactions
  for select using (is_user_active());

create policy "cashflow_insert_active_user" on cashflow_transactions
  for insert with check (is_user_active());

create policy "cashflow_update_active_user" on cashflow_transactions
  for update using (is_user_active());

create policy "cashflow_delete_owner" on cashflow_transactions
  for delete using (get_user_role() = 'owner' and is_user_active());

-- audit_logs policies
create policy "audit_select_active_user" on audit_logs
  for select using (is_user_active());

create policy "audit_insert_active_user" on audit_logs
  for insert with check (is_user_active());

-- =============================================
-- SEED DATA
-- =============================================

-- Seed branches
insert into branches (name, address, is_active) values
  ('Buduk', '', true),
  ('Dalung', '', true),
  ('Dalung 2', '', true),
  ('Pemogan', '', true),
  ('Soputan', '', true),
  ('Batu Bulan', '', true),
  ('Nusa Kambangan', '', true);

-- Seed cashflow categories
insert into cashflow_categories (name, default_type, description, is_active) values
  ('Penjualan', 'cash_in', 'Pemasukan dari penjualan harian', true),
  ('Margin Mitra', 'cash_in', 'Margin dari mitra bisnis', true),
  ('Persediaan Stok', 'cash_in', 'Penambahan persediaan stok', true),
  ('Lainnya', 'cash_in', 'Pemasukan lainnya', true),
  ('Pembelian Bahan Baku', 'cash_out', 'Pembelian bahan baku produksi', true),
  ('Gaji', 'cash_out', 'Pembayaran gaji karyawan', true),
  ('Sewa Tempat', 'cash_out', 'Pembayaran sewa tempat usaha', true),
  ('Kurir', 'cash_out', 'Biaya kurir dan pengiriman', true),
  ('Pembelian Kardus', 'cash_out', 'Pembelian kardus kemasan', true),
  ('Pembelian Gas', 'cash_out', 'Pembelian gas LPG', true),
  ('Internet', 'cash_out', 'Biaya internet', true),
  ('Peralatan', 'cash_out', 'Pembelian atau perbaikan peralatan', true),
  ('Food Waste', 'cash_out', 'Kerugian dari food waste', true),
  ('Beban Pokok Pendapatan', 'cash_out', 'Beban pokok pendapatan', true),
  ('Lainnya', 'cash_out', 'Pengeluaran lainnya', true);
