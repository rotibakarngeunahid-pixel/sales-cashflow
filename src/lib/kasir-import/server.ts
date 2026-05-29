import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
const uuidv4 = () => crypto.randomUUID()
import {
  KASIR_SALES_SOURCE,
  KASIR_EXPENSES_SOURCE,
  KASIR_SOURCE_LABEL,
  normalizePaymentMethod,
  normalizeBranchName,
  makeSaleImportKey,
  makeExpenseImportKey,
  distributeSplitAmounts,
  validateMappingTargets,
  STATUS_LABELS,
  type PaymentMethodFilter,
  type KasirSalePreviewItem,
  type KasirSalePreviewSummary,
  type KasirSalePreviewPayload,
  type KasirExpensePreviewItem,
  type KasirExpensePreviewSummary,
  type KasirExpensePreviewPayload,
  type KasirExpenseMappingConfig,
  type KasirImportResult,
  type MappingTarget,
  type CombinedImportResult,
  type SaleBranchDetail,
  type ExpenseItemDetail,
} from './shared'

type Supabase = SupabaseClient<Database>

// =============================================
// Error class
// =============================================

export class KasirImportError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'import_error') {
    super(message)
    this.name = 'KasirImportError'
    this.status = status
    this.code = code
  }
}

// =============================================
// POS PHP API client
// URL: POS_API_URL env var → https://pos.rotibakarngeunah.my.id/api/api.php/rpc
// Auth: X-API-Key header (POS_API_SECRET_KEY) + p_api_key body (KASIR_INTEGRATION_API_KEY)
// =============================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface KasirRpcParams {
  p_date_from: string
  p_date_to: string
  p_branch_id?: string
}

async function callKasirRpc(endpoint: string, params: KasirRpcParams): Promise<unknown[]> {
  const integrationApiKey = process.env.KASIR_INTEGRATION_API_KEY
  const posApiSecretKey   = process.env.POS_API_SECRET_KEY
  const posApiUrl         = process.env.POS_API_URL || 'https://pos.rotibakarngeunah.my.id/api/api.php/rpc'

  if (!integrationApiKey) {
    throw new KasirImportError(
      'API Key integrasi kasir belum dikonfigurasi. Hubungi administrator.',
      500,
      'missing_api_key'
    )
  }

  const body: Record<string, string> = {
    p_api_key:    integrationApiKey,
    p_date_from:  params.p_date_from,
    p_date_to:    params.p_date_to,
  }
  if (params.p_branch_id) body.p_branch_id = params.p_branch_id

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  }
  if (posApiSecretKey) {
    headers['X-API-Key'] = posApiSecretKey
  }

  let response: Response
  try {
    response = await fetch(`${posApiUrl}/${endpoint}`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      cache:   'no-store',
    })
  } catch {
    throw new KasirImportError(
      'Gagal terhubung ke sistem kasir. Periksa koneksi internet dan coba lagi.',
      502,
      'endpoint_unreachable'
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new KasirImportError(
      'Respons dari sistem kasir tidak valid (bukan JSON). Silakan cek integrasi.',
      502,
      'invalid_json'
    )
  }

  if (!response.ok) {
    const msg = getPayloadMessage(raw)
    if (response.status === 401 || response.status === 403) {
      throw new KasirImportError(
        'API Key tidak valid atau tidak punya akses ke sistem kasir.',
        401,
        'invalid_api_key'
      )
    }
    throw new KasirImportError(
      msg || `Endpoint kasir mengembalikan error (HTTP ${response.status}).`,
      502,
      'endpoint_error'
    )
  }

  // PHP API mengembalikan { success, data: [...], ... }
  if (isRecord(raw) && Array.isArray(raw.data)) return raw.data as unknown[]
  // Fallback: respons array langsung
  if (Array.isArray(raw)) return raw
  if (isRecord(raw) && raw.success === false) {
    const msg = getPayloadMessage(raw)
    throw new KasirImportError(
      msg || 'Sistem kasir mengembalikan error.',
      400,
      'api_error'
    )
  }
  return []
}

// =============================================
// Field-name normalizer (RPC response)
// =============================================

type AnyRecord = Record<string, unknown>

function getField(record: AnyRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const val = record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()]
    if (val !== undefined && val !== null && val !== '') return val
    const found = Object.keys(record).find((k) => k.toLowerCase() === key.toLowerCase())
    if (found && record[found] !== undefined && record[found] !== null && record[found] !== '') {
      return record[found]
    }
  }
  return undefined
}

function getString(record: AnyRecord, ...keys: string[]): string {
  const val = getField(record, ...keys)
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number') return String(val)
  return ''
}

function getNumber(record: AnyRecord, ...keys: string[]): number {
  const val = getField(record, ...keys)
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.,]/g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
  }
  return 0
}

function getBoolean(record: AnyRecord, ...keys: string[]): boolean {
  const val = getField(record, ...keys)
  if (typeof val === 'boolean') return val
  if (typeof val === 'string') {
    const lower = val.toLowerCase()
    return lower === 'true' || lower === '1' || lower === 'yes'
  }
  if (typeof val === 'number') return val === 1
  return false
}

/**
 * Ambil datetime dari record. PHP API mengembalikan `created_at: "YYYY-MM-DD HH:mm:ss"` dalam WITA.
 * Karena tidak ada timezone suffix, nilai WITA dipertahankan apa adanya.
 */
