// =============================================
// Kasir Import — Shared Types & Constants
// Digunakan oleh client (UI) dan server (API)
// =============================================

// ----- Source & label -----

export const KASIR_SALES_SOURCE = 'kasir_sales' as const
export const KASIR_EXPENSES_SOURCE = 'kasir_expenses' as const
export const KASIR_SOURCE_LABEL = 'Import Sistem Kasir'

// ----- Payment method -----

export type PaymentMethodFilter = 'Tunai' | 'QRIS' | 'Tunai+QRIS'

export const TUNAI_ALIASES = ['tunai', 'cash', 'uang tunai', 'bayar tunai', 'cash payment']
export const QRIS_ALIASES = ['qris', 'qr', 'qr code', 'quick response', 'qr payment']

// Metode yang harus DISKIP (online platform)
export const SKIP_PAYMENT_METHODS = [
  'gofood', 'grabfood', 'shopee', 'shopeefood', 'shopee food',
  'transfer', 'bank transfer', 'bank', 'debit', 'kredit',
  'credit card', 'kartu kredit', 'kartu debit', 'ovo', 'dana', 'linkaja',
  'gopay', 'shopeepay', 'akulaku', 'kredivo',
]

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
}

// ----- Combined import result (penjualan + kas keluar sekaligus) -----

export interface SaleBranchDetail {
  branchName: string
  totalCash:  number
  totalQris:  number
  total:      number
}

export interface ExpenseItemDetail {
  expenseName: string
  branchName:  string
  category:    string
  amount:      number
  dateWITA:    string
  recordedBy:  string
}

export interface CombinedImportResult {
  success:          boolean
  sales:            KasirImportResult
  expenses:         KasirImportResult
  message:          string
  salesByBranch:    SaleBranchDetail[]
  expenseItems:     ExpenseItemDetail[]
  expensesByBranch: Array<{ branchName: string; total: number; count: number }>
}

// Preview result (data fetched from kasir, NOT yet saved to DB)
export interface CombinedPreviewResult {
  salesNewCount:            number
  salesDupCount:            number
  salesSkippedCount:        number    // skipped_payment (online platforms)
  salesBranchNotFoundCount: number
  salesTotalAmount:         number    // total of new items only
  salesByBranch:            SaleBranchDetail[]
  expensesNewCount:            number
  expensesDupCount:            number
  expensesBranchNotFoundCount: number
  expensesTotalAmount:         number
  expenseItems:                ExpenseItemDetail[]
  expensesByBranch:            Array<{ branchName: string; total: number; count: number }>
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
