'use client'

import { useState, useEffect } from 'react'
import { X, Scissors, Equal, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatRupiah } from '@/lib/utils/format'

interface Branch {
  id: string
  name: string
}

interface Category {
  id: string
  name: string
  default_type: string
}

interface Allocation {
  branch_id: string
  amount: number
}

interface Props {
  branches: Branch[]
  categories: Category[]
  onClose: () => void
  onSuccess: () => void
}

export default function SplitExpenseModal({ branches, categories, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [total, setTotal] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})  // branch_id → amount string
  const [checkedBranches, setCheckedBranches] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Kategori cash_out saja
  const cashOutCategories = categories.filter(
    (c) => c.default_type === 'cash_out' || c.default_type === 'both'
  )

  const totalNum = parseFloat(total.replace(/\D/g, '')) || 0
  const allocatedNum = Array.from(checkedBranches).reduce((sum, bid) => {
    return sum + (parseFloat(allocations[bid]?.replace(/\D/g, '') || '0') || 0)
  }, 0)
  const remaining = totalNum - allocatedNum
  const isBalanced = checkedBranches.size > 0 && Math.abs(remaining) < 1

  function toggleBranch(bid: string) {
    setCheckedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(bid)) {
        next.delete(bid)
      } else {
        next.add(bid)
        // Set default amount 0 jika belum ada
        if (!allocations[bid]) {
          setAllocations((a) => ({ ...a, [bid]: '' }))
        }
      }
      return next
    })
  }

  function bagiRata() {
    if (checkedBranches.size === 0 || totalNum <= 0) return
    const perCabang = Math.floor(totalNum / checkedBranches.size)
    const sisa = totalNum - perCabang * checkedBranches.size
    const branchArr = Array.from(checkedBranches)
    const newAlloc: Record<string, string> = { ...allocations }
    branchArr.forEach((bid, i) => {
      // Sisanya masuk ke cabang pertama
      newAlloc[bid] = String(perCabang + (i === 0 ? sisa : 0))
    })
    setAllocations(newAlloc)
  }

  function setAmount(bid: string, val: string) {
    const numeric = val.replace(/\D/g, '')
    setAllocations((prev) => ({ ...prev, [bid]: numeric }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!date || !description.trim()) {
      setError('Tanggal dan deskripsi wajib diisi.')
      return
    }
    if (checkedBranches.size === 0) {
      setError('Pilih minimal 1 cabang.')
      return
    }
    if (!isBalanced) {
      setError(`Selisih Rp ${formatRupiah(Math.abs(remaining))} — pastikan total alokasi sama dengan total biaya.`)
      return
    }

    const allocList: { branch_id: string; amount: number }[] = []
    for (const bid of Array.from(checkedBranches)) {
      const amt = parseFloat(allocations[bid]?.replace(/\D/g, '') || '0') || 0
      if (amt <= 0) {
        setError(`Nominal cabang tidak boleh 0.`)
        return
      }
      allocList.push({ branch_id: bid, amount: amt })
    }

    setSaving(true)
    try {
      const res = await fetch('/api/cashflow/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim(),
          category_id: categoryId || null,
          allocations: allocList,
        }),
      })
      const data = await res.json()
      if (data.success) {
        onSuccess()
        onClose()
      } else {
        setError(data.message || 'Gagal menyimpan.')
      }
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setSaving(false)
    }
  }

  // Tutup modal dengan Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-black text-slate-900">Biaya Bersama</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">

            {/* Tanggal & Deskripsi */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tanggal</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kategori</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                >
                  <option value="">— Tanpa kategori —</option>
                  {cashOutCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Deskripsi</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Biaya Kurir, Biaya Operasional, dll."
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Total Biaya</label>
              <input
                type="text"
                inputMode="numeric"
                value={total ? Number(total.replace(/\D/g, '')).toLocaleString('id-ID') : ''}
                onChange={(e) => setTotal(e.target.value.replace(/\D/g, ''))}
                placeholder="50.000"
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>

            {/* Alokasi cabang */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">
                  Alokasi ke Cabang ({checkedBranches.size} dipilih)
                </label>
                {checkedBranches.size > 0 && totalNum > 0 && (
                  <button
                    type="button"
                    onClick={bagiRata}
                    className="flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-800 transition-colors"
                  >
                    <Equal className="w-3 h-3" />
                    Bagi Rata
                  </button>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                {branches.map((branch) => {
                  const checked = checkedBranches.has(branch.id)
                  return (
                    <div
                      key={branch.id}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        checked ? 'bg-orange-50' : 'bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        id={`branch-${branch.id}`}
                        checked={checked}
                        onChange={() => toggleBranch(branch.id)}
                        className="w-4 h-4 accent-orange-600 flex-shrink-0"
                      />
                      <label
                        htmlFor={`branch-${branch.id}`}
                        className="flex-1 text-sm font-medium text-slate-700 cursor-pointer"
                      >
                        {branch.name}
                      </label>
                      {checked && (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={
                            allocations[branch.id]
                              ? Number(allocations[branch.id]).toLocaleString('id-ID')
                              : ''
                          }
                          onChange={(e) => setAmount(branch.id, e.target.value)}
                          placeholder="0"
                          className="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Ringkasan alokasi */}
            {checkedBranches.size > 0 && totalNum > 0 && (
              <div
                className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold ${
                  isBalanced
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : 'bg-amber-50 border border-amber-200 text-amber-700'
                }`}
              >
                <span>Total teralokasi</span>
                <div className="flex items-center gap-2">
                  {isBalanced ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertCircle className="w-4 h-4" />
                  )}
                  <span>
                    {formatRupiah(allocatedNum)} / {formatRupiah(totalNum)}
                  </span>
                  {!isBalanced && remaining !== totalNum && (
                    <span className="text-xs opacity-75">
                      (sisa {formatRupiah(Math.abs(remaining))})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !isBalanced || checkedBranches.size === 0}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? 'Menyimpan…'
                : `Simpan (${checkedBranches.size} cabang)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
