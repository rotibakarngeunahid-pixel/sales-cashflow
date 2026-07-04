// =============================================
// Import Food Waste — tipe & konstanta bersama (client + server)
// Data bahan rusak/terbuang ditarik dari Sistem Inventori dan
// dicatat sebagai pengeluaran kategori "Food Waste" di cashflow.
// =============================================

export type FoodWasteImportStatus = 'new' | 'imported' | 'changed' | 'branch_not_found'
export type FoodWasteImportDecision = 'ignore' | 'update'

// Rincian satu bahan terbuang (dari API inventori)
export interface FoodWasteMaterialDetail {
  materialId: string
  materialName: string
  unit: string | null
  quantity: number
  unitPrice: number | null
  value: number | null // null = harga satuan belum di-set admin inventori
  wasteReason: string | null
  wasteReasonDetail: string | null
}

// Satu baris preview = agregat per cabang per tanggal
export interface FoodWasteImportItem {
  importKey: string
  reportDate: string
  branchName: string
  branchId: string | null
  totalAmount: number
  itemCount: number
  missingPriceCount: number
  materials: FoodWasteMaterialDetail[]
  status: FoodWasteImportStatus
  statusLabel: string
  existingTransactionId: string | null
  existingAmount: number | null
  warning: string | null
}

export interface FoodWasteImportSummary {
  branchCount: number
  itemCount: number
  missingPriceCount: number
  totalAmount: number
}

export interface FoodWasteImportPayload {
  items: FoodWasteImportItem[]
  summary: FoodWasteImportSummary
}

export interface SaveFoodWasteImportResult {
  created: number
  updated: number
  skipped: number
  branchMissing: number
  missingPriceCount: number
  totalAmount: number
  message: string
}

export const FOOD_WASTE_SOURCE = 'inventori_waste' as const
export const FOOD_WASTE_SOURCE_LABEL = 'Sistem Inventori (Food Waste)'
export const FOOD_WASTE_CATEGORY_NAME = 'Food Waste'

// Kunci anti-duplikat: 1 entri cashflow per cabang per tanggal laporan.
export function makeFoodWasteImportKey(reportDate: string, branchName: string): string {
  return `food-waste:${reportDate}:${normalizeInventoriName(branchName)}`
}

export function normalizeInventoriName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
