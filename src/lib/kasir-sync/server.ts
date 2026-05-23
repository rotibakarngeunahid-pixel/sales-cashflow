import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { normalizeBranchName } from '@/lib/kasir-import/shared'

type Supabase = SupabaseClient<Database>
type AnyRecord = Record<string, unknown>

// =============================================
// Konstanta
// =============================================

const KASIR_BASE_URL = 'https://mcrhlwqmeccighmxmccz.supabase.co/rest/v1/rpc'
const PAGE_SIZE = 1000
const MAX_PAGES = 50  // safety: maks 50.000 record per sync

// import_key format harus sama dengan kasir-import/shared.ts
// agar dedup bekerja lintas fitur
export function makeSyncSaleKey(branchName: string, kasirId: string): string {
  return `kasir-sales:${normalizeBranchName(branchName)}:${kasirId}`
}
export function makeSyncExpenseKey(branchName: string, kasirId: string): string {
  return `kasir-expenses:${normalizeBranchName(branchName)}:${kasirId}`
}

// =============================================
// Types
// =============================================

export interface SyncBatch {
  id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'partial'
  period_from: string | null
  period_to: string | null
  total_pulled: number
  new_count: number
  skipped_count: number
  error_message: string | null
  triggered_by: string
  created_at: string
}

export interface SyncQueueItem {
  id: string
  batch_id: string | null
  item_type: 'penjualan' | 'kas_keluar'
  kasir_id: string
  tanggal: string
  waktu: string
  cabang: string
  branch_id: string | null
  // penjualan
  total_penjualan: number | null
  subtotal: number | null
  diskon: number | null
  metode_pembayaran: string | null
  kasir_name: string | null
  // kas_keluar
  kategori: string | null
  nominal: number | null
  keterangan: string | null
  dicatat_oleh: string | null
  // workflow
  status: 'pending' | 'confirmed' | 'rejected'
  confirmed_at: string | null
  confirmed_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  reject_reason: string | null
  cashflow_transaction_id: string | null
  raw_data: AnyRecord | null
  pulled_at: string
}

export interface PullResult {
  batchId: string
  status: 'completed' | 'partial' | 'failed'
  periodFrom: string
  periodTo: string
  totalPulled: number
  newCount: number
  skippedCount: number
  errors: string[]
}

export interface ConfirmResult {
  confirmed: number
  failed: number
  errors: string[]
}

// =============================================
// Kasir API — Paginated Fetch
// =============================================

interface KasirPage {
  success: boolean
  data: AnyRecord[]
  pagination: {
    total_count: number
    returned_count: number
    has_more: boolean
  }
  error?: string
}

