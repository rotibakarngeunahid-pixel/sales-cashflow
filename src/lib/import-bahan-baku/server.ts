import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  IMPORT_BAHAN_BAKU_SOURCE,
  IMPORT_BAHAN_BAKU_SOURCE_LABEL,
  type ImportBahanBakuItem,
  type ImportBahanBakuPayload,
  type ImportBahanBakuSummary,
  type ImportBahanBakuDecision,
  type SaveImportBahanBakuResult,
} from './shared'

type Supabase = SupabaseClient<Database>
type JsonRecord = Record<string, unknown>

interface ImportParams {
  startDate: string
  endDate: string
  branchId?: string
}

interface LocalBranch {
  id: string
  name: string
}

interface PoMapping {
  po_name: string
  branch_id: string
}

interface NormalizedExternalItem {
  periodStart: string
  periodEnd: string
  transactionDate: string
  periodLabel: string
  branchName: string
  totalAmount: number
  transactionCount: number | null
}

interface ExistingImportRow {
  id: string
  import_key: string | null
  amount: number
  cash_out: number
  status: string
}

export class ImportBahanBakuError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'import_error') {
    super(message)
    this.name = 'ImportBahanBakuError'
    this.status = status
    this.code = code
  }
}

const DEFAULT_FINANCE_PORTAL_URL = 'https://purchase-order-system-iota.vercel.app/api/finance-portal/data'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const BRANCH_KEYS = [
  'cabang',
  'outlet',
  'branch',
  'branch_name',
  'nama_cabang',
  'nama_outlet',
  'store',
  'store_name',
]

const AMOUNT_KEYS = [
  'total_pengeluaran_bahan_baku',
  'total_bahan_baku',
  'pengeluaran_bahan_baku',
  'total_pengeluaran',
  'total_pembelian_bahan_baku',
  'total_pembelian',
  'total_belanja',
  'total_nominal',
  'grand_total',
  'subtotal',
  'nominal',
  'amount',
  'jumlah',
  'total',
]

const COUNT_KEYS = [
  'jumlah_transaksi',
  'jumlah_order',
  'total_transaksi',
  'total_order',
  'transaction_count',
  'order_count',
  'count',
]

const DATE_KEYS = ['tanggal', 'date', 'transaction_date', 'report_date', 'created_date']
const START_DATE_KEYS = ['tanggal_mulai', 'period_start', 'start_date', 'from_date']
const END_DATE_KEYS = ['tanggal_akhir', 'period_end', 'end_date', 'to_date']

const KNOWN_ARRAY_KEYS = [
  'rows',
  'items',
  'data',
  'result',
  'results',
  'pengeluaran',
  'pengeluaran_bahan_baku',
  'bahan_baku',
  'raw_material_expenses',
  'ringkasan',
  'ringkasan_cabang',
  'ringkasan_per_cabang',
  'per_cabang',
  'by_branch',
  'branches',
  'cabangs',
  'outlets',
  'orders',
  'transactions',
  'transaksi',
]

const IGNORED_PATH_PARTS = ['supplier', 'suppliers', 'vendor', 'vendors', 'produk', 'products']

export function validateImportDateRange(startDate: string | null, endDate: string | null): { startDate: string; endDate: string } {
  if (!startDate) {
    throw new ImportBahanBakuError('Tanggal mulai wajib diisi.', 400, 'invalid_date')
  }

  if (!endDate) {
    throw new ImportBahanBakuError('Tanggal akhir wajib diisi.', 400, 'invalid_date')
  }

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new ImportBahanBakuError('Format tanggal harus YYYY-MM-DD.', 400, 'invalid_date')
  }

  if (endDate < startDate) {
    throw new ImportBahanBakuError('Tanggal akhir tidak boleh lebih kecil dari tanggal mulai.', 400, 'invalid_date')
  }

  return { startDate, endDate }
}

