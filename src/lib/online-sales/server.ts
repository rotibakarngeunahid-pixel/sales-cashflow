import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  OnlinePlatform,
  OnlineSalesDeductionType,
  OnlineSalesNettInputMode,
  OnlineSalesStatus,
} from '@/types/database'
import { PLATFORM_LABELS } from '@/lib/kasir-import/shared'
import { calculateOnlineSalesNett } from './calculations'

type Supabase = SupabaseClient<Database>

export class OnlineSalesError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'OnlineSalesError'
    this.status = status
  }
}

// =============================================
// PENDING GROUPS — transaksi terdeteksi, belum dilengkapi
// =============================================

export interface PendingOnlineSalesGroup {
  key: string
  branchId: string | null
  branchName: string
  platform: OnlinePlatform
  platformLabel: string
  reportDate: string
  detectedCount: number
  detectedAmount: number
  existingReportId: string | null
  existingReportStatus: OnlineSalesStatus | null
}

export async function loadPendingOnlineSalesGroups(
  supabase: Supabase,
  opts: { startDate?: string; endDate?: string } = {}
): Promise<PendingOnlineSalesGroup[]> {
  let query = supabase
    .from('online_sales_detections')
    .select('branch_id, branch_name_raw, platform, transaction_date, detected_nett_amount, online_sales_report_id')
    .is('online_sales_report_id', null)

  if (opts.startDate) query = query.gte('transaction_date', opts.startDate)
  if (opts.endDate) query = query.lte('transaction_date', opts.endDate)

  const { data, error } = await query
  if (error) throw new OnlineSalesError(`Gagal memuat transaksi online: ${error.message}`, 500)

  const groups = new Map<string, PendingOnlineSalesGroup>()
  for (const row of data || []) {
    const key = `${row.branch_id ?? `unmatched:${row.branch_name_raw}`}|${row.platform}|${row.transaction_date}`
    const existing = groups.get(key)
    if (existing) {
      existing.detectedCount += 1
      existing.detectedAmount += row.detected_nett_amount
    } else {
      groups.set(key, {
        key,
        branchId: row.branch_id,
        branchName: row.branch_name_raw,
        platform: row.platform,
        platformLabel: PLATFORM_LABELS[row.platform],
        reportDate: row.transaction_date,
        detectedCount: 1,
        detectedAmount: row.detected_nett_amount,
        existingReportId: null,
        existingReportStatus: null,
      })
    }
  }

  const groupList = Array.from(groups.values())
  const matchedGroups = groupList.filter((g) => g.branchId)

  if (matchedGroups.length > 0) {
    const branchIds = Array.from(new Set(matchedGroups.map((g) => g.branchId as string)))
    const dates = Array.from(new Set(matchedGroups.map((g) => g.reportDate)))

    const { data: reports } = await supabase
      .from('online_sales_reports')
      .select('id, branch_id, platform, report_date, status')
      .in('branch_id', branchIds)
      .in('report_date', dates)

    const reportMap = new Map<string, { id: string; status: OnlineSalesStatus }>()
    for (const r of reports || []) {
      reportMap.set(`${r.branch_id}|${r.platform}|${r.report_date}`, { id: r.id, status: r.status })
    }

    for (const g of matchedGroups) {
      const found = reportMap.get(`${g.branchId}|${g.platform}|${g.reportDate}`)
      if (found) {
        g.existingReportId = found.id
        g.existingReportStatus = found.status
      }
    }
  }

  return groupList.sort((a, b) => b.reportDate.localeCompare(a.reportDate))
}

export async function assignBranchToUnmatchedDetections(
  supabase: Supabase,
  branchNameRaw: string,
  branchId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('online_sales_detections')
    .update({ branch_id: branchId })
    .eq('branch_name_raw', branchNameRaw)
    .is('branch_id', null)
    .select('id')

  if (error) throw new OnlineSalesError(`Gagal mengubah cabang: ${error.message}`, 500)
  return data?.length ?? 0
}

// =============================================
// SAVE — simpan/lengkapi rekonsiliasi (draft atau langsung posted)
// =============================================

export interface SaveOnlineSalesReportParams {
  reportDate: string
  branchId: string
  platform: OnlinePlatform
  grossAmount: number
  deductions: Array<{ deductionType: OnlineSalesDeductionType; label?: string; amount: number }>
  nettInputMode: OnlineSalesNettInputMode
  manualNettAmount?: number
  notes?: string
  status: 'draft' | 'posted'
  userId: string
}