async function fetchKasirPage(
  endpoint: string,
  params: { p_date_from?: string; p_date_to?: string },
  offset: number
): Promise<KasirPage> {
  const apiKey = process.env.KASIR_INTEGRATION_API_KEY
  const supabaseKey = process.env.KASIR_SUPABASE_ANON_KEY

  if (!apiKey) throw new Error('KASIR_INTEGRATION_API_KEY tidak dikonfigurasi.')

  const body: AnyRecord = {
    p_api_key: apiKey,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  }
  if (params.p_date_from) body.p_date_from = params.p_date_from
  if (params.p_date_to) body.p_date_to = params.p_date_to

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (supabaseKey) {
    headers['apikey'] = supabaseKey
    headers['Authorization'] = `Bearer ${supabaseKey}`
  }

  const response = await fetch(`${KASIR_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new Error(`Respons dari kasir bukan JSON (HTTP ${response.status})`)
  }

  if (!response.ok) {
    const msg =
      isRecord(raw) && typeof raw.message === 'string'
        ? raw.message
        : `HTTP ${response.status}`
    throw new Error(`Endpoint kasir error: ${msg}`)
  }

  // Normalisasi berbagai format respons Supabase RPC
  if (isRecord(raw)) {
    // Format standar dengan pagination
    if (raw.success === true && Array.isArray(raw.data)) {
      const pag = isRecord(raw.pagination)
        ? (raw.pagination as { total_count: number; returned_count: number; has_more: boolean })
        : null
      return {
        success: true,
        data: raw.data as AnyRecord[],
        pagination: {
          total_count: pag?.total_count ?? (raw.data as AnyRecord[]).length,
          returned_count: pag?.returned_count ?? (raw.data as AnyRecord[]).length,
          has_more: pag?.has_more ?? false,
        },
      }
    }
    // Error dari kasir
    if (raw.success === false) {
      return {
        success: false,
        data: [],
        pagination: { total_count: 0, returned_count: 0, has_more: false },
        error: typeof raw.error === 'string' ? raw.error : 'API kasir mengembalikan error',
      }
    }
  }

  // Fallback: respons berupa array langsung
  if (Array.isArray(raw)) {
    const arr = raw as AnyRecord[]
    return {
      success: true,
      data: arr,
      pagination: {
        total_count: arr.length,
        returned_count: arr.length,
        has_more: arr.length >= PAGE_SIZE,
      },
    }
  }

  throw new Error('Format respons kasir tidak dikenali.')
}

async function fetchAllFromKasir(
  endpoint: string,
  params: { p_date_from?: string; p_date_to?: string }
): Promise<{ data: AnyRecord[]; totalCount: number }> {
  const allData: AnyRecord[] = []
  let offset = 0
  let hasMore = true
  let totalCount = 0
  let page = 0

  while (hasMore && page < MAX_PAGES) {
    const result = await fetchKasirPage(endpoint, params, offset)

    if (!result.success) {
      throw new Error(result.error || 'Gagal mengambil data dari kasir.')
    }

    allData.push(...result.data)
    totalCount = result.pagination.total_count || allData.length
    hasMore = result.pagination.has_more

    offset += PAGE_SIZE
    page++

    // Jika returned_count < PAGE_SIZE, sudah pasti halaman terakhir
    if (result.pagination.returned_count < PAGE_SIZE) break
  }

  return { data: allData, totalCount }
}

// =============================================
// Normalisasi Record dari API Kasir
// =============================================

function str(r: AnyRecord, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (v !== undefined && v !== null) return String(v).trim()
  }
  return ''
}

function num(r: AnyRecord, ...keys: string[]): number {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.-]/g, ''))
      if (!isNaN(n)) return n
    }
  }
  return 0
}

function normalizeDate(r: AnyRecord): { tanggal: string; waktu: string } {
  const tanggal = str(r, 'tanggal', 'date', 'transaction_date')
  const waktu = str(r, 'waktu', 'time', 'jam')
  return {
    tanggal: tanggal.slice(0, 10),
    waktu: waktu || '00:00:00',
  }
}

// =============================================
// Branch Lookup
// =============================================

interface LocalBranch {
  id: string
  name: string
}

async function loadBranches(supabase: Supabase): Promise<LocalBranch[]> {
  const { data } = await supabase
    .from('branches')
    .select('id,name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')
  return data || []
}

function matchBranch(name: string, branches: LocalBranch[]): LocalBranch | null {
  const n = normalizeBranchName(name)
  return (
    branches.find((b) => normalizeBranchName(b.name) === n) ??
    branches.find(
      (b) =>
        normalizeBranchName(b.name).includes(n) ||
        n.includes(normalizeBranchName(b.name))
    ) ??
    null
  )
}

// =============================================
// Category Lookup
// =============================================

interface LocalCategory {
  id: string
  name: string
  default_type: string
}

async function loadCategories(supabase: Supabase): Promise<LocalCategory[]> {
  const { data } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('is_active', true)
    .is('deleted_at', null)
  return data || []
}

function findCategory(
  categories: LocalCategory[],
  type: 'cash_in' | 'cash_out',
  preferredNames: string[]
): string | null {
  const pool = categories.filter((c) => c.default_type === type || c.default_type === 'both')
  for (const preferred of preferredNames) {
    const found = pool.find(
      (c) => normalizeBranchName(c.name) === normalizeBranchName(preferred)
    )
    if (found) return found.id
  }
  // Fallback: "Penjualan" atau "Lainnya"
  const fallback = pool.find(
    (c) => normalizeBranchName(c.name).includes(type === 'cash_in' ? 'penjualan' : 'lainnya')
  )
  return fallback?.id ?? pool[0]?.id ?? null
}

function matchCategoryByKasirName(
  categories: LocalCategory[],
  kasirCategory: string
): string | null {
  const pool = categories.filter((c) => c.default_type === 'cash_out' || c.default_type === 'both')
  const n = normalizeBranchName(kasirCategory)
  const exact = pool.find((c) => normalizeBranchName(c.name) === n)
  if (exact) return exact.id
  const partial = pool.find(
    (c) =>
      normalizeBranchName(c.name).includes(n) ||
      n.includes(normalizeBranchName(c.name))
  )
  return partial?.id ?? null
}

// =============================================
// WITA Date Helpers
// =============================================

/**
 * Tanggal hari ini di timezone WITA (UTC+8).
 */
export function getWitaDate(offsetDays = 0): string {
  const witaMs = Date.now() + 8 * 60 * 60 * 1000
  const d = new Date(witaMs + offsetDays * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

// =============================================
// PULL — Tarik data dari kasir ke queue
// =============================================

export async function pullKasirToQueue(
  supabase: Supabase,
  opts: {
    triggeredBy?: string
    dateFrom?: string
    dateTo?: string
  } = {}
): Promise<PullResult> {
  const today = getWitaDate()
  const yesterday = getWitaDate(-1)

  // Tentukan periode: gunakan param atau otomatis dari sync terakhir
  let dateFrom = opts.dateFrom
  let dateTo = opts.dateTo ?? today

  if (!dateFrom) {
    const { data: lastBatch } = await supabase
      .from('kasir_sync_batches')
      .select('period_to')
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastBatch?.period_to) {
      // Mundur 2 hari dari sync terakhir untuk overlap keamanan
      const lastDate = new Date(lastBatch.period_to)
      lastDate.setDate(lastDate.getDate() - 2)
      dateFrom = lastDate.toISOString().slice(0, 10)
    } else {
      // Pertama kali sync: 30 hari ke belakang
      dateFrom = getWitaDate(-30)
    }
  }

  // Buat batch record
  const { data: batch, error: batchErr } = await supabase
    .from('kasir_sync_batches')
    .insert({
      status: 'running',
      period_from: dateFrom,
      period_to: dateTo,
      triggered_by: opts.triggeredBy ?? 'scheduler',
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    throw new Error(`Gagal membuat batch record: ${batchErr?.message}`)
  }

  const batchId = batch.id
  const errors: string[] = []
  let totalPulled = 0
  let newCount = 0
  let skippedCount = 0

  const branches = await loadBranches(supabase)

  // ---- Tarik Penjualan ----
  try {
    const { data: salesData } = await fetchAllFromKasir('get_sales_integration', {
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })

    totalPulled += salesData.length

    for (const raw of salesData) {
      if (!isRecord(raw)) continue

      const kasirId = str(raw, 'id', 'transaction_id')
      if (!kasirId) { skippedCount++; continue }

      const { tanggal, waktu } = normalizeDate(raw)
      if (!tanggal) { skippedCount++; continue }

      const cabang = str(raw, 'cabang', 'branch_name', 'outlet')
      const matchedBranch = cabang ? matchBranch(cabang, branches) : null

      const rowData = {
        batch_id: batchId,
        item_type: 'penjualan' as const,
        kasir_id: kasirId,
        tanggal,
        waktu,
        cabang: cabang || 'Tidak Diketahui',
        branch_id: matchedBranch?.id ?? null,
        total_penjualan: num(raw, 'total_penjualan', 'total', 'amount'),
        subtotal: num(raw, 'subtotal') || null,
        diskon: num(raw, 'diskon', 'discount') || null,
        metode_pembayaran: str(raw, 'metode_pembayaran', 'payment_method') || null,
        kasir_name: str(raw, 'kasir', 'cashier') || null,
        raw_data: raw,
        status: 'pending' as const,
      }

      const { error } = await supabase
        .from('kasir_sync_queue')
        .upsert(rowData, { onConflict: 'item_type,kasir_id', ignoreDuplicates: true })

      if (error) {
        // Duplikat diabaikan (unique constraint)
        if (error.code === '23505') {
          skippedCount++
        } else {
          errors.push(`Penjualan ID ${kasirId}: ${error.message}`)
          skippedCount++
        }
      } else {
        newCount++
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Gagal tarik penjualan: ${msg}`)
  }

  // ---- Tarik Kas Keluar ----
  try {
    const { data: expData } = await fetchAllFromKasir('get_kas_keluar_integration', {
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })

    totalPulled += expData.length

    for (const raw of expData) {
      if (!isRecord(raw)) continue

      const kasirId = str(raw, 'id', 'expense_id')
      if (!kasirId) { skippedCount++; continue }

      const { tanggal, waktu } = normalizeDate(raw)
      if (!tanggal) { skippedCount++; continue }

      const cabang = str(raw, 'cabang', 'branch_name', 'outlet')
      const matchedBranch = cabang ? matchBranch(cabang, branches) : null

      const rowData = {
        batch_id: batchId,
        item_type: 'kas_keluar' as const,
        kasir_id: kasirId,
        tanggal,
        waktu,
        cabang: cabang || 'Tidak Diketahui',
        branch_id: matchedBranch?.id ?? null,
        kategori: str(raw, 'kategori', 'category') || null,
        nominal: num(raw, 'nominal', 'amount', 'total') || null,
        keterangan: str(raw, 'keterangan', 'description', 'notes') || null,
        dicatat_oleh: str(raw, 'dicatat_oleh', 'recorded_by', 'kasir') || null,
        raw_data: raw,
        status: 'pending' as const,
      }

      const { error } = await supabase
        .from('kasir_sync_queue')
        .upsert(rowData, { onConflict: 'item_type,kasir_id', ignoreDuplicates: true })

      if (error) {
        if (error.code === '23505') {
          skippedCount++
        } else {
          errors.push(`Kas Keluar ID ${kasirId}: ${error.message}`)
          skippedCount++
        }
      } else {
        newCount++
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Gagal tarik kas keluar: ${msg}`)
  }

  // Update batch status
  const finalStatus: 'completed' | 'partial' | 'failed' =
    errors.length === 0
      ? 'completed'
      : newCount > 0
        ? 'partial'
        : 'failed'

  await supabase
    .from('kasir_sync_batches')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      total_pulled: totalPulled,
      new_count: newCount,
      skipped_count: skippedCount,
      error_message: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
    })
    .eq('id', batchId)

  return {
    batchId,
    status: finalStatus,
    periodFrom: dateFrom,
    periodTo: dateTo,
    totalPulled,
    newCount,
    skippedCount,
    errors,
  }
}

// =============================================
// CONFIRM — Konfirmasi item → cashflow_transactions
// =============================================

export async function confirmQueueItems(
  supabase: Supabase,
  ids: string[],
  userId: string
): Promise<ConfirmResult> {
  if (ids.length === 0) return { confirmed: 0, failed: 0, errors: [] }

  const { data: items, error: loadErr } = await supabase
    .from('kasir_sync_queue')
    .select('*')
    .in('id', ids)
    .eq('status', 'pending')

  if (loadErr) throw new Error(`Gagal memuat item: ${loadErr.message}`)
  if (!items || items.length === 0) {
    return { confirmed: 0, failed: 0, errors: ['Tidak ada item pending yang ditemukan.'] }
  }

  const categories = await loadCategories(supabase)
  let confirmed = 0
  let failed = 0
  const errors: string[] = []

  for (const item of items) {
    try {
      if (item.item_type === 'penjualan') {
        await confirmPenjualan(supabase, item as SyncQueueItem, userId, categories)
      } else {
        await confirmKasKeluar(supabase, item as SyncQueueItem, userId, categories)
      }
      confirmed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Item ${item.kasir_id} (${item.item_type}): ${msg}`)
      failed++
    }
  }

  return { confirmed, failed, errors }
}

