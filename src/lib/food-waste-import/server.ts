import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  FOOD_WASTE_SOURCE,
  FOOD_WASTE_SOURCE_LABEL,
  FOOD_WASTE_CATEGORY_NAME,
  makeFoodWasteImportKey,
  normalizeInventoriName,
  type FoodWasteImportItem,
  type FoodWasteImportPayload,
  type FoodWasteImportSummary,
  type FoodWasteImportDecision,
  type FoodWasteMaterialDetail,
  type SaveFoodWasteImportResult,
} from './shared'

type Supabase = SupabaseClient<Database>
type JsonRecord = Record<string, unknown>

export interface FoodWasteImportParams {
  startDate: string
  endDate: string
  branchId?: string
}

export interface SaveFoodWasteOptions {
  decisions?: Record<string, FoodWasteImportDecision>
  skippedKeys?: Set<string>
  /** Cron: langsung update baris yang nominalnya berubah tanpa keputusan admin. */
  autoUpdateChanged?: boolean
  /** 'scheduler' untuk cron, selain itu 'manual'. */
  triggeredBy?: string
}

interface LocalBranch {
  id: string
  name: string
}

interface InventoriMapping {
  inventori_name: string
  branch_id: string
}

// Bentuk baris dari endpoint inventori /integration/finance/food-waste
interface ExternalWasteGroup {
  reportDate: string
  branchName: string
  totalValue: number
  itemCount: number
  missingPriceCount: number
  materials: FoodWasteMaterialDetail[]
}

interface ExistingImportRow {
  id: string
  import_key: string | null
  amount: number
  cash_out: number
  status: string
}

export class FoodWasteImportError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'import_error') {
    super(message)
    this.name = 'FoodWasteImportError'
    this.status = status
    this.code = code
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateFoodWasteDateRange(startDate: string | null, endDate: string | null): { startDate: string; endDate: string } {
  if (!startDate) {
    throw new FoodWasteImportError('Tanggal mulai wajib diisi.', 400, 'invalid_date')
  }

  if (!endDate) {
    throw new FoodWasteImportError('Tanggal akhir wajib diisi.', 400, 'invalid_date')
  }

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new FoodWasteImportError('Format tanggal harus YYYY-MM-DD.', 400, 'invalid_date')
  }

  if (endDate < startDate) {
    throw new FoodWasteImportError('Tanggal akhir tidak boleh lebih kecil dari tanggal mulai.', 400, 'invalid_date')
  }

  return { startDate, endDate }
}

