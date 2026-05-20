export type ImportBahanBakuStatus = 'new' | 'imported' | 'changed' | 'branch_not_found'
export type ImportBahanBakuDecision = 'ignore' | 'update'

export interface ImportBahanBakuItem {
  importKey: string
  periodStart: string
  periodEnd: string
  transactionDate: string
  periodLabel: string
  branchName: string
  branchId: string | null
  totalAmount: number
  transactionCount: number | null
  status: ImportBahanBakuStatus
  statusLabel: string
  existingTransactionId: string | null
  existingAmount: number | null
  warning: string | null
}

export interface ImportBahanBakuSummary {
  branchCount: number
  transactionCount: number
  totalAmount: number
  totalAllBranches: number
}

export interface ImportBahanBakuPayload {
  items: ImportBahanBakuItem[]
  summary: ImportBahanBakuSummary
}

export interface SaveImportBahanBakuResult {
  created: number
  updated: number
  skipped: number
  branchMissing: number
  totalAmount: number
  message: string
}

export interface SaveImportBahanBakuRequest {
  tanggal_mulai: string
  tanggal_akhir: string
  branch_id?: string
  decisions?: Record<string, ImportBahanBakuDecision>
}

export const IMPORT_BAHAN_BAKU_SOURCE = 'purchase_order' as const
export const IMPORT_BAHAN_BAKU_SOURCE_LABEL = 'Finance Portal API / Purchase Order System'