function getDatetime(record: AnyRecord): { dateWITA: string; timeWITA: string; datetimeRaw: string } {
  // Coba full datetime dulu (format PHP API: "2024-01-01 10:30:00")
  const fullDt = getString(
    record,
    'created_at', 'transaction_datetime', 'expense_datetime',
    'datetime', 'tanggal_waktu', 'transaction_time', 'tanggal_transaksi'
  )

  if (fullDt && (fullDt.includes('T') || (fullDt.includes(' ') && fullDt.length > 10))) {
    return parseDatetimeString(fullDt)
  }

  // Fallback: pisah tanggal + jam
  const tanggal = getString(record, 'tanggal', 'date', 'transaction_date', 'expense_date', 'report_date')
  const jam = getString(record, 'jam', 'time', 'waktu', 'transaction_time', 'expense_time', 'hour')

  if (tanggal) {
    const combined = jam ? `${tanggal}T${jam}` : tanggal
    return parseDatetimeString(combined)
  }

  return { dateWITA: '', timeWITA: '', datetimeRaw: '' }
}

function parseDatetimeString(raw: string): { dateWITA: string; timeWITA: string; datetimeRaw: string } {
  const trimmed = raw.trim()
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(trimmed)

  let d: Date
  if (hasTimezone) {
    // Ada timezone — konversi ke WITA (UTC+8)
    d = new Date(trimmed)
    d = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  } else {
    // Tidak ada timezone — anggap sudah WITA, parse sebagai UTC agar tidak ada shift
    d = new Date(trimmed.replace(' ', 'T') + 'Z')
  }

  if (isNaN(d.getTime())) {
    const dateOnly = trimmed.slice(0, 10)
    if (DATE_RE.test(dateOnly)) {
      return { dateWITA: dateOnly, timeWITA: '00:00', datetimeRaw: trimmed }
    }
    return { dateWITA: '', timeWITA: '', datetimeRaw: trimmed }
  }

  const year   = String(d.getUTCFullYear())
  const month  = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day    = String(d.getUTCDate()).padStart(2, '0')
  const hour   = String(d.getUTCHours()).padStart(2, '0')
  const minute = String(d.getUTCMinutes()).padStart(2, '0')

  return {
    dateWITA:    `${year}-${month}-${day}`,
    timeWITA:    `${hour}:${minute}`,
    datetimeRaw: trimmed,
  }
}

// =============================================
// Local branch lookup
// =============================================

interface LocalBranch {
  id: string
  name: string
}

async function loadLocalBranches(supabase: Supabase): Promise<LocalBranch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id,name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')

  if (error) {
    throw new KasirImportError('Gagal membaca data cabang.', 500, 'branch_load_failed')
  }
  return data || []
}

function matchBranch(kasirName: string, branches: LocalBranch[]): LocalBranch | null {
  const normalized = normalizeBranchName(kasirName)
  const exact = branches.find((b) => normalizeBranchName(b.name) === normalized)
  if (exact) return exact
  const partial = branches.find(
    (b) => normalized.includes(normalizeBranchName(b.name)) ||
           normalizeBranchName(b.name).includes(normalized)
  )
  return partial ?? null
}

// =============================================
// Category lookup
// =============================================

interface LocalCategory {
  id: string
  name: string
  default_type: string
}

async function loadLocalCategories(supabase: Supabase): Promise<LocalCategory[]> {
  const { data, error } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (error) return []
  return data || []
}

function matchCategory(kasirCategoryName: string, categories: LocalCategory[], type: 'cash_in' | 'cash_out'): string | null {
  const normalized = normalizeBranchName(kasirCategoryName)
  const typed = categories.filter((c) => c.default_type === type || c.default_type === 'both')
  const exact = typed.find((c) => normalizeBranchName(c.name) === normalized)
  if (exact) return exact.id
  const partial = typed.find(
    (c) => normalized.includes(normalizeBranchName(c.name)) ||
           normalizeBranchName(c.name).includes(normalized)
  )
  return partial?.id ?? null
}

async function getSalesCategoryId(supabase: Supabase, paymentCategory: 'Tunai' | 'QRIS'): Promise<string | null> {
  const { data } = await supabase
    .from('cashflow_categories')
    .select('id,name')
    .eq('is_active', true)
    .is('deleted_at', null)

  const categories = data || []
  const specific = categories.find(
    (c) => normalizeBranchName(c.name) === normalizeBranchName(`Penjualan ${paymentCategory}`)
  )
  if (specific) return specific.id

  const generic = categories.find(
    (c) => normalizeBranchName(c.name) === 'penjualan'
  )
  return generic?.id ?? null
}

// =============================================
// Duplicate check helpers
// =============================================

async function loadExistingImportKeys(supabase: Supabase, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()

  const { data } = await supabase
    .from('cashflow_transactions')
    .select('import_key')
    .in('import_key', keys)
    .eq('status', 'active')

  return new Set((data || []).map((r) => r.import_key || ''))
}

// =============================================
// SALES PREVIEW
// =============================================

export interface SalesPreviewParams {
  startDate: string
  endDate: string
  branchId?: string
  paymentMethod: PaymentMethodFilter
}

