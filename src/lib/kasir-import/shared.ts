// =============================================
// Kasir Import - Shared Types & Constants
// Digunakan oleh client (UI) dan server (API)
// =============================================

import {
  KURIR_BAWA_BAHAN_CATEGORY_NAME,
  isKurirBawaBahanCategory,
  normalizeStrictCategoryName,
} from '@/lib/cashflow/auto-split-kurir'

export {
  KURIR_BAWA_BAHAN_CATEGORY_NAME,
  isKurirBawaBahanCategory,
  normalizeStrictCategoryName,
}

// ----- Source & label -----

export const KASIR_SALES_SOURCE = 'kasir_sales' as const
export const KASIR_EXPENSES_SOURCE = 'kasir_expenses' as const
export const KASIR_SOURCE_LABEL = 'Import Sistem Kasir'

// ----- Payment method -----

export type PaymentMethodFilter = 'Tunai' | 'QRIS' | 'Tunai+QRIS'

export const TUNAI_ALIASES = ['tunai', 'cash', 'uang tunai', 'bayar tunai', 'cash payment']
export const QRIS_ALIASES = ['qris', 'qr', 'qr code', 'quick response', 'qr payment']

// Metode yang harus DISKIP (bukan Cash/QRIS, dan bukan platform online yang dideteksi khusus)
export const SKIP_PAYMENT_METHODS = [
  'transfer', 'bank transfer', 'bank', 'debit', 'kredit',
  'credit card', 'kartu kredit', 'kartu debit', 'ovo', 'dana', 'linkaja',
  'gopay', 'shopeepay', 'akulaku', 'kredivo',
]

// ----- Online platform (GoFood/GrabFood/ShopeeFood) -----
// Nominal yang tercatat di kasir untuk metode ini adalah NETT (sudah dipotong
// komisi/biaya platform), bukan harga jual asli — dideteksi terpisah dari
// Tunai/QRIS supaya bisa dilengkapi gross+potongannya di halaman Penjualan Online.

export type OnlinePlatform = 'gofood' | 'grabfood' | 'shopeefood'

export const PLATFORM_LABELS: Record<OnlinePlatform, string> = {
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
}

export const GOFOOD_ALIASES = ['gofood', 'go-food', 'go food']
export const GRABFOOD_ALIASES = ['grabfood', 'grab-food', 'grab food']
export const SHOPEEFOOD_ALIASES = ['shopeefood', 'shopee-food', 'shopee food', 'shopee']

export function detectOnlinePlatform(raw: string): OnlinePlatform | null {
  const lower = raw.toLowerCase().trim()
  if (!lower) return null
  if (GOFOOD_ALIASES.some((alias) => lower.includes(alias))) return 'gofood'
  if (GRABFOOD_ALIASES.some((alias) => lower.includes(alias))) return 'grabfood'
  if (SHOPEEFOOD_ALIASES.some((alias) => lower.includes(alias))) return 'shopeefood'
  return null
}

// ----- Item status -----

export type KasirSaleItemStatus =
  | 'new'
  | 'duplicate'
  | 'skipped_payment'
  | 'branch_not_found'

export type KasirExpenseItemStatus =
  | 'new'
  | 'duplicate'
  | 'void_skipped'
  | 'branch_not_found'

// ----- Preview items -----

export interface KasirSalePreviewItem {
  importKey: string
  transactionId: string          // ID dari sistem kasir
  dateWITA: string               // YYYY-MM-DD (WITA)
  timeWITA: string               // HH:MM WITA
  datetimeRaw: string            // datetime asli dari endpoint
  branchName: string             // nama cabang dari kasir
  branchId: string | null        // UUID cabang di sistem keuangan (null jika tidak ditemukan)
  paymentMethod: string          // metode bayar dari kasir
  paymentCategory: 'Tunai' | 'QRIS' | null  // kategori di sistem keuangan
  platform: OnlinePlatform | null  // GoFood/GrabFood/ShopeeFood — null kalau bukan online
  amount: number
  cashier: string
  status: KasirSaleItemStatus
  statusLabel: string
}

export interface KasirSalePreviewSummary {
  totalFound: number
  totalNew: number
  totalDuplicate: number
  totalSkipped: number
  totalBranchNotFound: number
  totalCash: number
  totalQris: number
  totalAmount: number
  totalOnlineDetected: number       // jumlah transaksi online terdeteksi (belum masuk cashflow)
  totalOnlineDetectedAmount: number // total nett yang terdeteksi, menunggu dilengkapi
  byBranch: Array<{ branchName: string; totalCash: number; totalQris: number; total: number }>
  byDate: Array<{ date: string; total: number; count: number }>
}

