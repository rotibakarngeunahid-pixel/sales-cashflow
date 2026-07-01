-- =============================================
-- Migration 015: Auto Split Kurir bawa Bahan
-- =============================================

-- 1. Ensure canonical category exists and is active.
do $$
declare
  v_category_id uuid;
begin
  select id into v_category_id
  from cashflow_categories
  where regexp_replace(lower(trim(name)), '[_\s]+', ' ', 'g') = 'kurir bawa bahan'
  order by created_at
  limit 1;

  if v_category_id is null then
    insert into cashflow_categories (name, default_type, description, is_active)
    values (
      'Kurir bawa Bahan',
      'cash_out',
      'Biaya kurir pembawa bahan yang otomatis dibagi rata ke semua outlet aktif',
      true
    );
  else
    update cashflow_categories
    set
      name = 'Kurir bawa Bahan',
      default_type = 'cash_out',
      description = 'Biaya kurir pembawa bahan yang otomatis dibagi rata ke semua outlet aktif',
      is_active = true,
      deleted_at = null
    where id = v_category_id;
  end if;
end $$;

-- 2. Parent/header table.
create table if not exists cashflow_auto_split_groups (
  id uuid primary key default uuid_generate_v4(),
  transaction_date date not null,
  original_branch_id uuid references branches(id),
  category_id uuid not null references cashflow_categories(id),
  description text default '',
  total_amount numeric not null check (total_amount > 0),
  branch_count integer not null check (branch_count > 0),
  split_rule text not null default 'equal_active_branches'
    check (split_rule in ('equal_active_branches')),
  rounding_rule text not null default 'floor_remainder_by_branch_order'
    check (rounding_rule in ('floor_remainder_by_branch_order')),
  status text not null default 'active'
    check (status in ('active', 'void')),
  entry_source text not null default 'manual_cashflow'
    check (entry_source in ('manual_cashflow', 'kasir_import', 'kasir_sync')),
  source_ref text,
  idempotency_key text,
  branch_snapshot jsonb not null default '[]'::jsonb,
  allocation_snapshot jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text
);

create index if not exists idx_cashflow_auto_split_groups_date
  on cashflow_auto_split_groups(transaction_date desc);

create index if not exists idx_cashflow_auto_split_groups_category
  on cashflow_auto_split_groups(category_id);

create index if not exists idx_cashflow_auto_split_groups_status
  on cashflow_auto_split_groups(status);

create index if not exists idx_cashflow_auto_split_groups_created_by
  on cashflow_auto_split_groups(created_by);