export async function getSalesPreview(
  supabase: Supabase,
  params: SalesPreviewParams
): Promise<KasirSalePreviewPayload> {
  validateDateRange(params.startDate, params.endDate)

  const [rawData, branches] = await Promise.all([
    callKasirRpc('get_sales_integration', {
      p_date_from: params.startDate,
      p_date_to:   params.endDate,
    }),
    loadLocalBranches(supabase),
  ])

  if (rawData.length === 0) {
    throw new KasirImportError(
      'Tidak ada data penjualan pada rentang tanggal ini.',
      404,
      'empty_data'
    )
  }

  const normalized = rawData
    .filter(isRecord)
    .map((r) => normalizeRawSaleRecord(r as AnyRecord))
    .filter((item): item is NonNullable<typeof item> => item !== null)

  if (normalized.length === 0) {
    throw new KasirImportError(
      'Format data dari sistem kasir tidak dikenali. Silakan cek integrasi.',
      502,
      'invalid_format'
    )
  }

  const filtered = filterByPaymentMethod(normalized, params.paymentMethod)

  const branchFiltered = params.branchId
    ? filtered.filter((item) => {
        const matched = matchBranch(item.branchName, branches)
        return matched?.id === params.branchId
      })
    : filtered

  if (branchFiltered.length === 0 && filtered.length > 0) {
    throw new KasirImportError(
      'Tidak ada data untuk cabang yang dipilih pada periode ini.',
      404,
      'empty_data'
    )
  }

  const importKeys = branchFiltered.map((item) =>
    makeSaleImportKey(item.branchName, item.transactionId)
  )
  const existingKeys = await loadExistingImportKeys(supabase, importKeys)

  const items: KasirSalePreviewItem[] = branchFiltered.map((item) => {
    const importKey     = makeSaleImportKey(item.branchName, item.transactionId)
    const matchedBranch = matchBranch(item.branchName, branches)
    const isDuplicate   = existingKeys.has(importKey)

    let status: KasirSalePreviewItem['status']
    if (!matchedBranch) {
      status = 'branch_not_found'
    } else if (isDuplicate) {
      status = 'duplicate'
    } else {
      status = 'new'
    }

    return {
      importKey,
      transactionId:   item.transactionId,
      dateWITA:        item.dateWITA,
      timeWITA:        item.timeWITA,
      datetimeRaw:     item.datetimeRaw,
      branchName:      item.branchName,
      branchId:        matchedBranch?.id ?? null,
      paymentMethod:   item.paymentMethod,
      paymentCategory: item.paymentCategory,
      amount:          item.amount,
      cashier:         item.cashier,
      status,
      statusLabel:     STATUS_LABELS[status],
    }
  })

  const summary = buildSalesSummary(items, params.paymentMethod)
  return { items, summary }
}

// =============================================
// SALES IMPORT (save)
// =============================================

export interface SalesImportParams extends SalesPreviewParams {
  userId: string | null
}

export async function importSales(
  supabase: Supabase,
  params: SalesImportParams
): Promise<KasirImportResult> {
  const preview  = await getSalesPreview(supabase, params)
  const newItems = preview.items.filter((item) => item.status === 'new' && item.branchId)

  if (newItems.length === 0) {
    return {
      success:      true,
      totalFound:   preview.items.length,
      totalSuccess: 0,
      totalFailed:  0,
      totalSkipped: preview.items.filter((i) => i.status !== 'new').length,
      totalAmount:  0,
      message:      'Tidak ada data penjualan baru untuk diimport. Semua sudah pernah diimport sebelumnya.',
      errors:       [],
    }
  }

  let totalSuccess = 0
  let totalFailed  = 0
  let totalAmount  = 0
  const errors: string[] = []

  for (const item of newItems) {
    if (!item.branchId || !item.paymentCategory) continue

    const categoryId  = await getSalesCategoryId(supabase, item.paymentCategory).catch(() => null)
    const description = `Penjualan ${item.paymentCategory} - ${item.branchName} - ${item.dateWITA} ${item.timeWITA} WITA`

    const payload = {
      transaction_date: item.dateWITA,
      branch_id:        item.branchId,
      transaction_type: 'cash_in' as const,
      category_id:      categoryId,
      description,
      cash_in:          item.amount,
      cash_out:         0,
      amount:           item.amount,
      source:           KASIR_SALES_SOURCE,
      source_id:        null,
      import_key:       item.importKey,
      source_label:     KASIR_SOURCE_LABEL,
      source_metadata:  {
        transaction_id:  item.transactionId,
        branch_name:     item.branchName,
        payment_method:  item.paymentMethod,
        payment_category:item.paymentCategory,
        cashier:         item.cashier,
        time_wita:       item.timeWITA,
        datetime_raw:    item.datetimeRaw,
        import_date:     new Date().toISOString(),
      },
      status:     'active' as const,
      created_by: params.userId,
      updated_by: params.userId,
    }

    const { data: inserted, error } = await supabase
      .from('cashflow_transactions')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      if (error.message.toLowerCase().includes('unique') || error.message.toLowerCase().includes('duplicate')) {
        continue
      }
      totalFailed++
      errors.push(`Gagal import penjualan ${item.transactionId}: ${error.message}`)
      continue
    }

    totalSuccess++
    totalAmount += item.amount

    if (inserted) {
      try {
        await supabase.from('audit_logs').insert({
          table_name: 'cashflow_transactions',
          record_id:  inserted.id,
          action:     'kasir_sales_imported',
          old_data:   null,
          new_data:   payload as unknown as Record<string, unknown>,
          changed_by: params.userId,
          changed_at: new Date().toISOString(),
        })
      } catch { /* audit log bersifat non-blocking */ }
    }
  }

  const totalSkipped =
    preview.items.filter((i) => i.status === 'duplicate' || i.status === 'skipped_payment' || i.status === 'branch_not_found').length

  const message = buildImportMessage({ totalSuccess, totalFailed, totalSkipped, totalAmount, type: 'penjualan' })

  await writeKasirImportLog(supabase, {
    importType:          'sales',
    periodStart:         params.startDate,
    periodEnd:           params.endDate,
    branchFilter:        params.branchId,
    paymentMethodFilter: params.paymentMethod,
    totalFound:          preview.items.length,
    totalSuccess,
    totalFailed,
    totalSkipped,
    totalAmount,
    status:              totalFailed > 0 && totalSuccess === 0 ? 'failed' : totalFailed > 0 ? 'partial' : 'success',
    message,
    userId:              params.userId,
  })

  return {
    success:      totalFailed === 0 || totalSuccess > 0,
    totalFound:   preview.items.length,
    totalSuccess,
    totalFailed,
    totalSkipped,
    totalAmount,
    message,
    errors,
  }
}