/** Rentang default untuk cron: kemarin s.d. hari ini (WITA). */
export function defaultAutoSyncRange(now = new Date()): { startDate: string; endDate: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const endDate = fmt.format(now)
  const startDate = fmt.format(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  return { startDate, endDate }
}

// =============================================
// Preview
// =============================================

export async function getFoodWasteImportPreview(
  supabase: Supabase,
  params: FoodWasteImportParams
): Promise<FoodWasteImportPayload> {
  const branches = await loadBranches(supabase)
  const groups = await fetchInventoriFoodWaste(params)

  if (groups.length === 0) {
    throw new FoodWasteImportError('Belum ada bahan terbuang pada periode ini.', 404, 'empty_data')
  }

  const mappings = await loadInventoriMappings(supabase)
  const branchByName = new Map(branches.map((branch) => [normalizeInventoriName(branch.name), branch]))
  const branchByMappedName = new Map<string, LocalBranch>()
  for (const mapping of mappings) {
    const branch = branches.find((b) => b.id === mapping.branch_id)
    if (branch) branchByMappedName.set(normalizeInventoriName(mapping.inventori_name), branch)
  }

  const groupsWithBranch = groups
    .map((group) => {
      const key = normalizeInventoriName(group.branchName)
      const branch = branchByName.get(key) ?? branchByMappedName.get(key) ?? null
      return { group, branch }
    })
    .filter(({ branch }) => !params.branchId || branch?.id === params.branchId)

  if (groupsWithBranch.length === 0) {
    throw new FoodWasteImportError('Belum ada bahan terbuang pada periode ini.', 404, 'empty_data')
  }

  const importKeys = groupsWithBranch.map(({ group }) => makeFoodWasteImportKey(group.reportDate, group.branchName))
  const existingByKey = await loadExistingImports(supabase, importKeys)

  const items: FoodWasteImportItem[] = groupsWithBranch.map(({ group, branch }) => {
    const importKey = makeFoodWasteImportKey(group.reportDate, group.branchName)
    const existing = existingByKey.get(importKey) ?? null
    const existingAmount = existing ? Number(existing.cash_out || existing.amount || 0) : null
    const roundedExisting = existingAmount === null ? null : Math.round(existingAmount)
    const roundedIncoming = Math.round(group.totalValue)

    if (!branch) {
      return buildPreviewItem(group, importKey, null, 'branch_not_found', null, existingAmount)
    }

    if (!existing) {
      return buildPreviewItem(group, importKey, branch.id, 'new', null, null)
    }

    if (roundedExisting !== roundedIncoming) {
      return buildPreviewItem(group, importKey, branch.id, 'changed', existing.id, existingAmount)
    }

    return buildPreviewItem(group, importKey, branch.id, 'imported', existing.id, existingAmount)
  })

  const summary = buildSummary(items)
  return { items, summary }
}

// =============================================
// Save (dipakai halaman admin & cron)
// =============================================

export async function saveFoodWasteImport(
  supabase: Supabase,
  params: FoodWasteImportParams,
  userId: string | null,
  options: SaveFoodWasteOptions = {}
): Promise<SaveFoodWasteImportResult> {
  const decisions = options.decisions ?? {}
  const skippedKeys = options.skippedKeys ?? new Set<string>()
  const preview = await getFoodWasteImportPreview(supabase, params)
  const categoryId = await getFoodWasteCategoryId(supabase)
  let created = 0
  let updated = 0
  let skipped = 0
  let branchMissing = 0
  let missingPriceCount = 0
  let totalAmount = 0
  const touchedBranches = new Set<string>()

  for (const item of preview.items) {
    missingPriceCount += item.missingPriceCount

    if (!item.branchId) {
      branchMissing += 1
      continue
    }

    if (skippedKeys.has(item.importKey)) {
      skipped += 1
      continue
    }

    // Semua bahan terbuang di grup ini belum punya harga satuan → belum ada
    // nilai kerugian yang bisa dicatat. Dilewati; setelah admin mengisi harga
    // di panel inventori, sync berikutnya otomatis mencatatnya.
    if (item.totalAmount <= 0) {
      skipped += 1
      continue
    }

    const basePayload = {
      transaction_date: item.reportDate,
      branch_id: item.branchId,
      transaction_type: 'cash_out' as const,
      category_id: categoryId,
      description: buildDescription(item),
      cash_in: 0,
      cash_out: item.totalAmount,
      amount: item.totalAmount,
      source: FOOD_WASTE_SOURCE,
      source_id: null,
      import_key: item.importKey,
      source_label: FOOD_WASTE_SOURCE_LABEL,
      source_metadata: {
        report_date: item.reportDate,
        branch_name: item.branchName,
        item_count: item.itemCount,
        missing_price_count: item.missingPriceCount,
        materials: item.materials.map((material) => ({
          material_id: material.materialId,
          material_name: material.materialName,
          unit: material.unit,
          quantity: material.quantity,
          unit_price: material.unitPrice,
          value: material.value,
          waste_reason: material.wasteReason,
          waste_reason_detail: material.wasteReasonDetail,
        })),
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
        throw new FoodWasteImportError('Gagal menyimpan data ke laporan keuangan.', 500, 'save_failed')
      }

      created += 1
      totalAmount += item.totalAmount
      touchedBranches.add(item.branchId)

      if (inserted) {
        await supabase.from('audit_logs').insert({
          table_name: 'cashflow_transactions',
          record_id: inserted.id,
          action: 'cashflow_food_waste_imported',
          old_data: null,
          new_data: inserted as unknown as Record<string, unknown>,
          changed_by: userId,
          changed_at: new Date().toISOString(),
        })
      }
      continue
    }

    const shouldUpdate = options.autoUpdateChanged || decisions[item.importKey] === 'update'
    if (item.status === 'changed' && item.existingTransactionId && shouldUpdate) {
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
        throw new FoodWasteImportError('Gagal update transaksi lama.', 500, 'update_failed')
      }

      updated += 1
      totalAmount += item.totalAmount
      touchedBranches.add(item.branchId)

      await supabase.from('audit_logs').insert({
        table_name: 'cashflow_transactions',
        record_id: item.existingTransactionId,
        action: 'cashflow_food_waste_updated',
        old_data: oldTx as unknown as Record<string, unknown>,
        new_data: basePayload as unknown as Record<string, unknown>,
        changed_by: userId,
        changed_at: new Date().toISOString(),
      })
      continue
    }

    skipped += 1
  }

  const message = buildSaveMessage({ created, updated, skipped, branchMissing, missingPriceCount })
  await writeFoodWasteImportLog(supabase, params, userId, {
    status: 'success',
    branchCount: touchedBranches.size,
    totalAmount,
    itemCount: created + updated,
    missingPriceCount,
    message,
    triggeredBy: options.triggeredBy ?? 'manual',
  })

  return {
    created,
    updated,
    skipped,
    branchMissing,
    missingPriceCount,
    totalAmount,
    message,
  }
}

