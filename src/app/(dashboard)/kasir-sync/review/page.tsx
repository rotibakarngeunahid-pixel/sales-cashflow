'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CheckCircle2, XCircle, Clock, RefreshCw, ArrowLeft,
  ShoppingCart, Wallet, AlertCircle, X,
  CheckSquare, Square, ChevronDown, MapPin,
  BarChart2, ChevronUp, GitMerge, Plus, Trash2, Calendar,
} from 'lucide-react'
import { formatRupiah, cn } from '@/lib/utils/format'
import type {
  KasirExpenseMappingConfig,
  MappingTarget,
} from '@/lib/kasir-import/shared'
import { isKurirBawaBahanCategory } from '@/lib/cashflow/auto-split-kurir'

// =============================================
// Types
// =============================================

type ItemStatus = 'pending' | 'confirmed' | 'rejected'
type ItemType = 'penjualan' | 'kas_keluar'

interface QueueItem {
  id: string
  item_type: ItemType
  kasir_id: string
  tanggal: string
  waktu: string
  cabang: string
  branch_id: string | null
  // penjualan
  total_penjualan: number | null
  metode_pembayaran: string | null
  kasir_name: string | null
  // kas keluar
  kategori: string | null
  nominal: number | null
  keterangan: string | null
  dicatat_oleh: string | null
  // workflow
  status: ItemStatus
  confirmed_at: string | null
  rejected_at: string | null
  reject_reason: string | null
}

interface Branch {
  id: string
  name: string
}

// =============================================
// Halaman Review Queue
// =============================================

