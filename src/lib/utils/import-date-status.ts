// =============================================
// Import Date Status - Shared Helper
// Cek apakah data untuk suatu tanggal (+ opsional cabang) sudah pernah
// diimport, dengan query langsung ke cashflow_transactions (bukan tabel log
// riwayat import) supaya status ikut update begitu data dihapus.
// =============================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CashflowSource, Database } from '@/types/database'
import { toDateInputValue } from '@/lib/utils/format'

type Supabase = SupabaseClient<Database>

export interface CheckDateImportedParams {
  date: string
  branchId?: string
  /** Prefix import_key yang menandai sumber import ini, mis. 'kasir-sales:' */
  importKeyPrefixes: string[]
}

/**
 * Return true jika sudah ada minimal satu transaksi aktif untuk tanggal
 * (dan cabang, jika ditentukan) tersebut dengan import_key yang cocok salah
 * satu prefix yang diberikan.
 */
export async function checkDateAlreadyImported(
  supabase: Supabase,
  params: CheckDateImportedParams
): Promise<boolean> {
  if (!params.date || params.importKeyPrefixes.length === 0) return false

  const orFilter = params.importKeyPrefixes
    .map((prefix) => `import_key.like.${prefix}%`)
    .join(',')

  let query = supabase
    .from('cashflow_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_date', params.date)
    .eq('status', 'active')
    .or(orFilter)

  if (params.branchId) query = query.eq('branch_id', params.branchId)

  const { count, error } = await query
  if (error) throw error
  return (count ?? 0) > 0
}

export interface GetImportedDatesInMonthParams {
  /** Bulan yang ingin dicek — cuma tahun & bulannya yang dipakai */
  monthDate: Date
  branchId?: string
  /** Prefix import_key yang menandai sumber import ini, mis. 'kasir-sales:' */
  importKeyPrefixes: string[]
}

/**
 * Return himpunan tanggal (YYYY-MM-DD) dalam bulan `monthDate` yang sudah
 * punya minimal satu transaksi aktif dengan import_key sesuai salah satu
 * prefix. Dipakai untuk menonaktifkan/menandai abu-abu tanggal yang sudah
 * pernah diimport di kalender pemilih tanggal (ImportDatePicker).
 */
export async function getImportedDatesInMonth(
  supabase: Supabase,
  params: GetImportedDatesInMonthParams
): Promise<Set<string>> {
  if (params.importKeyPrefixes.length === 0) return new Set()

  const year  = params.monthDate.getFullYear()
  const month = params.monthDate.getMonth()
  const monthStart = toDateInputValue(new Date(year, month, 1))
  const monthEnd   = toDateInputValue(new Date(year, month + 1, 0))

  const orFilter = params.importKeyPrefixes
    .map((prefix) => `import_key.like.${prefix}%`)
    .join(',')

  let query = supabase
    .from('cashflow_transactions')
    .select('transaction_date')
    .gte('transaction_date', monthStart)
    .lte('transaction_date', monthEnd)
    .eq('status', 'active')
    .or(orFilter)

  if (params.branchId) query = query.eq('branch_id', params.branchId)

  const { data, error } = await query
  if (error) throw error
  return new Set((data || []).map((r) => r.transaction_date))
}

export interface CheckDateImportedBySourceParams {
  date: string
  branchId?: string
  source: CashflowSource
}

/** Varian yang cek berdasarkan kolom `source` persis (bukan prefix import_key). */
export async function checkDateAlreadyImportedBySource(
  supabase: Supabase,
  params: CheckDateImportedBySourceParams
): Promise<boolean> {
  if (!params.date) return false

  let query = supabase
    .from('cashflow_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_date', params.date)
    .eq('status', 'active')
    .eq('source', params.source)

  if (params.branchId) query = query.eq('branch_id', params.branchId)

  const { count, error } = await query
  if (error) throw error
  return (count ?? 0) > 0
}
