'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { CheckCircle2, XCircle, X, Pencil, RefreshCw, Smartphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatRupiah, formatDate } from '@/lib/utils/format'
import { PLATFORM_LABELS } from '@/lib/kasir-import/shared'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import StatCard from '@/components/ui/StatCard'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import OnlineSalesForm, {
  type OnlineSalesFormTarget,
  type OnlineSalesFormInitialData,
} from '@/components/sales/OnlineSalesForm'
import type { Branch, OnlinePlatform, OnlineSalesReport, OnlineSalesStatus } from '@/types/database'

interface PendingGroupApi {
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

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
        type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
      <span>{message}</span>
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function PlatformBadge({ platform }: { platform: OnlinePlatform }) {
  const colors: Record<OnlinePlatform, string> = {
    gofood: 'bg-emerald-100 text-emerald-700',
    grabfood: 'bg-green-100 text-green-700',
    shopeefood: 'bg-orange-100 text-orange-700',
  }
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${colors[platform]}`}>{PLATFORM_LABELS[platform]}</span>
}

function StatusBadge({ status }: { status: OnlineSalesStatus }) {
  const map: Record<OnlineSalesStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'badge-draft' },
    posted: { label: 'Posted', className: 'badge-posted' },
    void: { label: 'Void', className: 'badge-void' },
  }
  const { label, className } = map[status]
  return <span className={className}>{label}</span>
}

export default function OnlineSalesPage() {
  const [loadingPending, setLoadingPending] = useState(true)
  const [pendingGroups, setPendingGroups] = useState<PendingGroupApi[]>([])
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Recap/history filters
  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loadingReports, setLoadingReports] = useState(true)
  const [reports, setReports] = useState<OnlineSalesReport[]>([])

  // Form modal (complete pending group OR edit existing report)
  const [formTarget, setFormTarget] = useState<OnlineSalesFormTarget | null>(null)
  const [formInitialData, setFormInitialData] = useState<OnlineSalesFormInitialData | null>(null)
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Void confirm
  const [voidTarget, setVoidTarget] = useState<OnlineSalesReport | null>(null)
  const [voiding, setVoiding] = useState(false)

  // Unmatched branch assignment
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({})
  const [assigning, setAssigning] = useState<string | null>(null)

  const loadPending = useCallback(async () => {
    setLoadingPending(true)
    try {
      const res = await fetch('/api/online-sales/pending')
      const json = await res.json()
      if (json.success) {
        setPendingGroups(json.groups)
      } else {
        showToast(json.message || 'Gagal memuat transaksi online.', 'error')
      }
    } catch {
      showToast('Gagal terhubung ke server.', 'error')
    } finally {
      setLoadingPending(false)
    }
  }, [showToast])

  const loadReports = useCallback(async () => {
    setLoadingReports(true)
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
      if (filterBranch) params.set('branch_id', filterBranch)
      if (filterPlatform) params.set('platform', filterPlatform)
      if (filterStatus) params.set('status', filterStatus)

      const res = await fetch(`/api/online-sales/reports?${params.toString()}`)
      const json = await res.json()
      if (json.success) {
        setReports(json.reports)
      } else {
        showToast(json.message || 'Gagal memuat laporan penjualan online.', 'error')
      }
    } catch {
      showToast('Gagal terhubung ke server.', 'error')
    } finally {
      setLoadingReports(false)
    }
  }, [startDate, endDate, filterBranch, filterPlatform, filterStatus, showToast])

  useEffect(() => { loadPending() }, [loadPending])
  useEffect(() => { loadReports() }, [loadReports])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const br = await getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
        'branches:active',
        async () => {
          const { data } = await supabase.from('branches').select('id,name').eq('is_active', true).is('deleted_at', null).order('name')
          return data || []
        },
        { ttlMs: 5 * 60_000 }
      )
      setBranches(br)
    }
    init()
  }, [])

  const matchedGroups = pendingGroups.filter((g) => g.branchId)
  const unmatchedGroups = pendingGroups.filter((g) => !g.branchId)
  const unmatchedNames = Array.from(new Set(unmatchedGroups.map((g) => g.branchName)))

  const platformPending = (['gofood', 'grabfood', 'shopeefood'] as OnlinePlatform[]).map((p) => ({
    platform: p,
    count: matchedGroups.filter((g) => g.platform === p).length,
    amount: matchedGroups.filter((g) => g.platform === p).reduce((s, g) => s + g.detectedAmount, 0),
  }))

  const recapTotals = reports
    .filter((r) => r.status !== 'void')
    .reduce(
      (acc, r) => ({
        gross: acc.gross + r.gross_amount,
        deduction: acc.deduction + r.total_deduction,
        nett: acc.nett + r.nett_amount,
      }),
      { gross: 0, deduction: 0, nett: 0 }
    )

  function openCompleteForm(group: PendingGroupApi) {
    setFormTarget({
      branchId: group.branchId!,
      branchName: group.branchName,
      platform: group.platform,
      reportDate: group.reportDate,
      detectedAmount: group.detectedAmount,
    })
    if (group.existingReportId) {
      loadReportDetail(group.existingReportId)
    } else {
      setFormInitialData(null)
      setFormModalOpen(true)
    }
  }

  async function loadReportDetail(id: string) {
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/online-sales/reports/${id}`)
      const json = await res.json()
      if (json.success) {
        setFormInitialData(json.report)
        setFormModalOpen(true)
      } else {
        showToast(json.message || 'Gagal memuat detail laporan.', 'error')
      }
    } finally {
      setLoadingDetail(false)
    }
  }

  function openEditReport(report: OnlineSalesReport) {
    setFormTarget({
      branchId: report.branch_id,
      branchName: report.branch?.name || '-',
      platform: report.platform,
      reportDate: report.report_date,
      detectedAmount: report.detected_nett_amount,
    })
    loadReportDetail(report.id)
  }

  function handleFormSuccess(msg: string) {
    setFormModalOpen(false)
    showToast(msg, 'success')
    invalidateCachedData(/^(cashflow:|dashboard:|dashboard-today:|cash-positions:)/)
    loadPending()
    loadReports()
  }

  async function handleAssignBranch(branchName: string) {
    const branchId = assignSelections[branchName]
    if (!branchId) return
    setAssigning(branchName)
    try {
      const res = await fetch('/api/online-sales/pending', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_name_raw: branchName, branch_id: branchId }),
      })
      const json = await res.json()
      if (json.success) {
        showToast(`Cabang "${branchName}" berhasil ditautkan.`, 'success')
        loadPending()
      } else {
        showToast(json.message || 'Gagal mengubah cabang.', 'error')
      }
    } finally {
      setAssigning(null)
    }
  }

  async function handleVoid() {
    if (!voidTarget) return
    setVoiding(true)
    try {
      const res = await fetch(`/api/online-sales/reports/${voidTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'void' }),
      })
      const json = await res.json()
      if (json.success) {
        showToast('Laporan berhasil divoid.', 'success')
        invalidateCachedData(/^(cashflow:|dashboard:|dashboard-today:|cash-positions:)/)
        loadReports()
      } else {
        showToast(json.message || 'Gagal void laporan.', 'error')
      }
    } finally {
      setVoiding(false)
      setVoidTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h2 className="text-xl font-bold text-gray-900">Penjualan Online</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Kelola transaksi GoFood/GrabFood/ShopeeFood yang terdeteksi dari kasir — lengkapi gross &amp; potongan agar nett sales tercatat benar.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {platformPending.map((p) => (
          <StatCard
            key={p.platform}
            title={`${PLATFORM_LABELS[p.platform]} — Menunggu`}
            value={formatRupiah(p.amount)}
            subtitle={`${p.count} hari/cabang belum dilengkapi`}
            icon={<Smartphone className="w-5 h-5 text-slate-500" />}
          />
        ))}
      </div>

      {/* Pending section */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-950">Transaksi Terdeteksi — Menunggu Dilengkapi</h3>
          <button onClick={loadPending} className="btn-outline flex items-center gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {loadingPending ? (
          <PageLoading />
        ) : matchedGroups.length === 0 && unmatchedGroups.length === 0 ? (
          <EmptyState title="Tidak ada transaksi menunggu" description="Semua transaksi online yang terdeteksi sudah dilengkapi." />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full table-fixed">
                <thead>
                  <tr>
                    <th className="table-header w-[12%]">Tanggal</th>
                    <th className="table-header w-[20%]">Cabang</th>
                    <th className="table-header w-[14%]">Platform</th>
                    <th className="table-header text-right">Nett Terdeteksi</th>
                    <th className="table-header text-center w-[10%]">Transaksi</th>
                    <th className="table-header w-[14%] text-center">Status</th>
                    <th className="table-header w-[12%] text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {matchedGroups.map((g) => (
                    <tr key={g.key} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium">{formatDate(g.reportDate, 'dd/MM/yy')}</td>
                      <td className="table-cell"><div className="truncate">{g.branchName}</div></td>
                      <td className="table-cell"><PlatformBadge platform={g.platform} /></td>
                      <td className="table-cell text-right font-semibold text-rupiah">{formatRupiah(g.detectedAmount)}</td>
                      <td className="table-cell text-center">{g.detectedCount}</td>
                      <td className="table-cell text-center">
                        {g.existingReportStatus ? <StatusBadge status={g.existingReportStatus} /> : <span className="text-xs text-slate-400">Baru</span>}
                      </td>
                      <td className="table-cell text-right">
                        <button
                          onClick={() => openCompleteForm(g)}
                          disabled={loadingDetail}
                          className="btn-primary text-xs px-3 py-1.5"
                        >
                          {g.existingReportStatus ? 'Lanjutkan' : 'Lengkapi'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-3 md:hidden">
              {matchedGroups.map((g) => (
                <article key={g.key} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{formatDate(g.reportDate, 'dd MMM yyyy')}</p>
                      <p className="truncate text-xs text-slate-500">{g.branchName}</p>
                    </div>
                    <PlatformBadge platform={g.platform} />
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500">Nett Terdeteksi ({g.detectedCount} transaksi)</p>
                      <p className="font-bold text-slate-900 text-rupiah">{formatRupiah(g.detectedAmount)}</p>
                    </div>
                    {g.existingReportStatus && <StatusBadge status={g.existingReportStatus} />}
                  </div>
                  <button onClick={() => openCompleteForm(g)} className="btn-primary text-sm w-full mt-3">
                    {g.existingReportStatus ? 'Lanjutkan' : 'Lengkapi'}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}

        {unmatchedNames.length > 0 && (
          <div className="p-4 border-t border-amber-100 bg-amber-50 space-y-2">
            <p className="text-xs font-bold text-amber-800">Cabang tidak dikenali — pilih cabang tujuan:</p>
            {unmatchedNames.map((name) => (
              <div key={name} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-amber-900 flex-1 min-w-[120px]">{name}</span>
                <select
                  value={assignSelections[name] || ''}
                  onChange={(e) => setAssignSelections((s) => ({ ...s, [name]: e.target.value }))}
                  className="input-field text-sm w-48"
                >
                  <option value="">Pilih cabang...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleAssignBranch(name)}
                  disabled={!assignSelections[name] || assigning === name}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  {assigning === name ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recap & history */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-slate-950 mb-3">Rekap &amp; Riwayat</h3>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Cabang"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectFilter
            value={filterPlatform}
            onChange={setFilterPlatform}
            placeholder="Semua Platform"
            options={(['gofood', 'grabfood', 'shopeefood'] as OnlinePlatform[]).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
          />
          <SelectFilter
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Semua Status"
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'posted', label: 'Posted' },
              { value: 'void', label: 'Void' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Total Gross</p>
          <p className="text-base font-bold text-gray-900 text-rupiah">{formatRupiah(recapTotals.gross)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Total Potongan</p>
          <p className="text-base font-bold text-red-600 text-rupiah">-{formatRupiah(recapTotals.deduction)}</p>
        </div>
        <div className="card p-3 text-center bg-rbn-red">
          <p className="text-xs text-white/70 mb-0.5">Total Nett</p>
          <p className="text-base font-bold text-white text-rupiah">{formatRupiah(recapTotals.nett)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loadingReports ? (
          <PageLoading />
        ) : reports.length === 0 ? (
          <EmptyState title="Tidak ada laporan" description="Belum ada laporan penjualan online untuk filter yang dipilih." />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full table-fixed">
                <thead>
                  <tr>
                    <th className="table-header w-[10%]">Tanggal</th>
                    <th className="table-header w-[16%]">Cabang</th>
                    <th className="table-header w-[10%]">Platform</th>
                    <th className="table-header text-right">Gross</th>
                    <th className="table-header text-right">Potongan</th>
                    <th className="table-header text-right">Nett</th>
                    <th className="table-header w-[9%] text-center">Status</th>
                    <th className="table-header w-[10%] text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium">{formatDate(r.report_date, 'dd/MM/yy')}</td>
                      <td className="table-cell"><div className="truncate">{r.branch?.name || '-'}</div></td>
                      <td className="table-cell"><PlatformBadge platform={r.platform} /></td>
                      <td className="table-cell text-right text-rupiah">{formatRupiah(r.gross_amount)}</td>
                      <td className="table-cell text-right text-red-600 text-rupiah">-{formatRupiah(r.total_deduction)}</td>
                      <td className="table-cell text-right font-bold text-rbn-red text-rupiah">{formatRupiah(r.nett_amount)}</td>
                      <td className="table-cell text-center"><StatusBadge status={r.status} /></td>
                      <td className="table-cell">
                        <div className="flex items-center justify-end gap-1">
                          {r.status !== 'void' && (
                            <button
                              onClick={() => openEditReport(r)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {r.status === 'posted' && (
                            <button
                              onClick={() => setVoidTarget(r)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                              title="Void"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-3 md:hidden">
              {reports.map((r) => (
                <article key={r.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{formatDate(r.report_date, 'dd MMM yyyy')}</p>
                      <p className="truncate text-xs text-slate-500">{r.branch?.name || '-'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <PlatformBadge platform={r.platform} />
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Nett</p>
                    <p className="break-words text-xl font-bold text-rbn-red text-rupiah">{formatRupiah(r.nett_amount)}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Gross</p>
                        <p className="break-words font-semibold text-slate-900 text-rupiah">{formatRupiah(r.gross_amount)}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="text-xs text-slate-500">Potongan</p>
                        <p className="break-words font-semibold text-red-600 text-rupiah">-{formatRupiah(r.total_deduction)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    {r.status !== 'void' && (
                      <button
                        onClick={() => openEditReport(r)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {r.status === 'posted' && (
                      <button
                        onClick={() => setVoidTarget(r)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Void"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Form Modal */}
      <Modal
        isOpen={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        title="Lengkapi Penjualan Online"
        size="lg"
      >
        {formTarget && (
          <OnlineSalesForm
            target={formTarget}
            initialData={formInitialData}
            onSuccess={handleFormSuccess}
            onCancel={() => setFormModalOpen(false)}
          />
        )}
      </Modal>

      {/* Void confirm */}
      <ConfirmModal
        isOpen={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={handleVoid}
        loading={voiding}
        title="Void Laporan Penjualan Online"
        description={`Void laporan ${voidTarget?.branch?.name} (${voidTarget ? PLATFORM_LABELS[voidTarget.platform] : ''}) tanggal ${formatDate(voidTarget?.report_date || '')}? Cashflow terkait juga akan divoid.`}
        confirmLabel="Void"
        confirmClass="bg-rbn-red hover:bg-rbn-red-dark text-white"
      />
    </div>
  )
}