async function confirmPenjualan(
  supabase: Supabase,
  item: SyncQueueItem,
  userId: string,
  categories: LocalCategory[]
): Promise<void> {
  const amount = item.total_penjualan ?? 0
  if (amount <= 0) throw new Error('Nominal penjualan tidak valid.')
  if (!item.branch_id) throw new Error('Cabang tidak cocok — tidak bisa dikonfirmasi.')

  const metode = (item.metode_pembayaran ?? '').toLowerCase()
  let categoryNames: string[]
  if (metode === 'cash' || metode === 'tunai') {
    categoryNames = ['Penjualan Tunai', 'Penjualan']
  } else if (metode === 'qris') {
    categoryNames = ['Penjualan QRIS', 'Penjualan']
  } else {
    categoryNames = ['Penjualan']
  }
  const categoryId = findCategory(categories, 'cash_in', categoryNames)

  const importKey = makeSyncSaleKey(item.cabang, item.kasir_id)
  const description = [
    'Penjualan',
    item.metode_pembayaran ? `(${item.metode_pembayaran.toUpperCase()})` : '',
    item.cabang,
    item.tanggal,
    item.waktu ? `${item.waktu} WITA` : '',
  ]
    .filter(Boolean)
    .join(' - ')

  const payload = {
    transaction_date: item.tanggal,
    branch_id: item.branch_id,
    transaction_type: 'cash_in' as const,
    category_id: categoryId,
    description,
    cash_in: amount,
    cash_out: 0,
    amount,
    source: 'kasir_sales' as const,
    source_id: null,
    import_key: importKey,
    source_label: 'Sinkronisasi Otomatis Kasir',
    source_metadata: {
      ...((item.raw_data as AnyRecord) ?? {}),
      kasir_id: item.kasir_id,
      sync_queue_id: item.id,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    } as AnyRecord,
    status: 'active' as const,
    created_by: userId,
    updated_by: userId,
  }

  // Cek duplikat import_key terlebih dahulu
  const { data: existing } = await supabase
    .from('cashflow_transactions')
    .select('id')
    .eq('import_key', importKey)
    .maybeSingle()

  if (existing) {
    // Sudah ada — update status queue saja (sudah pernah diimport manual)
    await supabase
      .from('kasir_sync_queue')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
        cashflow_transaction_id: existing.id,
      })
      .eq('id', item.id)
    return
  }

  const { data: inserted, error } = await supabase
    .from('cashflow_transactions')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Race condition — duplikat, cari yang ada
      const { data: dup } = await supabase
        .from('cashflow_transactions')
        .select('id')
        .eq('import_key', importKey)
        .maybeSingle()
      if (dup) {
        await supabase
          .from('kasir_sync_queue')
          .update({
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            confirmed_by: userId,
            cashflow_transaction_id: dup.id,
          })
          .eq('id', item.id)
        return
      }
    }
    throw new Error(error.message)
  }

  // Update queue status
  await supabase
    .from('kasir_sync_queue')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      cashflow_transaction_id: inserted?.id ?? null,
    })
    .eq('id', item.id)

  // Audit log
  if (inserted) {
    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: inserted.id,
      action: 'kasir_sync_confirmed',
      old_data: null,
      new_data: payload as unknown as AnyRecord,
      changed_by: userId,
      changed_at: new Date().toISOString(),
    }).then(() => {})  // non-blocking
  }
}

