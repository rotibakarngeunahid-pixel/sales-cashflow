'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudDownload,
  Database,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, RawMaterialImportLog } from '@/types/database'
import type {
  ImportBahanBakuItem,
  ImportBahanBakuPayload,
  ImportBahanBakuSummary,
  SaveImportBahanBakuResult,
} from '@/lib/import-bahan-baku/shared'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner, PageLoading } from '@/components/ui/LoadingSpinner'
import { cn, formatDate, formatDateTime, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { invalidateCachedData } from '@/lib/utils/client-cache'

type Decision = 'ignore' | 'update'

interface ApiPreviewResponse extends Partial<ImportBahanBakuPayload> {
  success: boolean
  message?: string
}

interface ApiSaveResponse {
  success: boolean
  message?: string
  result?: SaveImportBahanBakuResult
}

const statusClass: Record<ImportBahanBakuItem['status'], string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-100',
  imported: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  changed: 'bg-amber-50 text-amber-700 border-amber-100',
  branch_not_found: 'bg-red-50 text-red-700 border-red-100',
}

function Notice({
  type,
  message,
}: {
  type: 'success' | 'error' | 'warning'
  message: string
}) {
  const style = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
  }[type]
  const Icon = type === 'success' ? CheckCircle2 : AlertTriangle

  return (
    <div className={cn('flex items-start gap-2 rounded-xl border p-3 text-sm font-medium', style)}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function formatPeriod(item: Pick<ImportBahanBakuItem, 'periodStart' | 'periodEnd'>) {
  if (item.periodStart === item.periodEnd) return formatDate(item.periodStart)
  return `${formatDate(item.periodStart)} - ${formatDate(item.periodEnd)}`
}

function formatCount(count: number | null) {
  if (!count) return '-'
  return `${count} transaksi`
}

function getLogMessage(log: RawMaterialImportLog) {
  return log.message || (log.status === 'success' ? 'Import berhasil.' : 'Import gagal.')
}

export default function ImportBahanBakuPage() {
  const today = toDateInputValue()
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [items, setItems] = useState<ImportBahanBakuItem[]>([])
  const [summary, setSummary] = useState<ImportBahanBakuSummary | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [hasFetched, setHasFetched] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [logs, setLogs] = useState<RawMaterialImportLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

  useEffect(() => {
    async function loadBranches() {
      const supabase = createClient()
      const { data } = await supabase
        .from('branches')
        .select('id,name')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')

      setBranches(data || [])
    }

    loadBranches()
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('raw_material_import_logs')
      .select('*, actor:profiles(full_name,email)')
      .order('imported_at', { ascending: false })
      .limit(20)

    setLogs((data || []) as unknown as RawMaterialImportLog[])
    setLogsLoading(false)
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const previewTotals = useMemo(() => {
    const branchNames = new Set(items.map((item) => item.branchName))
    const fallback = items.reduce(
      (acc, item) => ({
        transactionCount: acc.transactionCount + (item.transactionCount ?? 0),
        totalAmount: acc.totalAmount + item.totalAmount,
      }),
      { transactionCount: 0, totalAmount: 0 }
    )

    return summary || {
      branchCount: branchNames.size,
      transactionCount: fallback.transactionCount,
      totalAmount: fallback.totalAmount,
      totalAllBranches: fallback.totalAmount,
    }
  }, [items, summary])

  const changedItems = useMemo(() => items.filter((item) => item.status === 'changed'), [items])
  const canSave = items.some((item) => (
    item.status === 'new' || (item.status === 'changed' && decisions[item.importKey] === 'update')
  ))

  const validateDates = useCallback(() => {
    if (!startDate) return 'Tanggal mulai wajib diisi.'
    if (!endDate) return 'Tanggal akhir wajib diisi.'
    if (endDate < startDate) return 'Tanggal akhir tidak boleh lebih kecil dari tanggal mulai.'
    return null
  }, [endDate, startDate])

  const pullData = useCallback(async (options: { keepSuccess?: boolean } = {}) => {
    const validationError = validateDates()
    if (validationError) {
      setError(validationError)
      setSuccess(null)
      return false
    }

    setPulling(true)
    setError(null)
    if (!options.keepSuccess) setSuccess(null)

    try {
      const params = new URLSearchParams({
        tanggal_mulai: startDate,
        tanggal_akhir: endDate,
      })
      if (branchId) params.set('branch_id', branchId)

      const response = await fetch(`/api/import-bahan-baku?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json() as ApiPreviewResponse

      if (!response.ok || !payload.success) {
        setItems([])
        setSummary(null)
        setDecisions({})
        setHasFetched(true)
        setError(payload.message || 'Gagal menarik data pengeluaran bahan baku.')
        return false
      }

      const nextItems = payload.items || []
      setItems(nextItems)
      setSummary(payload.summary || null)
      setDecisions(Object.fromEntries(
        nextItems
          .filter((item) => item.status === 'changed')
          .map((item) => [item.importKey, 'ignore' as Decision])
      ))
      setHasFetched(true)
      return true
    } catch {
      setError('Gagal terhubung ke sistem pengeluaran bahan baku. Coba beberapa saat lagi.')
      setItems([])
      setSummary(null)
      setHasFetched(true)
      return false
    } finally {
      setPulling(false)
    }
  }, [branchId, endDate, startDate, validateDates])

  async function handleSave() {
    const validationError = validateDates()
    if (validationError) {
      setError(validationError)
      setSuccess(null)
      return
    }

    if (!canSave) {
      setError('Tidak ada data baru atau update yang dipilih untuk disimpan.')
      setSuccess(null)
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/import-bahan-baku/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tanggal_mulai: startDate,
          tanggal_akhir: endDate,
          branch_id: branchId || undefined,
          decisions,
        }),
      })
      const payload = await response.json() as ApiSaveResponse

      if (!response.ok || !payload.success) {
        setError(payload.message || 'Gagal menyimpan data ke laporan keuangan.')
        await loadLogs()
        return
      }

      invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)
      await pullData({ keepSuccess: true })
      await loadLogs()
      setSuccess(payload.result?.message || 'Data pengeluaran bahan baku berhasil disimpan.')
    } catch {
      setError('Gagal menyimpan data ke laporan keuangan.')
    } finally {
      setSaving(false)
    }
  }

  function updateDecision(importKey: string, decision: Decision) {
    setDecisions((current) => ({ ...current, [importKey]: decision }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Import Pengeluaran Bahan Baku</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Halaman ini digunakan untuk mengambil pengeluaran bahan baku otomatis dari sistem order bahan baku, sehingga tidak perlu input manual.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { pullData(); loadLogs() }}
          disabled={pulling || saving}
          className="btn-outline flex w-full items-center gap-2 text-sm lg:w-auto"
        >
          <RefreshCw className={cn('h-4 w-4', pulling && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <section className="card p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(180px,260px)_auto_auto] lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Periode Tanggal</label>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Cabang / Outlet</label>
            <SelectFilter
              value={branchId}
              onChange={setBranchId}
              placeholder="Semua Cabang"
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          </div>
          <button
            type="button"
            onClick={() => pullData()}
            disabled={pulling || saving}
            className="btn-primary flex w-full items-center gap-2 text-sm lg:w-auto"
          >
            {pulling ? <LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> : <CloudDownload className="h-4 w-4" />}
            {pulling ? 'Tarik Data...' : 'Tarik Data'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || pulling || !canSave}
            className="btn-outline flex w-full items-center gap-2 text-sm lg:w-auto"
          >
            {saving ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? 'Menyimpan...' : 'Simpan ke Laporan Keuangan'}
          </button>
        </div>
      </section>

      {pulling && (
        <section className="card p-6">
          <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-600">
            <LoadingSpinner className="h-5 w-5" />
            <span>Sedang mengambil data pengeluaran bahan baku...</span>
          </div>
        </section>
      )}

      {saving && (
        <Notice type="warning" message="Sedang menyimpan data ke laporan keuangan..." />
      )}

      {!pulling && error && <Notice type="error" message={error} />}
      {!pulling && success && <Notice type="success" message={success} />}

      {!pulling && changedItems.length > 0 && (
        <Notice
          type="warning"
          message="Data sudah pernah diimport, tetapi nominal dari sistem bahan baku berubah. Pilih update transaksi lama untuk baris yang ingin disesuaikan."
        />
      )}

      {!pulling && items.length > 0 && (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Pengeluaran</p>
              <p className="mt-1 text-xl font-extrabold text-red-600 text-rupiah">{formatRupiah(previewTotals.totalAmount)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Jumlah Cabang</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewTotals.branchCount}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Jumlah Transaksi</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewTotals.transactionCount || '-'}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Siap Disimpan</p>
              <p className="mt-1 text-xl font-extrabold text-blue-600">
                {items.filter((item) => item.status === 'new').length + changedItems.filter((item) => decisions[item.importKey] === 'update').length}
              </p>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-950">Preview Data Pengeluaran Bahan Baku</h3>
                <p className="text-xs text-slate-500">Periksa data sebelum disimpan ke cashflow.</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">{items.length} baris</span>
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header w-[18%]">Tanggal / Periode</th>
                    <th className="table-header w-[18%]">Cabang</th>
                    <th className="table-header text-right">Total Pengeluaran Bahan Baku</th>
                    <th className="table-header text-right">Jumlah Transaksi</th>
                    <th className="table-header w-[18%]">Status Import</th>
                    <th className="table-header w-[20%] text-right">Pilihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.importKey} className="hover:bg-slate-50">
                      <td className="table-cell font-semibold">{formatPeriod(item)}</td>
                      <td className="table-cell">
                        <div className="truncate">{item.branchName}</div>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{item.importKey}</p>
                      </td>
                      <td className="table-cell text-right font-bold text-red-600 text-rupiah">{formatRupiah(item.totalAmount)}</td>
                      <td className="table-cell text-right">{formatCount(item.transactionCount)}</td>
                      <td className="table-cell">
                        <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-bold', statusClass[item.status])}>
                          {item.statusLabel}
                        </span>
                        {item.warning && <p className="mt-1 text-xs text-amber-700">{item.warning}</p>}
                      </td>
                      <td className="table-cell text-right">
                        {item.status === 'changed' ? (
                          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                            <button
                              type="button"
                              onClick={() => updateDecision(item.importKey, 'ignore')}
                              className={cn(
                                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                                decisions[item.importKey] !== 'update'
                                  ? 'bg-slate-100 text-slate-700'
                                  : 'text-slate-500 hover:bg-slate-50'
                              )}
                            >
                              Abaikan
                            </button>
                            <button
                              type="button"
                              onClick={() => updateDecision(item.importKey, 'update')}
                              className={cn(
                                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                                decisions[item.importKey] === 'update'
                                  ? 'bg-amber-500 text-white'
                                  : 'text-slate-500 hover:bg-slate-50'
                              )}
                            >
                              Update transaksi lama
                            </button>
                          </div>
                        ) : item.status === 'new' ? (
                          <span className="text-xs font-semibold text-blue-600">Akan disimpan</span>
                        ) : (
                          <span className="text-xs text-slate-400">Tidak ada aksi</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 lg:hidden">
              {items.map((item) => (
                <article key={item.importKey} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-950">{item.branchName}</p>
                      <p className="text-xs text-slate-500">{formatPeriod(item)}</p>
                    </div>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-bold', statusClass[item.status])}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <p className="mt-3 overflow-x-auto whitespace-nowrap text-xl font-extrabold text-red-600 text-rupiah scrollbar-thin">
                    {formatRupiah(item.totalAmount)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formatCount(item.transactionCount)}</p>
                  {item.warning && <p className="mt-2 text-xs font-medium text-amber-700">{item.warning}</p>}
                  {item.status === 'changed' && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateDecision(item.importKey, 'ignore')}
                        className={cn('rounded-lg px-3 py-2 text-xs font-bold', decisions[item.importKey] !== 'update' ? 'bg-slate-100 text-slate-700' : 'border border-slate-200 text-slate-500')}
                      >
                        Abaikan
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDecision(item.importKey, 'update')}
                        className={cn('rounded-lg px-3 py-2 text-xs font-bold', decisions[item.importKey] === 'update' ? 'bg-amber-500 text-white' : 'border border-slate-200 text-slate-500')}
                      >
                        Update transaksi lama
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600">
                Total semua cabang: <span className="font-extrabold text-red-600 text-rupiah">{formatRupiah(previewTotals.totalAllBranches)}</span>
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || pulling || !canSave}
                className="btn-primary flex w-full items-center gap-2 text-sm md:w-auto"
              >
                {saving ? <LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> : <Database className="h-4 w-4" />}
                {saving ? 'Sedang menyimpan...' : 'Simpan ke Laporan Keuangan'}
              </button>
            </div>
          </section>
        </>
      )}

      {!pulling && hasFetched && !error && items.length === 0 && (
        <section className="card">
          <EmptyState title="Belum ada pengeluaran bahan baku" description="Belum ada pengeluaran bahan baku pada periode ini." />
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">Riwayat Import</h3>
            <p className="text-xs text-slate-500">Aktivitas integrasi pengeluaran bahan baku terakhir.</p>
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
          <EmptyState title="Belum ada riwayat import" description="Riwayat akan muncul setelah admin menarik atau menyimpan data." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header">Waktu Import</th>
                    <th className="table-header">Periode</th>
                    <th className="table-header text-right">Cabang Berhasil</th>
                    <th className="table-header text-right">Total Nominal</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Admin</th>
                    <th className="table-header">Pesan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="table-cell text-xs text-slate-500">{formatDateTime(log.imported_at)}</td>
                      <td className="table-cell font-semibold">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} - ${formatDate(log.period_end)}`}
                      </td>
                      <td className="table-cell text-right">{log.branch_count}</td>
                      <td className="table-cell text-right font-bold text-rupiah">{formatRupiah(log.total_amount)}</td>
                      <td className="table-cell">
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
                          log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        )}>
                          {log.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {log.status === 'success' ? 'Berhasil' : 'Gagal'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <p className="font-semibold">{log.actor?.full_name || 'Admin'}</p>
                        <p className="text-xs text-slate-400">{log.actor?.email}</p>
                      </td>
                      <td className="table-cell text-xs text-slate-500">{getLogMessage(log)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
              {logs.map((log) => (
                <article key={log.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-950">{formatDateTime(log.imported_at)}</p>
                      <p className="text-xs text-slate-500">
                        {log.period_start === log.period_end
                          ? formatDate(log.period_start)
                          : `${formatDate(log.period_start)} - ${formatDate(log.period_end)}`}
                      </p>
                    </div>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
                      log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    )}>
                      {log.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {log.status === 'success' ? 'Berhasil' : 'Gagal'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Cabang</p>
                      <p className="font-semibold">{log.branch_count}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Total</p>
                      <p className="font-bold text-rupiah">{formatRupiah(log.total_amount)}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    <div className="mb-1 flex items-center gap-1 font-semibold text-slate-700">
                      <Clock3 className="h-3.5 w-3.5" />
                      {log.actor?.full_name || 'Admin'}
                    </div>
                    {getLogMessage(log)}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