export async function getImportBahanBakuPreview(
  supabase: Supabase,
  params: ImportParams
): Promise<ImportBahanBakuPayload> {
  const branches = await loadBranches(supabase)
  const selectedBranch = params.branchId
    ? branches.find((branch) => branch.id === params.branchId) ?? null
    : null

  const payload = await fetchFinancePortalData(params)
  const normalized = normalizeFinancePortalResponse(payload, {
    startDate: params.startDate,
    endDate: params.endDate,
    fallbackBranchName: selectedBranch?.name ?? null,
  })

  if (normalized.length === 0) {
    throw new ImportBahanBakuError('Belum ada pengeluaran bahan baku pada periode ini.', 404, 'empty_data')
  }

  const poMappings = await loadPoMappings(supabase)
  const branchByName = new Map(branches.map((branch) => [normalizeName(branch.name), branch]))
  const branchByPoName = new Map<string, LocalBranch>()
  for (const mapping of poMappings) {
    const branch = branches.find((b) => b.id === mapping.branch_id)
    if (branch) branchByPoName.set(normalizeName(mapping.po_name), branch)
  }

  const itemsWithBranch = normalized
    .map((item) => {
      const key = normalizeName(item.branchName)
      const branch = branchByName.get(key) ?? branchByPoName.get(key) ?? null
      return { item, branch }
    })
    .filter(({ branch }) => !params.branchId || branch?.id === params.branchId)

  if (itemsWithBranch.length === 0) {
    throw new ImportBahanBakuError('Belum ada pengeluaran bahan baku pada periode ini.', 404, 'empty_data')
  }

  const importKeys = itemsWithBranch.map(({ item, branch }) => makeImportKey(item, branch?.name ?? item.branchName))
  const existingByKey = await loadExistingImports(supabase, importKeys)

  const items: ImportBahanBakuItem[] = itemsWithBranch.map(({ item, branch }) => {
    const importKey = makeImportKey(item, branch?.name ?? item.branchName)
    const existing = existingByKey.get(importKey) ?? null
    const existingAmount = existing ? Number(existing.cash_out || existing.amount || 0) : null
    const roundedExisting = existingAmount === null ? null : Math.round(existingAmount)
    const roundedIncoming = Math.round(item.totalAmount)

    if (!branch) {
      return buildPreviewItem(item, importKey, null, 'branch_not_found', null, existingAmount)
    }

    if (!existing) {
      return buildPreviewItem(item, importKey, branch.id, 'new', null, null)
    }

    if (roundedExisting !== roundedIncoming) {
      return buildPreviewItem(item, importKey, branch.id, 'changed', existing.id, existingAmount)
    }

    return buildPreviewItem(item, importKey, branch.id, 'imported', existing.id, existingAmount)
  })

  const summary = buildSummary(items)
  return { items, summary }
}