// =============================================
// EXPENSES PREVIEW
// =============================================

export interface ExpensesPreviewParams {
  startDate: string
  endDate: string
  branchId?: string
}

export async function getExpensesPreview(
  supabase: Supabase,
  params: ExpensesPreviewParams
): Promise<KasirExpensePreviewPayload> {
  validateDateRange(params.startDate, params.endDate)

  const [rawData, branches, categories] = await Promise.all([
    callKasirRpc('get_kas_keluar_integration', {
      p_date_from: params.startDate,
      p_date_to:   params.endDate,
    }),
    loadLocalBranches(supabase),
    loadLocalCategories(supabase),
  ])

  if (rawData.length === 0) {
    throw new KasirImportError(
      'Tidak ada data kas keluar pada rentang tanggal ini.',
      404,
      'empty_data'
    )
  }

  const normalized = rawData
    .filter(isRecord)
    .map((r) => normalizeRawExpenseRecord(r as AnyRecord))
    .filter((item): item is NonNullable<typeof item> => item !== null)

  if (normalized.length === 0) {
    throw new KasirImportError(
      'Format data kas keluar dari sistem kasir tidak dikenali.',
      502,
      'invalid_format'
    )
  }

  // PHP sudah filter is_void=0, tapi kita tetap cek di sini untuk keamanan
  const nonVoid  = normalized.filter((item) => !item.isVoid)
  const voidCount = normalized.length - nonVoid.length

  const branchFiltered = params.branchId
    ? nonVoid.filter((item) => matchBranch(item.branchName, branches)?.id === params.branchId)
    : nonVoid

  if (branchFiltered.length === 0 && nonVoid.length > 0) {
    throw new KasirImportError(
      'Tidak ada data kas keluar untuk cabang yang dipilih.',
      404,
      'empty_data'
    )
  }

  const importKeys   = branchFiltered.map((item) => makeExpenseImportKey(item.branchName, item.expenseId))
  const existingKeys = await loadExistingImportKeys(supabase, importKeys)

  const items: KasirExpensePreviewItem[] = branchFiltered.map((item) => {
    const importKey       = makeExpenseImportKey(item.branchName, item.expenseId)
    const matchedBranch   = matchBranch(item.branchName, branches)
    const localCategoryId = matchCategory(item.category || item.expenseName, categories, 'cash_out')
    const isDuplicate     = existingKeys.has(importKey)

    let status: KasirExpensePreviewItem['status']
    if (!matchedBranch) {
      status = 'branch_not_found'
    } else if (isDuplicate) {
      status = 'duplicate'
    } else {
      status = 'new'
    }

    const defaultMapping: KasirExpenseMappingConfig = {
      mode: 'original',
      targets: matchedBranch
        ? [{ branchId: matchedBranch.id, branchName: matchedBranch.name, amount: item.amount }]
        : [],
    }

    return {
      importKey,
      expenseId:     item.expenseId,
      dateWITA:      item.dateWITA,
      timeWITA:      item.timeWITA,
      datetimeRaw:   item.datetimeRaw,
      branchName:    item.branchName,
      branchId:      matchedBranch?.id ?? null,
      expenseName:   item.expenseName,
      category:      item.category,
      localCategoryId,
      amount:        item.amount,
      notes:         item.notes,
      recordedBy:    item.recordedBy,
      isVoid:        item.isVoid,
      status,
      statusLabel:   STATUS_LABELS[status],
      mapping:       defaultMapping,
    }
  })

  const summary = buildExpensesSummary(items, voidCount)
  return { items, summary }
}

// =============================================
// EXPENSES IMPORT (save)
// =============================================

export interface ExpensesImportParams extends ExpensesPreviewParams {
  userId: string | null
  mappings?: Record<string, KasirExpenseMappingConfig>
}

