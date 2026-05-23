'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  ShoppingCart,
  Wallet,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { KasirImportLog } from '@/types/database'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, formatDate, formatDateTime, formatRupiah } from '@/lib/utils/format'

// -----------------------------------------------
// Hub page: pintu masuk ke Import Kasir
// -----------------------------------------------

const STATUS_STYLES = {
  success: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  partial: 'bg-amber-50 text-amber-700',
}

const TYPE_STYLES = {
  sales: 'bg-blue-50 text-blue-700',
  expenses: 'bg-red-50 text-red-700',
}

function ImportTypeLabel({ type }: { type: KasirImportLog['import_type'] }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold', TYPE_STYLES[type])}>
      {type === 'sales' ? 'Penjualan' : 'Kas Keluar'}
    </span>
  )
}

export default function KasirImportHubPage() {
  const [logs, setLogs] = useState<KasirImportLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

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

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="page-kicker">Integrasi</p>
        <h2 className="text-xl font-bold text-gray-900">Import dari Sistem Kasir</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
          Tarik data penjualan dan pengeluaran langsung dari sistem kasir ke laporan keuangan. Tidak perlu input manual.
        </p>
      </div>

      {/* Cards pilih jenis import */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Sales card */}
        <a
          href="/kasir-import/penjualan"
          className="card group flex flex-col gap-4 p-5 hover:border-blue-200 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 group-hover:bg-blue-200 transition-colors">
              <ShoppingCart className="h-6 w-6 text-blue-700" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-950">Import Penjualan</h3>
            <p className="mt-1 text-sm text-slate-500">
              Import transaksi penjualan <strong>Tunai</strong> dan <strong>QRIS</strong> dari sistem kasir ke laporan pemasukan.
            </p>
          </div>
          <ul className="space-y-1 text-xs text-slate-500">
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> Filter per metode bayar</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> Preview sebelum import</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> Anti duplikat otomatis</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> Semua waktu dalam WITA</li>
          </ul>
          <div className="mt-auto">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white group-hover:bg-blue-700 transition-colors">
              Buka <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </a>

        {/* Expenses card */}
        <a
          href="/kasir-import/kas-keluar"
          className="card group flex flex-col gap-4 p-5 hover:border-red-200 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 group-hover:bg-red-200 transition-colors">
              <Wallet className="h-6 w-6 text-red-700" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-red-500 transition-colors" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-950">Import Kas Keluar</h3>
            <p className="mt-1 text-sm text-slate-500">
              Import pengeluaran dari sistem kasir. Bisa bagi beban ke beberapa outlet secara merata atau manual.
            </p>
          </div>
          <ul className="space-y-1 text-xs text-slate-500">
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-red-500" /> Mapping outlet (asal / pindah / bagi rata / manual)</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-red-500" /> Validasi total split</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-red-500" /> Auto skip data void</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-red-500" /> Anti duplikat otomatis</li>
          </ul>
          <div className="mt-auto">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white group-hover:bg-red-700 transition-colors">
              Buka <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </a>
      </div>

      {/* Info tentang integrasi */}
      <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-bold mb-1">Tentang Integrasi</p>
        <p>
          Data diambil dari endpoint <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">get_sales_integration</code> dan{' '}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">get_kas_keluar_integration</code> di Portal Integrasi Data Keuangan Roti Bakar Ngeunah.
          Semua waktu ditampilkan dalam <strong>WITA (UTC+8)</strong>.
        </p>
      </section>

      {/* Log import */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">Log Import</h3>
            <p className="text-xs text-slate-500">30 aktivitas import terakhir dari sistem kasir.</p>
          </div>
          <button
            type="button"
            onClick={loadLogs}
            disabled={logsLoading}
            className="btn-outline mt-2 flex w-full items-center gap-2 text-sm md:mt-0 md:w-auto"
          >
            <RefreshCw className={cn('h-4 w-4', logsLoading && 'animate-spin')} />
            Refresh Log
          </button>
        </div>

        {logsLoading ? (
          <PageLoading />
        ) : logs.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat import"
            description="Log import akan muncul setelah Anda melakukan import dari sistem kasir."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header">Waktu Import</th>
                    <th className="table-header">Jenis</th>
                    <th className="table-header">Periode</th>
                    <th className="table-header">Filter</th>
                    <th className="table-header text-right">Berhasil</th>
                    <th className="table-header text-right">Gagal</th>
                    <th className="table-header text-right">Dilewati</th>
                    <th className="table-header text-right">Total</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="table-cell text-xs text-slate-500">{formatDateTime(log.imported_at)}</td>
                      <td className="table-cell"><ImportTypeLabel type={log.import_type} /></td>
                      <td className="table-cell font-semibold">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} – ${formatDate(log.period_end)}`}
                      </td>
                      <td className="table-cell text-xs text-slate-500">
                        {log.branch_filter && <span>{log.branch_filter}</span>}
                        {log.payment_method_filter && <span className="ml-1 text-xs">· {log.payment_method_filter}</span>}
                        {!log.branch_filter && !log.payment_method_filter && <span className="text-slate-300">—</span>}
                      </td>
                      <td className="table-cell text-right font-bold text-blue-600">{log.total_success}</td>
                      <td className="table-cell text-right font-bold text-red-600">{log.total_failed}</td>
                      <td className="table-cell text-right text-slate-400">{log.total_skipped}</td>
                      <td className="table-cell text-right font-bold text-rupiah">
                        {log.import_type === 'sales'
                          ? formatRupiah(log.total_amount)
                          : <span className="text-red-600">{formatRupiah(log.total_amount)}</span>}
                      </td>
                      <td className="table-cell">
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
                          STATUS_STYLES[log.status]
                        )}>
                          {log.status === 'success'
                            ? <><CheckCircle2 className="h-3 w-3" /> Berhasil</>
                            : log.status === 'failed'
                              ? <><XCircle className="h-3 w-3" /> Gagal</>
                              : <><CheckCircle2 className="h-3 w-3" /> Sebagian</>}
                        </span>
                      </td>
                      <td className="table-cell">
                        <p className="font-semibold">{log.actor?.full_name || 'Admin'}</p>
                        <p className="text-xs text-slate-400">{log.actor?.email}</p>
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
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
                          STATUS_STYLES[log.status]
                        )}>
                          {log.status === 'success' ? 'Berhasil' : log.status === 'failed' ? 'Gagal' : 'Sebagian'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(log.imported_at)}</p>
                      <p className="text-xs text-slate-400">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} – ${formatDate(log.period_end)}`}
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
                  {log.message && (
                    <p className="mt-1 text-xs text-slate-500">{log.message}</p>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