export async function saveImportBahanBaku(
  supabase: Supabase,
  params: ImportParams,
  userId: string | null,
  decisions: Record<string, ImportBahanBakuDecision> = {}
): Promise<SaveImportBahanBakuResult> {
  const preview = await getImportBahanBakuPreview(supabase, params)
  const categoryId = await getRawMaterialCategoryId(supabase)
  let created = 0
  let updated = 0
  let skipped = 0
  let branchMissing = 0
  let totalAmount = 0
  const touchedBranches = new Set<string>()

  for (const item of preview.items) {
    if (!item.branchId) {
      branchMissing += 1
      continue
    }

    const basePayload = {
      transaction_date: item.transactionDate,
      branch_id: item.branchId,
      transaction_type: 'cash_out' as const,
      category_id: categoryId,
      description: `Import otomatis dari sistem pengeluaran bahan baku (${item.periodLabel})`,
      cash_in: 0,
      cash_out: item.totalAmount,
      amount: item.totalAmount,
      source: IMPORT_BAHAN_BAKU_SOURCE,
      source_id: null,
      import_key: item.importKey,
      source_label: IMPORT_BAHAN_BAKU_SOURCE_LABEL,
      source_metadata: {
        period_start: item.periodStart,
        period_end: item.periodEnd,
        period_label: item.periodLabel,
        branch_name: item.branchName,
        transaction_count: item.transactionCount,
      } as Record<string, unknown>,
      updated_by: userId,
    }

    if (item.status === 'new') {
      const { data: inserted, error } = await supabase
        .from('cashflow_transactions')
        .insert({ ...basePayload, status: 'active', created_by: userId })
        .select()
        .single()

      if (error) {
        if (isUniqueImportError(error.message)) {
          skipped += 1
          continue
        }
        throw new ImportBahanBakuError('Gagal menyimpan data ke laporan keuangan.', 500, 'save_failed')
      }

      created += 1
      totalAmount += item.totalAmount
      touchedBranches.add(item.branchId)

      if (inserted) {
        await supabase.from('audit_logs').insert({
          table_name: 'cashflow_transactions',
          record_id: inserted.id,
          action: 'cashflow_raw_material_imported',
          old_data: null,
          new_data: inserted as unknown as Record<string, unknown>,
          changed_by: userId,
          changed_at: new Date().toISOString(),
        })
      }
      continue
    }

    if (item.status === 'changed' && item.existingTransactionId && decisions[item.importKey] === 'update') {
      const { data: oldTx } = await supabase
        .from('cashflow_transactions')
        .select('*')
        .eq('id', item.existingTransactionId)
        .single()

      const { error } = await supabase
        .from('cashflow_transactions')
        .update(basePayload)
        .eq('id', item.existingTransactionId)

      if (error) {
        throw new ImportBahanBakuError('Gagal update transaksi lama.', 500, 'update_failed')
      }

      updated += 1
      totalAmount += item.totalAmount
      touchedBranches.add(item.branchId)

      await supabase.from('audit_logs').insert({
        table_name: 'cashflow_transactions',
        record_id: item.existingTransactionId,
        action: 'cashflow_raw_material_updated',
        old_data: oldTx as unknown as Record<string, unknown>,
        new_data: basePayload as unknown as Record<string, unknown>,
        changed_by: userId,
        changed_at: new Date().toISOString(),
      })
      continue
    }

    skipped += 1
  }

  const message = buildSaveMessage({ created, updated, skipped, branchMissing })
  await writeImportLog(supabase, params, userId, {
    status: 'success',
    branchCount: touchedBranches.size,
    totalAmount,
    message,
  })

  return {
    created,
    updated,
    skipped,
    branchMissing,
    totalAmount,
    message,
  }
}

export async function writeImportLog(
  supabase: Supabase,
  params: ImportParams,
  userId: string | null,
  entry: {
    status: 'success' | 'failed'
    branchCount: number
    totalAmount: number
    message: string
  }
) {
  await supabase.from('raw_material_import_logs').insert({
    period_start: params.startDate,
    period_end: params.endDate,
    branch_count: entry.branchCount,
    total_amount: entry.totalAmount,
    status: entry.status,
    message: entry.message,
    created_by: userId,
    imported_at: new Date().toISOString(),
  })
}

async function loadBranches(supabase: Supabase): Promise<LocalBranch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id,name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')

  if (error) {
    throw new ImportBahanBakuError('Gagal membaca data cabang.', 500, 'branch_load_failed')
  }

  return data || []
}

async function loadPoMappings(supabase: Supabase): Promise<PoMapping[]> {
  const { data } = await supabase
    .from('po_branch_mappings')
    .select('po_name,branch_id')

  return data || []
}

async function loadExistingImports(supabase: Supabase, importKeys: string[]) {
  if (importKeys.length === 0) return new Map<string, ExistingImportRow>()

  const { data, error } = await supabase
    .from('cashflow_transactions')
    .select('id,import_key,amount,cash_out,status')
    .in('import_key', importKeys)

  if (error) {
    throw new ImportBahanBakuError('Gagal membaca status import lama.', 500, 'existing_load_failed')
  }

  return new Map((data || []).map((row) => [row.import_key || '', row as ExistingImportRow]))
}

async function getRawMaterialCategoryId(supabase: Supabase): Promise<string> {
  const { data, error } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw new ImportBahanBakuError('Gagal membaca kategori bahan baku.', 500, 'category_load_failed')
  }

  const categories = data || []
  const category = categories.find((item) => normalizeName(item.name) === 'bahan-baku')
    ?? categories.find((item) => normalizeName(item.name) === 'pembelian-bahan-baku')

  if (category) return category.id

  const { data: inserted, error: insertError } = await supabase
    .from('cashflow_categories')
    .insert({
      name: 'Bahan Baku',
      default_type: 'cash_out',
      description: 'Pengeluaran bahan baku dari import otomatis',
      is_active: true,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    throw new ImportBahanBakuError('Kategori Bahan Baku belum tersedia.', 500, 'category_missing')
  }

  return inserted.id
}

