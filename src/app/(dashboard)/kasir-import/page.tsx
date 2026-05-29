'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch } from '@/types/database'
import type { KasirImportLog } from '@/types/database'
import type { CombinedImportResult } from '@/lib/kasir-import/shared'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner, PageLoading } from '@/components/ui/LoadingSpinner'
import { cn, formatDate, formatDateTime, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { invalidateCachedData } from '@/lib/utils/client-cache'

// -----------------------------------------------
// Types
// -----------------------------------------------
interface ApiImportResponse {
  success: boolean
  message?: string
  code?:    string
  result?:  CombinedImportResult
}

const STATUS_STYLES = {
  success: 'bg-emerald-50 text-emerald-700',
  failed:  'bg-red-50 text-red-700',
  partial: 'bg-amber-50 text-amber-700',
}

const TYPE_STYLES = {
  sales:    'bg-blue-50 text-blue-700',
  expenses: 'bg-red-50 text-red-700',
}

// -----------------------------------------------
// Sub-components
// -----------------------------------------------
function Notice({ type, message }: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error:   'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info:    'border-blue-200 bg-blue-50 text-blue-700',
  }[type]
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? XCircle : AlertTriangle
  return (
    <div className={cn('flex items-start gap-2 rounded-xl border p-3 text-sm font-medium', styles)}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function ImportTypeLabel({ type }: { type: KasirImportLog['import_type'] }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold', TYPE_STYLES[type])}>
      {type === 'sales' ? 'Penjualan' : 'Kas Keluar'}
    </span>
  )
}

// -----------------------------------------------
// Ringkasan hasil import
// -----------------------------------------------
function CombinedResultPanel({ result }: { result: CombinedImportResult }) {
  const { sales, expenses } = result

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          {result.success
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          <h3 className="text-sm font-bold text-slate-950">Hasil Import Data dari POS</h3>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{result.message}</p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {/* Sales */}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-950">Penjualan (Tunai &amp; QRIS)</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-xs text-blue-600">Berhasil</p>
              <p className="text-2xl font-extrabold text-blue-700">{sales.totalSuccess}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-xs text-emerald-600">Total</p>
              <p className="text-base font-extrabold text-emerald-700 leading-tight mt-1">
                {formatRupiah(sales.totalAmount)}
              </p>
            </div>
            {sales.totalSkipped > 0 && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Dilewati</p>
                <p className="text-xl font-extrabold text-slate-500">{sales.totalSkipped}</p>
              </div>
            )}
            {sales.totalFailed > 0 && (
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs text-red-600">Gagal</p>
                <p className="text-xl font-extrabold text-red-700">{sales.totalFailed}</p>
              </div>
            )}
          </div>
          {!sales.success && sales.errors.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="text-xs font-bold text-red-700 mb-1">Error:</p>
              <ul className="space-y-0.5">
                {sales.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-red-600">• {e}</li>
                ))}
                {sales.errors.length > 5 && (
                  <li className="text-xs text-red-400">...dan {sales.errors.length - 5} error lainnya</li>
                )}
              </ul>
            </div>
          )}
          {sales.totalSuccess === 0 && sales.totalFailed === 0 && (
            <p className="text-xs text-slate-400 italic">{sales.message}</p>
          )}
        </div>

        {/* Expenses */}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-600" />
            <span className="text-sm font-bold text-slate-950">Kas Keluar</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-xs text-blue-600">Berhasil</p>
              <p className="text-2xl font-extrabold text-blue-700">{expenses.totalSuccess}</p>
            </div>
            <div className="rounded-xl bg-red-50 p-3">
              <p className="text-xs text-red-600">Total</p>
              <p className="text-base font-extrabold text-red-700 leading-tight mt-1">
                {formatRupiah(expenses.totalAmount)}
              </p>
            </div>
            {expenses.totalSkipped > 0 && (
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Dilewati</p>
                <p className="text-xl font-extrabold text-slate-500">{expenses.totalSkipped}</p>
              </div>
            )}
            {expenses.totalFailed > 0 && (
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs text-red-600">Gagal</p>
                <p className="text-xl font-extrabold text-red-700">{expenses.totalFailed}</p>
              </div>
            )}
          </div>
          {!expenses.success && expenses.errors.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="text-xs font-bold text-red-700 mb-1">Error:</p>
              <ul className="space-y-0.5">
                {expenses.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-red-600">• {e}</li>
                ))}
                {expenses.errors.length > 5 && (
                  <li className="text-xs text-red-400">...dan {expenses.errors.length - 5} error lainnya</li>
                )}
              </ul>
            </div>
          )}
          {expenses.totalSuccess === 0 && expenses.totalFailed === 0 && (
            <p className="text-xs text-slate-400 italic">{expenses.message}</p>
          )}
        </div>
      </div>

      {/* Total gabungan */}
      <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-slate-600">
            Total berhasil:
            <span className="ml-1 font-extrabold text-blue-700">
              {sales.totalSuccess + expenses.totalSuccess} item
            </span>
          </span>
          <div className="flex gap-4">
            {sales.totalAmount > 0 && (
              <span className="text-slate-600">
                Masuk: <span className="font-extrabold text-emerald-700">{formatRupiah(sales.totalAmount)}</span>
              </span>
            )}
            {expenses.totalAmount > 0 && (
              <span className="text-slate-600">
                Keluar: <span className="font-extrabold text-red-700">{formatRupiah(expenses.totalAmount)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------
// Main page
// -----------------------------------------------
export default function KasirImportPage() {
  const today = toDateInputValue()
  const [startDate, setStartDate] = useState(today)
  const [endDate,   setEndDate]   = useState(today)
  const [branchId,  setBranchId]  = useState('')
  const [branches,  setBranches]  = useState<Pick<Branch, 'id' | 'name'>[]>([])

  const [importing,    setImporting]    = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [importResult, setImportResult] = useState<CombinedImportResult | null>(null)

  const [logs,        setLogs]        = useState<KasirImportLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

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

  // Load logs
  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('kasir_import_logs')
      .select('*, actor:profiles(full_name,email)')
      .order('imported_at', { ascending: false })
      .limit(30)
    setLogs((data || []) as unknown as KasirImportLog[])
    setLogsLoading(false)
  }, [])

  useEffect(() => { loadLogs() }, [loadLogs])

  // ----- Import -----
  async function handleImport() {
    if (!startDate || !endDate) { setError('Lengkapi tanggal terlebih dahulu.'); return }
    if (endDate < startDate)    { setError('Tanggal akhir tidak boleh sebelum tanggal mulai.'); return }

    setImporting(true)
    setError(null)
    setImportResult(null)

    try {
      const res = await fetch('/api/kasir-import/combined', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          start_date: startDate,
          end_date:   endDate,
          branch_id:  branchId || undefined,
        }),
      })
      const json = await res.json() as ApiImportResponse

      if (!res.ok || !json.success) {
        const code = json.code
        if (code === 'missing_api_key' || code === 'invalid_api_key') {
          setError('API Key integrasi kasir bermasalah. Hubungi administrator.')
        } else if (code === 'endpoint_unreachable') {
          setError('Tidak dapat terhubung ke sistem kasir. Periksa koneksi dan coba lagi.')
        } else if (code === 'invalid_date') {
          setError(json.message || 'Format tanggal tidak valid.')
        } else {
          setError(json.message || 'Import gagal. Silakan coba lagi.')
        }
        return
      }

      setImportResult(json.result!)
      invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)
      await loadLogs()
    } catch {
      setError('Gagal mengirim permintaan ke server. Periksa koneksi dan coba lagi.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="page-kicker">Integrasi</p>
        <h2 className="text-xl font-bold text-gray-900">Import Data dari POS</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
          Tarik data penjualan (Tunai &amp; QRIS) dan kas keluar langsung dari sistem kasir ke laporan keuangan —
          cukup <strong>1 kali klik</strong>.
        </p>
      </div>

      {/* Filter + tombol import */}
      <section className="card p-4 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Pilih Periode &amp; Cabang
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Periode Tanggal
            </label>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={(v) => { setStartDate(v); setImportResult(null); setError(null) }}
              onEndChange={(v)   => { setEndDate(v);   setImportResult(null); setError(null) }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Cabang / Outlet
            </label>
            <SelectFilter
              value={branchId}
              onChange={(v) => { setBranchId(v); setImportResult(null); setError(null) }}
              placeholder="Semua Cabang"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {importing
              ? <><LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> Sedang Mengimport...</>
              : <><CloudDownload className="h-4 w-4" /> Import Data dari POS</>
            }
          </button>

          {importResult && (
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="btn-outline flex items-center gap-2 text-sm"
            >
              <RefreshCw className={cn('h-4 w-4', importing && 'animate-spin')} />
              Import Ulang
            </button>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
          <strong>Yang akan diimport:</strong>
          <ul className="mt-1 space-y-0.5 ml-2">
            <li>✓ Penjualan Tunai dan QRIS sebagai <strong>Pemasukan</strong></li>
            <li>✓ Kas Keluar (pengeluaran staff) sebagai <strong>Pengeluaran</strong></li>
            <li>✓ Transaksi online delivery (GoFood, GrabFood, ShopeeFood) <strong>tidak diimport</strong></li>
            <li>✓ Data yang sudah pernah diimport <strong>otomatis dilewati</strong> (tidak dobel)</li>
            <li>✓ Semua waktu dalam <strong>WITA (UTC+8)</strong></li>
          </ul>
        </div>
      </section>

      {/* Loading indicator */}
      {importing && (
        <section className="card p-6">
          <div className="flex flex-col items-center justify-center gap-3 text-slate-600">
            <LoadingSpinner className="h-8 w-8" />
            <div className="text-center">
              <p className="text-sm font-bold">Sedang mengimport data dari sistem kasir...</p>
              <p className="text-xs text-slate-400 mt-1">
                Menarik penjualan dan kas keluar untuk periode {formatDate(startDate)}
                {endDate !== startDate && ` – ${formatDate(endDate)}`}
                {branchId && ` · ${branches.find((b) => b.id === branchId)?.name || 'Cabang dipilih'}`}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Error */}
      {!importing && error && <Notice type="error" message={error} />}

      {/* Result */}
      {!importing && importResult && <CombinedResultPanel result={importResult} />}

      {/* Log import */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">Riwayat Import</h3>
            <p className="text-xs text-slate-500">30 aktivitas import terakhir dari sistem kasir.</p>
          </div>
          <button
            type="button"
            onClick={loadLogs}
            disabled={logsLoading}
            className="btn-outline mt-2 flex w-full items-center gap-2 text-sm md:mt-0 md:w-auto"
          >
            <RefreshCw className={cn('h-4 w-4', logsLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {logsLoading ? (
          <PageLoading />
        ) : logs.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat import"
            description="Riwayat akan muncul setelah Anda melakukan import dari sistem kasir."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header">Waktu Import</th>
                    <th className="table-header">Jenis</th>
                    <th className="table-header">Periode</th>
                    <th className="table-header">Cabang</th>
                    <th className="table-header text-right">Berhasil</th>
                    <th className="table-header text-right">Dilewati</th>
                    <th className="table-header text-right">Gagal</th>
                    <th className="table-header text-right">Nominal</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="table-cell text-xs text-slate-500">{formatDateTime(log.imported_at)}</td>
                      <td className="table-cell"><ImportTypeLabel type={log.import_type} /></td>
                      <td className="table-cell font-semibold text-xs">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} – ${formatDate(log.period_end)}`}
                      </td>
                      <td className="table-cell text-xs text-slate-500">
                        {log.branch_filter || <span className="text-slate-300">Semua</span>}
                      </td>
                      <td className="table-cell text-right font-bold text-blue-600">{log.total_success}</td>
                      <td className="table-cell text-right text-slate-400">{log.total_skipped}</td>
                      <td className="table-cell text-right font-bold text-red-600">
                        {log.total_failed > 0 ? log.total_failed : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="table-cell text-right font-bold">
                        {log.import_type === 'sales'
                          ? <span className="text-emerald-700">{formatRupiah(log.total_amount)}</span>
                          : <span className="text-red-600">{formatRupiah(log.total_amount)}</span>}
                      </td>
                      <td className="table-cell">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold', STATUS_STYLES[log.status])}>
                          {log.status === 'success'
                            ? <><CheckCircle2 className="h-3 w-3" /> Berhasil</>
                            : log.status === 'failed'
                              ? <><XCircle className="h-3 w-3" /> Gagal</>
                              : <><AlertTriangle className="h-3 w-3" /> Sebagian</>}
                        </span>
                      </td>
                      <td className="table-cell">
                        <p className="font-semibold text-xs">{log.actor?.full_name || 'Admin'}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
              {logs.map((log) => (
                <article key={log.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <ImportTypeLabel type={log.import_type} />
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold', STATUS_STYLES[log.status])}>
                          {log.status === 'success' ? 'Berhasil' : log.status === 'failed' ? 'Gagal' : 'Sebagian'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(log.imported_at)}</p>
                      <p className="text-xs text-slate-400">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} – ${formatDate(log.period_end)}`}
                        {log.branch_filter && ` · ${log.branch_filter}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-extrabold text-slate-950">{formatRupiah(log.total_amount)}</p>
                      <p className="text-xs text-slate-400">{log.actor?.full_name || 'Admin'}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                    <span className="text-blue-600 font-semibold">{log.total_success} berhasil</span>
                    {log.total_failed > 0 && <span className="text-red-600 font-semibold">{log.total_failed} gagal</span>}
                    {log.total_skipped > 0 && <span className="text-slate-400">{log.total_skipped} dilewati</span>}
                  </div>
                  {log.message && <p className="mt-1 text-xs text-slate-500">{log.message}</p>}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
