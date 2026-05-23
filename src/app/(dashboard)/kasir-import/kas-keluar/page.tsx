'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  Database,
  Info,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch } from '@/types/database'
import type {
  KasirExpensePreviewItem,
  KasirExpensePreviewPayload,
  KasirImportResult,
  KasirExpenseMappingConfig,
  ExpenseMappingMode,
  MappingTarget,
} from '@/lib/kasir-import/shared'
import {
  distributeSplitAmounts,
  validateMappingTargets,
} from '@/lib/kasir-import/shared'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn, formatDate, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { invalidateCachedData } from '@/lib/utils/client-cache'

// -----------------------------------------------
// Types
// -----------------------------------------------
type ExpStatus = KasirExpensePreviewItem['status']

interface ApiPreviewResponse extends Partial<KasirExpensePreviewPayload> {
  success: boolean
  message?: string
  code?: string
}
interface ApiImportResponse {
  success: boolean
  message?: string
  result?: KasirImportResult
}

const STATUS_STYLES: Record<ExpStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-100',
  duplicate: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  void_skipped: 'bg-slate-50 text-slate-400 border-slate-100',
  branch_not_found: 'bg-red-50 text-red-700 border-red-100',
}

const PAGE_SIZE = 30

// -----------------------------------------------
// Notice component
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