export interface KasirSalePreviewPayload {
  items: KasirSalePreviewItem[]
  summary: KasirSalePreviewSummary
}

// ----- Expense mapping -----

export type ExpenseMappingMode = 'original' | 'remap' | 'split_equal' | 'split_manual'

export interface MappingTarget {
  branchId: string
  branchName: string
  amount: number
}

export interface KasirExpenseMappingConfig {
  mode: ExpenseMappingMode
  targets: MappingTarget[]
}

// ----- Expense preview item -----

export interface KasirExpensePreviewItem {
  importKey: string
  expenseId: string              // ID dari sistem kasir
  dateWITA: string               // YYYY-MM-DD (WITA)
  timeWITA: string               // HH:MM WITA
  datetimeRaw: string
  branchName: string
  branchId: string | null
  expenseName: string
  category: string               // kategori dari kasir
  localCategoryId: string | null // UUID kategori di sistem keuangan
  amount: number
  notes: string
  recordedBy: string
  isVoid: boolean
  status: KasirExpenseItemStatus
  statusLabel: string
  mapping: KasirExpenseMappingConfig
}

export interface KasirExpensePreviewSummary {
  totalFound: number
  totalNew: number
  totalDuplicate: number
  totalVoidSkipped: number
  totalBranchNotFound: number
  totalAmount: number
  byBranch: Array<{ branchName: string; total: number; count: number }>
  byDate: Array<{ date: string; total: number; count: number }>
}

export interface KasirExpensePreviewPayload {
  items: KasirExpensePreviewItem[]
  summary: KasirExpensePreviewSummary
}

// ----- Import request body -----

export interface ImportSalesRequest {
  start_date: string
  end_date: string
  branch_id?: string
  payment_method: PaymentMethodFilter
}

export interface ImportExpensesRequest {
  start_date: string
  end_date: string
  branch_id?: string
  // Mapping decisions: key=expenseId, value=mapping config
  mappings?: Record<string, KasirExpenseMappingConfig>
}

// ----- Import result -----

export interface KasirImportResult {
  success: boolean
  totalFound: number
  totalSuccess: number
  totalFailed: number
  totalSkipped: number
  totalAmount: number
  message: string
  errors: string[]
  // Transaksi online (GoFood/GrabFood/ShopeeFood) yang TERTAMPUNG untuk
  // dilengkapi di halaman Penjualan Online — bukan bagian dari totalAmount
  // karena belum masuk cashflow.
  onlineDetectedCount?: number
  onlineDetectedAmount?: number
}

// ----- Combined import result (penjualan + kas keluar sekaligus) -----

export interface SaleBranchDetail {
  branchName: string
  totalCash:  number
  totalQris:  number
  total:      number
}

export interface ExpenseItemDetail {
  importKey:    string
  expenseName:  string
  branchName:   string
  category:     string
  amount:       number
  dateWITA:     string
  recordedBy:   string
  isSplitKurir?: boolean   // true jika pengeluaran kurir di-split rata ke semua cabang
  splitCount?:   number    // jumlah cabang yang dituju saat split
}

export interface CombinedImportResult {
  success:          boolean
  sales:            KasirImportResult
  expenses:         KasirImportResult
  message:          string
  salesByBranch:    SaleBranchDetail[]
  expenseItems:     ExpenseItemDetail[]
  expensesByBranch: Array<{ branchName: string; total: number; count: number }>
  onlineDetectedCount:  number
  onlineDetectedAmount: number
}

// Preview result (data fetched from kasir, NOT yet saved to DB)
export interface CombinedPreviewResult {
  salesNewCount:            number
  salesDupCount:            number
  salesSkippedCount:        number    // skipped_payment (online platforms)
  salesBranchNotFoundCount: number
  salesTotalAmount:         number    // total of new items only
  salesByBranch:            SaleBranchDetail[]
  salesUnmatchedBranchNames:   string[]   // nama cabang kasir yg tidak cocok
  expensesNewCount:            number
  expensesDupCount:            number
  expensesBranchNotFoundCount: number
  expensesTotalAmount:         number
  expenseItems:                ExpenseItemDetail[]
  expensesByBranch:            Array<{ branchName: string; total: number; count: number }>
  expensesUnmatchedBranchNames: string[]  // nama cabang kasir yg tidak cocok
  onlineDetectedCount:          number    // transaksi GoFood/GrabFood/ShopeeFood baru terdeteksi
  onlineDetectedAmount:         number
}

