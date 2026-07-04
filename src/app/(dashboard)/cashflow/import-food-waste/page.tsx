'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CloudDownload,
  Database,
  MapPin,
  RefreshCw,
  RotateCcw,
  Save,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, FoodWasteImportLog, InventoriBranchMapping } from '@/types/database'
import type {
  FoodWasteImportItem,
  FoodWasteImportPayload,
  FoodWasteImportSummary,
  FoodWasteMaterialDetail,
  SaveFoodWasteImportResult,
} from '@/lib/food-waste-import/shared'
import { FOOD_WASTE_SOURCE } from '@/lib/food-waste-import/shared'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner, PageLoading } from '@/components/ui/LoadingSpinner'
import { cn, formatDate, formatDateTime, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { invalidateCachedData } from '@/lib/utils/client-cache'
import { checkDateAlreadyImportedBySource } from '@/lib/utils/import-date-status'

type Decision = 'ignore' | 'update'

interface ApiPreviewResponse extends Partial<FoodWasteImportPayload> {
  success: boolean
  message?: string
}

interface ApiSaveResponse {
  success: boolean
  message?: string
  result?: SaveFoodWasteImportResult
}

const statusClass: Record<FoodWasteImportItem['status'], string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-100',
  imported: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  changed: 'bg-amber-50 text-amber-700 border-amber-100',
  branch_not_found: 'bg-red-50 text-red-700 border-red-100',
}

const wasteReasonLabel: Record<string, string> = {
  hilang: 'Hilang',
  berjamur: 'Berjamur / Rusak',
  lainnya: 'Lainnya',
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

function formatQuantity(quantity: number) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(quantity)
}

function formatWasteReason(material: FoodWasteMaterialDetail) {
  if (!material.wasteReason) return '-'
  const label = wasteReasonLabel[material.wasteReason] ?? material.wasteReason
  if (material.wasteReason === 'lainnya' && material.wasteReasonDetail) {
    return `${label}: ${material.wasteReasonDetail}`
  }
  return label
}