export default function KasirSyncReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<Branch[]>([])

  // Filters — status awal bisa dikirim lewat URL (?status=confirmed dll.)
  const [statusFilter, setStatusFilter] = useState<ItemStatus | 'all'>('pending')

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('status')
    if (param === 'confirmed' || param === 'rejected' || param === 'all') {
      setStatusFilter(param)
    }
  }, [])
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 50

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Summary panel
  const [showSummary, setShowSummary] = useState(true)

  // Expense mappings: key = queue item id
  const [mappings, setMappings] = useState<Record<string, KasirExpenseMappingConfig>>({})
  const [mappingModal, setMappingModal] = useState<QueueItem | null>(null)

  // Reject modal
  const [rejectModal, setRejectModal] = useState<{
    ids: string[]
    reason: string
    loading: boolean
  } | null>(null)

  // Action feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>()

  // ---- Load branches ----
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  // ---- Load data ----
  const loadItems = useCallback(async (reset = false) => {
    const newPage = reset ? 0 : page
    if (reset) { setPage(0); setSelected(new Set()) }
    setLoading(true)
    setError(null)

    const supabase = createClient()

    try {
      let query = supabase
        .from('kasir_sync_queue')
        .select('id, item_type, kasir_id, tanggal, waktu, cabang, branch_id, total_penjualan, metode_pembayaran, kasir_name, kategori, nominal, keterangan, dicatat_oleh, status, confirmed_at, rejected_at, reject_reason')
        .order('tanggal', { ascending: false })
        .order('waktu', { ascending: false })
        .range(newPage * PAGE_SIZE, (newPage + 1) * PAGE_SIZE)

      if (statusFilter !== 'all') query = query.eq('status', statusFilter)
      if (typeFilter !== 'all') query = query.eq('item_type', typeFilter)

      const { data, error: err } = await query
      if (err) throw new Error(err.message)

      const fetched = data ?? []
      const hasMoreData = fetched.length > PAGE_SIZE
      const pageItems = hasMoreData ? fetched.slice(0, PAGE_SIZE) : fetched

      if (reset || newPage === 0) {
        setItems(pageItems)
      } else {
        setItems((prev) => [...prev, ...pageItems])
      }
      setHasMore(hasMoreData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter, page])

  useEffect(() => {
    setPage(0)
    loadItems(true)
  }, [statusFilter, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page > 0) loadItems(false)
  }, [page])  // eslint-disable-line react-hooks/exhaustive-deps

  function showFeedback(type: 'success' | 'error', msg: string) {
    clearTimeout(feedbackTimer.current)
    setFeedback({ type, msg })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 5000)
  }

  // ---- Map branch ----
  async function handleMapBranch(kasirName: string, branchId: string): Promise<void> {
    const res = await fetch('/api/kasir-sync/map-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kasir_name: kasirName, branch_id: branchId }),
    })
    const data = await res.json()
    if (data.success) {
      showFeedback('success', data.message)
      setItems((prev) =>
        prev.map((item) =>
          item.cabang === kasirName && item.status === 'pending'
            ? { ...item, branch_id: branchId }
            : item
        )
      )
    } else {
      showFeedback('error', data.message || 'Gagal menyimpan mapping.')
      throw new Error(data.message)
    }
  }

  // ---- Expense mapping ----
  function handleSaveMapping(itemId: string, config: KasirExpenseMappingConfig) {
    setMappings((prev) => ({ ...prev, [itemId]: config }))
  }

  function handleClearMapping(itemId: string) {
    setMappings((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }

  // ---- Selection helpers ----
  const pendingItems = items.filter((i) => i.status === 'pending')

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === pendingItems.length && pendingItems.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendingItems.map((i) => i.id)))
    }
  }

  // ---- Confirm ----
  async function handleConfirm(ids: string[]) {
    if (ids.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/kasir-sync/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, mappings }),
      })
      const data = await res.json()
      if (data.success || data.confirmed > 0) {
        showFeedback('success', data.message || `${data.confirmed} transaksi dikonfirmasi.`)
        setSelected(new Set())
        await loadItems(true)
      } else {
        showFeedback('error', data.message || 'Konfirmasi gagal.')
      }
    } catch {
      showFeedback('error', 'Gagal terhubung ke server.')
    } finally {
      setLoading(false)
    }
  }

  // ---- Reject ----
  async function handleReject(ids: string[], reason?: string) {
    if (ids.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/kasir-sync/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, reason }),
      })
      const data = await res.json()
      if (data.success || data.rejected > 0) {
        showFeedback('success', data.message || `${data.rejected} item ditolak.`)
        setSelected(new Set())
        setRejectModal(null)
        await loadItems(true)
      } else {
        showFeedback('error', data.message || 'Penolakan gagal.')
      }
    } catch {
      showFeedback('error', 'Gagal terhubung ke server.')
    } finally {
      setLoading(false)
    }
  }

  // ---- Summary data ----
  const summaryData = useMemo(() => {
    const pendingSales = items.filter((i) => i.item_type === 'penjualan' && i.status === 'pending')
    const pendingExp = items.filter((i) => i.item_type === 'kas_keluar' && i.status === 'pending')

    // Penjualan by branch
    const salesMap = new Map<string, { tunai: number; qris: number }>()
    for (const item of pendingSales) {
      const key = item.cabang || 'Tidak Diketahui'
      const curr = salesMap.get(key) ?? { tunai: 0, qris: 0 }
      const metode = (item.metode_pembayaran ?? '').toLowerCase()
      if (metode === 'tunai' || metode === 'cash') curr.tunai += item.total_penjualan ?? 0
      else if (metode === 'qris') curr.qris += item.total_penjualan ?? 0
      salesMap.set(key, curr)
    }

    // Kas keluar by branch → grouped kategori
    const expMap = new Map<string, Array<{ id: string; kategori: string; nominal: number; isKurir: boolean; isAutoSplitKurir: boolean }>>()
    for (const item of pendingExp) {
      const key = item.cabang || 'Tidak Diketahui'
      const list = expMap.get(key) ?? []
      const kategori = item.kategori || 'Lainnya'
      const isKurir = kategori.toLowerCase().includes('kurir')
      const isAutoSplitKurir = isKurirBawaBahanCategory(kategori)
      list.push({ id: item.id, kategori, nominal: item.nominal ?? 0, isKurir, isAutoSplitKurir })
      expMap.set(key, list)
    }

    // Rentang tanggal dari semua item pending
    const allPending = [...pendingSales, ...pendingExp]
    const uniqueDates = Array.from(new Set(allPending.map((i) => i.tanggal).filter(Boolean))).sort()
    const dateFrom = uniqueDates[0] ?? null
    const dateTo = uniqueDates[uniqueDates.length - 1] ?? null

    return {
      salesByBranch: Array.from(salesMap.entries()).map(([branch, v]) => ({
        branch, tunai: v.tunai, qris: v.qris, total: v.tunai + v.qris,
      })).sort((a, b) => b.total - a.total),
      expByBranch: Array.from(expMap.entries()).map(([branch, list]) => ({
        branch,
        total: list.reduce((s, x) => s + x.nominal, 0),
        items: list,
        hasKurir: list.some((x) => x.isKurir),
      })).sort((a, b) => b.total - a.total),
      totalPenjualan: pendingSales.reduce((s, i) => s + (i.total_penjualan ?? 0), 0),
      totalKasKeluar: pendingExp.reduce((s, i) => s + (i.nominal ?? 0), 0),
      pendingSalesCount: pendingSales.length,
      pendingExpCount: pendingExp.length,
      dateFrom,
      dateTo,
      uniqueDates,
    }
  }, [items])

  // ---- Filter counts ----
  const selectedPending = Array.from(selected).filter((id) =>
    items.find((i) => i.id === id && i.status === 'pending')
  )
  const confirmableSelected = selectedPending.filter((id) =>
    items.find((i) => i.id === id && (i.branch_id !== null || isKurirBawaBahanCategory(i.kategori)))
  )
  const unresolvableSelected = selectedPending.filter((id) =>
    items.find((i) => i.id === id && i.branch_id === null && !isKurirBawaBahanCategory(i.kategori))
  )

  // Kas keluar pending yang perlu mapping kurir (belum di-mapping)
  const unmappedKurirCount = pendingItems.filter((i) => {
    if (i.item_type !== 'kas_keluar') return false
    const kat = (i.kategori ?? '').toLowerCase()
    return kat.includes('kurir') && !isKurirBawaBahanCategory(i.kategori) && !mappings[i.id]
  }).length

  const hasPendingSummary =
    summaryData.pendingSalesCount > 0 || summaryData.pendingExpCount > 0

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <a
            href="/kasir-sync"
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </a>
          <div>
            <h1 className="text-xl font-black text-slate-900">Tinjau Antrian</h1>
            <p className="text-xs text-slate-500">Konfirmasi atau tolak transaksi dari kasir</p>
          </div>
        </div>
        <button
          onClick={() => loadItems(true)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border',
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          )}
        >
          {feedback.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {feedback.msg}
        </div>
      )}

      {/* ── Summary Panel ── */}
      {hasPendingSummary && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <button
            onClick={() => setShowSummary((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <BarChart2 className="w-4 h-4 text-rbn-red" />
              <span className="text-sm font-bold text-slate-800">Ringkasan Antrian Pending</span>
              <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">
                {summaryData.pendingSalesCount + summaryData.pendingExpCount} item
              </span>
              {summaryData.dateFrom && (
                <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {summaryData.dateFrom === summaryData.dateTo
                    ? formatDate(summaryData.dateFrom)
                    : `${formatDate(summaryData.dateFrom)} – ${formatDate(summaryData.dateTo!)}`}
                </span>
              )}
              {unmappedKurirCount > 0 && (
                <span className="text-xs bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <GitMerge className="w-3 h-3" />
                  {unmappedKurirCount} kurir belum di-mapping
                </span>
              )}
            </div>
            {showSummary
              ? <ChevronUp className="w-4 h-4 text-slate-400" />
              : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {showSummary && (
            <div className="border-t border-slate-100 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Penjualan */}
              {summaryData.pendingSalesCount > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Penjualan — {formatRupiah(summaryData.totalPenjualan)}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 uppercase tracking-wide">
                        <th className="text-left pb-1 font-semibold">Outlet</th>
                        <th className="text-right pb-1 font-semibold">Tunai</th>
                        <th className="text-right pb-1 font-semibold">QRIS</th>
                        <th className="text-right pb-1 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {summaryData.salesByBranch.map((row) => (
                        <tr key={row.branch}>
                          <td className="py-1 text-slate-700 font-medium truncate max-w-[120px]" title={row.branch}>
                            {row.branch}
                          </td>
                          <td className="py-1 text-right text-slate-600 tabular-nums">
                            {row.tunai > 0 ? formatRupiah(row.tunai) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-1 text-right text-slate-600 tabular-nums">
                            {row.qris > 0 ? formatRupiah(row.qris) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-1 text-right font-bold text-emerald-700 tabular-nums">
                            {formatRupiah(row.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Kas Keluar */}
              {summaryData.pendingExpCount > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Wallet className="w-3.5 h-3.5 text-orange-600" />
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Kas Keluar — {formatRupiah(summaryData.totalKasKeluar)}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 uppercase tracking-wide">
                        <th className="text-left pb-1 font-semibold">Outlet</th>
                        <th className="text-left pb-1 font-semibold">Kategori</th>
                        <th className="text-right pb-1 font-semibold">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {summaryData.expByBranch.flatMap((row) =>
                        row.items.map((exp, idx) => (
                          <tr key={`${row.branch}-${idx}`}>
                            <td className="py-1 text-slate-600 truncate max-w-[100px]" title={row.branch}>
                              {idx === 0 ? row.branch : ''}
                            </td>
                            <td className="py-1">
                              <div className="flex flex-col gap-0.5">
                                <span className={cn(
                                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold w-fit',
                                  exp.isAutoSplitKurir
                                    ? 'bg-sky-100 text-sky-700'
                                    : exp.isKurir
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-slate-100 text-slate-600'
                                )}>
                                  {(exp.isKurir || exp.isAutoSplitKurir) && <GitMerge className="w-2.5 h-2.5" />}
                                  {exp.kategori}
                                </span>
                                {exp.isAutoSplitKurir ? (
                                  <span className="text-xs text-sky-700 font-semibold flex items-center gap-0.5 w-fit">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    Auto split semua outlet
                                  </span>
                                ) : exp.isKurir && (
                                  mappings[exp.id] ? (
                                    <button
                                      onClick={() => {
                                        const fullItem = items.find((i) => i.id === exp.id)
                                        if (fullItem) setMappingModal(fullItem)
                                      }}
                                      className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold flex items-center gap-0.5 w-fit"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      {mappings[exp.id].targets.length > 1
                                        ? `Dibagi ${mappings[exp.id].targets.length} cabang`
                                        : 'Mapped'} · Edit
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        const fullItem = items.find((i) => i.id === exp.id)
                                        if (fullItem) setMappingModal(fullItem)
                                      }}
                                      className="text-xs text-orange-600 hover:text-orange-800 font-semibold flex items-center gap-0.5 w-fit"
                                    >
                                      <GitMerge className="w-2.5 h-2.5" />
                                      Set mapping
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                            <td className="py-1 text-right font-bold text-red-600 tabular-nums">
                              {formatRupiah(exp.nominal)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-semibold">
          {(
            [
              { value: 'pending', label: 'Menunggu', icon: <Clock className="w-3.5 h-3.5" /> },
              { value: 'confirmed', label: 'Dikonfirmasi', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
              { value: 'rejected', label: 'Ditolak', icon: <XCircle className="w-3.5 h-3.5" /> },
              { value: 'all', label: 'Semua', icon: null },
            ] as { value: ItemStatus | 'all'; label: string; icon: React.ReactNode }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 transition-colors border-r border-slate-200 last:border-0',
                statusFilter === opt.value
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-semibold">
          {(
            [
              { value: 'all', label: 'Semua jenis' },
              { value: 'penjualan', label: '🛒 Penjualan' },
              { value: 'kas_keluar', label: '💸 Kas Keluar' },
            ] as { value: ItemType | 'all'; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={cn(
                'px-3 py-2 transition-colors border-r border-slate-200 last:border-0',
                typeFilter === opt.value
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {statusFilter === 'pending' && pendingItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors"
          >
            {selected.size === pendingItems.length && pendingItems.length > 0 ? (
              <CheckSquare className="w-4 h-4 text-rbn-red" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            {selected.size === pendingItems.length && pendingItems.length > 0
              ? 'Batal Pilih Semua'
              : `Pilih Semua (${pendingItems.length})`}
          </button>

          {selectedPending.length > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-sm text-slate-500">
                {selectedPending.length} dipilih
                {unresolvableSelected.length > 0 && (
                  <span className="ml-1 text-amber-500">
                    ({unresolvableSelected.length} belum ada cabang)
                  </span>
                )}
              </span>
              {confirmableSelected.length > 0 && (
                <button
                  onClick={() => handleConfirm(confirmableSelected)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Konfirmasi ({confirmableSelected.length})
                </button>
              )}
              <button
                onClick={() => setRejectModal({ ids: selectedPending, reason: '', loading: false })}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                Tolak ({selectedPending.length})
              </button>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {loading && items.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Memuat data…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-semibold">Tidak ada data</p>
            <p className="text-xs mt-1">
              {statusFilter === 'pending'
                ? 'Semua transaksi sudah diproses.'
                : 'Tidak ada transaksi dengan filter ini.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  {statusFilter === 'pending' && (
                    <th className="px-4 py-3 w-10">
                      <button onClick={toggleSelectAll}>
                        {selected.size === pendingItems.length && pendingItems.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-rbn-red" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </th>
                  )}
                  <th className="text-left px-4 py-3 font-semibold">Tanggal</th>
                  <th className="text-left px-4 py-3 font-semibold">Jenis</th>
                  <th className="text-left px-4 py-3 font-semibold">Cabang</th>
                  <th className="text-left px-4 py-3 font-semibold">Detail</th>
                  <th className="text-right px-4 py-3 font-semibold">Nominal</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  {statusFilter === 'pending' && (
                    <th className="px-4 py-3 font-semibold">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    branches={branches}
                    onMapBranch={handleMapBranch}
                    showCheckbox={statusFilter === 'pending'}
                    isSelected={selected.has(item.id)}
                    onToggle={() => toggleSelect(item.id)}
                    onConfirm={() => handleConfirm([item.id])}
                    onReject={() => setRejectModal({ ids: [item.id], reason: '', loading: false })}
                    onOpenMapping={() => setMappingModal(item)}
                    mapping={mappings[item.id]}
                    onClearMapping={() => handleClearMapping(item.id)}
                    disabled={loading}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="px-4 py-3 border-t border-slate-100 text-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={loading}
              className="text-sm font-semibold text-rbn-red hover:underline disabled:opacity-50"
            >
              {loading ? 'Memuat…' : 'Muat lebih banyak'}
            </button>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-slate-900">
                Tolak {rejectModal.ids.length} Item
              </h3>
              <button
                onClick={() => setRejectModal(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Item yang ditolak tidak akan masuk ke cashflow. Alasan penolakan bersifat opsional.
            </p>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Alasan (opsional)
            </label>
            <textarea
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((prev) => prev ? { ...prev, reason: e.target.value } : null)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              rows={3}
              placeholder="Contoh: Data sudah diinput manual, duplikat dari periode sebelumnya…"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => handleReject(rejectModal.ids, rejectModal.reason || undefined)}
                disabled={rejectModal.loading || loading}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Tolak Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Mapping Modal */}
      {mappingModal && (
        <ExpenseMappingModal
          item={mappingModal}
          branches={branches}
          initialMapping={mappings[mappingModal.id]}
          onSave={(config) => {
            handleSaveMapping(mappingModal.id, config)
            setMappingModal(null)
          }}
          onClose={() => setMappingModal(null)}
        />
      )}
    </div>
  )
}

// =============================================
// ExpenseMappingModal — Mapping sebelum konfirmasi
// =============================================

function ExpenseMappingModal({
  item,
  branches,
  initialMapping,
  onSave,
  onClose,
}: {
  item: QueueItem
  branches: Branch[]
  initialMapping?: KasirExpenseMappingConfig
  onSave: (config: KasirExpenseMappingConfig) => void
  onClose: () => void
}) {
  const totalAmount = item.nominal ?? 0

  const defaultTargets = (): MappingTarget[] => {
    if (initialMapping?.targets.length) return initialMapping.targets
    if (item.branch_id) {
      const br = branches.find((b) => b.id === item.branch_id)
      return [{ branchId: item.branch_id, branchName: br?.name ?? item.cabang, amount: totalAmount }]
    }
    return [{ branchId: '', branchName: '', amount: totalAmount }]
  }

  const [targets, setTargets] = useState<MappingTarget[]>(defaultTargets)

  const totalMapped = targets.reduce((s, t) => s + (t.amount || 0), 0)
  const remaining = totalAmount - totalMapped
  const isValid =
    targets.length > 0 &&
    targets.every((t) => t.branchId && (t.amount ?? 0) > 0) &&
    Math.abs(remaining) <= 1

  function addTarget() {
    setTargets((prev) => [
      ...prev,
      { branchId: '', branchName: '', amount: Math.max(0, remaining) },
    ])
  }

  function removeTarget(idx: number) {
    setTargets((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateBranch(idx: number, branchId: string) {
    const br = branches.find((b) => b.id === branchId)
    setTargets((prev) =>
      prev.map((t, i) =>
        i === idx ? { ...t, branchId, branchName: br?.name ?? '' } : t
      )
    )
  }

  function updateAmount(idx: number, raw: string) {
    const val = parseInt(raw.replace(/\D/g, ''), 10) || 0
    setTargets((prev) => prev.map((t, i) => i === idx ? { ...t, amount: val } : t))
  }

  function splitEqual() {
    if (targets.length === 0) return
    const n = targets.length
    const base = Math.floor(totalAmount / n)
    const rem = totalAmount - base * n
    setTargets((prev) =>
      prev.map((t, i) => ({ ...t, amount: base + (i < rem ? 1 : 0) }))
    )
  }

  function handleSave() {
    const isSplit = targets.length > 1
    const isRemap = targets.length === 1 && targets[0].branchId !== (item.branch_id ?? '')
    const mode = isSplit ? 'split_manual' : isRemap ? 'remap' : 'original'
    onSave({ mode, targets })
  }

  const isKurir = (item.kategori ?? '').toLowerCase().includes('kurir')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-rbn-red" />
            <h3 className="text-base font-black text-slate-900">Mapping Pengeluaran</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info item */}
        <div className={cn(
          'rounded-xl px-4 py-3 mb-5 border text-sm',
          isKurir
            ? 'bg-orange-50 border-orange-200'
            : 'bg-slate-50 border-slate-200'
        )}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">{item.kategori || 'Kas Keluar'}</p>
              <p className="text-slate-500 text-xs mt-0.5">
                Cabang asli: <span className="font-semibold">{item.cabang}</span>
                {item.keterangan && <> — {item.keterangan}</>}
              </p>
            </div>
            <p className="text-lg font-black text-red-600">{formatRupiah(totalAmount)}</p>
          </div>
          {isKurir && (
            <p className="text-orange-700 text-xs mt-2 font-medium flex items-center gap-1">
              <GitMerge className="w-3 h-3" />
              Biaya kurir biasanya dibagi ke beberapa cabang. Atur mapping di bawah.
            </p>
          )}
        </div>

        {/* Targets */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Target Cabang
            </p>
            {targets.length > 1 && (
              <button
                onClick={splitEqual}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
              >
                <GitMerge className="w-3 h-3" />
                Bagi Rata
              </button>
            )}
          </div>

          {targets.map((target, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {/* Branch selector */}
              <select
                value={target.branchId}
                onChange={(e) => updateBranch(idx, e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rbn-red/30 focus:border-rbn-red"
              >
                <option value="">Pilih cabang…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {/* Amount input */}
              <div className="relative w-36">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-semibold">
                  Rp
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={target.amount > 0 ? target.amount.toLocaleString('id-ID') : ''}
                  onChange={(e) => updateAmount(idx, e.target.value)}
                  className="w-full border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-rbn-red/30 focus:border-rbn-red tabular-nums"
                  placeholder="0"
                />
              </div>

              {/* Remove */}
              {targets.length > 1 && (
                <button
                  onClick={() => removeTarget(idx)}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add target */}
        <button
          onClick={addTarget}
          className="flex items-center gap-1.5 text-sm font-semibold text-rbn-red hover:text-red-700 mb-5"
        >
          <Plus className="w-3.5 h-3.5" />
          Tambah Cabang
        </button>

        {/* Validation */}
        <div className={cn(
          'rounded-xl px-3 py-2 text-xs font-semibold mb-5 flex items-center justify-between',
          isValid
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-amber-50 border border-amber-200 text-amber-700'
        )}>
          <span>
            Total mapping: <strong>{formatRupiah(totalMapped)}</strong>
            {' '}/ Nominal: <strong>{formatRupiah(totalAmount)}</strong>
          </span>
          {!isValid && Math.abs(remaining) > 1 && (
            <span>
              {remaining > 0 ? `Kurang ${formatRupiah(remaining)}` : `Lebih ${formatRupiah(-remaining)}`}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-bold bg-rbn-red text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Simpan Mapping
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// Row Component
// =============================================

function QueueRow({
  item,
  branches,
  onMapBranch,
  showCheckbox,
  isSelected,
  onToggle,
  onConfirm,
  onReject,
  onOpenMapping,
  mapping,
  onClearMapping,
  disabled,
}: {
  item: QueueItem
  branches: Branch[]
  onMapBranch: (kasirName: string, branchId: string) => Promise<void>
  showCheckbox: boolean
  isSelected: boolean
  onToggle: () => void
  onConfirm: () => void
  onReject: () => void
  onOpenMapping: () => void
  mapping?: KasirExpenseMappingConfig
  onClearMapping: () => void
  disabled: boolean
}) {
  const isPenjualan = item.item_type === 'penjualan'
  const amount = isPenjualan ? (item.total_penjualan ?? 0) : (item.nominal ?? 0)
  const isKasKeluar = item.item_type === 'kas_keluar'
  const isKurir = isKasKeluar && (item.kategori ?? '').toLowerCase().includes('kurir')
  const isAutoSplitKurir = isKasKeluar && isKurirBawaBahanCategory(item.kategori)
  const noBranch = !item.branch_id && !mapping && !isAutoSplitKurir
  // Kurir perlu mapping — tampilkan peringatan jika belum di-mapping
  const needsMapping = isKurir && !isAutoSplitKurir && !mapping && item.status === 'pending'

  return (
    <tr
      className={cn(
        'transition-colors',
        isSelected ? 'bg-rbn-red/5' : 'hover:bg-slate-50',
        noBranch && item.status === 'pending' ? 'bg-amber-50/30' : ''
      )}
    >
      {showCheckbox && (
        <td className="px-4 py-3">
          {item.status === 'pending' && (
            <button onClick={onToggle} disabled={disabled}>
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-rbn-red" />
              ) : (
                <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
              )}
            </button>
          )}
        </td>
      )}

      <td className="px-4 py-3 whitespace-nowrap">
        <p className="font-semibold text-slate-800">{formatDate(item.tanggal)}</p>
        <p className="text-xs text-slate-400">{item.waktu?.slice(0, 5)} WITA</p>
      </td>

      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold',
            isPenjualan
              ? 'bg-blue-100 text-blue-700'
              : 'bg-orange-100 text-orange-700'
          )}
        >
          {isPenjualan ? <ShoppingCart className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
          {isPenjualan ? 'Penjualan' : 'Kas Keluar'}
        </span>
      </td>

      <td className="px-4 py-3">
        <p className="font-medium text-slate-800">{item.cabang}</p>
        {!item.branch_id && !mapping && item.status === 'pending' ? (
          <BranchPicker
            kasirName={item.cabang}
            branches={branches}
            onMap={(branchId) => onMapBranch(item.cabang, branchId)}
          />
        ) : !item.branch_id && !mapping ? (
          <p className="text-xs text-amber-600 font-semibold mt-0.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Cabang tidak dikenali
          </p>
        ) : null}
      </td>

      <td className="px-4 py-3 max-w-xs">
        {isPenjualan ? (
          <>
            <p className="text-slate-700">
              {item.metode_pembayaran
                ? <span className="font-semibold">{item.metode_pembayaran.toUpperCase()}</span>
                : <span className="text-slate-400">—</span>}
            </p>
            {item.kasir_name && (
              <p className="text-xs text-slate-400">Kasir: {item.kasir_name}</p>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-slate-700 font-medium">{item.kategori || '—'}</p>
              {isKurir && (
                <span className={cn(
                  'text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5',
                  isAutoSplitKurir ? 'bg-sky-100 text-sky-700' : 'bg-orange-100 text-orange-700'
                )}>
                  <GitMerge className="w-2.5 h-2.5" />
                  {isAutoSplitKurir ? 'Auto Split' : 'Kurir'}
                </span>
              )}
            </div>
            {item.keterangan && (
              <p className="text-xs text-slate-400 truncate max-w-[200px]" title={item.keterangan}>
                {item.keterangan}
              </p>
            )}
            {item.dicatat_oleh && (
              <p className="text-xs text-slate-400">Oleh: {item.dicatat_oleh}</p>
            )}
            {/* Mapping badge */}
            {isKasKeluar && item.status === 'pending' && (
              <div className="mt-1">
                {isAutoSplitKurir ? (
                  <span className="text-xs bg-sky-100 text-sky-700 font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1 w-fit">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Auto split semua outlet
                  </span>
                ) : mapping ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      {mapping.targets.length > 1
                        ? `Dibagi ke ${mapping.targets.length} cabang`
                        : mapping.mode === 'remap'
                          ? `→ ${mapping.targets[0]?.branchName}`
                          : 'Sesuai cabang'}
                    </span>
                    <button
                      onClick={onOpenMapping}
                      className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={onClearMapping}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : needsMapping ? (
                  <button
                    onClick={onOpenMapping}
                    className="text-xs text-orange-600 hover:text-orange-800 font-semibold flex items-center gap-1"
                  >
                    <GitMerge className="w-3 h-3" />
                    Set mapping cabang
                  </button>
                ) : (
                  <button
                    onClick={onOpenMapping}
                    className="text-xs text-slate-400 hover:text-slate-600 font-semibold flex items-center gap-1"
                  >
                    <GitMerge className="w-3 h-3" />
                    Mapping
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap">
        <p className={cn(
          'font-bold tabular-nums',
          isPenjualan ? 'text-emerald-700' : 'text-red-600'
        )}>
          {isPenjualan ? '+' : '-'}{formatRupiah(amount)}
        </p>
        {/* Tampilkan breakdown mapping jika split */}
        {mapping && mapping.targets.length > 1 && (
          <div className="text-right">
            {mapping.targets.map((t, i) => (
              <p key={i} className="text-xs text-slate-400 tabular-nums">
                {t.branchName.split(' - ').pop()}: {formatRupiah(t.amount)}
              </p>
            ))}
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <StatusBadge status={item.status} />
        {item.reject_reason && (
          <p className="text-xs text-slate-400 mt-0.5 max-w-[120px] truncate" title={item.reject_reason}>
            {item.reject_reason}
          </p>
        )}
        {item.confirmed_at && (
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(item.confirmed_at).toLocaleString('id-ID', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              timeZone: 'Asia/Makassar',
            })}
          </p>
        )}
      </td>

      {showCheckbox && (
        <td className="px-4 py-3">
          {item.status === 'pending' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onConfirm}
                disabled={disabled || (noBranch)}
                title={noBranch ? 'Pilih cabang atau set mapping dulu' : 'Konfirmasi'}
                className={cn(
                  'p-1.5 rounded-lg text-xs font-bold transition-colors',
                  noBranch
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-600 hover:text-white'
                )}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onReject}
                disabled={disabled}
                title="Tolak"
                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-600 hover:text-white transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  )
}

// =============================================
// BranchPicker
// =============================================

function BranchPicker({
  kasirName,
  branches,
  onMap,
}: {
  kasirName: string
  branches: Branch[]
  onMap: (branchId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function selectBranch(branchId: string) {
    setSaving(true)
    setOpen(false)
    try {
      await onMap(branchId)
      setSaved(true)
    } catch { /* Error ditampilkan di parent */ }
    finally { setSaving(false) }
  }

  if (saved) return null

  return (
    <div className="relative mt-0.5" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving || branches.length === 0}
        className={cn(
          'flex items-center gap-1 text-xs font-semibold transition-colors',
          saving ? 'text-slate-400 cursor-wait' : 'text-amber-600 hover:text-amber-800'
        )}
      >
        {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
        {saving ? 'Menyimpan…' : 'Pilih cabang'}
        {!saving && <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />}
      </button>

      {open && branches.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-xl w-52 py-1 max-h-56 overflow-y-auto">
          <p className="text-xs text-slate-400 px-3 py-1.5 font-semibold border-b border-slate-100 sticky top-0 bg-white">
            Pilih cabang untuk &ldquo;{kasirName}&rdquo;
          </p>
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => selectBranch(b.id)}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================
// Helper Components
// =============================================

function StatusBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending: {
      label: 'Menunggu',
      className: 'bg-amber-100 text-amber-700',
      icon: <Clock className="w-3 h-3" />,
    },
    confirmed: {
      label: 'Dikonfirmasi',
      className: 'bg-emerald-100 text-emerald-700',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    rejected: {
      label: 'Ditolak',
      className: 'bg-red-100 text-red-700',
      icon: <XCircle className="w-3 h-3" />,
    },
  }
  const s = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold', s.className)}>
      {s.icon}
      {s.label}
    </span>
  )
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}