export async function importExpenses(
  supabase: Supabase,
  params: ExpensesImportParams
): Promise<KasirImportResult> {
  const preview  = await getExpensesPreview(supabase, params)
  const newItems = preview.items.filter((item) => item.status === 'new')

  if (newItems.length === 0) {
    return {
      success:      true,
      totalFound:   preview.items.length,
      totalSuccess: 0,
      totalFailed:  0,
      totalSkipped: preview.items.filter((i) => i.status !== 'new').length,
      totalAmount:  0,
      message:      'Tidak ada data kas keluar baru untuk diimport.',
      errors:       [],
    }
  }

  let totalSuccess = 0
  let totalFailed  = 0
  let totalAmount  = 0
  const errors: string[] = []

  for (const item of newItems) {
    const mapping: KasirExpenseMappingConfig =
      params.mappings?.[item.expenseId] ?? item.mapping

    if (mapping.mode !== 'original' || mapping.targets.length === 0) {
      const validationError = validateMappingTargets(mapping.targets, item.amount)
      if (validationError) {
        totalFailed++
        errors.push(`Mapping ${item.expenseName} (${item.expenseId}): ${validationError}`)
        continue
      }
    }

    const targets: MappingTarget[] = mapping.targets.length > 0
      ? mapping.targets
      : item.branchId
        ? [{ branchId: item.branchId, branchName: item.branchName, amount: item.amount }]
        : []

    if (targets.length === 0) {
      totalFailed++
      errors.push(`Cabang tidak ditemukan untuk kas keluar: ${item.expenseName}`)
      continue
    }

    const groupId = targets.length > 1 ? uuidv4() : null

    if (targets.length > 1) {
      const sumTargets = targets.reduce((s, t) => s + t.amount, 0)
      if (Math.abs(sumTargets - item.amount) > 1) {
        totalFailed++
        errors.push(`Total split ${item.expenseName} (${sumTargets}) tidak sama dengan nominal asli (${item.amount})`)
        continue
      }
    }

    let partialFailed = false

    for (const target of targets) {
      const isplit    = targets.length > 1
      const importKey = isplit
        ? `${makeExpenseImportKey(target.branchName, item.expenseId)}:split:${target.branchId}`
        : makeExpenseImportKey(item.branchName, item.expenseId)

      const description = isplit
        ? `${item.expenseName} - ${target.branchName} (dibagi) - ${item.dateWITA}`
        : `${item.expenseName} - ${item.branchName} - ${item.dateWITA}`

      const payload = {
        transaction_date: item.dateWITA,
        branch_id:        target.branchId,
        transaction_type: 'cash_out' as const,
        category_id:      item.localCategoryId,
        description,
        cash_in:          0,
        cash_out:         target.amount,
        amount:           target.amount,
        source:           KASIR_EXPENSES_SOURCE,
        source_id:        null,
        import_key:       importKey,
        source_label:     KASIR_SOURCE_LABEL,
        source_metadata:  {
          expense_id:      item.expenseId,
          original_branch: item.branchName,
          original_amount: item.amount,
          expense_name:    item.expenseName,
          category:        item.category,
          notes:           item.notes,
          recorded_by:     item.recordedBy,
          time_wita:       item.timeWITA,
          datetime_raw:    item.datetimeRaw,
          mapping_mode:    mapping.mode,
          is_split:        isplit,
          split_count:     targets.length,
          import_date:     new Date().toISOString(),
        },
        reference_group_id: groupId,
        status:     'active' as const,
        created_by: params.userId,
        updated_by: params.userId,
      }

      const { data: inserted, error } = await supabase
        .from('cashflow_transactions')
        .insert(payload)
        .select('id')
        .single()

      if (error) {
        if (error.message.toLowerCase().includes('unique') || error.message.toLowerCase().includes('duplicate')) {
          continue
        }
        partialFailed = true
        errors.push(`Gagal simpan ${item.expenseName} → ${target.branchName}: ${error.message}`)
        continue
      }

      totalAmount += target.amount

      if (inserted) {
        try {
          await supabase.from('audit_logs').insert({
            table_name: 'cashflow_transactions',
            record_id:  inserted.id,
            action:     'kasir_expenses_imported',
            old_data:   null,
            new_data:   payload as unknown as Record<string, unknown>,
            changed_by: params.userId,
            changed_at: new Date().toISOString(),
          })
        } catch { /* audit log bersifat non-blocking */ }
      }
    }

    if (partialFailed) {
      totalFailed++
    } else {
      totalSuccess++
    }
  }

  const totalSkipped = preview.items.filter(
    (i) => i.status === 'duplicate' || i.status === 'void_skipped' || i.status === 'branch_not_found'
  ).length

  const message = buildImportMessage({ totalSuccess, totalFailed, totalSkipped, totalAmount, type: 'kas keluar' })

  await writeKasirImportLog(supabase, {
    importType:   'expenses',
    periodStart:  params.startDate,
    periodEnd:    params.endDate,
    branchFilter: params.branchId,
    totalFound:   preview.items.length,
    totalSuccess,
    totalFailed,
    totalSkipped,
    totalAmount,
    status:       totalFailed > 0 && totalSuccess === 0 ? 'failed' : totalFailed > 0 ? 'partial' : 'success',
    message,
    userId:       params.userId,
  })

  return {
    success:      totalFailed === 0 || totalSuccess > 0,
    totalFound:   preview.items.length,
    totalSuccess,
    totalFailed,
    totalSkipped,
    totalAmount,
    message,
    errors,
  }
}

// =============================================
// COMBINED IMPORT (penjualan + kas keluar sekaligus)
// =============================================

export interface CombinedImportParams {
  startDate: string
  endDate: string
  branchId?: string
  userId: string | null
}

function makeEmptyResult(message: string): KasirImportResult {
  return {
    success:      true,
    totalFound:   0,
    totalSuccess: 0,
    totalFailed:  0,
    totalSkipped: 0,
    totalAmount:  0,
    message,
    errors:       [],
  }
}