// ----- Helpers -----

export function normalizePaymentMethod(raw: string): 'Tunai' | 'QRIS' | null {
  const lower = raw.toLowerCase().trim()
  if (TUNAI_ALIASES.some((alias) => lower === alias || lower.includes(alias))) return 'Tunai'
  if (QRIS_ALIASES.some((alias) => lower === alias || lower.includes(alias))) return 'QRIS'
  return null
}

export function shouldSkipPaymentMethod(raw: string): boolean {
  const lower = raw.toLowerCase().trim()
  return SKIP_PAYMENT_METHODS.some((alias) => lower.includes(alias))
}

// Exclude setoran tunai: internal cash transfer (outlet → HQ), not an operational expense.
// Cek kategori/nama kas keluar — toleran terhadap variasi penulisan
// ("Setoran Tunai", "SETORAN TUNAI", "setoran_tunai", "setoran",
// "Setoran #aa9e0856-fff5-470f-bb4e-dc9e6c555aa7" — POS menambahkan ID transaksi unik
// di belakang kata "Setoran", jadi dicek sebagai awalan kata, bukan exact match).
export function isSetoranTunai(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => {
    if (!value) return false
    const normalized = value.toLowerCase().replace(/[_\s]+/g, ' ').trim()
    return /^setoran(\s|#|$)/.test(normalized)
  })
}

// Deteksi pengeluaran kurir: biaya pengiriman shared cost yang harus dibagi rata.
// Cek kategori/nama kas keluar — toleran terhadap variasi penulisan
// ("Kurir", "Biaya Kurir", "Ongkir", "Ongkos Kirim", "Biaya Pengiriman", "Pengiriman").
export function isKurirExpense(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => {
    if (!value) return false
    const normalized = value.toLowerCase().replace(/[_\s]+/g, ' ').trim()
    return (
      normalized === 'kurir' ||
      normalized.includes('kurir') ||
      normalized === 'ongkir' ||
      normalized.includes('ongkos kirim') ||
      normalized.includes('biaya pengiriman') ||
      normalized === 'pengiriman'
    )
  })
}

export function normalizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .trim()
}

export function makeSaleImportKey(branchName: string, transactionId: string): string {
  return `kasir-sales:${normalizeBranchName(branchName)}:${transactionId}`
}

export function makeOnlineSaleImportKey(
  platform: OnlinePlatform,
  branchName: string,
  transactionId: string
): string {
  return `online-sales:${platform}:${normalizeBranchName(branchName)}:${transactionId}`
}

export function makeExpenseImportKey(branchName: string, expenseId: string): string {
  return `kasir-expenses:${normalizeBranchName(branchName)}:${expenseId}`
}

export function distributeSplitAmounts(total: number, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [total]

  const base = Math.floor(total / count)
  const remainder = total - base * count
  const result = Array(count).fill(base) as number[]

  // Tambahkan sisa ke outlet-outlet pertama (distribusi paling merata)
  for (let i = 0; i < remainder; i++) {
    result[i] += 1
  }

  return result
}

export function validateMappingTargets(
  targets: MappingTarget[],
  originalAmount: number
): string | null {
  if (targets.length === 0) return 'Pilih minimal satu outlet untuk mapping.'

  for (const t of targets) {
    if (t.amount < 0) return `Nominal untuk outlet ${t.branchName} tidak boleh minus.`
    if (t.amount === 0) return `Nominal untuk outlet ${t.branchName} tidak boleh nol.`
  }

  const sum = targets.reduce((acc, t) => acc + t.amount, 0)
  if (sum !== originalAmount) {
    return `Total mapping (${sum.toLocaleString('id-ID')}) harus sama dengan nominal asli (${originalAmount.toLocaleString('id-ID')}).`
  }

  return null
}

export const STATUS_LABELS: Record<KasirSaleItemStatus | KasirExpenseItemStatus, string> = {
  new: 'Belum Diimport',
  duplicate: 'Sudah Diimport',
  skipped_payment: 'Dilewati (Metode Lain)',
  void_skipped: 'Dilewati (Void)',
  branch_not_found: 'Cabang Tidak Ditemukan',
}
