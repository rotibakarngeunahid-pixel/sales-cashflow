'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeftRight, Trash2, AlertCircle, CheckCircle2, X, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, CashflowCategory, Profile, BebanTransfer } from '@/types/database'
import { formatRupiah, formatDate } from '@/lib/utils/format'
import { ConfirmModal } from '@/components/ui/Modal'

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
        type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success'
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        : <AlertCircle className="w-4 h-4 flex-shrink-0" />
      }
      <span>{message}</span>
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function TransferBebanPage() {
  const today = new Date().toISOString().slice(0, 10)

  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [categories, setCategories] = useState<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [transfers, setTransfers] = useState<BebanTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Form state
  const [date, setDate] = useState(today)
  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<BebanTransfer | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isOwner = profile?.role === 'owner'

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadTransfers = useCallback(async () => {
    const res = await fetch('/api/cashflow/beban-transfer?limit=100')
    const json = await res.json()
    if (json.data) setTransfers(json.data)
  }, [])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const [{ data: { session } }, { data: branchData }, { data: catData }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from('branches').select('id, name').eq('is_active', true).is('deleted_at', null).order('name'),
        supabase.from('cashflow_categories').select('id, name, default_type').eq('is_active', true).is('deleted_at', null).order('name'),
      ])

      if (session?.user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
        if (p) setProfile(p)
      }
      if (branchData) setBranches(branchData)
      if (catData) setCategories(catData)

      await loadTransfers()
      setLoading(false)
    }
    init()
  }, [loadTransfers])

  const cashOutCategories = categories.filter(
    (c) => c.default_type === 'cash_out' || c.default_type === 'both'
  )

  const amountNum = parseInt(amount.replace(/\D/g, ''), 10) || 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!date || !fromBranch || !toBranch) {
      setFormError('Tanggal, cabang pengirim, dan cabang penerima wajib diisi.')
      return
    }
    if (fromBranch === toBranch) {
      setFormError('Cabang pengirim dan penerima tidak boleh sama.')
      return
    }
    if (amountNum <= 0) {
      setFormError('Nominal harus lebih dari 0.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/cashflow/beban-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transfer_date: date,
          from_branch_id: fromBranch,
          to_branch_id: toBranch,
          amount: amountNum,
          description: description.trim() || null,
          category_id: categoryId || null,
        }),
      })
      const json = await res.json()
      if (json.success) {
        showToast('Transfer beban berhasil disimpan.', 'success')
        setFromBranch('')
        setToBranch('')
        setAmount('')
        setDescription('')
        setCategoryId('')
        setDate(today)
        await loadTransfers()
      } else {
        setFormError(json.error || 'Gagal menyimpan.')
      }
    } catch {
      setFormError('Gagal terhubung ke server.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/cashflow/beban-transfer?id=${deleteTarget.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        showToast('Transfer berhasil dihapus.', 'success')
        setDeleteTarget(null)
        await loadTransfers()
      } else {
        showToast(json.error || 'Gagal menghapus.', 'error')
        setDeleteTarget(null)
      }
    } catch {
      showToast('Gagal terhubung ke server.', 'error')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-purple-200">
          <ArrowLeftRight className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">Transfer Beban Pokok</h1>
          <p className="text-sm text-slate-500">
            Catat transfer beban pokok antar cabang. Cabang pengirim beban berkurang, cabang penerima beban bertambah.
          </p>
        </div>
      </div>

      {/* Info box */}
      <div className="flex gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-violet-800">
          <p className="font-semibold mb-0.5">Cara penggunaan</p>
          <p>Misalnya Dalung Permai ambil stok susu dari Bunderan Dalung: pilih <strong>Pengirim = Bunderan Dalung</strong> (bebannya berkurang) dan <strong>Penerima = Dalung Permai</strong> (bebannya bertambah).</p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Input Transfer Baru</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Tanggal + Kategori */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tanggal</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Kategori <span className="text-slate-400 font-normal">(opsional)</span></label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">— Tanpa kategori —</option>
                {cashOutCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Cabang Pengirim + Penerima */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cabang Pengirim
                <span className="ml-1 text-slate-400 font-normal">(beban berkurang)</span>
              </label>
              <select
                value={fromBranch}
                onChange={(e) => setFromBranch(e.target.value)}
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">— Pilih cabang —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.id === toBranch}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cabang Penerima
                <span className="ml-1 text-slate-400 font-normal">(beban bertambah)</span>
              </label>
              <select
                value={toBranch}
                onChange={(e) => setToBranch(e.target.value)}
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">— Pilih cabang —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.id === fromBranch}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Nominal */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nominal Transfer</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 font-medium">Rp</span>
              <input
                type="text"
                inputMode="numeric"
                value={amountNum > 0 ? amountNum.toLocaleString('id-ID') : ''}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                required
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>

          {/* Keterangan */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan <span className="text-slate-400 font-normal">(opsional)</span></label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contoh: susu 1 karton, bahan roti, dll."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          {/* Preview */}
          {fromBranch && toBranch && amountNum > 0 && fromBranch !== toBranch && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1.5 text-sm">
              <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-2">Preview transaksi yang akan dibuat</p>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">{branches.find(b => b.id === fromBranch)?.name}</span>
                <span className="text-emerald-600 font-semibold">+{formatRupiah(amountNum)} <span className="text-xs text-slate-500">(Beban berkurang)</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">{branches.find(b => b.id === toBranch)?.name}</span>
                <span className="text-red-600 font-semibold">-{formatRupiah(amountNum)} <span className="text-xs text-slate-500">(Beban bertambah)</span></span>
              </div>
            </div>
          )}

          {/* Error */}
          {formError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {formError}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={saving || amountNum <= 0 || !fromBranch || !toBranch || fromBranch === toBranch}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-bold rounded-xl hover:from-violet-700 hover:to-purple-700 transition-all shadow-md shadow-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Menyimpan…' : 'Simpan Transfer'}
            </button>
          </div>
        </form>
      </div>

      {/* Riwayat */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Riwayat Transfer</h2>
        </div>

        {transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <ArrowLeftRight className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-500">Belum ada transfer beban</p>
            <p className="text-xs text-slate-400 mt-1">Transfer yang dicatat akan muncul di sini</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Tanggal</th>
                  <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Pengirim → Penerima</th>
                  <th className="text-right px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Nominal</th>
                  <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Keterangan</th>
                  <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Dibuat oleh</th>
                  {isOwner && (
                    <th className="px-6 py-3" />
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3.5 text-slate-700 whitespace-nowrap font-medium">
                      {formatDate(t.transfer_date)}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-700 font-medium">{t.from_branch?.name ?? '—'}</span>
                        <ArrowLeftRight className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                        <span className="text-slate-700 font-medium">{t.to_branch?.name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {formatRupiah(t.amount)}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 max-w-xs truncate">
                      {t.description || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap">
                      {t.actor?.full_name || t.actor?.email || '—'}
                    </td>
                    {isOwner && (
                      <td className="px-6 py-3.5">
                        <button
                          onClick={() => setDeleteTarget(t)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Hapus transfer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Transfer Beban"
        description={
          deleteTarget
            ? `Hapus transfer ${formatRupiah(deleteTarget.amount)} dari ${deleteTarget.from_branch?.name} ke ${deleteTarget.to_branch?.name}? Kedua transaksi cashflow terkait juga akan dihapus.`
            : ''
        }
        confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
        loading={deleting}
      />
    </div>
  )
}
