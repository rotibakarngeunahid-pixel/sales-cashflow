import type { OnlineSalesDeductionType, OnlineSalesNettInputMode } from '@/types/database'

export interface OnlineSalesDeductionInput {
  deduction_type: OnlineSalesDeductionType
  amount: number
}

export interface OnlineSalesCalculationInput {
  gross: number
  deductions: OnlineSalesDeductionInput[]
  mode: OnlineSalesNettInputMode
  manualNett?: number
}

export interface OnlineSalesCalculationResult {
  totalDeduction: number
  nett: number
  // Selisih nett manual vs hasil hitung otomatis (gross - totalDeduction).
  // Hanya relevan saat mode 'manual' — ditampilkan sebagai info, bukan error.
  variance: number
}

export function calculateOnlineSalesNett(input: OnlineSalesCalculationInput): OnlineSalesCalculationResult {
  const gross = input.gross || 0
  const totalDeduction = input.deductions.reduce((sum, d) => sum + (d.amount || 0), 0)
  const calculatedNett = gross - totalDeduction

  const nett = input.mode === 'manual' ? (input.manualNett ?? 0) : calculatedNett
  const variance = input.mode === 'manual' ? nett - calculatedNett : 0

  return { totalDeduction, nett, variance }
}
