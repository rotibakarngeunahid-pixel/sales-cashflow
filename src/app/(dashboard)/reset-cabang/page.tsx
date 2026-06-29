'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Eye,
  RotateCcw,
  Database,
  FileText,
  Wallet,
  History,
  ArrowLeftRight,
  Building2,
  Trash2,
  RefreshCw,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'form' | 'preview' | 'confirm' | 'resetting' | 'done'

type ModuleKey = 'penjualan' | 'cashflow_manual' | 'kasir' | 'transfer_beban'

interface Branch {
  id: string
  name: string
  is_active: boolean
}

interface PreviewData {
  // Penjualan module
  salesReports: number
  cashflowSales: number
  // Cashflow manual module
  cashflowManual: number
  // Kasir module
  cashflowKasir: number
  kasirImportLogs: number
  kasirSyncQueue: number
  // Transfer beban module
  cashflowBeban: number
  bebanTransfers: number
}

interface ResetResult {
  salesReports: number
  cashflowTransactions: number
  kasirImportLogs: number
  kasirSyncQueueRejected: number
  bebanTransfers: number
  errors: string[]
}

const MODULE_DEFS: {
  key: ModuleKey
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  tables: string
}[] = [
  {
    key: 'penjualan',
    label: 'Penjualan',
    description: 'Laporan penjualan harian dan cashflow yang dibuat dari penjualan',
    icon: FileText,
    tables: 'sales_reports, cashflow_transactions (source=sales)',
  },
  {
    key: 'cashflow_manual',
    label: 'Cashflow Manual',
    description: 'Transaksi cashflow kas masuk/keluar yang diinput atau diimport secara manual',
    icon: Wallet,
    tables: 'cashflow_transactions (source=manual)',
  },
  {
    key: 'kasir',
    label: 'Import & Sinkronisasi Kasir (POS)',
    description: 'Log import dari POS, antrian sinkronisasi kasir, dan cashflow bahan baku terkait',
    icon: History,
    tables: 'kasir_import_logs, kasir_sync_queue, cashflow_transactions (source=kasir_*,purchase_order)',
  },
  {
    key: 'transfer_beban',
    label: 'Transfer Beban Pokok',
    description: 'Riwayat transfer beban antar cabang yang melibatkan cabang ini (kedua sisi)',
    icon: ArrowLeftRight,
    tables: 'beban_transfers, cashflow_transactions (source=beban_transfer)',
  },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function ResetCabangPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [branches, setBranches] = useState<Branch[]>([])

  const [step, setStep] = useState<Step>('form')
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [selectedModules, setSelectedModules] = useState<Set<ModuleKey>>(new Set())
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [confirmBranchName, setConfirmBranchName] = useState('')
  const [confirmResetText, setConfirmResetText] = useState('')

  // ── Load profile & branches ────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.user) {
        const profileData = await getOrFetchCached<Profile | null>(
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
        setProfile(profileData)

        if (profileData?.role === 'owner') {
          const { data: branchData } = await supabase
            .from('branches')
            .select('id, name, is_active')
            .order('name')
          setBranches(branchData ?? [])
        }
      }
      setProfileLoading(false)
    }
    loadData()
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

  const selectedBranch = branches.find((b) => b.id === selectedBranchId)

  function toggleModule(key: ModuleKey) {
    setSelectedModules((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setValidationError(null)
  }

  function selectAllModules() {
    setSelectedModules(
      new Set<ModuleKey>(['penjualan', 'cashflow_manual', 'kasir', 'transfer_beban'])
    )
  }

  function clearAllModules() {
    setSelectedModules(new Set())
  }

  // ── Compute total from selected modules ────────────────────────────────────
  function computeSelectedTotal(): number {
    if (!previewData) return 0
    let total = 0
    if (selectedModules.has('penjualan'))
      total += previewData.salesReports + previewData.cashflowSales
    if (selectedModules.has('cashflow_manual')) total += previewData.cashflowManual
    if (selectedModules.has('kasir'))
      total +=
        previewData.kasirImportLogs + previewData.kasirSyncQueue + previewData.cashflowKasir
    if (selectedModules.has('transfer_beban'))
      total += previewData.bebanTransfers + previewData.cashflowBeban
    return total
  }

  // ── Preview handler ────────────────────────────────────────────────────────
  async function handlePreview() {
    if (!selectedBranchId) {
      setValidationError('Pilih cabang yang ingin direset terlebih dahulu.')
      return
    }
    if (selectedModules.size === 0) {
      setValidationError('Pilih minimal satu modul data yang ingin direset.')
      return
    }

    setValidationError(null)
    setLoading(true)

    const supabase = createClient()

    const [
      { count: salesCount },
      { count: cfSalesCount },
      { count: cfManualCount },
      { count: cfKasirCount },
      { count: cfBebanCount },
      { count: kasirImportCount },
      { count: kasirSyncCount },
      { count: bebanTransferCount },
    ] = await Promise.all([
      // Penjualan
      supabase
        .from('sales_reports')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId),
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId)
        .eq('source', 'sales'),

      // Cashflow manual
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId)
        .eq('source', 'manual'),

      // Kasir cashflow
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId)
        .in('source', ['kasir_sales', 'kasir_expenses', 'purchase_order']),

      // Transfer beban cashflow (cabang ini saja)
      supabase
        .from('cashflow_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId)
        .eq('source', 'beban_transfer'),

      // Kasir import logs
      supabase
        .from('kasir_import_logs')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId),

      // Kasir sync queue (semua status)
      supabase
        .from('kasir_sync_queue')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', selectedBranchId),

      // Beban transfers (as sender OR receiver)
      supabase
        .from('beban_transfers')
        .select('*', { count: 'exact', head: true })
        .or(`from_branch_id.eq.${selectedBranchId},to_branch_id.eq.${selectedBranchId}`),
    ])

    setPreviewData({
      salesReports: salesCount ?? 0,
      cashflowSales: cfSalesCount ?? 0,
      cashflowManual: cfManualCount ?? 0,
      cashflowKasir: cfKasirCount ?? 0,
      cashflowBeban: cfBebanCount ?? 0,
      kasirImportLogs: kasirImportCount ?? 0,
      kasirSyncQueue: kasirSyncCount ?? 0,
      bebanTransfers: bebanTransferCount ?? 0,
    })

    setLoading(false)
    setStep('preview')
  }

  // ── Reset handler ──────────────────────────────────────────────────────────
  async function handleReset() {
    if (
      !selectedBranch ||
      confirmBranchName !== selectedBranch.name ||
      confirmResetText !== 'RESET'
    )
      return

    setStep('resetting')
    setLoading(true)

    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const user = session?.user
    const now = new Date().toISOString()

    const result: ResetResult = {
      salesReports: 0,
      cashflowTransactions: 0,
      kasirImportLogs: 0,
      kasirSyncQueueRejected: 0,
      bebanTransfers: 0,
      errors: [],
    }

    // ── MODULE: PENJUALAN ──────────────────────────────────────────────────
    if (selectedModules.has('penjualan')) {
      // 1. Get sales report IDs for this branch (untuk link cashflow)
      const { data: salesRows } = await supabase
        .from('sales_reports')
        .select('id')
        .eq('branch_id', selectedBranchId)
      const salesIds = (salesRows ?? []).map((r) => r.id)

      // 2. Delete linked cashflow (source='sales') terlebih dahulu
      if (salesIds.length > 0) {
        const { data: deletedCfSales, error: cfSalesErr } = await supabase
          .from('cashflow_transactions')
          .delete()
          .eq('source', 'sales')
          .in('source_id', salesIds)
          .select('id')

        if (cfSalesErr) {
          result.errors.push(`Gagal hapus cashflow dari penjualan: ${cfSalesErr.message}`)
        } else {
          result.cashflowTransactions += (deletedCfSales ?? []).length
        }
      }

      // 3. Delete sales_reports
      const { data: deletedSales, error: salesErr } = await supabase
        .from('sales_reports')
        .delete()
        .eq('branch_id', selectedBranchId)
        .select('id')

      if (salesErr) {
        result.errors.push(`Gagal hapus laporan penjualan: ${salesErr.message}`)
      } else {
        result.salesReports = (deletedSales ?? []).length
      }
    }

    // ── MODULE: CASHFLOW MANUAL ────────────────────────────────────────────
    if (selectedModules.has('cashflow_manual')) {
      const { data: deletedManual, error: manualErr } = await supabase
        .from('cashflow_transactions')
        .delete()
        .eq('branch_id', selectedBranchId)
        .eq('source', 'manual')
        .select('id')

      if (manualErr) {
        result.errors.push(`Gagal hapus cashflow manual: ${manualErr.message}`)
      } else {
        result.cashflowTransactions += (deletedManual ?? []).length
      }
    }

    // ── MODULE: KASIR ──────────────────────────────────────────────────────
    if (selectedModules.has('kasir')) {
      // a. Delete cashflow dari kasir (kasir_sales, kasir_expenses, purchase_order)
      const { data: deletedKasirCf, error: kasirCfErr } = await supabase
        .from('cashflow_transactions')
        .delete()
        .eq('branch_id', selectedBranchId)
        .in('source', ['kasir_sales', 'kasir_expenses', 'purchase_order'])
        .select('id')

      if (kasirCfErr) {
        result.errors.push(`Gagal hapus cashflow kasir: ${kasirCfErr.message}`)
      } else {
        result.cashflowTransactions += (deletedKasirCf ?? []).length
      }

      // b. Delete kasir_import_logs
      const { data: deletedKasirLogs, error: kasirLogsErr } = await supabase
        .from('kasir_import_logs')
        .delete()
        .eq('branch_id', selectedBranchId)
        .select('id')

      if (kasirLogsErr) {
        result.errors.push(`Gagal hapus log import kasir: ${kasirLogsErr.message}`)
      } else {
        result.kasirImportLogs = (deletedKasirLogs ?? []).length
      }

      // c. Reject kasir_sync_queue (tidak ada DELETE policy, hanya UPDATE)
      const { data: rejectedSync, error: syncErr } = await supabase
        .from('kasir_sync_queue')
        .update({
          status: 'rejected',
          rejected_at: now,
          rejected_by: user?.id ?? null,
          reject_reason: `Reset data cabang ${selectedBranch?.name ?? ''} oleh owner.`,
          cashflow_transaction_id: null,
          confirmed_at: null,
          confirmed_by: null,
        })
        .eq('branch_id', selectedBranchId)
        .in('status', ['pending', 'confirmed'])
        .select('id')

      if (syncErr) {
        result.errors.push(`Gagal menonaktifkan antrian sync kasir: ${syncErr.message}`)
      } else {
        result.kasirSyncQueueRejected = (rejectedSync ?? []).length
      }
    }

    // ── MODULE: TRANSFER BEBAN ─────────────────────────────────────────────
    if (selectedModules.has('transfer_beban')) {
      // a. Ambil reference_group_id dari beban_transfers yang melibatkan cabang ini
      const { data: bebanRows } = await supabase
        .from('beban_transfers')
        .select('id, reference_group_id')
        .or(`from_branch_id.eq.${selectedBranchId},to_branch_id.eq.${selectedBranchId}`)

      const refGroupIds = (bebanRows ?? [])
        .map((r) => r.reference_group_id)
        .filter(Boolean) as string[]

      // b. Hapus SEMUA cashflow_transactions yang terkait (termasuk cabang lain yang terlibat)
      if (refGroupIds.length > 0) {
        const { data: deletedBebanCf, error: bebanCfErr } = await supabase
          .from('cashflow_transactions')
          .delete()
          .in('reference_group_id', refGroupIds)
          .eq('source', 'beban_transfer')
          .select('id')

        if (bebanCfErr) {
          result.errors.push(`Gagal hapus cashflow transfer beban: ${bebanCfErr.message}`)
        } else {
          result.cashflowTransactions += (deletedBebanCf ?? []).length
        }
      }

      // c. Hapus beban_transfers
      const { data: deletedBeban, error: bebanErr } = await supabase
        .from('beban_transfers')
        .delete()
        .or(`from_branch_id.eq.${selectedBranchId},to_branch_id.eq.${selectedBranchId}`)
        .select('id')

      if (bebanErr) {
        result.errors.push(`Gagal hapus riwayat transfer beban: ${bebanErr.message}`)
      } else {
        result.bebanTransfers = (deletedBeban ?? []).length
      }
    }

    // ── AUDIT LOG ──────────────────────────────────────────────────────────
    await supabase.from('audit_logs').insert({
      table_name: 'reset_data_cabang',
      record_id: null,
      action: 'branch_data_reset',
      old_data: null,
      new_data: {
        branch_id: selectedBranchId,
        branch_name: selectedBranch?.name,
        modules: Array.from(selectedModules),
        deleted: {
          sales_reports: result.salesReports,
          cashflow_transactions: result.cashflowTransactions,
          kasir_import_logs: result.kasirImportLogs,
          kasir_sync_queue_rejected: result.kasirSyncQueueRejected,
          beban_transfers: result.bebanTransfers,
        },
        errors: result.errors,
      } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: now,
    })

    // ── INVALIDATE CLIENT CACHE ────────────────────────────────────────────
    invalidateCachedData(
      /^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:|sales-reports:|sales-analysis:|dashboard-today:|sales-report-status:)/
    )

    setResetResult(result)
    setLoading(false)
    setStep('done')
  }

  // ── Reset form state ───────────────────────────────────────────────────────
  function resetForm() {
    setStep('form')
    setSelectedBranchId('')
    setSelectedModules(new Set())
    setPreviewData(null)
    setResetResult(null)
    setConfirmBranchName('')
    setConfirmResetText('')
    setValidationError(null)
  }

  const totalSelected = computeSelectedTotal()
  const totalDeleted =
    (resetResult?.salesReports ?? 0) +
    (resetResult?.cashflowTransactions ?? 0) +
    (resetResult?.kasirImportLogs ?? 0) +
    (resetResult?.kasirSyncQueueRejected ?? 0) +
    (resetResult?.bebanTransfers ?? 0)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Reset Data Cabang</h2>
        <p className="text-sm text-gray-500">
          Hapus data operasional per cabang. Cabang lain tidak akan terpengaruh.
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STEP: FORM
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'form' && (
        <>
          {/* Warning banner */}
          <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold mb-1">Perhatian!</p>
              <p>
                Fitur ini menghapus data operasional cabang secara <strong>permanen</strong>.
                Data yang sudah direset <strong>tidak dapat dikembalikan</strong>.
                Hanya cabang yang dipilih yang akan terdampak.
              </p>
            </div>
          </div>

          <div className="card p-5 space-y-5">
            {/* Branch selector */}
            <div>
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100 mb-3">
                <Building2 className="w-5 h-5 text-rbn-orange" />
                <h3 className="font-semibold text-gray-900">Pilih Cabang</h3>
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cabang yang akan direset <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedBranchId}
                onChange={(e) => {
                  setSelectedBranchId(e.target.value)
                  setValidationError(null)
                }}
                className="input-field"
              >
                <option value="">-- Pilih cabang --</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {!b.is_active ? ' (nonaktif)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Module selector */}
            <div>
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100 mb-3">
                <Database className="w-5 h-5 text-rbn-orange" />
                <h3 className="font-semibold text-gray-900">Pilih Modul Data</h3>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <button
                    onClick={selectAllModules}
                    className="text-rbn-red hover:underline font-medium"
                  >
                    Pilih Semua
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={clearAllModules}
                    className="text-slate-500 hover:underline"
                  >
                    Hapus Semua
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {MODULE_DEFS.map(({ key, label, description, icon: Icon, tables }) => {
                  const isChecked = selectedModules.has(key)
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        isChecked
                          ? 'border-red-300 bg-red-50/70'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleModule(key)}
                        className="mt-0.5 accent-rbn-red flex-shrink-0"
                      />
                      <Icon
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          isChecked ? 'text-rbn-red' : 'text-slate-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-semibold ${
                            isChecked ? 'text-red-800' : 'text-slate-700'
                          }`}
                        >
                          {label}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-mono">{tables}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* What will NOT be deleted */}
            <div className="bg-emerald-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">
                Data yang TIDAK akan dihapus
              </p>
              <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-xs text-emerald-700">
                <span>✓ Data cabang lain</span>
                <span>✓ Data user / staff</span>
                <span>✓ Master produk / menu</span>
                <span>✓ Kategori cashflow</span>
                <span>✓ Audit log</span>
                <span>✓ Setting & konfigurasi sistem</span>
                <span>✓ Mapping cabang kasir</span>
                <span>✓ Data cabang itu sendiri</span>
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {validationError}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={handlePreview} disabled={loading} className="btn-primary">
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Memeriksa...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Cek Preview Data
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: PREVIEW
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'preview' && previewData && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            <Eye className="w-5 h-5 text-rbn-orange" />
            <div>
              <h3 className="font-semibold text-gray-900">Preview Data yang Akan Direset</h3>
              <p className="text-xs text-slate-500">
                Cabang:{' '}
                <strong className="text-slate-800">{selectedBranch?.name}</strong>
              </p>
            </div>
          </div>

          {totalSelected === 0 ? (
            <div className="text-center py-10">
              <Database className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">Tidak ada data untuk direset</p>
              <p className="text-sm text-slate-500 mt-1">
                Cabang <strong>{selectedBranch?.name}</strong> tidak memiliki data untuk
                modul yang dipilih.
              </p>
              <button onClick={resetForm} className="btn-outline mt-4 text-sm">
                <RotateCcw className="w-4 h-4" />
                Kembali
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {/* Penjualan */}
                {selectedModules.has('penjualan') && (
                  <div className="p-3 bg-slate-50 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-blue-500" />
                        <p className="text-sm font-semibold text-slate-800">Penjualan</p>
                      </div>
                      <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                        {(previewData.salesReports + previewData.cashflowSales).toLocaleString('id')} data
                      </span>
                    </div>
                    <div className="pl-8 space-y-0.5 text-xs text-slate-500">
                      <p>
                        Laporan penjualan:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.salesReports.toLocaleString('id')}
                        </span>
                      </p>
                      <p>
                        Cashflow dari penjualan:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowSales.toLocaleString('id')}
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                {/* Cashflow manual */}
                {selectedModules.has('cashflow_manual') && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Wallet className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Cashflow Manual</p>
                        <p className="text-xs text-slate-500">cashflow_transactions (manual)</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                      {previewData.cashflowManual.toLocaleString('id')} data
                    </span>
                  </div>
                )}

                {/* Kasir */}
                {selectedModules.has('kasir') && (
                  <div className="p-3 bg-slate-50 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <History className="w-5 h-5 text-violet-500" />
                        <p className="text-sm font-semibold text-slate-800">
                          Import & Sinkronisasi Kasir
                        </p>
                      </div>
                      <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                        {(
                          previewData.kasirImportLogs +
                          previewData.kasirSyncQueue +
                          previewData.cashflowKasir
                        ).toLocaleString('id')}{' '}
                        data
                      </span>
                    </div>
                    <div className="pl-8 space-y-0.5 text-xs text-slate-500">
                      <p>
                        Log import kasir:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.kasirImportLogs.toLocaleString('id')}
                        </span>
                      </p>
                      <p>
                        Antrian sinkronisasi:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.kasirSyncQueue.toLocaleString('id')}
                        </span>{' '}
                        <span className="text-slate-400">(akan dinonaktifkan)</span>
                      </p>
                      <p>
                        Cashflow dari kasir &amp; bahan baku:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowKasir.toLocaleString('id')}
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                {/* Transfer beban */}
                {selectedModules.has('transfer_beban') && (
                  <div className="p-3 bg-slate-50 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ArrowLeftRight className="w-5 h-5 text-orange-500" />
                        <p className="text-sm font-semibold text-slate-800">Transfer Beban</p>
                      </div>
                      <span className="text-sm font-bold text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200">
                        {(
                          previewData.bebanTransfers + previewData.cashflowBeban
                        ).toLocaleString('id')}{' '}
                        data
                      </span>
                    </div>
                    <div className="pl-8 space-y-0.5 text-xs text-slate-500">
                      <p>
                        Riwayat transfer:{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.bebanTransfers.toLocaleString('id')}
                        </span>
                      </p>
                      <p>
                        Cashflow transfer (cabang ini):{' '}
                        <span className="font-medium text-slate-700">
                          {previewData.cashflowBeban.toLocaleString('id')}
                        </span>
                      </p>
                    </div>
                    {previewData.bebanTransfers > 0 && (
                      <div className="pl-8">
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                          Cashflow transfer beban di cabang lain yang terlibat juga akan ikut
                          dihapus.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Grand total */}
                <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-bold text-red-800">Total Data yang Akan Direset</p>
                  <span className="text-sm font-bold text-red-800 bg-white px-3 py-1 rounded-lg border border-red-200">
                    {totalSelected.toLocaleString('id')} data
                  </span>
                </div>
              </div>

              <div className="flex gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">
                  <p className="font-semibold">Data yang direset TIDAK DAPAT dikembalikan!</p>
                  <p className="mt-1">
                    Hanya data cabang <strong>{selectedBranch?.name}</strong> yang akan
                    terdampak. Data cabang lain tetap aman.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={resetForm} className="btn-outline text-sm">
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
          STEP: CONFIRM
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'confirm' && previewData && selectedBranch && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-red-100">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-red-700">Konfirmasi Reset Data Cabang</h3>
          </div>

          <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-sm text-red-800 space-y-3">
            <p className="font-bold text-base">⚠️ PERINGATAN TERAKHIR</p>
            <p>
              Anda akan mereset{' '}
              <strong>{totalSelected.toLocaleString('id')} record</strong> dari cabang:
            </p>
            <p className="text-base font-bold text-center py-2 bg-white rounded-lg border border-red-200">
              {selectedBranch.name}
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              {selectedModules.has('penjualan') && (
                <li>
                  {(previewData.salesReports + previewData.cashflowSales).toLocaleString('id')}{' '}
                  data penjualan
                </li>
              )}
              {selectedModules.has('cashflow_manual') && (
                <li>
                  {previewData.cashflowManual.toLocaleString('id')} cashflow manual
                </li>
              )}
              {selectedModules.has('kasir') && (
                <li>
                  {(
                    previewData.kasirImportLogs +
                    previewData.kasirSyncQueue +
                    previewData.cashflowKasir
                  ).toLocaleString('id')}{' '}
                  data kasir
                </li>
              )}
              {selectedModules.has('transfer_beban') && (
                <li>
                  {(previewData.bebanTransfers + previewData.cashflowBeban).toLocaleString('id')}{' '}
                  data transfer beban
                </li>
              )}
            </ul>
            <p className="font-semibold">Tindakan ini TIDAK BISA DIBATALKAN.</p>
          </div>

          {/* Konfirmasi 1: ketik nama cabang */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ketik nama cabang{' '}
              <strong className="text-red-600 font-mono bg-red-50 px-1 rounded">
                {selectedBranch.name}
              </strong>{' '}
              untuk mengkonfirmasi:
            </label>
            <input
              type="text"
              value={confirmBranchName}
              onChange={(e) => setConfirmBranchName(e.target.value)}
              placeholder={`Ketik: ${selectedBranch.name}`}
              className="input-field font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {confirmBranchName.length > 0 && confirmBranchName !== selectedBranch.name && (
              <p className="text-xs text-red-500 mt-1">
                Harus persis:{' '}
                <span className="font-mono font-bold">{selectedBranch.name}</span>
              </p>
            )}
          </div>

          {/* Konfirmasi 2: ketik RESET */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ketik{' '}
              <strong className="text-red-600 font-mono bg-red-50 px-1 rounded">RESET</strong>{' '}
              untuk melanjutkan:
            </label>
            <input
              type="text"
              value={confirmResetText}
              onChange={(e) => setConfirmResetText(e.target.value)}
              placeholder="Ketik RESET di sini..."
              className="input-field font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {confirmResetText.length > 0 && confirmResetText !== 'RESET' && (
              <p className="text-xs text-red-500 mt-1">
                Harus persis: <span className="font-mono font-bold">RESET</span>
              </p>
            )}
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setStep('preview')
                setConfirmBranchName('')
                setConfirmResetText('')
              }}
              className="btn-outline text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Batal
            </button>
            <button
              onClick={handleReset}
              disabled={
                confirmBranchName !== selectedBranch.name || confirmResetText !== 'RESET'
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Reset Data Cabang
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: RESETTING
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'resetting' && (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 border-4 border-red-200 border-t-red-600 rounded-full animate-spin mx-auto mb-5" />
          <h3 className="text-base font-semibold text-slate-800">
            Sedang mereset data cabang {selectedBranch?.name}...
          </h3>
          <p className="text-sm text-slate-500 mt-2">
            Mohon tunggu. Jangan tutup atau refresh halaman ini.
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP: DONE
      ════════════════════════════════════════════════════════════════════ */}
      {step === 'done' && resetResult && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            {resetResult.errors.length === 0 ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <XCircle className="w-5 h-5 text-amber-600" />
            )}
            <div>
              <h3
                className={`font-semibold ${
                  resetResult.errors.length === 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {resetResult.errors.length === 0
                  ? `Data cabang ${selectedBranch?.name} berhasil direset`
                  : 'Selesai dengan beberapa error'}
              </h3>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Laporan Reset
            </p>

            {resetResult.salesReports > 0 && (
              <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-slate-700">Laporan Penjualan</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {resetResult.salesReports.toLocaleString('id')} dihapus
                </span>
              </div>
            )}

            {resetResult.cashflowTransactions > 0 && (
              <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm text-slate-700">Transaksi Cashflow</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {resetResult.cashflowTransactions.toLocaleString('id')} dihapus
                </span>
              </div>
            )}

            {resetResult.kasirImportLogs > 0 && (
              <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-violet-500" />
                  <span className="text-sm text-slate-700">Log Import Kasir</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {resetResult.kasirImportLogs.toLocaleString('id')} dihapus
                </span>
              </div>
            )}

            {resetResult.kasirSyncQueueRejected > 0 && (
              <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-sky-500" />
                  <span className="text-sm text-slate-700">Antrian Sync Kasir</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {resetResult.kasirSyncQueueRejected.toLocaleString('id')} dinonaktifkan
                </span>
              </div>
            )}

            {resetResult.bebanTransfers > 0 && (
              <div className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-slate-700">Riwayat Transfer Beban</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {resetResult.bebanTransfers.toLocaleString('id')} dihapus
                </span>
              </div>
            )}

            {totalDeleted === 0 && resetResult.errors.length === 0 && (
              <div className="p-3 bg-slate-50 rounded-xl text-center text-sm text-slate-500">
                Tidak ada data yang direset.
              </div>
            )}

            {totalDeleted > 0 && (
              <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-sm font-bold text-emerald-800">Total Data Diproses</span>
                <span className="text-sm font-bold text-emerald-800">
                  {totalDeleted.toLocaleString('id')} record
                </span>
              </div>
            )}
          </div>

          {resetResult.errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm font-semibold text-red-700 mb-2">Error yang terjadi:</p>
              <ul className="space-y-1">
                {resetResult.errors.map((err, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-xl text-xs text-slate-500">
            <Database className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
            <p>
              Reset ini telah dicatat di Audit Log dengan detail lengkap (waktu, operator,
              cabang, modul, jumlah data yang terdampak).
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={resetForm} className="btn-primary text-sm">
              <RotateCcw className="w-4 h-4" />
              Reset Cabang Lain
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