async function fetchFinancePortalData(params: ImportParams): Promise<unknown> {
  const apiKey = process.env.FINANCE_PORTAL_API_KEY
  const endpoint = process.env.FINANCE_PORTAL_API_URL || DEFAULT_FINANCE_PORTAL_URL

  if (!apiKey) {
    throw new ImportBahanBakuError('Kode akses integrasi belum dikonfigurasi.', 500, 'missing_api_key')
  }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new ImportBahanBakuError('Endpoint integrasi belum valid.', 500, 'invalid_endpoint')
  }

  url.searchParams.set('tanggal_mulai', params.startDate)
  url.searchParams.set('tanggal_akhir', params.endDate)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
      cache: 'no-store',
    })
  } catch {
    throw new ImportBahanBakuError(
      'Gagal terhubung ke sistem pengeluaran bahan baku. Coba beberapa saat lagi.',
      502,
      'endpoint_unreachable'
    )
  }

  const text = await response.text()
  const payload = parseJson(text)
  const message = getPayloadMessage(payload)

  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || isAccessError(message)) {
      throw new ImportBahanBakuError('Gagal menarik data. Kode akses integrasi tidak valid.', 401, 'invalid_api_key')
    }

    throw new ImportBahanBakuError(
      'Gagal terhubung ke sistem pengeluaran bahan baku. Coba beberapa saat lagi.',
      502,
      'endpoint_error'
    )
  }

  if (isRecord(payload) && payload.success === false) {
    if (isAccessError(message)) {
      throw new ImportBahanBakuError('Gagal menarik data. Kode akses integrasi tidak valid.', 401, 'invalid_api_key')
    }

    throw new ImportBahanBakuError(
      message || 'Gagal terhubung ke sistem pengeluaran bahan baku. Coba beberapa saat lagi.',
      502,
      'endpoint_error'
    )
  }

  return payload
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new ImportBahanBakuError(
      'Format data dari sistem bahan baku tidak sesuai. Silakan cek integrasi.',
      502,
      'invalid_json'
    )
  }
}

function normalizeFinancePortalResponse(
  payload: unknown,
  defaults: { startDate: string; endDate: string; fallbackBranchName: string | null }
): NormalizedExternalItem[] {
  const root = getDataRoot(payload)
  const records = findCandidateRecords(root)

  if (records.length === 0) {
    if (hasExplicitEmptyData(root)) return []

    throw new ImportBahanBakuError(
      'Format data dari sistem bahan baku tidak sesuai. Silakan cek integrasi.',
      502,
      'invalid_format'
    )
  }

  const rows = records
    .map((record) => normalizeRecord(record, defaults))
    .filter((item): item is NormalizedExternalItem => Boolean(item))

  if (rows.length === 0) {
    if (hasExplicitEmptyData(root)) return []

    throw new ImportBahanBakuError(
      'Format data dari sistem bahan baku tidak sesuai. Silakan cek integrasi.',
      502,
      'invalid_format'
    )
  }

  return aggregateItems(rows)
}

function normalizeRecord(
  record: JsonRecord,
  defaults: { startDate: string; endDate: string; fallbackBranchName: string | null }
): NormalizedExternalItem | null {
  const rowDate = toIsoDate(getValueByKeys(record, DATE_KEYS))
  const periodStart = toIsoDate(getValueByKeys(record, START_DATE_KEYS)) || rowDate || defaults.startDate
  const periodEnd = toIsoDate(getValueByKeys(record, END_DATE_KEYS)) || rowDate || defaults.endDate
  const transactionDate = rowDate || periodEnd
  const branchName = getBranchName(record) || defaults.fallbackBranchName || 'Semua Cabang'
  const totalAmount = getAmount(record)

  if (totalAmount <= 0) return null

  return {
    periodStart,
    periodEnd,
    transactionDate,
    periodLabel: periodStart === periodEnd ? periodStart : `${periodStart} - ${periodEnd}`,
    branchName,
    totalAmount,
    transactionCount: getTransactionCount(record),
  }
}