function makeFailedResult(err: unknown, fallbackMessage: string): KasirImportResult {
  // Jika tidak ada data (periode kosong), anggap sukses dengan 0 item
  if (err instanceof KasirImportError && err.code === 'empty_data') {
    return makeEmptyResult('Tidak ada data pada periode ini.')
  }
  const message = err instanceof KasirImportError ? err.message : fallbackMessage
  return {
    success:      false,
    totalFound:   0,
    totalSuccess: 0,
    totalFailed:  0,
    totalSkipped: 0,
    totalAmount:  0,
    message,
    errors:       [message],
  }
}

export async function importCombined(
  supabase: Supabase,
  params: CombinedImportParams
): Promise<CombinedImportResult> {
  validateDateRange(params.startDate, params.endDate)

  // Step 1: Ambil preview paralel untuk build detail display
  let salesByBranch:    SaleBranchDetail[]                                       = []
  let expenseItems:     ExpenseItemDetail[]                                       = []
  let expensesByBranch: Array<{ branchName: string; total: number; count: number }> = []

  const [salesPreviewResult, expensesPreviewResult] = await Promise.allSettled([
    getSalesPreview(supabase, {
      startDate:     params.startDate,
      endDate:       params.endDate,
      branchId:      params.branchId,
      paymentMethod: 'Tunai+QRIS',
    }),
    getExpensesPreview(supabase, {
      startDate: params.startDate,
      endDate:   params.endDate,
      branchId:  params.branchId,
    }),
  ])

  if (salesPreviewResult.status === 'fulfilled') {
    const newItems = salesPreviewResult.value.items.filter((i) => i.status === 'new')
    const bMap = new Map<string, SaleBranchDetail>()
    for (const item of newItems) {
      const b = bMap.get(item.branchName) || { branchName: item.branchName, totalCash: 0, totalQris: 0, total: 0 }
      if (item.paymentCategory === 'Tunai') b.totalCash += item.amount
      if (item.paymentCategory === 'QRIS')  b.totalQris += item.amount
      b.total += item.amount
      bMap.set(item.branchName, b)
    }
    salesByBranch = Array.from(bMap.values()).sort((a, b) => b.total - a.total)
  }

  if (expensesPreviewResult.status === 'fulfilled') {
    const newItems = expensesPreviewResult.value.items.filter((i) => i.status === 'new')
    expenseItems = newItems
      .map((item) => ({
        expenseName: item.expenseName,
        branchName:  item.branchName,
        category:    item.category,
        amount:      item.amount,
        dateWITA:    item.dateWITA,
        recordedBy:  item.recordedBy,
      }))
      .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.dateWITA.localeCompare(b.dateWITA))

    const bMap = new Map<string, { total: number; count: number }>()
    for (const item of newItems) {
      const b = bMap.get(item.branchName) || { total: 0, count: 0 }
      b.total += item.amount
      b.count += 1
      bMap.set(item.branchName, b)
    }
    expensesByBranch = Array.from(bMap.entries())
      .map(([branchName, v]) => ({ branchName, ...v }))
      .sort((a, b) => b.total - a.total)
  }

  // Step 2: Import penjualan dulu, lalu kas keluar (sequential)
  let salesResult: KasirImportResult
  let expensesResult: KasirImportResult

  try {
    salesResult = await importSales(supabase, {
      startDate:     params.startDate,
      endDate:       params.endDate,
      branchId:      params.branchId,
      paymentMethod: 'Tunai+QRIS',
      userId:        params.userId,
    })
  } catch (err) {
    salesResult = makeFailedResult(err, 'Gagal mengimport data penjualan dari sistem kasir.')
  }

  try {
    expensesResult = await importExpenses(supabase, {
      startDate: params.startDate,
      endDate:   params.endDate,
      branchId:  params.branchId,
      userId:    params.userId,
      mappings:  undefined,
    })
  } catch (err) {
    expensesResult = makeFailedResult(err, 'Gagal mengimport data kas keluar dari sistem kasir.')
  }

  const overallSuccess = salesResult.success || expensesResult.success
  const message        = buildCombinedMessage(salesResult, expensesResult)

  return {
    success:  overallSuccess,
    sales:    salesResult,
    expenses: expensesResult,
    message,
    salesByBranch,
    expenseItems,
    expensesByBranch,
  }
}

function buildCombinedMessage(sales: KasirImportResult, expenses: KasirImportResult): string {
  const parts: string[] = []

  if (sales.totalSuccess > 0) {
    parts.push(`${sales.totalSuccess} penjualan berhasil diimport (${formatRupiahSimple(sales.totalAmount)})`)
  } else if (!sales.success && sales.errors.length > 0) {
    parts.push(`Penjualan gagal: ${sales.message}`)
  } else if (sales.totalFound === 0) {
    parts.push('Tidak ada penjualan baru')
  } else {
    parts.push('Semua penjualan sudah pernah diimport')
  }

  if (expenses.totalSuccess > 0) {
    parts.push(`${expenses.totalSuccess} kas keluar berhasil diimport (${formatRupiahSimple(expenses.totalAmount)})`)
  } else if (!expenses.success && expenses.errors.length > 0) {
    parts.push(`Kas keluar gagal: ${expenses.message}`)
  } else if (expenses.totalFound === 0) {
    parts.push('Tidak ada kas keluar baru')
  } else {
    parts.push('Semua kas keluar sudah pernah diimport')
  }

  return parts.join('. ') + '.'
}