function MaterialDetailList({ materials }: { materials: FoodWasteMaterialDetail[] }) {
  return (
    <ul className="space-y-1.5">
      {materials.map((material, index) => (
        <li
          key={`${material.materialId}-${index}`}
          className={cn(
            'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-xs',
            material.value === null ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-700'
          )}
        >
          <span className="font-semibold">
            {material.materialName}
            <span className="ml-1.5 font-normal text-slate-500">
              {formatQuantity(material.quantity)} {material.unit || ''}
            </span>
          </span>
          <span className="font-bold text-rupiah">
            {material.value === null
              ? 'Harga belum di-set'
              : `${formatRupiah(material.value)}`}
          </span>
          <span className="w-full text-[11px] text-slate-500">
            {formatWasteReason(material)}
            {material.unitPrice !== null && (
              <> · @{formatRupiah(material.unitPrice)}</>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function getLogMessage(log: FoodWasteImportLog) {
  return log.message || (log.status === 'success' ? 'Sinkronisasi berhasil.' : 'Sinkronisasi gagal.')
}

export default function ImportFoodWastePage() {
  const today = toDateInputValue()
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [items, setItems] = useState<FoodWasteImportItem[]>([])
  const [summary, setSummary] = useState<FoodWasteImportSummary | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [skippedItems, setSkippedItems] = useState<Set<string>>(new Set())
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [hasFetched, setHasFetched] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [logs, setLogs] = useState<FoodWasteImportLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

  // Status import per-tanggal (hanya berlaku untuk pilihan tanggal tunggal)
  const [dateAlreadyImported, setDateAlreadyImported] = useState(false)
  const [checkingImportStatus, setCheckingImportStatus] = useState(false)
  const [forceRecheck, setForceRecheck] = useState(false)

  // Branch mapping state
  const [pendingMappings, setPendingMappings] = useState<Record<string, string>>({})
  const [savingMappingKey, setSavingMappingKey] = useState<string | null>(null)
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null)
  const [existingMappings, setExistingMappings] = useState<InventoriBranchMapping[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(true)

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
      .from('food_waste_import_logs')
      .select('*, actor:profiles(full_name,email)')
      .order('imported_at', { ascending: false })
      .limit(20)

    setLogs((data || []) as unknown as FoodWasteImportLog[])
    setLogsLoading(false)
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('inventori_branch_mappings')
      .select('*, branch:branches(id,name)')
      .order('inventori_name')
    setExistingMappings((data || []) as unknown as InventoriBranchMapping[])
    setMappingsLoading(false)
  }, [])

  useEffect(() => { loadMappings() }, [loadMappings])

  // ----- Cek status import untuk tanggal yang dipilih -----
  const checkImportStatus = useCallback(async () => {
    if (!startDate || startDate !== endDate) {
      setDateAlreadyImported(false)
      return
    }
    setCheckingImportStatus(true)
    try {
      const supabase = createClient()
      const already = await checkDateAlreadyImportedBySource(supabase, {
        date: startDate,
        branchId: branchId || undefined,
        source: FOOD_WASTE_SOURCE,
      })
      setDateAlreadyImported(already)
    } catch {
      setDateAlreadyImported(false)
    } finally {
      setCheckingImportStatus(false)
    }
  }, [startDate, endDate, branchId])

  useEffect(() => {
    setForceRecheck(false)
    checkImportStatus()
  }, [checkImportStatus])

  const unresolvedBranches = useMemo(() => {
    const seen = new Set<string>()
    return items
      .filter((item) => item.status === 'branch_not_found')
      .filter((item) => { if (seen.has(item.branchName)) return false; seen.add(item.branchName); return true })
      .map((item) => item.branchName)
  }, [items])

  async function handleSaveMapping(inventoriName: string) {
    const mappedBranchId = pendingMappings[inventoriName]
    if (!mappedBranchId) return

    setSavingMappingKey(inventoriName)
    setError(null)
    setMappingSuccess(null)

    try {
      const res = await fetch('/api/food-waste-import/map-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventori_name: inventoriName, branch_id: mappedBranchId }),
      })
      const json = await res.json() as { success: boolean; message?: string }

      if (!res.ok || !json.success) {
        setError(json.message || 'Gagal menyimpan mapping cabang.')
        return
      }

      setPendingMappings((prev) => { const next = { ...prev }; delete next[inventoriName]; return next })
      await Promise.all([
        loadMappings(),
        hasFetched ? pullData({ keepSuccess: true }) : Promise.resolve(),
      ])
      setMappingSuccess(`Mapping "${inventoriName}" berhasil disimpan. Preview diperbarui.`)
    } finally {
      setSavingMappingKey(null)
    }
  }

  async function handleDeleteMapping(inventoriName: string) {
    const res = await fetch(`/api/food-waste-import/map-branch?inventori_name=${encodeURIComponent(inventoriName)}`, {
      method: 'DELETE',
    })
    const json = await res.json() as { success: boolean; message?: string }
    if (res.ok && json.success) {
      await loadMappings()
    } else {
      setError(json.message || 'Gagal menghapus mapping.')
    }
  }

  const previewTotals = useMemo(() => {
    if (summary) return summary
    const branchNames = new Set(items.map((item) => item.branchName))
    return items.reduce(
      (acc, item) => ({
        ...acc,
        itemCount: acc.itemCount + item.itemCount,
        missingPriceCount: acc.missingPriceCount + item.missingPriceCount,
        totalAmount: acc.totalAmount + item.totalAmount,
      }),
      { branchCount: branchNames.size, itemCount: 0, missingPriceCount: 0, totalAmount: 0 }
    )
  }, [items, summary])

  const changedItems = useMemo(() => items.filter((item) => item.status === 'changed'), [items])
  const canSave = items.some((item) => (
    (item.status === 'new' && item.totalAmount > 0 && !skippedItems.has(item.importKey)) ||
    (item.status === 'changed' && decisions[item.importKey] === 'update')
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

      const response = await fetch(`/api/food-waste-import?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json() as ApiPreviewResponse

      if (!response.ok || !payload.success) {
        setItems([])
        setSummary(null)
        setDecisions({})
        setHasFetched(true)
        setError(payload.message || 'Gagal menarik data food waste.')
        return false
      }

      const nextItems = payload.items || []
      setItems(nextItems)
      setSummary(payload.summary || null)
      setSkippedItems(new Set())
      setExpandedItems(new Set())
      setDecisions(Object.fromEntries(
        nextItems
          .filter((item) => item.status === 'changed')
          .map((item) => [item.importKey, 'ignore' as Decision])
      ))
      setHasFetched(true)
      return true
    } catch {
      setError('Gagal terhubung ke sistem inventori. Coba beberapa saat lagi.')
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
      const response = await fetch('/api/food-waste-import/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tanggal_mulai: startDate,
          tanggal_akhir: endDate,
          branch_id: branchId || undefined,
          decisions,
          skipped_keys: skippedItems.size > 0 ? Array.from(skippedItems) : undefined,
        }),
      })
      const payload = await response.json() as ApiSaveResponse

      if (!response.ok || !payload.success) {
        setError(payload.message || 'Gagal menyimpan data ke laporan keuangan.')
        await loadLogs()
        return
      }

      invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)
      setForceRecheck(false)
      await Promise.all([pullData({ keepSuccess: true }), loadLogs(), checkImportStatus()])
      setSuccess(payload.result?.message || 'Data food waste berhasil disimpan.')
    } catch {
      setError('Gagal menyimpan data ke laporan keuangan.')
    } finally {
      setSaving(false)
    }
  }

  function updateDecision(importKey: string, decision: Decision) {
    setDecisions((current) => ({ ...current, [importKey]: decision }))
  }

  function toggleExpanded(importKey: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(importKey)) next.delete(importKey)
      else next.add(importKey)
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Import Food Waste</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Bahan rusak/terbuang yang dilaporkan staff di Sistem Inventori dicatat sebagai pengeluaran
            kategori <strong>Food Waste</strong>. Nilai kerugian dihitung otomatis dari jumlah terbuang
            dikali harga satuan master inventori.
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

      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        <Timer className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Sinkronisasi berjalan <strong>otomatis setiap pagi</strong> untuk laporan kemarin &amp; hari ini.
          Halaman ini dipakai untuk memantau hasilnya atau menarik ulang periode tertentu secara manual.
        </span>
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
            disabled={pulling || saving || checkingImportStatus || (dateAlreadyImported && !forceRecheck)}
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

        {checkingImportStatus && (
          <p className="mt-3 text-xs text-slate-400">Memeriksa status tanggal...</p>
        )}

        {!checkingImportStatus && dateAlreadyImported && !forceRecheck && (
          <div className="mt-3 flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 w-fit">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            Tanggal ini sudah pernah diimport
            <button
              type="button"
              onClick={() => setForceRecheck(true)}
              className="underline decoration-dotted underline-offset-2 hover:text-emerald-900"
            >
              Tetap tarik data
            </button>
          </div>
        )}
      </section>

      {pulling && (
        <section className="card p-6">
          <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-600">
            <LoadingSpinner className="h-5 w-5" />
            <span>Sedang mengambil data food waste dari sistem inventori...</span>
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
          message="Data sudah pernah diimport, tetapi nilai kerugian dari sistem inventori berubah (mis. harga satuan baru diisi admin). Pilih update transaksi lama untuk baris yang ingin disesuaikan. Sync otomatis harian akan meng-update baris seperti ini dengan sendirinya."
        />
      )}

      {!pulling && previewTotals.missingPriceCount > 0 && (
        <Notice
          type="warning"
          message={`${previewTotals.missingPriceCount} bahan terbuang belum punya harga satuan di panel inventori sehingga nilai kerugiannya belum dihitung. Isi harga di panel Materials/Working Capital inventori, lalu tarik data lagi.`}
        />
      )}

      {mappingSuccess && !pulling && (
        <Notice type="success" message={mappingSuccess} />
      )}

      {!pulling && unresolvedBranches.length > 0 && (
        <section className="card overflow-hidden border-l-4 border-amber-400">
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mapping Cabang Diperlukan</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Nama cabang berikut dari sistem inventori belum cocok dengan cabang di laporan keuangan.
                  Pilih cabang yang sesuai, lalu klik <strong>Simpan Mapping</strong>.
                  Preview akan diperbarui otomatis.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {unresolvedBranches.map((inventoriName) => (
                <div key={inventoriName} className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3 sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Nama dari sistem inventori</p>
                    <p className="mt-0.5 text-sm font-bold text-amber-800">{inventoriName}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={pendingMappings[inventoriName] || ''}
                      onChange={(e) => setPendingMappings((prev) => ({ ...prev, [inventoriName]: e.target.value }))}
                      className="input-field text-sm min-w-[200px]"
                    >
                      <option value="">Pilih cabang di laporan keuangan...</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleSaveMapping(inventoriName)}
                      disabled={!pendingMappings[inventoriName] || savingMappingKey === inventoriName}
                      className="btn-primary flex items-center gap-1.5 text-sm whitespace-nowrap"
                    >
                      {savingMappingKey === inventoriName
                        ? <><LoadingSpinner className="h-3.5 w-3.5 border-white border-t-transparent" /> Menyimpan...</>
                        : <><Save className="h-3.5 w-3.5" /> Simpan Mapping</>
                      }
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {!pulling && items.length > 0 && (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Nilai Kerugian</p>
              <p className="mt-1 text-xl font-extrabold text-red-600 text-rupiah">{formatRupiah(previewTotals.totalAmount)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Jumlah Cabang</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewTotals.branchCount}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Bahan Terbuang</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewTotals.itemCount}</p>
              {previewTotals.missingPriceCount > 0 && (
                <p className="mt-0.5 text-xs font-semibold text-amber-600">{previewTotals.missingPriceCount} tanpa harga</p>
              )}
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Siap Disimpan</p>
              <p className="mt-1 text-xl font-extrabold text-blue-600">
                {items.filter((item) => item.status === 'new' && item.totalAmount > 0 && !skippedItems.has(item.importKey)).length + changedItems.filter((item) => decisions[item.importKey] === 'update').length}
              </p>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-950">Preview Data Food Waste</h3>
                <p className="text-xs text-slate-500">Satu baris = satu entri cashflow per cabang per tanggal. Klik jumlah bahan untuk melihat rinciannya.</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">{items.length} baris</span>
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header w-[14%]">Tanggal</th>
                    <th className="table-header w-[16%]">Cabang</th>
                    <th className="table-header text-right">Nilai Kerugian</th>
                    <th className="table-header">Bahan Terbuang</th>
                    <th className="table-header w-[16%]">Status Import</th>
                    <th className="table-header w-[20%] text-right">Pilihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.importKey} className={cn('transition-colors align-top', skippedItems.has(item.importKey) ? 'opacity-50 bg-slate-50' : 'hover:bg-slate-50')}>
                      <td className="table-cell font-semibold">{formatDate(item.reportDate)}</td>
                      <td className="table-cell">
                        <div className="truncate">{item.branchName}</div>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{item.importKey}</p>
                      </td>
                      <td className="table-cell text-right font-bold text-red-600 text-rupiah">{formatRupiah(item.totalAmount)}</td>
                      <td className="table-cell">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.importKey)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expandedItems.has(item.importKey) && 'rotate-180')} />
                          {item.itemCount} bahan
                          {item.missingPriceCount > 0 && (
                            <span className="text-amber-600">({item.missingPriceCount} tanpa harga)</span>
                          )}
                        </button>
                        {expandedItems.has(item.importKey) && (
                          <div className="mt-2 max-w-md">
                            <MaterialDetailList materials={item.materials} />
                          </div>
                        )}
                      </td>
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
                          item.totalAmount <= 0 ? (
                            <span className="text-xs font-semibold text-amber-600">Menunggu harga satuan</span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              {skippedItems.has(item.importKey) ? (
                                <button
                                  type="button"
                                  onClick={() => setSkippedItems((prev) => { const n = new Set(prev); n.delete(item.importKey); return n })}
                                  className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Batalkan Lewati
                                </button>
                              ) : (
                                <>
                                  <span className="text-xs font-semibold text-blue-600">Akan disimpan</span>
                                  <button
                                    type="button"
                                    onClick={() => setSkippedItems((prev) => new Set(prev).add(item.importKey))}
                                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                    title="Lewati — tidak disimpan"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Lewati
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        ) : item.status === 'branch_not_found' ? (
                          <span className="text-xs font-semibold text-amber-600">↑ Atur mapping di atas</span>
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
                <article key={item.importKey} className={cn('rounded-xl border border-slate-100 bg-white p-3 shadow-sm', skippedItems.has(item.importKey) && 'opacity-50')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn('text-sm font-bold', skippedItems.has(item.importKey) ? 'line-through text-slate-400' : 'text-slate-950')}>{item.branchName}</p>
                      <p className="text-xs text-slate-500">{formatDate(item.reportDate)}</p>
                    </div>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-bold', statusClass[item.status])}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <p className="mt-3 overflow-x-auto whitespace-nowrap text-xl font-extrabold text-red-600 text-rupiah scrollbar-thin">
                    {formatRupiah(item.totalAmount)}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.importKey)}
                    className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-600"
                  >
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expandedItems.has(item.importKey) && 'rotate-180')} />
                    {item.itemCount} bahan terbuang
                    {item.missingPriceCount > 0 && (
                      <span className="text-amber-600">({item.missingPriceCount} tanpa harga)</span>
                    )}
                  </button>
                  {expandedItems.has(item.importKey) && (
                    <div className="mt-2">
                      <MaterialDetailList materials={item.materials} />
                    </div>
                  )}
                  {item.warning && <p className="mt-2 text-xs font-medium text-amber-700">{item.warning}</p>}
                  {item.status === 'new' && item.totalAmount > 0 && (
                    <div className="mt-3">
                      {skippedItems.has(item.importKey) ? (
                        <button
                          type="button"
                          onClick={() => setSkippedItems((prev) => { const n = new Set(prev); n.delete(item.importKey); return n })}
                          className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 w-full justify-center"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Batalkan Lewati
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSkippedItems((prev) => new Set(prev).add(item.importKey))}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 w-full justify-center hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          Lewati (tidak disimpan)
                        </button>
                      )}
                    </div>
                  )}
                  {item.status === 'new' && item.totalAmount <= 0 && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                      Menunggu harga satuan diisi di panel inventori.
                    </p>
                  )}
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
                  {item.status === 'branch_not_found' && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                      <MapPin className="inline h-3 w-3 mr-1" />
                      Gunakan panel mapping di atas untuk mencocokkan cabang ini.
                    </p>
                  )}
                </article>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600">
                Total semua cabang: <span className="font-extrabold text-red-600 text-rupiah">{formatRupiah(previewTotals.totalAmount)}</span>
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
          <EmptyState title="Belum ada bahan terbuang" description="Belum ada laporan bahan rusak/terbuang pada periode ini." />
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">Mapping Cabang Inventori</h3>
            <p className="text-xs text-slate-500">
              Daftar pemetaan nama cabang dari sistem inventori ke cabang di laporan keuangan.
            </p>
          </div>
          <button
            type="button"
            onClick={loadMappings}
            disabled={mappingsLoading}
            className="btn-outline mt-2 flex w-full items-center gap-2 text-sm md:mt-0 md:w-auto"
          >
            <RefreshCw className={cn('h-4 w-4', mappingsLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {mappingsLoading ? (
          <PageLoading />
        ) : existingMappings.length === 0 ? (
          <EmptyState
            title="Belum ada mapping cabang"
            description="Nama cabang yang sama persis dengan cabang laporan keuangan otomatis cocok tanpa mapping. Mapping hanya perlu dibuat bila namanya berbeda."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-auto">
                <thead>
                  <tr>
                    <th className="table-header">Nama di Sistem Inventori</th>
                    <th className="table-header">Cabang di Laporan Keuangan</th>
                    <th className="table-header w-[80px] text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {existingMappings.map((mapping) => (
                    <tr key={mapping.id} className="hover:bg-slate-50">
                      <td className="table-cell font-semibold text-amber-800">{mapping.inventori_name}</td>
                      <td className="table-cell font-medium text-slate-900">
                        {mapping.branch?.name || mapping.branch_id}
                      </td>
                      <td className="table-cell text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteMapping(mapping.inventori_name)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Hapus mapping"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
              {existingMappings.map((mapping) => (
                <article key={mapping.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400">Dari sistem inventori</p>
                      <p className="font-bold text-amber-800">{mapping.inventori_name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMapping(mapping.inventori_name)}
                      className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-900">
                      {mapping.branch?.name || mapping.branch_id}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">Riwayat Sinkronisasi</h3>
            <p className="text-xs text-slate-500">Aktivitas sync food waste terakhir (otomatis maupun manual).</p>
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
          <EmptyState title="Belum ada riwayat sinkronisasi" description="Riwayat akan muncul setelah sync otomatis berjalan atau admin menyimpan data." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] table-auto">
                <thead>
                  <tr>
                    <th className="table-header">Waktu Sync</th>
                    <th className="table-header">Periode</th>
                    <th className="table-header text-right">Cabang</th>
                    <th className="table-header text-right">Total Kerugian</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Oleh</th>
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
                        {log.triggered_by === 'scheduler' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                            <Timer className="h-3.5 w-3.5" /> Sync Otomatis
                          </span>
                        ) : (
                          <>
                            <p className="font-semibold">{log.actor?.full_name || 'Admin'}</p>
                            <p className="text-xs text-slate-400">{log.actor?.email}</p>
                          </>
                        )}
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
                      {log.triggered_by === 'scheduler'
                        ? <><Timer className="h-3.5 w-3.5" /> Sync Otomatis</>
                        : <><Clock3 className="h-3.5 w-3.5" /> {log.actor?.full_name || 'Admin'}</>}
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