function aggregateItems(items: NormalizedExternalItem[]) {
  const map = new Map<string, NormalizedExternalItem>()

  items.forEach((item) => {
    const key = [
      item.periodStart,
      item.periodEnd,
      item.transactionDate,
      normalizeName(item.branchName),
    ].join('|')
    const existing = map.get(key)

    if (!existing) {
      map.set(key, { ...item })
      return
    }

    existing.totalAmount += item.totalAmount
    existing.transactionCount = (existing.transactionCount ?? 0) + (item.transactionCount ?? 1)
  })

  return Array.from(map.values()).sort((a, b) => (
    a.transactionDate.localeCompare(b.transactionDate) || a.branchName.localeCompare(b.branchName)
  ))
}

function findCandidateRecords(root: unknown): JsonRecord[] {
  if (Array.isArray(root)) {
    return root.filter(isRecord).filter(recordLooksLikeRow)
  }

  if (!isRecord(root)) return []

  const knownArrays = findKnownArrays(root)
  for (const item of knownArrays) {
    const records = item.filter(isRecord).filter(recordLooksLikeRow)
    if (records.length > 0) return records
  }

  if (recordLooksLikeRow(root)) {
    return [root]
  }

  return collectDeepRecords(root)
}

function findKnownArrays(record: JsonRecord): unknown[][] {
  const arrays: unknown[][] = []

  function walk(node: unknown, path: string[]) {
    if (Array.isArray(node)) {
      const key = path[path.length - 1]
      if (KNOWN_ARRAY_KEYS.includes(key) && !path.some((part) => IGNORED_PATH_PARTS.includes(part))) {
        arrays.push(node)
      }
      return
    }

    if (!isRecord(node)) return

    Object.entries(node).forEach(([key, value]) => walk(value, [...path, key.toLowerCase()]))
  }

  walk(record, [])
  return arrays
}

function collectDeepRecords(record: JsonRecord): JsonRecord[] {
  const records: JsonRecord[] = []

  function walk(node: unknown, path: string[]) {
    if (path.some((part) => IGNORED_PATH_PARTS.includes(part))) return

    if (Array.isArray(node)) {
      node.filter(isRecord).forEach((item) => {
        if (recordLooksLikeRow(item)) records.push(item)
        walk(item, path)
      })
      return
    }

    if (!isRecord(node)) return
    Object.entries(node).forEach(([key, value]) => walk(value, [...path, key.toLowerCase()]))
  }

  walk(record, [])
  return records
}

function recordLooksLikeRow(record: JsonRecord) {
  return Boolean(
    getBranchName(record)
    || getAmount(record) > 0
    || getTransactionCount(record) !== null
    || toIsoDate(getValueByKeys(record, DATE_KEYS))
  )
}

function getDataRoot(payload: unknown) {
  if (isRecord(payload) && 'data' in payload) {
    return payload.data
  }

  return payload
}

function hasExplicitEmptyData(root: unknown): boolean {
  if (Array.isArray(root)) return root.length === 0

  if (!isRecord(root)) return false

  if (getAmount(root) === 0 && Object.keys(root).some((key) => AMOUNT_KEYS.includes(key))) {
    return true
  }

  return Object.values(root).some((value) => Array.isArray(value) && value.length === 0)
}

function getBranchName(record: JsonRecord): string | null {
  const value = getValueByKeys(record, BRANCH_KEYS)

  if (typeof value === 'string' && value.trim()) return value.trim()

  if (isRecord(value)) {
    const nested = getValueByKeys(value, ['name', 'nama', 'label', 'title'])
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }

  return null
}

function getAmount(record: JsonRecord): number {
  for (const key of AMOUNT_KEYS) {
    const value = getCaseInsensitive(record, key)
    const amount = toNumber(value)
    if (amount > 0) return amount
  }

  return 0
}

