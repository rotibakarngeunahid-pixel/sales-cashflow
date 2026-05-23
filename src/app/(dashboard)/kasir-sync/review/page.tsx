'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CheckCircle2, XCircle, Clock, RefreshCw, ArrowLeft,
  ShoppingCart, Wallet, AlertCircle, X,
  CheckSquare, Square,
} from 'lucide-react'
import { formatRupiah, cn } from '@/lib/utils/format'

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

// =============================================
// Halaman Review Queue
// =============================================

export default function KasirSyncReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<ItemStatus | 'all'>('pending')
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 50

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Reject modal
  const [rejectModal, setRejectModal] = useState<{
    ids: string[]
    reason: string
    loading: boolean
  } | null>(null)

  // Action feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>()

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
        .range(newPage * PAGE_SIZE, (newPage + 1) * PAGE_SIZE)  // +1 untuk deteksi has_more

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

  // Reset & reload when filters change
  useEffect(() => {
    setPage(0)
    loadItems(true)
  }, [statusFilter, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load more when page increments
  useEffect(() => {
    if (page > 0) loadItems(false)
  }, [page])  // eslint-disable-line react-hooks/exhaustive-deps

  function showFeedback(type: 'success' | 'error', msg: string) {
    clearTimeout(feedbackTimer.current)
    setFeedback({ type, msg })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
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
        body: JSON.stringify({ ids }),
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

  // ---- Filter counts ----
  const allPendingCount = items.filter((i) => i.status === 'pending').length
  const selectedPending = Array.from(selected).filter((id) =>
    items.find((i) => i.id === id && i.status === 'pending')
  )

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
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          {feedback.msg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Status filter */}
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

        {/* Type filter */}
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
              </span>
              <button
                onClick={() => handleConfirm(selectedPending)}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Konfirmasi ({selectedPending.length})
              </button>
              <button
                onClick={() =>
                  setRejectModal({ ids: selectedPending, reason: '', loading: false })
                }
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
                    showCheckbox={statusFilter === 'pending'}
                    isSelected={selected.has(item.id)}
                    onToggle={() => toggleSelect(item.id)}
                    onConfirm={() => handleConfirm([item.id])}
                    onReject={() =>
                      setRejectModal({ ids: [item.id], reason: '', loading: false })
                    }
                    disabled={loading}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Load more */}
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
              onChange={(e) =>
                setRejectModal((prev) => prev ? { ...prev, reason: e.target.value } : null)
              }
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
    </div>
  )
}

// =============================================
// Row Component
// =============================================

function QueueRow({
  item,
  showCheckbox,
  isSelected,
  onToggle,
  onConfirm,
  onReject,
  disabled,
}: {
  item: QueueItem
  showCheckbox: boolean
  isSelected: boolean
  onToggle: () => void
  onConfirm: () => void
  onReject: () => void
  disabled: boolean
}) {
  const isPenjualan = item.item_type === 'penjualan'
  const amount = isPenjualan ? (item.total_penjualan ?? 0) : (item.nominal ?? 0)
  const noBranch = !item.branch_id

  return (
    <tr
      className={cn(
        'transition-colors',
        isSelected ? 'bg-rbn-red/5' : 'hover:bg-slate-50',
        noBranch && item.status === 'pending' ? 'bg-amber-50/50' : ''
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
          {isPenjualan ? (
            <ShoppingCart className="w-3 h-3" />
          ) : (
            <Wallet className="w-3 h-3" />
          )}
          {isPenjualan ? 'Penjualan' : 'Kas Keluar'}
        </span>
      </td>

      <td className="px-4 py-3">
        <p className="font-medium text-slate-800">{item.cabang}</p>
        {noBranch && (
          <p className="text-xs text-amber-600 font-semibold mt-0.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Cabang tidak dikenali
          </p>
        )}
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
            <p className="text-slate-700 font-medium">{item.kategori || '—'}</p>
            {item.keterangan && (
              <p className="text-xs text-slate-400 truncate max-w-[200px]" title={item.keterangan}>
                {item.keterangan}
              </p>
            )}
            {item.dicatat_oleh && (
              <p className="text-xs text-slate-400">Oleh: {item.dicatat_oleh}</p>
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
                disabled={disabled || noBranch}
                title={noBranch ? 'Cabang tidak dikenali — tidak bisa dikonfirmasi' : 'Konfirmasi'}
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