create unique index if not exists unique_cashflow_auto_split_groups_idempotency
  on cashflow_auto_split_groups(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists unique_cashflow_auto_split_groups_source_ref
  on cashflow_auto_split_groups(entry_source, source_ref)
  where source_ref is not null;

drop trigger if exists update_cashflow_auto_split_groups_updated_at on cashflow_auto_split_groups;

create trigger update_cashflow_auto_split_groups_updated_at
  before update on cashflow_auto_split_groups
  for each row execute function update_updated_at_column();

-- 3. Link reportable child rows to parent/header.
alter table cashflow_transactions
  add column if not exists auto_split_group_id uuid
  references cashflow_auto_split_groups(id);

create index if not exists idx_cashflow_transactions_auto_split_group
  on cashflow_transactions(auto_split_group_id)
  where auto_split_group_id is not null;

create unique index if not exists unique_active_auto_split_child_per_branch
  on cashflow_transactions(auto_split_group_id, branch_id)
  where auto_split_group_id is not null
    and status = 'active';

-- 4. Add source value for auto split children.
alter table cashflow_transactions drop constraint if exists cashflow_transactions_source_check;

alter table cashflow_transactions add constraint cashflow_transactions_source_check
  check (source in (
    'manual',
    'sales',
    'purchase_order',
    'kasir_sales',
    'kasir_expenses',
    'beban_transfer',
    'auto_split_kurir'
  ));

-- 5. RLS policies.
alter table cashflow_auto_split_groups enable row level security;

drop policy if exists "auto_split_groups_select_active_user" on cashflow_auto_split_groups;
drop policy if exists "auto_split_groups_insert_active_user" on cashflow_auto_split_groups;
drop policy if exists "auto_split_groups_update_active_user" on cashflow_auto_split_groups;
drop policy if exists "auto_split_groups_delete_owner" on cashflow_auto_split_groups;

create policy "auto_split_groups_select_active_user" on cashflow_auto_split_groups
  for select using (is_user_active());

create policy "auto_split_groups_insert_active_user" on cashflow_auto_split_groups
  for insert with check (is_user_active());

create policy "auto_split_groups_update_active_user" on cashflow_auto_split_groups
  for update using (is_user_active());

create policy "auto_split_groups_delete_owner" on cashflow_auto_split_groups
  for delete using (get_user_role() = 'owner' and is_user_active());

-- 6. Response helper used by create/void RPCs.
create or replace function cashflow_auto_split_group_response(
  p_group_id uuid,
  p_idempotent boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'success', true,
    'mode', 'auto_split_kurir',
    'idempotent', p_idempotent,
    'group_id', g.id,
    'status', g.status,
    'total_amount', g.total_amount,
    'branch_count', g.branch_count,
    'allocations', g.allocation_snapshot,
    'transaction_ids', coalesce(
      (
        select jsonb_agg(t.id order by b.name asc, b.id asc)
        from cashflow_transactions t
        join branches b on b.id = t.branch_id
        where t.auto_split_group_id = g.id
      ),
      '[]'::jsonb
    ),
    'message',
      case
        when g.status = 'void' then 'Pengeluaran Kurir bawa Bahan sudah dibatalkan.'
        else 'Pengeluaran Kurir bawa Bahan berhasil dibagi ke ' || g.branch_count || ' outlet aktif.'
      end
  )
  from cashflow_auto_split_groups g
  where g.id = p_group_id;
$$;

-- 7. Atomic create RPC.
create or replace function create_auto_split_kurir_bawa_bahan(
  p_transaction_date date,
  p_original_branch_id uuid,
  p_category_id uuid,
  p_description text,
  p_total_amount numeric,
  p_entry_source text default 'manual_cashflow',
  p_source_ref text default null,
  p_idempotency_key text default null,
  p_source_metadata jsonb default '{}'::jsonb,
  p_child_import_key_prefix text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_category record;
  v_existing_id uuid;
  v_group_id uuid;
  v_branch_count integer;
  v_total_amount bigint;
  v_base bigint;
  v_remainder integer;
  v_branch record;
  v_amount bigint;
  v_branch_snapshot jsonb := '[]'::jsonb;
  v_allocation_snapshot jsonb := '[]'::jsonb;
  v_child_id uuid;
  v_child_ids uuid[] := '{}';
  v_child_import_key text;
  v_child_description text;
  v_sum_amount numeric;
  v_sum_cash_out numeric;
  v_child_count integer;
begin
  if v_user_id is null or not is_user_active() then
    raise exception 'Sesi login tidak valid.';
  end if;

  if p_transaction_date is null then
    raise exception 'Tanggal wajib diisi.';
  end if;

  if p_total_amount is null or p_total_amount <= 0 then
    raise exception 'Nominal harus lebih dari 0.';
  end if;

  if p_total_amount <> trunc(p_total_amount) then
    raise exception 'Nominal Kurir bawa Bahan harus berupa angka Rupiah tanpa desimal.';
  end if;

  if p_entry_source not in ('manual_cashflow', 'kasir_import', 'kasir_sync') then
    raise exception 'Sumber auto split tidak valid.';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing_id
    from cashflow_auto_split_groups
    where idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_id is not null then
      return cashflow_auto_split_group_response(v_existing_id, true);
    end if;
  end if;

  if p_source_ref is not null then
    select id into v_existing_id
    from cashflow_auto_split_groups
    where entry_source = p_entry_source
      and source_ref = p_source_ref
    limit 1;

    if v_existing_id is not null then
      return cashflow_auto_split_group_response(v_existing_id, true);
    end if;
  end if;

  select id, name, default_type into v_category
  from cashflow_categories
  where id = p_category_id
    and is_active = true
    and deleted_at is null
    and default_type in ('cash_out', 'both')
  limit 1;

  if not found then
    raise exception 'Kategori Kurir bawa Bahan tidak ditemukan atau tidak aktif.';
  end if;

  if regexp_replace(lower(trim(v_category.name)), '[_\s]+', ' ', 'g') <> 'kurir bawa bahan' then
    raise exception 'Kategori ini tidak valid untuk auto split Kurir bawa Bahan.';
  end if;

  select count(*) into v_branch_count
  from branches
  where is_active = true
    and deleted_at is null;

  if v_branch_count = 0 then
    raise exception 'Tidak ada outlet aktif. Aktifkan minimal 1 outlet sebelum menyimpan Kurir bawa Bahan.';
  end if;

  v_total_amount := p_total_amount::bigint;

  if v_total_amount < v_branch_count then
    raise exception 'Nominal Kurir bawa Bahan minimal Rp% karena ada % outlet aktif.', v_branch_count, v_branch_count;
  end if;

  v_base := floor(v_total_amount::numeric / v_branch_count)::bigint;
  v_remainder := (v_total_amount - (v_base * v_branch_count))::integer;

  for v_branch in
    select
      id,
      name,
      row_number() over (order by name asc, id asc)::integer as branch_order
    from branches
    where is_active = true
      and deleted_at is null
    order by name asc, id asc
  loop
    v_amount := v_base + case when v_branch.branch_order <= v_remainder then 1 else 0 end;

    v_branch_snapshot := v_branch_snapshot || jsonb_build_array(
      jsonb_build_object(
        'branch_id', v_branch.id,
        'branch_name', v_branch.name,
        'order', v_branch.branch_order
      )
    );

    v_allocation_snapshot := v_allocation_snapshot || jsonb_build_array(
      jsonb_build_object(
        'branch_id', v_branch.id,
        'branch_name', v_branch.name,
        'order', v_branch.branch_order,
        'amount', v_amount
      )
    );
  end loop;

  insert into cashflow_auto_split_groups (
    transaction_date,
    original_branch_id,
    category_id,
    description,
    total_amount,
    branch_count,
    entry_source,
    source_ref,
    idempotency_key,
    branch_snapshot,
    allocation_snapshot,
    source_metadata,
    created_by,
    updated_by
  ) values (
    p_transaction_date,
    p_original_branch_id,
    p_category_id,
    coalesce(p_description, ''),
    v_total_amount,
    v_branch_count,
    p_entry_source,
    p_source_ref,
    p_idempotency_key,
    v_branch_snapshot,
    v_allocation_snapshot,
    coalesce(p_source_metadata, '{}'::jsonb),
    v_user_id,
    v_user_id
  )
  returning id into v_group_id;

  v_child_description :=
    coalesce(nullif(trim(coalesce(p_description, '')), ''), 'Kurir bawa Bahan')
    || ' (auto split Kurir bawa Bahan)';

  for v_branch in
    select
      (item->>'branch_id')::uuid as branch_id,
      item->>'branch_name' as branch_name,
      (item->>'order')::integer as branch_order,
      (item->>'amount')::bigint as amount
    from jsonb_array_elements(v_allocation_snapshot) item
    order by (item->>'order')::integer
  loop
    v_child_import_key := case
      when p_child_import_key_prefix is null then null
      else p_child_import_key_prefix || ':split:' || v_branch.branch_id
    end;

    insert into cashflow_transactions (
      transaction_date,
      branch_id,
      transaction_type,
      category_id,
      description,
      cash_in,
      cash_out,
      amount,
      source,
      source_id,
      import_key,
      source_label,
      source_metadata,
      reference_group_id,
      auto_split_group_id,
      status,
      created_by,
      updated_by
    ) values (
      p_transaction_date,
      v_branch.branch_id,
      'cash_out',
      p_category_id,
      v_child_description,
      0,
      v_branch.amount,
      v_branch.amount,
      'auto_split_kurir',
      null,
      v_child_import_key,
      'Auto Split Kurir bawa Bahan',
      coalesce(p_source_metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_split_type', 'kurir_bawa_bahan',
        'auto_split_group_id', v_group_id,
        'original_branch_id', p_original_branch_id,
        'original_amount', v_total_amount,
        'branch_count', v_branch_count,
        'rounding_rule', 'floor_remainder_by_branch_order',
        'branch_order', v_branch.branch_order,
        'branch_name', v_branch.branch_name,
        'entry_source', p_entry_source,
        'source_ref', p_source_ref,
        'idempotency_key', p_idempotency_key
      ),
      v_group_id,
      v_group_id,
      'active',
      v_user_id,
      v_user_id
    )
    returning id into v_child_id;

    v_child_ids := array_append(v_child_ids, v_child_id);
  end loop;

  select
    coalesce(sum(amount), 0),
    coalesce(sum(cash_out), 0),
    count(*)
  into v_sum_amount, v_sum_cash_out, v_child_count
  from cashflow_transactions
  where auto_split_group_id = v_group_id
    and status = 'active';

  if v_sum_amount <> v_total_amount
    or v_sum_cash_out <> v_total_amount
    or v_child_count <> v_branch_count then
    raise exception 'Total alokasi auto split tidak sama dengan nominal awal.';
  end if;

  insert into audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) values (
    'cashflow_auto_split_groups',
    v_group_id,
    'cashflow_auto_split_created',
    null,
    jsonb_build_object(
      'group_id', v_group_id,
      'transaction_date', p_transaction_date,
      'category_id', p_category_id,
      'category_name', v_category.name,
      'original_branch_id', p_original_branch_id,
      'total_amount', v_total_amount,
      'branch_count', v_branch_count,
      'rounding_rule', 'floor_remainder_by_branch_order',
      'allocation', v_allocation_snapshot,
      'child_transaction_ids', to_jsonb(v_child_ids),
      'entry_source', p_entry_source,
      'source_ref', p_source_ref,
      'idempotency_key', p_idempotency_key
    ),
    v_user_id,
    now()
  );

  return cashflow_auto_split_group_response(v_group_id, false);
end;
$$;

-- 8. Atomic void RPC.
create or replace function void_auto_split_kurir_bawa_bahan(
  p_group_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group cashflow_auto_split_groups%rowtype;
  v_old_group jsonb;
  v_old_children jsonb;
  v_voided_count integer := 0;
begin
  if v_user_id is null or not is_user_active() then
    raise exception 'Sesi login tidak valid.';
  end if;

  select * into v_group
  from cashflow_auto_split_groups
  where id = p_group_id;

  if not found then
    raise exception 'Auto split Kurir bawa Bahan tidak ditemukan.';
  end if;

  if v_group.status = 'void' then
    return cashflow_auto_split_group_response(p_group_id, true);
  end if;

  v_old_group := to_jsonb(v_group);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at asc), '[]'::jsonb)
  into v_old_children
  from cashflow_transactions t
  where t.auto_split_group_id = p_group_id
    and t.status = 'active';

  update cashflow_auto_split_groups
  set
    status = 'void',
    updated_by = v_user_id,
    voided_at = now(),
    voided_by = v_user_id,
    void_reason = p_reason
  where id = p_group_id;

  update cashflow_transactions
  set
    status = 'void',
    updated_by = v_user_id,
    updated_at = now()
  where auto_split_group_id = p_group_id
    and status = 'active';

  get diagnostics v_voided_count = row_count;

  insert into audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) values (
    'cashflow_auto_split_groups',
    p_group_id,
    'cashflow_auto_split_voided',
    jsonb_build_object(
      'group', v_old_group,
      'children', v_old_children
    ),
    jsonb_build_object(
      'group_id', p_group_id,
      'status', 'void',
      'void_reason', p_reason,
      'voided_child_count', v_voided_count
    ),
    v_user_id,
    now()
  );

  return cashflow_auto_split_group_response(p_group_id, false)
    || jsonb_build_object('voided_count', v_voided_count);
end;
$$;

comment on table cashflow_auto_split_groups is
  'Parent/header auto split cash out Kurir bawa Bahan. Reportable rows stay in cashflow_transactions.';

comment on column cashflow_transactions.auto_split_group_id is
  'Parent group for auto split Kurir bawa Bahan child rows.';