function formatRupiahSimple(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)
}

// =============================================
// Log writer
// =============================================

interface LogEntry {
  importType:          'sales' | 'expenses'
  periodStart:         string
  periodEnd:           string
  branchFilter?:       string
  paymentMethodFilter?: string
  totalFound:          number
  totalSuccess:        number
  totalFailed:         number
  totalSkipped:        number
  totalAmount:         number
  status:              'success' | 'failed' | 'partial'
  message:             string
  userId:              string | null
}

export async function writeKasirImportLog(supabase: Supabase, entry: LogEntry) {
  try {
    await supabase.from('kasir_import_logs').insert({
      import_type:           entry.importType,
      period_start:          entry.periodStart,
      period_end:            entry.periodEnd,
      branch_filter:         entry.branchFilter || null,
      payment_method_filter: entry.paymentMethodFilter || null,
      total_found:           entry.totalFound,
      total_success:         entry.totalSuccess,
      total_failed:          entry.totalFailed,
      total_skipped:         entry.totalSkipped,
      total_amount:          entry.totalAmount,
      status:                entry.status,
      message:               entry.message,
      created_by:            entry.userId,
      imported_at:           new Date().toISOString(),
    })
  } catch { /* log bersifat non-blocking */ }
}

// =============================================
// Raw record normalizers
// =============================================

interface NormalizedSale {
  transactionId:   string
  dateWITA:        string
  timeWITA:        string
  datetimeRaw:     string
  branchName:      string
  paymentMethod:   string
  paymentCategory: 'Tunai' | 'QRIS' | null
  amount:          number
  cashier:         string
}

function normalizeRawSaleRecord(r: AnyRecord): NormalizedSale | null {
  const transactionId = getString(
    r, 'id', 'transaction_id', 'id_transaksi', 'order_id', 'receipt_id', 'no_transaksi'
  )
  if (!transactionId) return null

  const { dateWITA, timeWITA, datetimeRaw } = getDatetime(r)
  if (!dateWITA) return null

  const branchName = getString(
    r, 'branch_name', 'nama_outlet', 'outlet_name', 'nama_cabang', 'cabang', 'outlet', 'branch', 'store_name'
  )
  if (!branchName) return null

  const paymentMethod   = getString(r, 'payment_method', 'metode_pembayaran', 'payment', 'method', 'jenis_pembayaran', 'cara_bayar')
  const paymentCategory = normalizePaymentMethod(paymentMethod)

  const amount = getNumber(r, 'amount', 'total', 'nominal', 'total_amount', 'grand_total', 'harga', 'nilai', 'jumlah', 'total_penjualan')
  if (amount <= 0) return null

  const cashier = getString(r, 'cashier', 'kasir', 'cashier_name', 'nama_kasir', 'operator', 'staff', 'karyawan')

  return {
    transactionId,
    dateWITA,
    timeWITA,
    datetimeRaw,
    branchName,
    paymentMethod,
    paymentCategory,
    amount,
    cashier: cashier || 'Tidak Diketahui',
  }
}

interface NormalizedExpense {
  expenseId:   string
  dateWITA:    string
  timeWITA:    string
  datetimeRaw: string
  branchName:  string
  expenseName: string
  category:    string
  amount:      number
  notes:       string
  recordedBy:  string
  isVoid:      boolean
}

function normalizeRawExpenseRecord(r: AnyRecord): NormalizedExpense | null {
  const expenseId = getString(
    r, 'id', 'expense_id', 'id_kas_keluar', 'kas_keluar_id', 'pengeluaran_id', 'id_pengeluaran'
  )
  if (!expenseId) return null

  const { dateWITA, timeWITA, datetimeRaw } = getDatetime(r)
  if (!dateWITA) return null

  const branchName = getString(
    r, 'branch_name', 'nama_outlet', 'outlet_name', 'nama_cabang', 'cabang', 'outlet', 'branch'
  )
  if (!branchName) return null

  const expenseName = getString(
    r, 'name', 'nama', 'expense_name', 'nama_pengeluaran', 'keterangan', 'description', 'uraian'
  )

  const category = getString(
    r, 'category', 'kategori', 'category_name', 'nama_kategori', 'jenis'
  ) || expenseName

  const amount = getNumber(r, 'amount', 'nominal', 'total', 'jumlah', 'nilai', 'harga')
  if (amount <= 0) return null

  const notes      = getString(r, 'notes', 'catatan', 'keterangan', 'note', 'remark')
  const recordedBy = getString(r, 'recorded_by', 'dicatat_oleh', 'user', 'admin', 'operator', 'staff', 'kasir')

  const isVoid =
    getBoolean(r, 'is_void', 'void', 'is_deleted', 'deleted', 'cancelled') ||
    getString(r, 'status').toLowerCase() === 'void' ||
    getString(r, 'status').toLowerCase() === 'cancelled'

  return {
    expenseId,
    dateWITA,
    timeWITA,
    datetimeRaw,
    branchName,
    expenseName: expenseName || 'Pengeluaran',
    category:    category    || 'Lainnya',
    amount,
    notes:       notes      || '',
    recordedBy:  recordedBy || 'Tidak Diketahui',
    isVoid,
  }
}

// =============================================
// Filter & summary builders
// =============================================