async function confirmKasKeluar(
  supabase: Supabase,
  item: SyncQueueItem,
  userId: string,
  categories: LocalCategory[]
): Promise<void> {
  const amount = item.nominal ?? 0
  if (amount <= 0) throw new Error('Nominal kas keluar tidak valid.')
  if (!item.branch_id) throw new Error('Cabang tidak cocok — tidak bisa dikonfirmasi.')

  const categoryId = item.kategori
    ? matchCategoryByKasirName(categories, item.kategori) ??
      findCategory(categories, 'cash_out', ['Lainnya'])
    : findCategory(categories, 'cash_out', ['Lainnya'])

  const importKey = makeSyncExpenseKey(item.cabang, item.kasir_id)
  const description = [
    item.kategori || 'Kas Keluar',
    item.cabang,
    item.tanggal,
    item.keterangan ? `- ${item.keterangan}` : '',
  ]
    .filter(Boolean)
    .join(' - ')

  const payload = {
    transaction_date: item.tanggal,
    branch_id: item.branch_id,
    transaction_type: 'cash_out' as const,
    category_id: categoryId,
    description,
    cash_in: 0,
    cash_out: amount,
    amount,
    source: 'kasir_expenses' as const,
    source_id: null,
    import_key: importKey,
    source_label: 'Sinkronisasi Otomatis Kasir',
    source_metadata: {
      ...((item.raw_data as AnyRecord) ?? {}),
      kasir_id: item.kasir_id,
      sync_queue_id: item.id,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    } as AnyRecord,
    status: 'active' as const,
    created_by: userId,
    updated_by: userId,
  }

  const { data: existing } = await supabase
    .from('cashflow_transactions')
    .select('id')
    .eq('import_key', importKey)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('kasir_sync_queue')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
        cashflow_transaction_id: existing.id,
      })
      .eq('id', item.id)
    return
  }

  const { data: inserted, error } = await supabase
    .from('cashflow_transactions')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: dup } = await supabase
        .from('cashflow_transactions')
        .select('id')
        .eq('import_key', importKey)
        .maybeSingle()
      if (dup) {
        await supabase
          .from('kasir_sync_queue')
          .update({
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            confirmed_by: userId,
            cashflow_transaction_id: dup.id,
          })
          .eq('id', item.id)
        return
      }
    }
    throw new Error(error.message)
  }

  await supabase
    .from('kasir_sync_queue')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      cashflow_transaction_id: inserted?.id ?? null,
    })
    .eq('id', item.id)

  if (inserted) {
    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: inserted.id,
      action: 'kasir_sync_confirmed',
      old_data: null,
      new_data: payload as unknown as AnyRecord,
      changed_by: userId,
      changed_at: new Date().toISOString(),
    }).then(() => {})
  }
}

// =============================================
// REJECT — Tolak item dari queue
// =============================================

export async function rejectQueueItems(
  supabase: Supabase,
  ids: string[],
  userId: string,
  reason?: string
): Promise<{ rejected: number; errors: string[] }> {
  if (ids.length === 0) return { rejected: 0, errors: [] }

  const { error } = await supabase
    .from('kasir_sync_queue')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: userId,
      reject_reason: reason ?? null,
    })
    .in('id', ids)
    .eq('status', 'pending')

  if (error) {
    return { rejected: 0, errors: [error.message] }
  }

  return { rejected: ids.length, errors: [] }
}

// =============================================
// Helpers
// =============================================

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
