'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Eye, Pencil, CheckCircle, XCircle, Download,
  FileSpreadsheet, RefreshCw
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { SalesReport, SalesStatus, Branch, Profile } from '@/types/database'
import { formatDate, formatRupiah } from '@/lib/utils/format'
import { exportSalesToExcel, exportSalesToCSV } from '@/lib/utils/export'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { SalesBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import SalesForm from '@/components/sales/SalesForm'
import { format, startOfMonth, endOfMonth } from 'date-fns'

type ActionType = 'post' | 'void'

export default function SalesReportsPage() {
  const router = useRouter()
  const [reports, setReports] = useState<SalesReport[]>([])
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

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

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
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
    setReports(data || [])
    setLoading(false)
  }, [startDate, endDate, filterBranch, filterStatus])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const [{ data: br }, { data: { user } }] = await Promise.all([
        supabase.from('branches').select('id,name').eq('is_active', true).order('name'),
        supabase.auth.getUser(),
      ])
      setBranches(br || [])
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        setProfile(prof)
      }
    }
    init()
  }, [])

  async function handleAction() {
    if (!actionTarget) return
    setActioning(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const newStatus: SalesStatus = actionTarget.type === 'post' ? 'posted' : 'void'
    const oldReport = actionTarget.report

    await supabase.from('sales_reports')
      .update({ status: newStatus, updated_by: user?.id ?? null })
      .eq('id', oldReport.id)

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
    load()
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Laporan Penjualan</h2>
          <p className="text-sm text-gray-500 mt-0.5">{reports.length} laporan ditemukan</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              exportSalesToExcel(reports)
            }}
            className="btn-outline flex items-center gap-1.5 text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">Export Excel</span>
          </button>
          <button
            onClick={() => router.push('/sales/input')}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Input Penjualan</span>
          </button>
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
              { value: 'posted', label: 'Posted' },
              { value: 'void', label: 'Void' },
            ]}
          />
          <button onClick={load} className="btn-outline flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
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
              <button onClick={() => router.push('/sales/input')} className="btn-primary text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" /> Input Penjualan
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Tanggal</th>
                  <th className="table-header">Cabang</th>
                  <th className="table-header text-right">Cash</th>
                  <th className="table-header text-right">QRIS</th>
                  <th className="table-header text-right">GoFood</th>
                  <th className="table-header text-right">GrabFood</th>
                  <th className="table-header text-right">Shopee</th>
                  <th className="table-header text-right">Offline</th>
                  <th className="table-header text-right">Online Nett</th>
                  <th className="table-header text-right">Grand Total</th>
                  <th className="table-header text-center">Status</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium">{formatDate(report.report_date, 'dd/MM/yy')}</td>
                    <td className="table-cell">{report.branch?.name || '—'}</td>
                    <td className="table-cell text-right text-rupiah">{formatRupiah(report.cash)}</td>
                    <td className="table-cell text-right text-rupiah">{formatRupiah(report.qris)}</td>
                    <td className="table-cell text-right text-rupiah">{formatRupiah(report.gofood_nett)}</td>
                    <td className="table-cell text-right text-rupiah">{formatRupiah(report.grabfood_nett)}</td>
                    <td className="table-cell text-right text-rupiah">{formatRupiah(report.shopeefood_nett)}</td>
                    <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(report.total_offline)}</td>
                    <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(report.total_online_nett)}</td>
                    <td className="table-cell text-right font-bold text-rbn-red text-rupiah">{formatRupiah(report.grand_total_nett_sales)}</td>
                    <td className="table-cell text-center">
                      <SalesBadge status={report.status} />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetailReport(report)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          title="Detail"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {report.status !== 'void' && (
                          <button
                            onClick={() => { setEditReport(report); setEditModalOpen(true) }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {report.status === 'draft' && (
                          <button
                            onClick={() => setActionTarget({ report, type: 'post' })}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                            title="Post"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {report.status !== 'void' && (
                          <button
                            onClick={() => setActionTarget({ report, type: 'void' })}
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
          onSuccess={() => { setEditModalOpen(false); load() }}
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

      {/* Action Confirm Modal */}
      <ConfirmModal
        isOpen={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={handleAction}
        loading={actioning}
        title={actionTarget?.type === 'post' ? 'Post Laporan Penjualan' : 'Void Laporan Penjualan'}
        description={
          actionTarget?.type === 'post'
            ? `Posting laporan ${actionTarget?.report.branch?.name} tanggal ${formatDate(actionTarget?.report.report_date || '')}? Data akan otomatis masuk ke cashflow.`
            : `Void laporan ${actionTarget?.report.branch?.name} tanggal ${formatDate(actionTarget?.report.report_date || '')}? Cashflow terkait juga akan divoid.`
        }
        confirmLabel={actionTarget?.type === 'post' ? 'Post Sekarang' : 'Void'}
        confirmClass={
          actionTarget?.type === 'post'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-rbn-red hover:bg-rbn-red-dark text-white'
        }
      />
    </div>
  )
}
