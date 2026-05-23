'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Database,
  Info,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch } from '@/types/database'
import type {
  KasirSalePreviewItem,
  KasirSalePreviewPayload,
  KasirImportResult,
  PaymentMethodFilter,
} from '@/lib/kasir-import/shared'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner, PageLoading } from '@/components/ui/LoadingSpinner'
import { cn, formatDate, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { invalidateCachedData } from '@/lib/utils/client-cache'

// -----------------------------------------------
// Types
// -----------------------------------------------
interface ApiPreviewResponse extends Partial<KasirSalePreviewPayload> {
  success: boolean
  message?: string
  code?: string
}
interface ApiImportResponse {
  success: boolean
  message?: string
  result?: KasirImportResult
}

type SaleStatus = KasirSalePreviewItem['status']

const STATUS_STYLES: Record<SaleStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-100',
  duplicate: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  skipped_payment: 'bg-slate-50 text-slate-500 border-slate-100',
  branch_not_found: 'bg-red-50 text-red-700 border-red-100',
}

const PAYMENT_STYLE: Record<string, string> = {
  Tunai: 'bg-green-50 text-green-700',
  QRIS: 'bg-purple-50 text-purple-700',
}

const PAGE_SIZE = 50

// -----------------------------------------------
// Sub-components
// -----------------------------------------------

function Notice({ type, message }: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  }[type]

  const Icon = type === 'success' ? CheckCircle2 : type === 'info' ? Info : AlertTriangle

  return (
    <div className={cn('flex items-start gap-2 rounded-xl border p-3 text-sm font-medium', styles)}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold', color || 'text-slate-950')}>{value}</p>
    </div>
  )
}

// -----------------------------------------------
// Main component
// -----------------------------------------------

