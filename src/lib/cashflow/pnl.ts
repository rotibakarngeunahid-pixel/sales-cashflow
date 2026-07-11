import type { CashflowTransaction } from '@/types/database'

// Helper klasifikasi P&L yang dipakai bersama oleh Analisa Cashflow dan Proyeksi Laba Rugi,
// supaya definisi revenue/HPP/beban selalu konsisten di kedua halaman.

export function toNumber(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export function percent(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}

export function normalizeCategoryName(name?: string | null): string {
  return (name || '').trim().toLowerCase()
}

export function getCashflowAmount(tx: CashflowTransaction): number {
  if (tx.transaction_type === 'cash_in') {
    return toNumber(tx.cash_in) || toNumber(tx.amount)
  }

  return toNumber(tx.cash_out) || toNumber(tx.amount)
}

// Transfer beban antar cabang BUKAN pendapatan/beban baru di level usaha,
// melainkan reklasifikasi beban pokok: cabang pengirim bebannya berkurang
// (dicatat sebagai cash_in) dan cabang penerima bebannya bertambah (cash_out).
export function isBebanTransfer(tx: CashflowTransaction): boolean {
  return tx.source === 'beban_transfer'
}

export function isSalesRevenueCategory(tx: CashflowTransaction): boolean {
  const name = normalizeCategoryName(tx.category?.name)
  return name === 'penjualan' || name.startsWith('penjualan ')
}

export function isRevenueCashIn(tx: CashflowTransaction): boolean {
  return tx.transaction_type === 'cash_in'
    && !isBebanTransfer(tx)
    && (tx.source === 'sales' || isSalesRevenueCategory(tx))
}

export function isAdditionalRevenueCashIn(tx: CashflowTransaction): boolean {
  return isRevenueCashIn(tx) && tx.source !== 'sales'
}

export function isOtherIncomeCashIn(tx: CashflowTransaction): boolean {
  return tx.transaction_type === 'cash_in'
    && !isBebanTransfer(tx)
    && !isRevenueCashIn(tx)
}

// Kontribusi transaksi ke total beban (contra-beban untuk sisi pengirim transfer).
// Positif = menambah beban, negatif = mengurangi beban.
export function getExpenseContribution(tx: CashflowTransaction): number {
  const amount = getCashflowAmount(tx)
  if (isBebanTransfer(tx)) {
    return tx.transaction_type === 'cash_in' ? -amount : amount
  }
  return tx.transaction_type === 'cash_out' ? amount : 0
}

// HPP/COGS: kategori "Beban Pokok Pendapatan" (sudah menyatukan "Pembelian Bahan Baku", lihat migration 013).
export function isCogsCategory(tx: CashflowTransaction): boolean {
  return normalizeCategoryName(tx.category?.name) === 'beban pokok pendapatan'
}

// Kategori beban yang secara alami ikut naik/turun mengikuti volume penjualan
// (dipakai untuk proyeksi: diproyeksikan pakai rasio terhadap revenue, bukan rata-rata bulanan tetap).
export const REVENUE_CORRELATED_CATEGORY_NAMES = new Set([
  'food waste',
  'pembelian gas',
  'pembelian kardus',
  'kurir',
])

export function isRevenueCorrelatedCategory(categoryName?: string | null): boolean {
  return REVENUE_CORRELATED_CATEGORY_NAMES.has(normalizeCategoryName(categoryName))
}

export function isExpenseTransaction(tx: CashflowTransaction): boolean {
  return tx.transaction_type === 'cash_out' || isBebanTransfer(tx)
}