export async function writeFoodWasteImportLog(
  supabase: Supabase,
  params: FoodWasteImportParams,
  userId: string | null,
  entry: {
    status: 'success' | 'failed'
    branchCount: number
    totalAmount: number
    itemCount: number
    missingPriceCount: number
    message: string
    triggeredBy?: string
  }
) {
  await supabase.from('food_waste_import_logs').insert({
    period_start: params.startDate,
    period_end: params.endDate,
    branch_count: entry.branchCount,
    total_amount: entry.totalAmount,
    item_count: entry.itemCount,
    missing_price_count: entry.missingPriceCount,
    status: entry.status,
    message: entry.message,
    triggered_by: entry.triggeredBy ?? 'manual',
    created_by: userId,
    imported_at: new Date().toISOString(),
  })
}

// =============================================
// Helpers
// =============================================

async function loadBranches(supabase: Supabase): Promise<LocalBranch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id,name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')

  if (error) {
    throw new FoodWasteImportError('Gagal membaca data cabang.', 500, 'branch_load_failed')
  }

  return data || []
}

async function loadInventoriMappings(supabase: Supabase): Promise<InventoriMapping[]> {
  const { data } = await supabase
    .from('inventori_branch_mappings')
    .select('inventori_name,branch_id')

  return data || []
}

async function loadExistingImports(supabase: Supabase, importKeys: string[]) {
  if (importKeys.length === 0) return new Map<string, ExistingImportRow>()

  const { data, error } = await supabase
    .from('cashflow_transactions')
    .select('id,import_key,amount,cash_out,status')
    .in('import_key', importKeys)

  if (error) {
    throw new FoodWasteImportError('Gagal membaca status import lama.', 500, 'existing_load_failed')
  }

  return new Map((data || []).map((row) => [row.import_key || '', row as ExistingImportRow]))
}

async function getFoodWasteCategoryId(supabase: Supabase): Promise<string> {
  const { data, error } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw new FoodWasteImportError('Gagal membaca kategori Food Waste.', 500, 'category_load_failed')
  }

  const categories = data || []
  const category = categories.find(
    (item) => normalizeInventoriName(item.name) === 'food-waste' && item.default_type !== 'cash_in'
  )

  if (category) return category.id

  const { data: inserted, error: insertError } = await supabase
    .from('cashflow_categories')
    .insert({
      name: FOOD_WASTE_CATEGORY_NAME,
      default_type: 'cash_out',
      description: 'Kerugian dari food waste',
      is_active: true,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    throw new FoodWasteImportError('Kategori Food Waste belum tersedia.', 500, 'category_missing')
  }

  return inserted.id
}

async function fetchInventoriFoodWaste(params: FoodWasteImportParams): Promise<ExternalWasteGroup[]> {
  const apiKey = process.env.INVENTORI_API_KEY
  const endpoint = process.env.INVENTORI_API_URL

  if (!apiKey) {
    throw new FoodWasteImportError('Kode akses integrasi inventori belum dikonfigurasi.', 500, 'missing_api_key')
  }

  if (!endpoint) {
    throw new FoodWasteImportError('Endpoint integrasi inventori belum dikonfigurasi.', 500, 'missing_endpoint')
  }

  let url: URL
  try {
    url = new URL(`${endpoint.replace(/\/$/, '')}/integration/finance/food-waste`)
  } catch {
    throw new FoodWasteImportError('Endpoint integrasi inventori belum valid.', 500, 'invalid_endpoint')
  }

  url.searchParams.set('date_from', params.startDate)
  url.searchParams.set('date_to', params.endDate)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
      cache: 'no-store',
    })
  } catch {
    throw new FoodWasteImportError(
      'Gagal terhubung ke sistem inventori. Coba beberapa saat lagi.',
      502,
      'endpoint_unreachable'
    )
  }

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new FoodWasteImportError(
      'Format data dari sistem inventori tidak sesuai. Silakan cek integrasi.',
      502,
      'invalid_json'
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new FoodWasteImportError('Gagal menarik data. Kode akses integrasi inventori tidak valid.', 401, 'invalid_api_key')
  }

  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    const message = getPayloadMessage(payload)
    throw new FoodWasteImportError(
      message || 'Gagal terhubung ke sistem inventori. Coba beberapa saat lagi.',
      502,
      'endpoint_error'
    )
  }

  const dataRoot = isRecord(payload.data) ? payload.data : null
  const rows = dataRoot && Array.isArray(dataRoot.rows) ? dataRoot.rows : null
  if (!rows) {
    throw new FoodWasteImportError(
      'Format data dari sistem inventori tidak sesuai. Silakan cek integrasi.',
      502,
      'invalid_format'
    )
  }

  return rows.filter(isRecord).map(normalizeWasteGroup)
}

