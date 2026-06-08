'use client'

import { useState } from 'react'
import { X, FileDown, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, CashflowTransaction } from '@/types/database'

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

interface Props {
  branches: Pick<Branch, 'id' | 'name'>[]
  onClose: () => void
}

export default function ExportArusKasModal({ branches, onClose }: Props) {
  const today = new Date()
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [year, setYear] = useState(today.getFullYear())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleExport() {
    if (!branchId) {
      setError('Pilih cabang terlebih dahulu.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const mm = String(month).padStart(2, '0')
      const startDate = `${year}-${mm}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

      const { data, error: fetchError } = await supabase
        .from('cashflow_transactions')
        .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true })

      if (fetchError) throw new Error(fetchError.message)

      const txs = (data ?? []) as CashflowTransaction[]
      const branchName = branches.find((b) => b.id === branchId)?.name ?? 'Cabang'

      const { exportArusKas } = await import('@/lib/utils/export')
      await exportArusKas(txs, { branchName, year, month })

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal export.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Export Arus Kas</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cabang</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="input-field"
            >
              <option value="">Pilih cabang...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bulan</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="input-field"
              >
                {MONTH_NAMES_ID.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tahun</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="input-field"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            File: <span className="font-medium text-gray-700">Arus_Kas_{branches.find((b) => b.id === branchId)?.name?.replace(/\s+/g, '_') ?? 'Cabang'}_{MONTH_NAMES_ID[month - 1]}_{year}.xlsx</span>
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} className="btn-outline flex-1 text-sm">
            Batal
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !branchId}
            className="btn-primary flex flex-1 items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Memproses...</>
            ) : (
              <><FileDown className="h-4 w-4" /> Export Excel</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
