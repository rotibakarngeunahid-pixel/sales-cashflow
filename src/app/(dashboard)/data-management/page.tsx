'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { formatDate } from '@/lib/utils/format'
import { invalidateCachedData, getOrFetchCached } from '@/lib/utils/client-cache'
import { format, addDays, parseISO } from 'date-fns'
import {
  AlertTriangle,
  Trash2,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Eye,
  RotateCcw,
  Calendar,
  Database,
  FileText,
  Wallet,
  Package,
  RefreshCw,
  History,
  ArrowLeftRight,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'form' | 'preview' | 'confirm' | 'deleting' | 'done'

interface PreviewData {
  salesReports: number
  cashflowTotal: number
  cashflowManual: number
  cashflowFromSales: number
  cashflowFromImport: number
  cashflowFromKasirSales: number
  cashflowFromKasirExpenses: number
  rawMaterialLogs: number
  kasirSyncQueueItems: number
  kasirImportLogs: number
  bebanTransfers: number
  grandTotal: number
}

interface DeleteResult {
  salesReports: number
  cashflowTransactions: number
  rawMaterialLogs: number
  kasirSyncQueueItems: number
  kasirImportLogs: number
  bebanTransfers: number
  errors: string[]
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DataManagementPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const [step, setStep] = useState<Step>('form')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null)
  const [confirmText, setConfirmText] = useState('')

  // ── Load profile ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const data = await getOrFetchCached<Profile | null>(
          `profile:${session.user.id}`,
          async () => {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single()
            return data
          },
          { ttlMs: 5 * 60_000 }
        )
        setProfile(data)
      }
      setProfileLoading(false)
    }
    loadProfile()
  }, [])

  // ── Access guard ───────────────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-rbn-red/30 border-t-rbn-red rounded-full animate-spin" />
      </div>
    )
  }

  if (profile?.role !== 'owner') {
    return (
      <div className="text-center py-20">
        <ShieldAlert className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Akses Ditolak</h2>
        <p className="text-gray-500 mt-2">Fitur ini hanya dapat diakses oleh Owner.</p>
      </div>
    )
  }

  // ── Preview handler ────────────────────────────────────────────────────────
  async function handlePreview() {
    if (!startDate || !endDate) {
      setValidationError('Tanggal mulai dan tanggal akhir wajib diisi.')
      return
    }
    if (startDate > endDate) {
      setValidationError('Tanggal mulai tidak boleh lebih besar dari tanggal akhir.')
      return
    }

    setValidationError(null)
    setLoading(true)

    const supabase = createClient()
    // For timestamp fields (imported_at), use < next day to capture the full end date
    const endDateNextDay = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd')

    const [
      { count: salesCount },
      { count: cfTotal },
      { count: cfManual },
      { count: cfSales },
      { count: cfImport },
      { count: cfKasirSales },
      { count: cfKasirExpenses },
      { count: rawCount },
      { count: kasirSyncCount },
      { count: kasirImportLogsCount },
      { count: bebanTransferCount },
    ] = await Promise.all([
      // Sales reports
      supabase
        .from('sales_reports')
        .select('*', { count: 'exact', head: true })
        .gte('report_date', startDate)
        .lte('report_date', endDate),

      // Cashflow total
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate),

      // Cashflow manual
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .eq('source', 'manual'),

      // Cashflow from sales
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .eq('source', 'sales'),

      // Cashflow from raw material import
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .eq('source', 'purchase_order'),

      // Cashflow from Kasir sales import/sync
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .eq('source', 'kasir_sales'),

      // Cashflow from Kasir expense import/sync
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .eq('source', 'kasir_expenses'),

      // Raw material import logs
      supabase
        .from('raw_material_import_logs')
        .select('*', { count: 'exact', head: true })
        .gte('imported_at', startDate)
        .lt('imported_at', endDateNextDay),

      // Confirmed Kasir sync queue is used as fallback in sales analysis.
      supabase
        .from('kasir_sync_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'confirmed')
        .gte('tanggal', startDate)
        .lte('tanggal', endDate),

      // Kasir import logs for the period
      supabase
        .from('kasir_import_logs')
        .select('*', { count: 'exact', head: true })
        .gte('period_start', startDate)
        .lte('period_start', endDate),

      // Riwayat transfer beban antar cabang
      supabase
        .from('beban_transfers')
        .select('*', { count: 'exact', head: true })
        .gte('transfer_date', startDate)
        .lte('transfer_date', endDate),
    ])

    setPreviewData({
      salesReports: salesCount ?? 0,
      cashflowTotal: cfTotal ?? 0,
      cashflowManual: cfManual ?? 0,
      cashflowFromSales: cfSales ?? 0,
      cashflowFromImport: cfImport ?? 0,
      cashflowFromKasirSales: cfKasirSales ?? 0,
      cashflowFromKasirExpenses: cfKasirExpenses ?? 0,
      rawMaterialLogs: rawCount ?? 0,
      kasirSyncQueueItems: kasirSyncCount ?? 0,
      kasirImportLogs: kasirImportLogsCount ?? 0,
      bebanTransfers: bebanTransferCount ?? 0,
      grandTotal: (salesCount ?? 0) + (cfTotal ?? 0) + (rawCount ?? 0) + (kasirSyncCount ?? 0) + (kasirImportLogsCount ?? 0) + (bebanTransferCount ?? 0),
    })

    setLoading(false)
    setStep('preview')
  }

  // ── Delete handler ─────────────────────────────────────────────────────────
  async function handleDelete() {
    if (confirmText !== 'HAPUS') return

    setStep('deleting')
    setLoading(true)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    const now = new Date().toISOString()
    const endDateNextDay = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd')

    const result: DeleteResult = {
      salesReports: 0,
      cashflowTransactions: 0,
      rawMaterialLogs: 0,
      kasirSyncQueueItems: 0,
      kasirImportLogs: 0,
      bebanTransfers: 0,
      errors: [],
    }

    // ── STEP 1: Collect IDs for relational cleanup ─────────────────────────

    // Get sales_report IDs in date range (to delete linked cashflow)
    const { data: salesReportRows } = await supabase
      .from('sales_reports')
      .select('id')
      .gte('report_date', startDate)
      .lte('report_date', endDate)
    const salesIds = (salesReportRows ?? []).map((r) => r.id)

    // Get raw_material_import_log IDs in date range (to delete linked cashflow)
    const { data: rawLogRows } = await supabase
      .from('raw_material_import_logs')
      .select('id')
      .gte('imported_at', startDate)
      .lt('imported_at', endDateNextDay)
    const rawIds = (rawLogRows ?? []).map((r) => r.id)

    // ── STEP 2: Delete cashflow_transactions linked to sales_reports ───────
    // These may have transaction_date outside the range — must be deleted first
    if (salesIds.length > 0) {
      const { data: deletedCfSales, error: cfSalesErr } = await supabase
        .from('cashflow_transactions')
        .delete()
        .eq('source', 'sales')
        .in('source_id', salesIds)
        .select('id')

      if (cfSalesErr) {
        result.errors.push(`Gagal hapus cashflow dari sales: ${cfSalesErr.message}`)
      } else {
        result.cashflowTransactions += (deletedCfSales ?? []).length
      }
    }

    // ── STEP 3: Delete cashflow_transactions linked to raw material imports ─
    if (rawIds.length > 0) {
      const { data: deletedCfRaw, error: cfRawErr } = await supabase
        .from('cashflow_transactions')
        .delete()
        .eq('source', 'purchase_order')
        .in('source_id', rawIds)
        .select('id')

      if (cfRawErr) {
        result.errors.push(`Gagal hapus cashflow dari bahan baku: ${cfRawErr.message}`)
      } else {
        result.cashflowTransactions += (deletedCfRaw ?? []).length
      }
    }

    // ── STEP 4: Delete remaining cashflow_transactions in date range ────────
    // Catches manual entries and file-imported cashflow not covered above
    const { data: deletedCfRemaining, error: cfRemainingErr } = await supabase
      .from('cashflow_transactions')
      .delete()
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .select('id')

    if (cfRemainingErr) {
      result.errors.push(`Gagal hapus cashflow manual/lainnya: ${cfRemainingErr.message}`)
    } else {
      result.cashflowTransactions += (deletedCfRemaining ?? []).length
    }

    // ── STEP 4b: Delete beban_transfers log in date range ──────────────────
    // Kedua cashflow transfer beban sudah ikut terhapus di STEP 4 (transaction_date
    // = transfer_date). Di sini hapus baris riwayat transfernya agar tidak orphan.
    const { data: deletedBebanTransfers, error: bebanTransferErr } = await supabase
      .from('beban_transfers')
      .delete()
      .gte('transfer_date', startDate)
      .lte('transfer_date', endDate)
      .select('id')

    if (bebanTransferErr) {
      result.errors.push(`Gagal hapus riwayat transfer beban: ${bebanTransferErr.message}`)
    } else {
      result.bebanTransfers = (deletedBebanTransfers ?? []).length
    }

    // ── STEP 5: Delete sales_reports in date range ─────────────────────────
    if (salesIds.length > 0) {
      const { data: deletedSales, error: salesErr } = await supabase
        .from('sales_reports')
        .delete()
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .select('id')

      if (salesErr) {
        result.errors.push(`Gagal hapus laporan penjualan: ${salesErr.message}`)
      } else {
        result.salesReports = (deletedSales ?? []).length
      }
    }

    // ── STEP 6: Delete raw_material_import_logs in date range ──────────────
    if (rawIds.length > 0) {
      const { data: deletedRaw, error: rawErr } = await supabase
        .from('raw_material_import_logs')
        .delete()
        .gte('imported_at', startDate)
        .lt('imported_at', endDateNextDay)
        .select('id')

      if (rawErr) {
        result.errors.push(`Gagal hapus log impor bahan baku: ${rawErr.message}`)
      } else {
        result.rawMaterialLogs = (deletedRaw ?? []).length
      }
    }

    // STEP 7: Disable confirmed Kasir sync queue rows.
    // Legacy sales analysis can use these rows as fallback totals.
    const { data: disabledKasirSync, error: kasirSyncErr } = await supabase
      .from('kasir_sync_queue')
      .update({
        status: 'rejected',
        confirmed_at: null,
        confirmed_by: null,
        rejected_at: now,
        rejected_by: user?.id ?? null,
        reject_reason: `Dibatalkan otomatis oleh Manajemen Data untuk periode ${startDate} s/d ${endDate}.`,
        cashflow_transaction_id: null,
      })
      .eq('status', 'confirmed')
      .gte('tanggal', startDate)
      .lte('tanggal', endDate)
      .select('id')

    if (kasirSyncErr) {
      result.errors.push(`Gagal menonaktifkan sync kasir terkonfirmasi: ${kasirSyncErr.message}`)
    } else {
      result.kasirSyncQueueItems = (disabledKasirSync ?? []).length
    }

    // STEP 8: Delete kasir_import_logs in date range
    const { data: deletedKasirImportLogs, error: kasirImportLogsErr } = await supabase
      .from('kasir_import_logs')
      .delete()
      .gte('period_start', startDate)
      .lte('period_start', endDate)
      .select('id')

    if (kasirImportLogsErr) {
      result.errors.push(`Gagal hapus riwayat import kasir: ${kasirImportLogsErr.message}`)
    } else {
      result.kasirImportLogs = (deletedKasirImportLogs ?? []).length
    }

    // STEP 9: Write audit log
    await supabase.from('audit_logs').insert({
      table_name: 'bulk_data_delete',
      record_id: null,
      action: 'bulk_data_deleted_by_date_range',
      old_data: null,
      new_data: {
        start_date: startDate,
        end_date: endDate,
        deleted: {
          sales_reports: result.salesReports,
          cashflow_transactions: result.cashflowTransactions,
          raw_material_import_logs: result.rawMaterialLogs,
          kasir_sync_queue_items_disabled: result.kasirSyncQueueItems,
          kasir_import_logs: result.kasirImportLogs,
          beban_transfers: result.bebanTransfers,
        },
        errors: result.errors,
      } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: now,
    })

    // STEP 10: Invalidate client-side caches
    invalidateCachedData(
      /^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:|sales-reports:|sales-analysis:|dashboard-today:|sales-report-status:)/
    )

    setDeleteResult(result)
    setLoading(false)
    setStep('done')
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  function reset() {
    setStep('form')
    setStartDate('')
    setEndDate('')
    setPreviewData(null)
    setDeleteResult(null)
    setConfirmText('')
    setValidationError(null)
  }

  const totalDeleted =
    (deleteResult?.salesReports ?? 0) +
    (deleteResult?.cashflowTransactions ?? 0) +
    (deleteResult?.rawMaterialLogs ?? 0) +
    (deleteResult?.kasirSyncQueueItems ?? 0) +
    (deleteResult?.kasirImportLogs ?? 0) +
    (deleteResult?.bebanTransfers ?? 0)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Manajemen Data</h2>
        <p className="text-sm text-gray-500">Hapus data transaksi berdasarkan rentang tanggal</p>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STEP: FORM — date range selection
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'form' && (
        <>
          {/* Warning banner */}
          <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold mb-1">Perhatian!</p>
              <p>
                Fitur ini menghapus data transaksi secara <strong>permanen</strong> dan menonaktifkan sync kasir terkait.
                Data yang sudah dihapus <strong>tidak dapat dikembalikan</strong>.
                Master data (cabang, staff, kategori, dll) tidak akan ikut terhapus.
              </p>
            </div>
          </div>

          {/* Form card */}
          <div className="card p-5 space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <Calendar className="w-5 h-5 text-rbn-orange" />
              <h3 className="font-semibold text-gray-900">Pilih Rentang Tanggal</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tanggal Mulai <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setValidationError(null) }}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tanggal Akhir <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setValidationError(null) }}
                  className="input-field"
                />
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {validationError}
              </div>
            )}

            {/* What will be deleted */}
            <div className="bg-red-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-3">
                Data yang dapat dihapus
              </p>
              <ul className="space-y-2 text-sm text-red-700">
                <li className="flex items-center gap-2">
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  Laporan Penjualan (sales_reports)
                </li>
                <li className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 flex-shrink-0" />
                  Transaksi Cashflow - manual, sales, bahan baku, import/sync kasir
                </li>
                <li className="flex items-center gap-2">
                  <Package className="w-4 h-4 flex-shrink-0" />
                  Log Impor Bahan Baku (raw_material_import_logs)
                </li>
                <li className="flex items-center gap-2">
                  <History className="w-4 h-4 flex-shrink-0" />
                  Riwayat Import Kasir (kasir_import_logs)
                </li>
                <li className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
                  Riwayat Transfer Beban antar cabang (beban_transfers)
                </li>
                <li className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 flex-shrink-0" />
                  Sync Kasir terkonfirmasi akan dinonaktifkan agar tidak masuk total kas
                </li>
              </ul>
            </div>

            {/* What will NOT be deleted */}
            <div className="bg-emerald-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-3">
                Master data yang TIDAK akan dihapus
              </p>
              <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm text-emerald-700">
                <span>✓ Cabang / Outlet</span>
                <span>✓ Kategori Cashflow</span>
                <span>✓ Data Staff / User</span>
                <span>✓ Setting Sistem</span>
                <span>✓ Audit Log</span>
                <span>✓ Akun Kas & Role</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handlePreview}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Memeriksa...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Cek Data
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: PREVIEW — show counts, proceed or cancel
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'preview' && previewData && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            <Eye className="w-5 h-5 text-rbn-orange" />
            <div>
              <h3 className="font-semibold text-gray-900">Preview Data yang Akan Dihapus</h3>
              <p className="text-xs text-slate-500">
                Periode: {formatDate(startDate)} — {formatDate(endDate)}
              </p>
            </div>
          </div>

          {/* No data case */}
          {previewData.grandTotal === 0 ? (
            <div className="text-center py-10">
              <Database className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">Tidak ada data yang bisa dihapus</p>
              <p className="text-sm text-slate-500 mt-1">
                Tidak ada data transaksi dalam rentang tanggal yang dipilih.
              </p>
              <button onClick={reset} className="btn-outline mt-4 text-sm">
                <RotateCcw className="w-4 h-4" />
                Pilih Tanggal Lain
              </button>
            </div>
          ) : (
            <>
              {/* Breakdown cards */}
              <div className="space-y-3">

                {/* Sales Reports */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Laporan Penjualan</p>
                      <p className="text-xs text-slate-500">sales_reports</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {previewData.salesReports.toLocaleString('id')} data
                  </span>
                </div>

                {/* Cashflow Transactions */}
                <div className="p-3 bg-slate-50 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Wallet className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Transaksi Cashflow</p>
                        <p className="text-xs text-slate-500">cashflow_transactions</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                      {previewData.cashflowTotal.toLocaleString('id')} data
                    </span>
                  </div>
                  {previewData.cashflowTotal > 0 && (
                    <div className="pl-8 text-xs text-slate-500 space-y-0.5">
                      <p>
                        Manual:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowManual.toLocaleString('id')}
                        </span>
                        &nbsp;|&nbsp; Sales:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowFromSales.toLocaleString('id')}
                        </span>
                        &nbsp;|&nbsp; Bahan Baku:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowFromImport.toLocaleString('id')}
                        </span>
                        &nbsp;|&nbsp; Kasir Sales:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowFromKasirSales.toLocaleString('id')}
                        </span>
                        &nbsp;|&nbsp; Kasir Kas Keluar:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowFromKasirExpenses.toLocaleString('id')}
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Raw Material Import Logs */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-orange-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Log Impor Bahan Baku</p>
                      <p className="text-xs text-slate-500">raw_material_import_logs</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {previewData.rawMaterialLogs.toLocaleString('id')} data
                  </span>
                </div>

                {/* Kasir Import Logs */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <History className="w-5 h-5 text-violet-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Riwayat Import Kasir</p>
                      <p className="text-xs text-slate-500">kasir_import_logs</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {previewData.kasirImportLogs.toLocaleString('id')} data
                  </span>
                </div>

                {/* Beban Transfers */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <ArrowLeftRight className="w-5 h-5 text-violet-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Riwayat Transfer Beban</p>
                      <p className="text-xs text-slate-500">beban_transfers</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {previewData.bebanTransfers.toLocaleString('id')} data
                  </span>
                </div>

                {/* Kasir Sync Queue */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-sky-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Sync Kasir Terkonfirmasi</p>
                      <p className="text-xs text-slate-500">kasir_sync_queue</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {previewData.kasirSyncQueueItems.toLocaleString('id')} data
                  </span>
                </div>

                {/* Grand Total */}
                <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-bold text-red-800">Total Data yang Akan Diproses</p>
                  <span className="text-sm font-bold text-red-800 bg-white px-3 py-1 rounded-lg border border-red-200">
                    {previewData.grandTotal.toLocaleString('id')} data
                  </span>
                </div>
              </div>

              {/* Danger warning */}
              <div className="flex gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">
                  <p className="font-semibold">Data yang dihapus TIDAK DAPAT dikembalikan!</p>
                  <p className="mt-1">
                    Pastikan Anda sudah mengekspor data yang diperlukan sebelum melanjutkan.
                    Proses ini akan menghapus atau menonaktifkan{' '}
                    <strong>{previewData.grandTotal.toLocaleString('id')} record</strong> yang terdampak.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <button onClick={reset} className="btn-outline text-sm">
                  <RotateCcw className="w-4 h-4" />
                  Kembali
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Lanjutkan ke Konfirmasi
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: CONFIRM — require typed confirmation "HAPUS"
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'confirm' && previewData && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-red-100">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-red-700">Konfirmasi Penghapusan Data</h3>
          </div>

          {/* Final danger box */}
          <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-sm text-red-800 space-y-3">
            <p className="font-bold text-base">⚠️ PERINGATAN TERAKHIR</p>
            <p>
              Anda akan menghapus atau menonaktifkan{' '}
              <strong>{previewData.grandTotal.toLocaleString('id')} record</strong> untuk
              periode:
            </p>
            <p className="text-base font-bold text-center py-2 bg-white rounded-lg border border-red-200">
              {formatDate(startDate)} — {formatDate(endDate)}
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>{previewData.salesReports.toLocaleString('id')} laporan penjualan</li>
              <li>{previewData.cashflowTotal.toLocaleString('id')} transaksi cashflow</li>
              <li>{previewData.rawMaterialLogs.toLocaleString('id')} log impor bahan baku</li>
              <li>{previewData.kasirImportLogs.toLocaleString('id')} riwayat import kasir</li>
              <li>{previewData.bebanTransfers.toLocaleString('id')} riwayat transfer beban</li>
              <li>{previewData.kasirSyncQueueItems.toLocaleString('id')} sync kasir terkonfirmasi</li>
            </ul>
            <p className="font-semibold">Tindakan ini TIDAK BISA DIBATALKAN.</p>
          </div>

          {/* Typed confirmation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ketik{' '}
              <strong className="text-red-600 font-mono bg-red-50 px-1 rounded">HAPUS</strong>{' '}
              untuk mengkonfirmasi penghapusan:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Ketik HAPUS di sini..."
              className="input-field font-mono"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {confirmText.length > 0 && confirmText !== 'HAPUS' && (
              <p className="text-xs text-red-500 mt-1">
                Ketik persis: <span className="font-mono font-bold">HAPUS</span>
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setStep('preview'); setConfirmText('') }}
              className="btn-outline text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Batal
            </button>
            <button
              onClick={handleDelete}
              disabled={confirmText !== 'HAPUS'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Hapus Data Permanen
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: DELETING — progress indicator
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'deleting' && (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 border-4 border-red-200 border-t-red-600 rounded-full animate-spin mx-auto mb-5" />
          <h3 className="text-base font-semibold text-slate-800">Sedang menghapus data...</h3>
          <p className="text-sm text-slate-500 mt-2">
            Mohon tunggu. Jangan tutup atau refresh halaman ini.
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: DONE — deletion report
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'done' && deleteResult && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            {deleteResult.errors.length === 0 ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <XCircle className="w-5 h-5 text-amber-600" />
            )}
            <div>
              <h3 className={`font-semibold ${
                deleteResult.errors.length === 0 ? 'text-emerald-700' : 'text-amber-700'
              }`}>
                {deleteResult.errors.length === 0
                  ? 'Data berhasil dihapus'
                  : 'Selesai dengan beberapa error'}
              </h3>
              <p className="text-xs text-slate-500">
                Periode: {formatDate(startDate)} — {formatDate(endDate)}
              </p>
            </div>
          </div>

          {/* Result breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Laporan Penghapusan
            </p>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-slate-700">Laporan Penjualan</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.salesReports.toLocaleString('id')} dihapus
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-slate-700">Transaksi Cashflow</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.cashflowTransactions.toLocaleString('id')} dihapus
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-slate-700">Log Impor Bahan Baku</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.rawMaterialLogs.toLocaleString('id')} dihapus
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-violet-500" />
                <span className="text-sm text-slate-700">Riwayat Import Kasir</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.kasirImportLogs.toLocaleString('id')} dihapus
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-violet-500" />
                <span className="text-sm text-slate-700">Riwayat Transfer Beban</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.bebanTransfers.toLocaleString('id')} dihapus
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-sky-500" />
                <span className="text-sm text-slate-700">Sync Kasir Terkonfirmasi</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {deleteResult.kasirSyncQueueItems.toLocaleString('id')} dinonaktifkan
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="text-sm font-bold text-emerald-800">Total Data Diproses</span>
              <span className="text-sm font-bold text-emerald-800">
                {totalDeleted.toLocaleString('id')} record
              </span>
            </div>
          </div>

          {/* Errors (if any) */}
          {deleteResult.errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm font-semibold text-red-700 mb-2">
                Error yang terjadi:
              </p>
              <ul className="space-y-1">
                {deleteResult.errors.map((err, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Audit note */}
          <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-xl text-xs text-slate-500">
            <Database className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
            <p>
              Penghapusan ini telah dicatat di Audit Log dengan detail lengkap
              (waktu, operator, jumlah data yang dihapus).
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={reset} className="btn-primary text-sm">
              <Trash2 className="w-4 h-4" />
              Hapus Data Lainnya
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