// -----------------------------------------------
// Mapping panel for a single expense item
// -----------------------------------------------
function MappingPanel({
  item,
  allBranches,
  mapping,
  onChange,
}: {
  item: KasirExpensePreviewItem
  allBranches: Pick<Branch, 'id' | 'name'>[]
  mapping: KasirExpenseMappingConfig
  onChange: (m: KasirExpenseMappingConfig) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const modes: { value: ExpenseMappingMode; label: string; desc: string }[] = [
    { value: 'original', label: 'Outlet Asal', desc: `Masuk ke ${item.branchName}` },
    { value: 'split_equal', label: 'Bagi Rata', desc: 'Bagi ke beberapa outlet secara merata' },
    { value: 'split_manual', label: 'Manual', desc: 'Tentukan nominal per outlet secara manual' },
    { value: 'remap', label: 'Pindah Outlet', desc: 'Pindahkan ke outlet lain' },
  ]

  function setMode(mode: ExpenseMappingMode) {
    if (mode === 'original') {
      const b = allBranches.find((b) => b.id === item.branchId)
      onChange({
        mode,
        targets: b ? [{ branchId: b.id, branchName: b.name, amount: item.amount }] : [],
      })
    } else if (mode === 'remap') {
      onChange({ mode, targets: [] })
    } else if (mode === 'split_equal' || mode === 'split_manual') {
      onChange({ mode, targets: [] })
    }
  }

  // ── split_equal: checklist outlets
  function toggleSplitBranch(branchId: string, branchName: string) {
    const existing = mapping.targets.find((t) => t.branchId === branchId)
    let newTargets: MappingTarget[]
    if (existing) {
      newTargets = mapping.targets.filter((t) => t.branchId !== branchId)
    } else {
      newTargets = [...mapping.targets, { branchId, branchName, amount: 0 }]
    }
    // Redistribute
    const amounts = distributeSplitAmounts(item.amount, newTargets.length)
    newTargets = newTargets.map((t, i) => ({ ...t, amount: amounts[i] }))
    onChange({ ...mapping, targets: newTargets })
  }

  // ── split_manual: change amount per target
  function setManualAmount(branchId: string, amount: number) {
    const newTargets = mapping.targets.map((t) =>
      t.branchId === branchId ? { ...t, amount } : t
    )
    onChange({ ...mapping, targets: newTargets })
  }

  function toggleManualBranch(branchId: string, branchName: string) {
    const existing = mapping.targets.find((t) => t.branchId === branchId)
    if (existing) {
      onChange({ ...mapping, targets: mapping.targets.filter((t) => t.branchId !== branchId) })
    } else {
      onChange({ ...mapping, targets: [...mapping.targets, { branchId, branchName, amount: 0 }] })
    }
  }

  // ── remap: pick single branch
  function setRemapBranch(branchId: string, branchName: string) {
    onChange({ ...mapping, targets: [{ branchId, branchName, amount: item.amount }] })
  }

  const mappingSum = mapping.targets.reduce((s, t) => s + t.amount, 0)
  const mappingError =
    (mapping.mode === 'split_manual' || mapping.mode === 'split_equal' || mapping.mode === 'remap')
      ? validateMappingTargets(mapping.targets, item.amount)
      : null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
      >
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Konfigurasi Mapping Outlet
        {mapping.mode !== 'original' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 font-bold">
            {modes.find((m) => m.value === mapping.mode)?.label}
          </span>
        )}
        {mappingError && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">⚠ Perlu dikonfirmasi</span>
        )}
      </button>

      {isOpen && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
          {/* Mode selector */}
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1.5">Mode Mapping:</p>
            <div className="flex flex-wrap gap-2">
              {modes.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors',
                    mapping.mode === m.value
                      ? 'border-rbn-red bg-rbn-red text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  )}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Remap: pick one branch */}
          {mapping.mode === 'remap' && (
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Pilih Outlet Tujuan:</p>
              <div className="flex flex-wrap gap-1.5">
                {allBranches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setRemapBranch(b.id, b.name)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                      mapping.targets[0]?.branchId === b.id
                        ? 'border-blue-400 bg-blue-500 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Split equal: checklist multi-branch */}
          {mapping.mode === 'split_equal' && (
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">
                Pilih Outlet (centang untuk menanggung beban):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allBranches.map((b) => {
                  const selected = mapping.targets.some((t) => t.branchId === b.id)
                  const target = mapping.targets.find((t) => t.branchId === b.id)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleSplitBranch(b.id, b.name)}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                        selected
                          ? 'border-blue-400 bg-blue-500 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                      )}
                    >
                      {selected && <CheckCircle2 className="h-3 w-3" />}
                      {b.name}
                      {selected && target && (
                        <span className="ml-1 opacity-80">{formatRupiah(target.amount)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
              {mapping.targets.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Total terbagi: <strong>{formatRupiah(mappingSum)}</strong> dari {formatRupiah(item.amount)}
                </p>
              )}
            </div>
          )}

          {/* Split manual: per-branch input */}
          {mapping.mode === 'split_manual' && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500">Pilih outlet dan tentukan nominal:</p>
              <div className="space-y-1.5">
                {allBranches.map((b) => {
                  const target = mapping.targets.find((t) => t.branchId === b.id)
                  return (
                    <div key={b.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`branch-${b.id}`}
                        checked={!!target}
                        onChange={() => toggleManualBranch(b.id, b.name)}
                        className="rounded border-slate-300"
                      />
                      <label htmlFor={`branch-${b.id}`} className="flex-1 text-xs font-semibold text-slate-700 cursor-pointer">
                        {b.name}
                      </label>
                      {target && (
                        <input
                          type="number"
                          min={0}
                          value={target.amount}
                          onChange={(e) => setManualAmount(b.id, parseInt(e.target.value) || 0)}
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs font-semibold"
                          placeholder="Nominal"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className={cn(
                'flex items-center justify-between rounded-lg p-2 text-xs font-bold',
                mappingSum === item.amount
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              )}>
                <span>Total mapping: {formatRupiah(mappingSum)}</span>
                <span>Nominal asli: {formatRupiah(item.amount)}</span>
              </div>
            </div>
          )}

          {/* Validation error */}
          {mappingError && (
            <p className="text-xs text-red-600 font-semibold">⚠ {mappingError}</p>
          )}

          {/* Mapping preview */}
          {mapping.targets.length > 0 && !mappingError && (
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <p className="text-xs font-bold text-slate-500 mb-1">Preview mapping:</p>
              {mapping.targets.map((t) => (
                <div key={t.branchId} className="flex justify-between text-xs py-0.5">
                  <span className="font-semibold text-slate-700">{t.branchName}</span>
                  <span className="font-bold">{formatRupiah(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------
// Main page
// -----------------------------------------------
export default function ImportKasKeluarPage() {
  const today = toDateInputValue()
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])

  const [previewData, setPreviewData] = useState<KasirExpensePreviewPayload | null>(null)
  const [mappings, setMappings] = useState<Record<string, KasirExpenseMappingConfig>>({})
  const [hasFetched, setHasFetched] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<KasirImportResult | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    createClient()
      .from('branches')
      .select('id,name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setBranches(data || []))
  }, [])

  const paginatedItems = useMemo(() => {
    const items = previewData?.items || []
    return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  }, [previewData, page])

  const totalPages = Math.ceil((previewData?.items.length || 0) / PAGE_SIZE)

  // Validasi semua mapping
  const mappingErrors = useMemo(() => {
    if (!previewData) return {}
    const errors: Record<string, string> = {}
    for (const item of previewData.items) {
      if (item.status !== 'new') continue
      const m = mappings[item.expenseId] ?? item.mapping
      if (m.mode !== 'original') {
        const err = validateMappingTargets(m.targets, item.amount)
        if (err) errors[item.expenseId] = err
      }
    }
    return errors
  }, [previewData, mappings])

  const hasMappingErrors = Object.keys(mappingErrors).length > 0
  const canImport = (previewData?.summary.totalNew || 0) > 0 && !hasMappingErrors

  function updateMapping(expenseId: string, mapping: KasirExpenseMappingConfig) {
    setMappings((prev) => ({ ...prev, [expenseId]: mapping }))
  }

  function getMappingForItem(item: KasirExpensePreviewItem): KasirExpenseMappingConfig {
    return mappings[item.expenseId] ?? item.mapping
  }

  // ----- Preview -----
  const fetchPreview = useCallback(async (opts: { keepSuccess?: boolean } = {}) => {
    if (!startDate || !endDate) { setError('Lengkapi tanggal terlebih dahulu.'); return }
    if (endDate < startDate) { setError('Tanggal akhir tidak boleh sebelum tanggal mulai.'); return }

    setPulling(true)
    setError(null)
    setImportResult(null)
    setMappings({})
    if (!opts.keepSuccess) setSuccess(null)
    setPage(0)

    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
      if (branchId) params.set('branch_id', branchId)

      const res = await fetch(`/api/kasir-import/expenses?${params}`, { cache: 'no-store' })
      const json = await res.json() as ApiPreviewResponse

      if (!res.ok || !json.success) {
        setPreviewData(null)
        setHasFetched(true)
        const code = json.code
        if (code === 'empty_data') {
          setError(json.message || 'Tidak ada data kas keluar pada periode ini.')
        } else if (code === 'missing_api_key' || code === 'invalid_api_key') {
          setError('API Key integrasi kasir bermasalah. Hubungi administrator.')
        } else if (code === 'endpoint_unreachable') {
          setError('Tidak dapat terhubung ke sistem kasir. Periksa koneksi dan coba lagi.')
        } else {
          setError(json.message || 'Gagal mengambil data kas keluar dari sistem kasir.')
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
  }, [startDate, endDate, branchId])

  // ----- Import -----
  async function handleImport() {
    if (!canImport) {
      if (hasMappingErrors) {
        setError('Perbaiki konfigurasi mapping sebelum import. Cek baris yang ditandai merah.')
      } else {
        setError('Tidak ada data baru untuk diimport.')
      }
      return
    }

    setImporting(true)
    setError(null)
    setSuccess(null)
    setImportResult(null)

    // Merge mappings dari state dengan defaults
    const allMappings: Record<string, KasirExpenseMappingConfig> = {}
    for (const item of previewData?.items || []) {
      if (item.status !== 'new') continue
      allMappings[item.expenseId] = getMappingForItem(item)
    }

    try {
      const res = await fetch('/api/kasir-import/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          branch_id: branchId || undefined,
          mappings: allMappings,
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
          <h2 className="text-xl font-bold text-gray-900">Import Kas Keluar dari Kasir</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Ambil data pengeluaran dari sistem kasir. Bisa mapping ke satu outlet, bagi rata, atau manual.
          </p>
        </div>
        <a href="/kasir-import" className="btn-outline flex w-full items-center gap-2 text-sm lg:w-auto">
          ← Kembali ke Hub
        </a>
      </div>

      {/* Filter */}
      <section className="card p-4 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Langkah 1 — Pilih Rentang Tanggal & Cabang
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              : <><CloudDownload className="h-4 w-4" /> Preview Data Kas Keluar</>
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
      {!pulling && hasMappingErrors && (
        <Notice
          type="warning"
          message={`${Object.keys(mappingErrors).length} item memiliki konfigurasi mapping yang belum valid. Selesaikan sebelum klik Import.`}
        />
      )}
      {!pulling && (previewData?.summary.totalVoidSkipped ?? 0) > 0 && (
        <Notice
          type="info"
          message={`${previewData?.summary.totalVoidSkipped} pengeluaran yang sudah di-void tidak akan diimport.`}
        />
      )}
      {!pulling && (previewData?.summary.totalDuplicate ?? 0) > 0 && (
        <Notice
          type="info"
          message={`${previewData?.summary.totalDuplicate} pengeluaran sudah pernah diimport dan akan dilewati.`}
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
            <div className="rounded-xl bg-red-50 p-3">
              <p className="text-xs text-red-600">Total</p>
              <p className="text-lg font-extrabold text-red-700">{formatRupiah(importResult.totalAmount)}</p>
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="mb-1 text-xs font-bold text-red-700">Detail Error:</p>
              <ul className="space-y-0.5">
                {importResult.errors.map((e, i) => <li key={i} className="text-xs text-red-600">• {e}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Preview loading */}
      {pulling && (
        <section className="card p-6">
          <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-600">
            <LoadingSpinner className="h-5 w-5" />
            Sedang mengambil data kas keluar dari sistem kasir...
          </div>
        </section>
      )}

      {/* Preview data */}
      {!pulling && previewData && previewData.items.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Ditemukan</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewData.summary.totalFound}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Belum Diimport</p>
              <p className="mt-1 text-xl font-extrabold text-blue-600">{previewData.summary.totalNew}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Nominal Baru</p>
              <p className="mt-1 text-xl font-extrabold text-red-600">{formatRupiah(previewData.summary.totalAmount)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Dilewati / Void</p>
              <p className="mt-1 text-xl font-extrabold text-slate-400">
                {previewData.summary.totalDuplicate + previewData.summary.totalVoidSkipped}
              </p>
            </div>
          </div>

          {/* Breakdown per outlet */}
          {previewData.summary.byBranch.length > 1 && (
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-950">Rincian per Outlet</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-1.5 text-left text-xs font-bold uppercase text-slate-400">Outlet</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Item</th>
                      <th className="py-1.5 text-right text-xs font-bold uppercase text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.summary.byBranch.map((b) => (
                      <tr key={b.branchName} className="border-b border-slate-50">
                        <td className="py-2 font-semibold">{b.branchName}</td>
                        <td className="py-2 text-right">{b.count}</td>
                        <td className="py-2 text-right font-bold text-red-600">{formatRupiah(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Transaction list with mapping */}
          <section className="card overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-950">
                  Daftar Kas Keluar — Langkah 2: Konfigurasi Mapping
                </h3>
                <p className="text-xs text-slate-500">
                  Klik &ldquo;Konfigurasi Mapping Outlet&rdquo; pada item yang ingin dibagi ke beberapa outlet.
                </p>
              </div>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || pulling || !canImport}
                className={cn(
                  'btn-primary flex items-center gap-2 text-sm',
                  hasMappingErrors && 'opacity-50 cursor-not-allowed'
                )}
                title={hasMappingErrors ? 'Perbaiki mapping terlebih dahulu' : ''}
              >
                {importing
                  ? <><LoadingSpinner className="h-4 w-4 border-white border-t-transparent" /> Mengimport...</>
                  : <><Database className="h-4 w-4" /> Import {previewData.summary.totalNew} Kas Keluar</>
                }
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {paginatedItems.map((item) => {
                const currentMapping = getMappingForItem(item)
                const hasError = !!mappingErrors[item.expenseId]

                return (
                  <div
                    key={item.importKey}
                    className={cn(
                      'p-4',
                      item.status === 'duplicate' && 'opacity-50 bg-slate-50/50',
                      item.status === 'void_skipped' && 'opacity-40 bg-slate-50/50',
                      hasError && 'bg-red-50/30',
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-slate-950">{item.expenseName}</p>
                          <span className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-xs font-bold',
                            STATUS_STYLES[item.status]
                          )}>
                            {item.statusLabel}
                          </span>
                          {hasError && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                              <AlertTriangle className="h-3 w-3" /> Mapping belum valid
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.branchName} · {formatDate(item.dateWITA)} · {item.timeWITA} WITA
                        </p>
                        <p className="text-xs text-slate-400">
                          Kategori: {item.category} · Dicatat oleh: {item.recordedBy}
                        </p>
                        {item.notes && (
                          <p className="mt-0.5 text-xs italic text-slate-400">&ldquo;{item.notes}&rdquo;</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-extrabold text-red-600">{formatRupiah(item.amount)}</p>
                        <p className="font-mono text-xs text-slate-400">{item.expenseId}</p>
                      </div>
                    </div>

                    {/* Mapping panel — only for new items */}
                    {item.status === 'new' && (
                      <MappingPanel
                        item={item}
                        allBranches={branches}
                        mapping={currentMapping}
                        onChange={(m) => updateMapping(item.expenseId, m)}
                      />
                    )}
                  </div>
                )
              })}
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
                  {page + 1} / {totalPages}
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
              <div>
                <p className="text-sm text-slate-600">
                  Total baru: <span className="font-extrabold text-red-600">{formatRupiah(previewData.summary.totalAmount)}</span>
                  {' '}({previewData.summary.totalNew} item)
                </p>
                {hasMappingErrors && (
                  <p className="text-xs text-red-600 font-semibold mt-0.5">
                    ⚠ {Object.keys(mappingErrors).length} item membutuhkan konfigurasi mapping yang valid
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || pulling || !canImport}
                className={cn('btn-primary flex items-center gap-2 text-sm', hasMappingErrors && 'opacity-50 cursor-not-allowed')}
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
            title="Tidak ada kas keluar"
            description="Tidak ada data pengeluaran ditemukan pada periode dan filter yang dipilih."
          />
        </section>
      )}

      {/* Guide */}
      {!hasFetched && !pulling && (
        <section className="card p-6">
          <h3 className="text-sm font-bold text-slate-950 mb-3">Cara Penggunaan</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">1.</span> Pilih rentang tanggal</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">2.</span> Klik &ldquo;Preview Data Kas Keluar&rdquo;</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">3.</span> Untuk setiap item, bisa pilih mapping: outlet asal, bagi rata, atau manual</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">4.</span> Pastikan total mapping sama dengan nominal asli jika pakai split manual</li>
            <li className="flex gap-2"><span className="flex-shrink-0 font-bold text-rbn-red">5.</span> Klik &ldquo;Import&rdquo;</li>
          </ol>
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
            <strong>Fitur Split:</strong> Pengeluaran bersama (misal: kurir Rp20.000 untuk 3 outlet) bisa dibagi rata atau manual. Total hasil bagi harus selalu sama dengan nominal asli.
          </div>
        </section>
      )}
    </div>
  )
}