function getTransactionCount(record: JsonRecord): number | null {
  for (const key of COUNT_KEYS) {
    const value = getCaseInsensitive(record, key)
    const count = Math.round(toNumber(value))
    if (count > 0) return count
  }

  const nestedOrders = getValueByKeys(record, ['orders', 'order', 'transactions', 'transaksi'])
  if (Array.isArray(nestedOrders)) return nestedOrders.length

  return null
}

function getValueByKeys(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = getCaseInsensitive(record, key)
    if (value !== undefined && value !== null && value !== '') return value
  }

  return null
}

function getCaseInsensitive(record: JsonRecord, key: string) {
  const direct = record[key]
  if (direct !== undefined) return direct

  const foundKey = Object.keys(record).find((item) => item.toLowerCase() === key.toLowerCase())
  return foundKey ? record[foundKey] : undefined
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0

  const raw = value.trim()
  if (!raw) return 0

  const cleaned = raw.replace(/[^0-9,.-]/g, '')
  if (!cleaned) return 0

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else if (lastDot > -1) {
    const afterDot = cleaned.slice(lastDot + 1)
    normalized = afterDot.length === 3 ? cleaned.replace(/\./g, '') : cleaned
  } else if (lastComma > -1) {
    const afterComma = cleaned.slice(lastComma + 1)
    normalized = afterComma.length === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.')
  }

  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
  }

  return null
}

function buildPreviewItem(
  item: NormalizedExternalItem,
  importKey: string,
  branchId: string | null,
  status: ImportBahanBakuItem['status'],
  existingTransactionId: string | null,
  existingAmount: number | null
): ImportBahanBakuItem {
  const statusLabel = {
    new: 'Belum disimpan',
    imported: 'Sudah pernah diimport',
    changed: 'Nominal berubah',
    branch_not_found: 'Cabang belum cocok',
  }[status]

  return {
    importKey,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    transactionDate: item.transactionDate,
    periodLabel: item.periodLabel,
    branchName: item.branchName,
    branchId,
    totalAmount: item.totalAmount,
    transactionCount: item.transactionCount,
    status,
    statusLabel,
    existingTransactionId,
    existingAmount,
    warning: status === 'changed'
      ? 'Data sudah pernah diimport, tetapi nominal dari sistem bahan baku berubah.'
      : status === 'branch_not_found'
        ? 'Nama cabang dari sistem bahan baku belum cocok dengan cabang di laporan keuangan.'
        : null,
  }
}

function buildSummary(items: ImportBahanBakuItem[]): ImportBahanBakuSummary {
  const branchCount = new Set(items.map((item) => item.branchName)).size
  const transactionCount = items.reduce((sum, item) => sum + (item.transactionCount ?? 0), 0)
  const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0)

  return {
    branchCount,
    transactionCount,
    totalAmount,
    totalAllBranches: totalAmount,
  }
}

function makeImportKey(item: NormalizedExternalItem, branchName: string) {
  const periodKey = item.periodStart === item.periodEnd
    ? item.periodStart
    : `${item.periodStart}_${item.periodEnd}`

  return `bahan-baku:${periodKey}:${normalizeName(branchName)}`
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function buildSaveMessage(result: { created: number; updated: number; skipped: number; branchMissing: number }) {
  const parts = [
    `${result.created} transaksi baru disimpan`,
    `${result.updated} transaksi lama diupdate`,
    `${result.skipped} data dilewati`,
  ]

  if (result.branchMissing > 0) {
    parts.push(`${result.branchMissing} cabang belum cocok`)
  }

  return parts.join(', ') + '.'
}

function isUniqueImportError(message: string) {
  return message.toLowerCase().includes('unique') || message.toLowerCase().includes('duplicate')
}

function isAccessError(message: string | null) {
  if (!message) return false
  const normalized = message.toLowerCase()
  return normalized.includes('akses') || normalized.includes('access') || normalized.includes('kode') || normalized.includes('token')
}

function getPayloadMessage(payload: unknown) {
  if (!isRecord(payload)) return null
  const message = payload.message ?? payload.error ?? payload.status_message
  return typeof message === 'string' ? message : null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