function normalizeWasteGroup(record: JsonRecord): ExternalWasteGroup {
  const materialsRaw = Array.isArray(record.items) ? record.items.filter(isRecord) : []
  const materials: FoodWasteMaterialDetail[] = materialsRaw.map((item) => ({
    materialId: toStringValue(item.material_id),
    materialName: toStringValue(item.material_name),
    unit: item.unit === null || item.unit === undefined ? null : toStringValue(item.unit),
    quantity: toNumber(item.quantity),
    unitPrice: item.unit_price === null || item.unit_price === undefined ? null : toNumber(item.unit_price),
    value: item.value === null || item.value === undefined ? null : toNumber(item.value),
    wasteReason: item.waste_reason === null || item.waste_reason === undefined ? null : toStringValue(item.waste_reason),
    wasteReasonDetail:
      item.waste_reason_detail === null || item.waste_reason_detail === undefined
        ? null
        : toStringValue(item.waste_reason_detail),
  }))

  return {
    reportDate: toStringValue(record.report_date),
    branchName: toStringValue(record.branch_name),
    totalValue: toNumber(record.total_value),
    itemCount: materials.length,
    missingPriceCount: materials.filter((material) => material.value === null).length,
    materials,
  }
}

function buildDescription(item: FoodWasteImportItem): string {
  const [year, month, day] = item.reportDate.split('-')
  const materialNames = item.materials
    .filter((material) => material.value !== null)
    .map((material) => material.materialName)
    .filter(Boolean)
  const detail = materialNames.length > 0 ? `: ${materialNames.join(', ')}` : ''
  return `Food waste ${item.branchName} - ${day}/${month}/${year} (${materialNames.length} bahan)${detail}`
}

function buildPreviewItem(
  group: ExternalWasteGroup,
  importKey: string,
  branchId: string | null,
  status: FoodWasteImportItem['status'],
  existingTransactionId: string | null,
  existingAmount: number | null
): FoodWasteImportItem {
  const statusLabel = {
    new: 'Belum disimpan',
    imported: 'Sudah pernah diimport',
    changed: 'Nominal berubah',
    branch_not_found: 'Cabang belum cocok',
  }[status]

  const warnings: string[] = []
  if (status === 'changed') {
    warnings.push('Data sudah pernah diimport, tetapi nilai kerugian dari sistem inventori berubah.')
  }
  if (status === 'branch_not_found') {
    warnings.push('Nama cabang dari sistem inventori belum cocok dengan cabang di laporan keuangan.')
  }
  if (group.missingPriceCount > 0) {
    warnings.push(
      `${group.missingPriceCount} bahan belum punya harga satuan di panel inventori dan dilewati dari nilai kerugian.`
    )
  }

  return {
    importKey,
    reportDate: group.reportDate,
    branchName: group.branchName,
    branchId,
    totalAmount: group.totalValue,
    itemCount: group.itemCount,
    missingPriceCount: group.missingPriceCount,
    materials: group.materials,
    status,
    statusLabel,
    existingTransactionId,
    existingAmount,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  }
}

function buildSummary(items: FoodWasteImportItem[]): FoodWasteImportSummary {
  return {
    branchCount: new Set(items.map((item) => item.branchName)).size,
    itemCount: items.reduce((sum, item) => sum + item.itemCount, 0),
    missingPriceCount: items.reduce((sum, item) => sum + item.missingPriceCount, 0),
    totalAmount: items.reduce((sum, item) => sum + item.totalAmount, 0),
  }
}

function buildSaveMessage(result: {
  created: number
  updated: number
  skipped: number
  branchMissing: number
  missingPriceCount: number
}) {
  const parts = [
    `${result.created} transaksi baru disimpan`,
    `${result.updated} transaksi lama diupdate`,
    `${result.skipped} data dilewati`,
  ]

  if (result.branchMissing > 0) {
    parts.push(`${result.branchMissing} cabang belum cocok`)
  }

  if (result.missingPriceCount > 0) {
    parts.push(`${result.missingPriceCount} bahan tanpa harga satuan`)
  }

  return parts.join(', ') + '.'
}

function isUniqueImportError(message: string) {
  return message.toLowerCase().includes('unique') || message.toLowerCase().includes('duplicate')
}

function getPayloadMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const error = payload.error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  const message = payload.message
  return typeof message === 'string' ? message : null
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