export default function ImportPenjualanPage() {
  const today = toDateInputValue()
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [branchId, setBranchId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodFilter>('Tunai+QRIS')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])

  const [previewData, setPreviewData] = useState<KasirSalePreviewPayload | null>(null)
  const [hasFetched, setHasFetched] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<KasirImportResult | null>(null)

  const [page, setPage] = useState(0)

  // Load branches
  useEffect(() => {
    createClient()
      .from('branches')
      .select('id,name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setBranches(data || []))
  }, [])

  // Paginated items
  const paginatedItems = useMemo(() => {
    const items = previewData?.items || []
    return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  }, [previewData, page])

  const totalPages = Math.ceil((previewData?.items.length || 0) / PAGE_SIZE)
  const canImport = (previewData?.summary.totalNew || 0) > 0

  // ----- Preview -----
  const fetchPreview = useCallback(async (opts: { keepSuccess?: boolean } = {}) => {
    if (!startDate || !endDate) { setError('Lengkapi tanggal terlebih dahulu.'); return }
    if (endDate < startDate) { setError('Tanggal akhir tidak boleh sebelum tanggal mulai.'); return }

    setPulling(true)
    setError(null)
    setImportResult(null)
    if (!opts.keepSuccess) setSuccess(null)
    setPage(0)

    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        payment_method: paymentMethod,
      })
      if (branchId) params.set('branch_id', branchId)

      const res = await fetch(`/api/kasir-import/sales?${params}`, { cache: 'no-store' })
      const json = await res.json() as ApiPreviewResponse

      if (!res.ok || !json.success) {
        setPreviewData(null)
        setHasFetched(true)
        const code = json.code
        if (code === 'empty_data') {
          setError(json.message || 'Tidak ada data penjualan pada periode ini.')
        } else if (code === 'missing_api_key' || code === 'invalid_api_key') {
          setError('API Key integrasi kasir bermasalah. Hubungi administrator.')
        } else if (code === 'endpoint_unreachable') {
          setError('Tidak dapat terhubung ke sistem kasir. Periksa koneksi dan coba lagi.')
        } else {
          setError(json.message || 'Gagal mengambil data dari sistem kasir.')
        }
        return
      }

      setPreviewData({ items: json.items || [], summary: json.summary! })
      setHasFetched(true)
    } catch {
      setError('Gagal terhubung ke server. Coba lagi.')
      setHasFetched(true)
    } finally {
      setPulling(false)
    }
  }, [startDate, endDate, branchId, paymentMethod])

  // ----- Import -----
  async function handleImport() {
    if (!canImport) { setError('Tidak ada data baru untuk diimport.'); return }

    setImporting(true)
    setError(null)
    setSuccess(null)
    setImportResult(null)

    try {
      const res = await fetch('/api/kasir-import/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          branch_id: branchId || undefined,
          payment_method: paymentMethod,
        }),
      })
      const json = await res.json() as ApiImportResponse

      if (!res.ok || !json.success) {
        setError(json.message || 'Import gagal.')
        return
      }

      const result = json.result!
      setImportResult(result)
      setSuccess(result.message)
      invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)
      await fetchPreview({ keepSuccess: true })
    } catch {
      setError('Gagal mengirim data. Coba lagi.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="page-kicker">Import Kasir</p>
          <h2 className="text-xl font-bold text-gray-900">Import Penjualan dari Kasir</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Ambil data transaksi penjualan Tunai dan QRIS dari sistem kasir. Preview dulu sebelum import.
          </p>
        </div>
        <a href="/kasir-import" className="btn-outline flex w-full items-center gap-2 text-sm lg:w-auto">
          ← Kembali ke Hub
        </a>
      </div>

      {/* Step 1 — Filter */}
      <section className="card p-4 space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
            Langkah 1 — Pilih Rentang Tanggal & Filter
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Periode Tanggal
            </label>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Cabang / Outlet
            </label>
            <SelectFilter
              value={branchId}
              onChange={setBranchId}
              placeholder="Semua Cabang"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Metode Pembayaran
            </label>
            <div className="flex gap-1">
              {(['Tunai', 'QRIS', 'Tunai+QRIS'] as PaymentMethodFilter[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-2 text-xs font-bold transition-colors',
                    paymentMethod === m
                      ? 'border-rbn-red bg-rbn-red text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <button
            type="button"
            onClick={() => fetchPreview()}
            disabled={pulling || importing}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {pulling
              ? <><LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> Mengambil Data...</>
              : <><CloudDownload className="h-4 w-4" /> Preview Data</>
            }
          </button>
          {hasFetched && (
            <button
              type="button"
              onClick={() => fetchPreview()}
              disabled={pulling || importing}
              className="btn-outline flex items-center gap-2 text-sm"
            >
              <RefreshCw className={cn('h-4 w-4', pulling && 'animate-spin')} />
              Refresh
            </button>
          )}
        </div>
      </section>

      {/* Notices */}
      {!pulling && error && <Notice type="error" message={error} />}
      {!pulling && success && !error && <Notice type="success" message={success} />}
      {!pulling && (previewData?.summary.totalBranchNotFound ?? 0) > 0 && (
        <Notice
          type="warning"
          message={`${previewData?.summary.totalBranchNotFound} transaksi dari cabang yang belum terdaftar di sistem keuangan. Transaksi tersebut tidak akan diimport.`}
        />
      )}
      {!pulling && (previewData?.summary.totalDuplicate ?? 0) > 0 && (
        <Notice
          type="info"
          message={`${previewData?.summary.totalDuplicate} transaksi sudah pernah diimport sebelumnya dan akan dilewati.`}
        />
      )}

      {/* Import Result */}
      {importResult && (
        <section className="card p-4 space-y-2">
          <h3 className="text-sm font-bold text-slate-950">Hasil Import</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-xs text-blue-600">Berhasil</p>
              <p className="text-2xl font-extrabold text-blue-700">{importResult.totalSuccess}</p>
            </div>
            <div className="rounded-xl bg-red-50 p-3">
              <p className="text-xs text-red-600">Gagal</p>
              <p className="text-2xl font-extrabold text-red-700">{importResult.totalFailed}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Dilewati</p>
              <p className="text-2xl font-extrabold text-slate-700">{importResult.totalSkipped}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-xs text-emerald-600">Total</p>
              <p className="text-lg font-extrabold text-emerald-700">{formatRupiah(importResult.totalAmount)}</p>
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="mb-1 text-xs font-bold text-red-700">Detail Error:</p>
              <ul className="space-y-0.5">
                {importResult.errors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Step 2 — Preview data */}
      {pulling && (
        <section className="card p-6">
          <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-600">
            <LoadingSpinner className="h-5 w-5" />
            Sedang mengambil data dari sistem kasir...
          </div>
        </section>
      )}

      {!pulling && previewData && previewData.items.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Total Transaksi"
              value={previewData.summary.totalFound}
            />
            <StatCard
              label="Belum Diimport"
              value={previewData.summary.totalNew}
              color="text-blue-600"
            />
            <StatCard
              label="Penjualan Tunai"
              value={formatRupiah(previewData.summary.totalCash)}
              color="text-green-600"
            />
            <StatCard
              label="Penjualan QRIS"
              value={formatRupiah(previewData.summary.totalQris)}
              color="text-purple-600"
            />
            <StatCard
              label="Total Baru"
              value={formatRupiah(previewData.summary.totalAmount)}
              color="text-slate-950"
            />
          </div>

          {/* Per-branch breakdown */}
          {previewData.summary.byBranch.length > 1 && (
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-950">Rincian per Outlet</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-1.5 text-left text-xs font-bold uppercase text-slate-400">Outlet</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Tunai</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">QRIS</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.summary.byBranch.map((b) => (
                      <tr key={b.branchName} className="border-b border-slate-50">
                        <td className="py-2 font-semibold">{b.branchName}</td>
                        <td className="py-2 text-right text-green-700">{formatRupiah(b.totalCash)}</td>
                        <td className="py-2 text-right text-purple-700">{formatRupiah(b.totalQris)}</td>
                        <td className="py-2 text-right font-bold">{formatRupiah(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Per-date breakdown */}
          {previewData.summary.byDate.length > 1 && (
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-950">Rincian per Tanggal</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-1.5 text-left text-xs font-bold uppercase text-slate-400">Tanggal</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Transaksi</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.summary.byDate.map((d) => (
                      <tr key={d.date} className="border-b border-slate-50">
                        <td className="py-2 font-semibold">{formatDate(d.date)}</td>
                        <td className="py-2 text-right">{d.count}</td>
                        <td className="py-2 text-right font-bold">{formatRupiah(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Transaction list */}
          <section className="card overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-950">Daftar Transaksi</h3>
                <p className="text-xs text-slate-500">
                  Menampilkan {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, previewData.items.length)} dari {previewData.items.length} transaksi
                </p>
              </div>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || pulling || !canImport}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {importing
                  ? <><LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> Mengimport...</>
                  : <><Database className="h-4 w-4" /> Import {previewData.summary.totalNew} Transaksi Baru</>
                }
              </button>
            </div>

            {/* Table — desktop */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header w-[15%]">Tanggal & Jam WITA</th>
                    <th className="table-header w-[14%]">Outlet</th>
                    <th className="table-header w-[12%]">Kasir</th>
                    <th className="table-header w-[10%]">Metode</th>
                    <th className="table-header text-right w-[14%]">Nominal</th>
                    <th className="table-header w-[14%]">Status</th>
                    <th className="table-header text-right w-[21%]">ID Transaksi Kasir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {paginatedItems.map((item) => (
                    <tr
                      key={item.importKey}
                      className={cn(
                        'hover:bg-slate-50',
                        item.status === 'duplicate' && 'opacity-50',
                        item.status === 'branch_not_found' && 'bg-red-50/30'
                      )}
                    >
                      <td className="table-cell">
                        <p className="font-semibold">{formatDate(item.dateWITA)}</p>
                        <p className="text-xs text-slate-400">{item.timeWITA} WITA</p>
                      </td>
                      <td className="table-cell">
                        <p className="truncate font-medium">{item.branchName}</p>
                      </td>
                      <td className="table-cell">
                        <p className="truncate text-sm text-slate-600">{item.cashier}</p>
                      </td>
                      <td className="table-cell">
                        <span className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-bold',
                          PAYMENT_STYLE[item.paymentCategory || ''] || 'bg-slate-50 text-slate-500'
                        )}>
                          {item.paymentCategory || item.paymentMethod}
                        </span>
                      </td>
                      <td className="table-cell text-right font-bold">{formatRupiah(item.amount)}</td>
                      <td className="table-cell">
                        <span className={cn(
                          'inline-flex rounded-full border px-2 py-0.5 text-xs font-bold',
                          STATUS_STYLES[item.status]
                        )}>
                          {item.statusLabel}
                        </span>
                      </td>
                      <td className="table-cell text-right">
                        <span className="font-mono text-xs text-slate-400">{item.transactionId}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards — mobile */}
            <div className="grid grid-cols-1 gap-3 p-3 lg:hidden">
              {paginatedItems.map((item) => (
                <article
                  key={item.importKey}
                  className={cn(
                    'rounded-xl border border-slate-100 bg-white p-3 shadow-sm',
                    item.status === 'duplicate' && 'opacity-50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-950">{item.branchName}</p>
                      <p className="text-xs text-slate-500">{formatDate(item.dateWITA)} · {item.timeWITA} WITA</p>
                      <p className="text-xs text-slate-400 mt-0.5">{item.cashier}</p>
                    </div>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-bold shrink-0', STATUS_STYLES[item.status])}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold', PAYMENT_STYLE[item.paymentCategory || ''] || 'bg-slate-50 text-slate-500')}>
                      {item.paymentCategory || item.paymentMethod}
                    </span>
                    <p className="text-lg font-extrabold text-slate-950">{formatRupiah(item.amount)}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-400">{item.transactionId}</p>
                </article>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 border-t border-slate-100 p-3">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-outline px-3 py-1.5 text-xs"
                >
                  ← Sebelumnya
                </button>
                <span className="text-xs text-slate-500">
                  Halaman {page + 1} dari {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="btn-outline px-3 py-1.5 text-xs"
                >
                  Berikutnya →
                </button>
              </div>
            )}

            {/* Footer action */}
            <div className="flex flex-col gap-3 border-t border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-slate-600">
                Total baru: <span className="font-extrabold text-slate-950">{formatRupiah(previewData.summary.totalAmount)}</span>
                {' '}({previewData.summary.totalNew} transaksi)
              </p>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || pulling || !canImport}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {importing
                  ? <><LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> Mengimport...</>
                  : <><Database className="h-4 w-4" /> Import Sekarang</>
                }
              </button>
            </div>
          </section>
        </>
      )}

      {/* Empty state */}
      {!pulling && hasFetched && !error && (!previewData || previewData.items.length === 0) && (
        <section className="card">
          <EmptyState
            title="Tidak ada data penjualan"
            description="Tidak ada transaksi penjualan yang ditemukan pada periode dan filter yang dipilih."
          />
        </section>
      )}

      {/* Step guide (before fetch) */}
      {!hasFetched && !pulling && (
        <section className="card p-6">
          <h3 className="text-sm font-bold text-slate-950 mb-3">Cara Penggunaan</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">1.</span> Pilih rentang tanggal yang ingin diimport</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">2.</span> Pilih cabang (opsional, kosongkan untuk semua cabang)</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">3.</span> Pilih metode pembayaran: Tunai, QRIS, atau keduanya</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">4.</span> Klik &ldquo;Preview Data&rdquo; untuk melihat data sebelum diimport</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">5.</span> Periksa ringkasan dan daftar transaksi</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">6.</span> Klik &ldquo;Import&rdquo; untuk menyimpan ke sistem keuangan</li>
          </ol>
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
            <strong>Catatan:</strong> Sistem akan otomatis melewati transaksi yang sudah pernah diimport. Data yang sama tidak akan masuk dua kali.
          </div>
        </section>
      )}
    </div>
  )
}
