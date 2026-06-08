'use client'

import { useState } from 'react'
import { X, FileDown, Loader2 } from 'lucide-react'
import { saveAs } from 'file-saver'
import type { Branch } from '@/types/database'

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

  const branchName = branches.find((b) => b.id === branchId)?.name ?? 'Cabang'
  const previewFilename = branchId
    ? `Arus_Kas_${branchName.replace(/\s+/g, '_')}_${MONTH_NAMES_ID[month - 1]}_${year}.xlsx`
    : ''

  async function handleExport() {
    if (!branchId) {
      setError('Pilih cabang terlebih dahulu.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/cashflow/export-arus-kas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, year, month, branch_name: branchName }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Export gagal.' }))
        throw new Error(errData.error ?? 'Export gagal.')
      }

      const blob = await response.blob()
      saveAs(blob, previewFilename)
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

          {previewFilename && (
            <p className="text-xs text-gray-500">
              File: <span className="font-medium text-gray-700">{previewFilename}</span>
            </p>
          )}

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