export async function saveOnlineSalesReport(
  supabase: Supabase,
  params: SaveOnlineSalesReportParams
): Promise<{ id: string }> {
  const { totalDeduction, nett } = calculateOnlineSalesNett({
    gross: params.grossAmount,
    deductions: params.deductions.map((d) => ({ deduction_type: d.deductionType, amount: d.amount })),
    mode: params.nettInputMode,
    manualNett: params.manualNettAmount,
  })

  const { data: detectionRows } = await supabase
    .from('online_sales_detections')
    .select('detected_nett_amount')
    .eq('branch_id', params.branchId)
    .eq('platform', params.platform)
    .eq('transaction_date', params.reportDate)

  const detectedNettAmount = (detectionRows || []).reduce((s, r) => s + r.detected_nett_amount, 0)

  const { data: report, error } = await supabase
    .from('online_sales_reports')
    .upsert(
      {
        report_date: params.reportDate,
        branch_id: params.branchId,
        platform: params.platform,
        gross_amount: params.grossAmount,
        total_deduction: totalDeduction,
        nett_amount: nett,
        nett_input_mode: params.nettInputMode,
        detected_nett_amount: detectedNettAmount,
        status: params.status,
        notes: params.notes ?? '',
        created_by: params.userId,
        updated_by: params.userId,
      },
      { onConflict: 'report_date,branch_id,platform' }
    )
    .select('id')
    .single()

  if (error || !report) {
    throw new OnlineSalesError(`Gagal menyimpan rekonsiliasi: ${error?.message ?? 'unknown error'}`, 500)
  }

  // Replace rincian potongan
  await supabase.from('online_sales_deductions').delete().eq('report_id', report.id)
  if (params.deductions.length > 0) {
    const { error: deductionError } = await supabase.from('online_sales_deductions').insert(
      params.deductions.map((d) => ({
        report_id: report.id,
        deduction_type: d.deductionType,
        label: d.label ?? '',
        amount: d.amount,
      }))
    )
    if (deductionError) {
      throw new OnlineSalesError(`Gagal menyimpan rincian potongan: ${deductionError.message}`, 500)
    }
  }

  // Hubungkan transaksi kasir yang terdeteksi ke rekonsiliasi ini
  await supabase
    .from('online_sales_detections')
    .update({ online_sales_report_id: report.id })
    .eq('branch_id', params.branchId)
    .eq('platform', params.platform)
    .eq('transaction_date', params.reportDate)
    .is('online_sales_report_id', null)

  return { id: report.id }
}

// =============================================
// STATUS TRANSITIONS
// =============================================

export async function setOnlineSalesReportStatus(
  supabase: Supabase,
  id: string,
  status: OnlineSalesStatus,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('online_sales_reports')
    .update({ status, updated_by: userId })
    .eq('id', id)

  if (error) throw new OnlineSalesError(`Gagal mengubah status: ${error.message}`, 500)
}

// =============================================
// LIST / DETAIL — untuk histori & rekap
// =============================================

export interface ListOnlineSalesReportsFilters {
  branchId?: string
  platform?: OnlinePlatform
  status?: OnlineSalesStatus
  startDate?: string
  endDate?: string
}

export async function listOnlineSalesReports(
  supabase: Supabase,
  filters: ListOnlineSalesReportsFilters = {}
) {
  let query = supabase
    .from('online_sales_reports')
    .select('*, branch:branches(id,name)')
    .order('report_date', { ascending: false })

  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.platform) query = query.eq('platform', filters.platform)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.startDate) query = query.gte('report_date', filters.startDate)
  if (filters.endDate) query = query.lte('report_date', filters.endDate)

  const { data, error } = await query
  if (error) throw new OnlineSalesError(`Gagal memuat laporan penjualan online: ${error.message}`, 500)
  return data || []
}

export async function getOnlineSalesReportWithDeductions(supabase: Supabase, id: string) {
  const { data: report, error } = await supabase
    .from('online_sales_reports')
    .select('*, branch:branches(id,name)')
    .eq('id', id)
    .single()

  if (error || !report) throw new OnlineSalesError('Laporan tidak ditemukan.', 404)

  const { data: deductions } = await supabase
    .from('online_sales_deductions')
    .select('*')
    .eq('report_id', id)

  return { ...report, deductions: deductions || [] }
}
