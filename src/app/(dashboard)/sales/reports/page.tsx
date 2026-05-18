'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus, Eye, Pencil, CheckCircle, XCircle,
  FileSpreadsheet, RefreshCw, Trash2, CheckCircle2, X
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { SalesReport, SalesStatus, Branch, Profile } from '@/types/database'
import { formatDate, formatRupiah } from '@/lib/utils/format'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { SalesBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import SalesForm from '@/components/sales/SalesForm'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { getCachedData, getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'

type ActionType = 'post' | 'void'
const SALES_REPORTS_TOAST_KEY = 'salesReportsToast'

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
        type === 'success'
          ? 'bg-emerald-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success'
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        : <XCircle className="w-4 h-4 flex-shrink-0" />
      }
      <span>{message}</span>
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function SalesReportsPage() {
  const [reports, setReports] = useState<SalesReport[]>([])
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const toastTimerRef = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    let message: string | null = null

    try {
      message = window.sessionStorage.getItem(SALES_REPORTS_TOAST_KEY)
      if (message) window.sessionStorage.removeItem(SALES_REPORTS_TOAST_KEY)
    } catch {
      message = null
    }

    if (message) toastTimerRef(message, 'success')
  }, [toastTimerRef])

  // Filters
  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Modals
  const [editReport, setEditReport] = useState<SalesReport | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [detailReport, setDetailReport] = useState<SalesReport | null>(null)
  const [actionTarget, setActionTarget] = useState<{ report: SalesReport; type: ActionType } | null>(null)
  const [actioning, setActioning] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SalesReport | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const isOwner = profile?.role === 'owner'

  async function handleExport() {
    const { exportSalesToExcel } = await import('@/lib/utils/export')
    exportSalesToExcel(reports)
  }

  const canDeleteSales = useCallback((report: SalesReport) => (
    isOwner && ['draft', 'submitted', 'void'].includes(report.status)
  ), [isOwner])

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const cacheKey = `sales-reports:${startDate}:${endDate}:${filterBranch || 'all'}:${filterStatus || 'all'}`
    const cached = getCachedData<SalesReport[]>(cacheKey)

    if (cached && !options.force) {
      setReports(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const data = await getOrFetchCached<SalesReport[]>(
      cacheKey,
      async () => {
        let query = supabase
          .from('sales_reports')
          .select('*, branch:branches(id,name)')
          .gte('report_date', startDate)
          .lte('report_date', endDate)
          .order('report_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (filterBranch) query = query.eq('branch_id', filterBranch)
        if (filterStatus) query = query.eq('status', filterStatus as SalesStatus)

        const { data } = await query
        return data || []
      },
      { ttlMs: 60_000, force: options.force || Boolean(cached) }
    )

    setReports(data)
    setLoading(false)
  }, [startDate, endDate, filterBranch, filterStatus])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const [{ data: { session } }, br] = await Promise.all([
        supabase.auth.getSession(),
        getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
          'branches:active',
          async () => {
            const { data } = await supabase.from('branches').select('id,name').eq('is_active', true).is('deleted_at', null).order('name')
            return data || []
          },
          { ttlMs: 5 * 60_000 }
        ),
      ])
      setBranches(br)
      if (session?.user) {
        const prof = await getOrFetchCached<Profile | null>(
          `profile:${session.user.id}`,
          async () => {
            const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
            return data
          },
          { ttlMs: 5 * 60_000 }
        )
        setProfile(prof)
      }
    }
    init()
  }, [])

  async function handleAction() {
    if (!actionTarget) return
    setActioning(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    const newStatus: SalesStatus = actionTarget.type === 'post' ? 'posted' : 'void'
    const oldReport = actionTarget.report

    const { error: updateError } = await supabase.from('sales_reports')
      .update({ status: newStatus, updated_by: user?.id ?? null })
      .eq('id', oldReport.id)

    if (updateError) {
      toastTimerRef(`Gagal: ${updateError.message}`, 'error')
      setActioning(false)
      setActionTarget(null)
      return
    }

    const auditAction = actionTarget.type === 'post' ? 'sales_posted' : 'sales_voided'
    await supabase.from('audit_logs').insert({
      table_name: 'sales_reports',
      record_id: oldReport.id,
      action: auditAction,
      old_data: { status: oldReport.status } as Record<string, unknown>,
      new_data: { status: newStatus } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: new Date().toISOString(),
    })

    setActioning(false)
    setActionTarget(null)
    invalidateCachedData(/^(sales-reports:|dashboard:|dashboard-today:|sales-report-status:)/)

    const successMsg = actionTarget.type === 'post'
      ? 'Laporan berhasil diposting! Data masuk ke cashflow.'
      : 'Laporan berhasil divoid.'
    toastTimerRef(successMsg, 'success')
    load({ force: true })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    if (!isOwner) {
      toastTimerRef('Hanya owner yang dapat menghapus laporan permanen.', 'error')
      setDeleteTarget(null)
      setDeleteReason('')
      return
    }

    setDeleting(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    const now = new Date().toISOString()
    const isVoidDelete = deleteTarget.status === 'void'

    const { error: auditError } = await supabase.from('audit_logs').insert({
      table_name: 'sales_reports',
      record_id: deleteTarget.id,
      action: 'sales_deleted',
      old_data: deleteTarget as unknown as Record<string, unknown>,
      new_data: { delete_reason: deleteReason || null } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: now,
    })

    if (auditError) {
      toastTimerRef(`Gagal mencatat audit log: ${auditError.message}`, 'error')
      setDeleting(false)
      return
    }

    const { error: cashflowDeleteError } = await supabase
      .from('cashflow_transactions')
      .delete()
      .eq('source', 'sales')
      .eq('source_id', deleteTarget.id)

    if (cashflowDeleteError) {
      toastTimerRef(`Gagal menghapus cashflow terkait: ${cashflowDeleteError.message}`, 'error')
      setDeleting(false)
      return
    }

    const { error: deleteError } = await supabase.from('sales_reports').delete().eq('id', deleteTarget.id)

    if (deleteError) {
      toastTimerRef(`Gagal menghapus: ${deleteError.message}`, 'error')
      setDeleting(false)
      setDeleteTarget(null)
      setDeleteReason('')
      return
    }

    setDeleting(false)
    setDeleteTarget(null)
    setDeleteReason('')
    invalidateCachedData(/^(sales-reports:|dashboard:|dashboard-today:|sales-report-status:|cashflow:|cash-positions:)/)
    toastTimerRef(isVoidDelete ? 'Laporan void berhasil dihapus permanen.' : 'Laporan penjualan berhasil dihapus permanen.', 'success')
    load({ force: true })
  }

  const totals = reports
    .filter((r) => r.status !== 'void')
    .reduce(
      (acc, r) => ({
        offline: acc.offline + r.total_offline,
        onlineNett: acc.onlineNett + r.total_online_nett,
        grand: acc.grand + r.grand_total_nett_sales,
      }),
      { offline: 0, onlineNett: 0, grand: 0 }
    )

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Laporan Penjualan</h2>
          <p className="text-sm text-gray-500 mt-0.5">{reports.length} laporan ditemukan</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <button
            onClick={handleExport}
            className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">Export Excel</span>
          </button>
          <Link
            href="/sales/input"
            prefetch
            className="btn-primary flex w-full items-center gap-2 sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Input Penjualan</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Cabang"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectFilter
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Semua Status"
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'posted', label: 'Posted' },
              { value: 'void', label: 'Void' },
            ]}
          />
          <button onClick={() => load({ force: true })} className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Total Offline</p>
          <p className="text-base font-bold text-gray-900 text-rupiah">{formatRupiah(totals.offline)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Total Online Nett</p>
          <p className="text-base font-bold text-gray-900 text-rupiah">{formatRupiah(totals.onlineNett)}</p>
        </div>
        <div className="card p-3 text-center bg-rbn-red">
          <p className="text-xs text-white/70 mb-0.5">Grand Total</p>
          <p className="text-base font-bold text-white text-rupiah">{formatRupiah(totals.grand)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <PageLoading />
        ) : reports.length === 0 ? (
          <EmptyState
            title="Tidak ada laporan"
            description="Belum ada laporan penjualan untuk filter yang dipilih."
            action={
              <Link href="/sales/input" prefetch className="btn-primary text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" /> Input Penjualan
              </Link>
            }
          />
        ) : (
          <>
          <div className="hidden md:block">
            <table className="w-full table-fixed">
              <thead>
                <tr>
                  <th className="table-header w-[12%]">Tanggal</th>
                  <th className="table-header w-[16%]">Cabang</th>
                  <th className="table-header text-right">Offline</th>
                  <th className="table-header text-right">Online Nett</th>
                  <th className="table-header text-right">Grand Total</th>
                  <th className="table-header w-[11%] text-center">Status</th>
                  <th className="table-header w-[16%] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium">{formatDate(report.report_date, 'dd/MM/yy')}</td>
                    <td className="table-cell"><div className="truncate">{report.branch?.name || '-'}</div></td>
                    <td className="table-cell text-right font-medium text-rupiah"><div className="truncate">{formatRupiah(report.total_offline)}</div></td>
                    <td className="table-cell text-right font-medium text-rupiah"><div className="truncate">{formatRupiah(report.total_online_nett)}</div></td>
                    <td className="table-cell text-right font-bold text-rbn-red text-rupiah"><div className="truncate">{formatRupiah(report.grand_total_nett_sales)}</div></td>
                    <td className="table-cell text-center">
                      <SalesBadge status={report.status} />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        {/* View */}
                        <button
                          onClick={() => setDetailReport(report)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          title="Lihat Detail"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {/* Edit — not allowed for void */}
                        {report.status !== 'void' && (
                          <button
                            onClick={() => { setEditReport(report); setEditModalOpen(true) }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Post — for draft and submitted */}
                        {(report.status === 'draft' || report.status === 'submitted') && (
                          <button
                            onClick={() => setActionTarget({ report, type: 'post' })}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                            title="Post (Finalisasi)"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Void — for draft, submitted, posted */}
                        {report.status !== 'void' && (
                          <button
                            onClick={() => setActionTarget({ report, type: 'void' })}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title="Void"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Hapus Draft — hard delete, only for draft/submitted */}
                        {canDeleteSales(report) && (
                          <button
                            onClick={() => { setDeleteTarget(report); setDeleteReason('') }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title={report.status === 'void' ? 'Hapus Laporan Void' : 'Hapus Laporan'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
            {reports.map((report) => (
              <article key={report.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{formatDate(report.report_date, 'dd MMM yyyy')}</p>
                    <p className="truncate text-xs text-slate-500">{report.branch?.name || '-'}</p>
                  </div>
                  <SalesBadge status={report.status} />
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Grand Total</p>
                  <p className="break-words text-xl font-bold text-rbn-red text-rupiah">{formatRupiah(report.grand_total_nett_sales)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">Offline</p>
                      <p className="break-words font-semibold text-slate-900 text-rupiah">{formatRupiah(report.total_offline)}</p>
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="text-xs text-slate-500">Online Nett</p>
                      <p className="break-words font-semibold text-slate-900 text-rupiah">{formatRupiah(report.total_online_nett)}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => setDetailReport(report)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    title="Lihat Detail"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {report.status !== 'void' && (
                    <button
                      onClick={() => { setEditReport(report); setEditModalOpen(true) }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {(report.status === 'draft' || report.status === 'submitted') && (
                    <button
                      onClick={() => setActionTarget({ report, type: 'post' })}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-green-50 hover:text-green-600"
                      title="Post (Finalisasi)"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  {report.status !== 'void' && (
                    <button
                      onClick={() => setActionTarget({ report, type: 'void' })}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="Void"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                  {canDeleteSales(report) && (
                    <button
                      onClick={() => { setDeleteTarget(report); setDeleteReason('') }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      title={report.status === 'void' ? 'Hapus Laporan Void' : 'Hapus Laporan'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Laporan Penjualan"
        size="2xl"
      >
        <SalesForm
          initialData={editReport}
          onSuccess={(msg) => {
            setEditModalOpen(false)
            toastTimerRef(msg || 'Perubahan berhasil disimpan.', 'success')
            invalidateCachedData(/^(sales-reports:|dashboard:|dashboard-today:|sales-report-status:)/)
            load({ force: true })
          }}
          onCancel={() => setEditModalOpen(false)}
        />
      </Modal>

      {/* Detail Modal */}
      {detailReport && (
        <Modal
          isOpen={!!detailReport}
          onClose={() => setDetailReport(null)}
          title="Detail Laporan Penjualan"
          size="lg"
        >
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-gray-500 text-xs">Tanggal</p>
                <p className="font-medium">{formatDate(detailReport.report_date)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Cabang</p>
                <p className="font-medium">{detailReport.branch?.name || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Status</p>
                <SalesBadge status={detailReport.status} />
              </div>
            </div>
            <hr />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Cash', detailReport.cash],
                ['QRIS', detailReport.qris],
                ['GoFood Gross', detailReport.gofood_gross],
                ['GoFood Promo', detailReport.gofood_promo],
                ['GoFood Komisi', detailReport.gofood_commission],
                ['GoFood Nett', detailReport.gofood_nett],
                ['GrabFood Gross', detailReport.grabfood_gross],
                ['GrabFood Promo', detailReport.grabfood_promo],
                ['GrabFood Komisi', detailReport.grabfood_commission],
                ['GrabFood Ads', detailReport.grabfood_ads],
                ['GrabFood Nett', detailReport.grabfood_nett],
                ['ShopeeFood Gross', detailReport.shopeefood_gross],
                ['ShopeeFood Promo', detailReport.shopeefood_promo],
                ['ShopeeFood Komisi', detailReport.shopeefood_commission],
                ['ShopeeFood Nett', detailReport.shopeefood_nett],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-gray-500 text-xs">{label}</p>
                  <p className="font-medium text-rupiah">{formatRupiah(Number(value))}</p>
                </div>
              ))}
            </div>
            <hr />
            <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-lg">
              <div>
                <p className="text-gray-500 text-xs">Total Offline</p>
                <p className="font-bold text-rupiah">{formatRupiah(detailReport.total_offline)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Total Online Gross</p>
                <p className="font-bold text-rupiah">{formatRupiah(detailReport.total_online_gross)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Total Online Nett</p>
                <p className="font-bold text-rupiah">{formatRupiah(detailReport.total_online_nett)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Potongan Online</p>
                <p className="font-bold text-red-600 text-rupiah">-{formatRupiah(detailReport.total_online_deduction)} ({detailReport.online_deduction_percentage.toFixed(1)}%)</p>
              </div>
            </div>
            <div className="bg-rbn-red p-4 rounded-xl text-center">
              <p className="text-white/70 text-xs">Grand Total Nett Sales</p>
              <p className="text-2xl font-bold text-white text-rupiah">{formatRupiah(detailReport.grand_total_nett_sales)}</p>
            </div>
            {detailReport.notes && (
              <div>
                <p className="text-gray-500 text-xs">Catatan</p>
                <p>{detailReport.notes}</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Action Confirm Modal (Post / Void) */}
      <ConfirmModal
        isOpen={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        loading={actioning}
        title={actionTarget?.type === 'post' ? 'Post Laporan Penjualan' : 'Void Laporan Penjualan'}
        description={
          actionTarget?.type === 'post'
            ? `Posting laporan ${actionTarget?.report.branch?.name} tanggal ${formatDate(actionTarget?.report.report_date || '')}? Status berubah menjadi Posted dan data otomatis masuk ke cashflow.`
            : `Void laporan ${actionTarget?.report.branch?.name} tanggal ${formatDate(actionTarget?.report.report_date || '')}? Cashflow terkait juga akan divoid.`
        }
        confirmLabel={actionTarget?.type === 'post' ? 'Post Sekarang' : 'Void'}
        confirmClass={
          actionTarget?.type === 'post'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-rbn-red hover:bg-rbn-red-dark text-white'
        }
      />

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteReason('') }}
        onConfirm={handleDelete}
        loading={deleting}
        title={deleteTarget?.status === 'void' ? 'Hapus Permanen Laporan Void' : 'Hapus Laporan Penjualan'}
        description={
          deleteTarget?.status === 'void'
            ? `Yakin ingin menghapus permanen laporan void ${deleteTarget?.branch?.name} tanggal ${formatDate(deleteTarget?.report_date || '')}? Cashflow dari sales terkait juga akan dihapus dan data tidak bisa dikembalikan.`
            : `Yakin ingin menghapus laporan ${deleteTarget?.branch?.name} tanggal ${formatDate(deleteTarget?.report_date || '')}? Data akan dihapus permanen dan tidak bisa dikembalikan.`
        }
        confirmLabel="Hapus Permanen"
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
        showReason
        reason={deleteReason}
        onReasonChange={setDeleteReason}
        reasonPlaceholder="Alasan penghapusan (opsional)..."
      />
    </div>
  )
}