function filterByPaymentMethod(items: NormalizedSale[], filter: PaymentMethodFilter): NormalizedSale[] {
  return items.filter((item) => {
    if (item.paymentCategory === null) return false
    if (filter === 'Tunai') return item.paymentCategory === 'Tunai'
    if (filter === 'QRIS')  return item.paymentCategory === 'QRIS'
    return item.paymentCategory === 'Tunai' || item.paymentCategory === 'QRIS'
  })
}

function buildSalesSummary(items: KasirSalePreviewItem[], _filter: PaymentMethodFilter): KasirSalePreviewSummary {
  const totalNew           = items.filter((i) => i.status === 'new').length
  const totalDuplicate     = items.filter((i) => i.status === 'duplicate').length
  const totalSkipped       = items.filter((i) => i.status === 'skipped_payment').length
  const totalBranchNotFound = items.filter((i) => i.status === 'branch_not_found').length

  const newItems   = items.filter((i) => i.status === 'new')
  const totalCash  = newItems.filter((i) => i.paymentCategory === 'Tunai').reduce((s, i) => s + i.amount, 0)
  const totalQris  = newItems.filter((i) => i.paymentCategory === 'QRIS').reduce((s, i) => s + i.amount, 0)
  const totalAmount = totalCash + totalQris

  const branchMap = new Map<string, { totalCash: number; totalQris: number; total: number }>()
  for (const item of newItems) {
    const existing = branchMap.get(item.branchName) || { totalCash: 0, totalQris: 0, total: 0 }
    if (item.paymentCategory === 'Tunai') existing.totalCash += item.amount
    if (item.paymentCategory === 'QRIS')  existing.totalQris += item.amount
    existing.total += item.amount
    branchMap.set(item.branchName, existing)
  }
  const byBranch = Array.from(branchMap.entries())
    .map(([branchName, vals]) => ({ branchName, ...vals }))
    .sort((a, b) => b.total - a.total)

  const dateMap = new Map<string, { total: number; count: number }>()
  for (const item of newItems) {
    const existing = dateMap.get(item.dateWITA) || { total: 0, count: 0 }
    existing.total += item.amount
    existing.count += 1
    dateMap.set(item.dateWITA, existing)
  }
  const byDate = Array.from(dateMap.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalFound: items.length,
    totalNew,
    totalDuplicate,
    totalSkipped,
    totalBranchNotFound,
    totalCash,
    totalQris,
    totalAmount,
    byBranch,
    byDate,
  }
}

function buildExpensesSummary(items: KasirExpensePreviewItem[], voidSkipped: number): KasirExpensePreviewSummary {
  const totalNew            = items.filter((i) => i.status === 'new').length
  const totalDuplicate      = items.filter((i) => i.status === 'duplicate').length
  const totalBranchNotFound = items.filter((i) => i.status === 'branch_not_found').length

  const newItems    = items.filter((i) => i.status === 'new')
  const totalAmount = newItems.reduce((s, i) => s + i.amount, 0)

  const branchMap = new Map<string, { total: number; count: number }>()
  for (const item of newItems) {
    const existing = branchMap.get(item.branchName) || { total: 0, count: 0 }
    existing.total += item.amount
    existing.count += 1
    branchMap.set(item.branchName, existing)
  }
  const byBranch = Array.from(branchMap.entries())
    .map(([branchName, vals]) => ({ branchName, ...vals }))
    .sort((a, b) => b.total - a.total)

  const dateMap = new Map<string, { total: number; count: number }>()
  for (const item of newItems) {
    const existing = dateMap.get(item.dateWITA) || { total: 0, count: 0 }
    existing.total += item.amount
    existing.count += 1
    dateMap.set(item.dateWITA, existing)
  }
  const byDate = Array.from(dateMap.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalFound: items.length,
    totalNew,
    totalDuplicate,
    totalVoidSkipped: voidSkipped,
    totalBranchNotFound,
    totalAmount,
    byBranch,
    byDate,
  }
}

// =============================================
// Helpers
// =============================================

export function validateDateRange(startDate: string, endDate: string): void {
  if (!startDate) throw new KasirImportError('Tanggal mulai wajib diisi.', 400, 'invalid_date')
  if (!endDate)   throw new KasirImportError('Tanggal akhir wajib diisi.', 400, 'invalid_date')
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new KasirImportError('Format tanggal harus YYYY-MM-DD.', 400, 'invalid_date')
  }
  if (endDate < startDate) {
    throw new KasirImportError('Tanggal akhir tidak boleh sebelum tanggal mulai.', 400, 'invalid_date')
  }
}

function buildImportMessage(opts: {
  totalSuccess: number
  totalFailed:  number
  totalSkipped: number
  totalAmount:  number
  type:         string
}) {
  const parts: string[] = []
  if (opts.totalSuccess > 0) parts.push(`${opts.totalSuccess} ${opts.type} berhasil diimport`)
  if (opts.totalFailed  > 0) parts.push(`${opts.totalFailed} gagal`)
  if (opts.totalSkipped > 0) parts.push(`${opts.totalSkipped} dilewati`)
  if (opts.totalAmount  > 0) {
    const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(opts.totalAmount)
    parts.push(`total ${formatted}`)
  }
  return parts.length > 0 ? parts.join(', ') + '.' : `Tidak ada data ${opts.type} baru.`
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPayloadMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const msg = payload.message ?? payload.error ?? payload.detail
  return typeof msg === 'string' ? msg : null
}
