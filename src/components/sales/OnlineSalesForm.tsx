'use client'

import { useMemo, useState } from 'react'
import { Send, CheckCircle2, Plus, Trash2, Info, TrendingDown } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/utils/format'
import { calculateOnlineSalesNett } from '@/lib/online-sales/calculations'
import { PLATFORM_LABELS } from '@/lib/kasir-import/shared'
import type { OnlinePlatform, OnlineSalesDeductionType, OnlineSalesNettInputMode, OnlineSalesStatus } from '@/types/database'

interface DeductionRow {
  key: string
  deduction_type: OnlineSalesDeductionType
  label: string
  amount: number
}

const DEDUCTION_TYPE_LABELS: Record<OnlineSalesDeductionType, string> = {
  commission: 'Komisi Platform',
  promo: 'Promo',
  other: 'Biaya Lain',
}

export interface OnlineSalesFormTarget {
  branchId: string
  branchName: string
  platform: OnlinePlatform
  reportDate: string
  detectedAmount: number
}

export interface OnlineSalesFormInitialData {
  id: string
  gross_amount: number
  nett_input_mode: OnlineSalesNettInputMode
  nett_amount: number
  notes: string | null
  status: OnlineSalesStatus
  deductions: Array<{ deduction_type: OnlineSalesDeductionType; label: string | null; amount: number }>
}

interface OnlineSalesFormProps {
  target: OnlineSalesFormTarget
  initialData?: OnlineSalesFormInitialData | null
  onSuccess: (message: string) => void
  onCancel: () => void
}

let rowKeySeq = 0
function makeRowKey() {
  rowKeySeq += 1
  return `row-${rowKeySeq}-${Date.now()}`
}

export default function OnlineSalesForm({ target, initialData, onSuccess, onCancel }: OnlineSalesFormProps) {
  const [grossAmount, setGrossAmount] = useState(initialData?.gross_amount ?? 0)
  const [deductions, setDeductions] = useState<DeductionRow[]>(() =>
    (initialData?.deductions ?? []).map((d) => ({
      key: makeRowKey(),
      deduction_type: d.deduction_type,
      label: d.label ?? '',
      amount: d.amount,
    }))
  )
  const [nettInputMode, setNettInputMode] = useState<OnlineSalesNettInputMode>(initialData?.nett_input_mode ?? 'calculated')
  const [manualNett, setManualNett] = useState(initialData?.nett_amount ?? 0)
  const [notes, setNotes] = useState(initialData?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const calc = useMemo(
    () =>
      calculateOnlineSalesNett({
        gross: Number(grossAmount) || 0,
        deductions: deductions.map((d) => ({ deduction_type: d.deduction_type, amount: Number(d.amount) || 0 })),
        mode: nettInputMode,
        manualNett: Number(manualNett) || 0,
      }),
    [grossAmount, deductions, nettInputMode, manualNett]
  )

  const detectedVariance = calc.nett - target.detectedAmount

  function addDeduction() {
    setDeductions((rows) => [...rows, { key: makeRowKey(), deduction_type: 'commission', amount: 0, label: '' }])
  }

  function updateDeduction(key: string, patch: Partial<DeductionRow>) {
    setDeductions((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeDeduction(key: string) {
    setDeductions((rows) => rows.filter((r) => r.key !== key))
  }

  async function submit(status: 'draft' | 'posted') {
    setError(null)

    if (Number(grossAmount) <= 0) {
      setError('Gross sales harus lebih dari 0.')
      return
    }
    for (const row of deductions) {
      if (row.deduction_type === 'other' && !row.label.trim()) {
        setError('Label wajib diisi untuk potongan jenis "Biaya Lain".')
        return
      }
    }
    if (nettInputMode === 'manual' && Number(manualNett) < 0) {
      setError('Nett manual tidak boleh negatif.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/online-sales/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_date: target.reportDate,
          branch_id: target.branchId,
          platform: target.platform,
          gross_amount: Number(grossAmount) || 0,
          deductions: deductions.map((d) => ({
            deduction_type: d.deduction_type,
            label: d.label,
            amount: Number(d.amount) || 0,
          })),
          nett_input_mode: nettInputMode,
          manual_nett_amount: nettInputMode === 'manual' ? Number(manualNett) || 0 : undefined,
          notes,
          status,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message || 'Gagal menyimpan.')
        setSaving(false)
        return
      }
      setSaving(false)
      onSuccess(status === 'posted' ? 'Penjualan online berhasil diposting ke cashflow.' : 'Draft berhasil disimpan.')
    } catch {
      setError('Gagal mengirim permintaan ke server. Periksa koneksi dan coba lagi.')
      setSaving(false)
    }
  }

  const isEditingPosted = initialData?.status === 'posted'

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Target info (readonly) */}
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">Platform</p>
          <p className="font-bold text-slate-900">{PLATFORM_LABELS[target.platform]}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Tanggal</p>
          <p className="font-semibold text-slate-900">{formatDate(target.reportDate)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Cabang</p>
          <p className="font-semibold text-slate-900 truncate">{target.branchName}</p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm flex items-center justify-between">
        <span className="text-blue-700 font-medium">Nett Terdeteksi dari Kasir</span>
        <span className="font-bold text-blue-900 text-rupiah">{formatRupiah(target.detectedAmount)}</span>
      </div>

      {/* Gross */}
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Harga Jual Asli (Gross) <span className="text-red-500">*</span></label>
        <input
          type="number"
          step="1"
          min="0"
          value={grossAmount}
          onChange={(e) => setGrossAmount(Number(e.target.value))}
          className="input-field text-sm font-semibold text-rupiah"
          placeholder="0"
        />
      </div>

      {/* Deductions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold text-slate-600">Rincian Potongan</label>
          <button
            type="button"
            onClick={addDeduction}
            className="flex items-center gap-1 text-xs font-semibold text-rbn-orange hover:text-rbn-red transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Tambah Potongan
          </button>
        </div>

        {deductions.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Belum ada potongan ditambahkan.</p>
        ) : (
          <div className="space-y-2">
            {deductions.map((row) => (
              <div key={row.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 bg-white p-2">
                <select
                  value={row.deduction_type}
                  onChange={(e) => updateDeduction(row.key, { deduction_type: e.target.value as OnlineSalesDeductionType })}
                  className="input-field text-sm flex-1 min-w-[140px]"
                >
                  {(Object.keys(DEDUCTION_TYPE_LABELS) as OnlineSalesDeductionType[]).map((t) => (
                    <option key={t} value={t}>{DEDUCTION_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                {row.deduction_type === 'other' && (
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateDeduction(row.key, { label: e.target.value })}
                    placeholder="Nama biaya..."
                    className="input-field text-sm flex-1 min-w-[120px]"
                  />
                )}
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={row.amount}
                  onChange={(e) => updateDeduction(row.key, { amount: Number(e.target.value) })}
                  placeholder="0"
                  className="input-field text-sm font-semibold text-rupiah w-32"
                />
                <button
                  type="button"
                  onClick={() => removeDeduction(row.key)}
                  className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                  title="Hapus potongan"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nett mode toggle */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Nett Sales</span>
          <button
            type="button"
            onClick={() => setNettInputMode(nettInputMode === 'manual' ? 'calculated' : 'manual')}
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${
              nettInputMode === 'manual'
                ? 'bg-orange-100 border-orange-300 text-orange-700'
                : 'bg-slate-100 border-slate-200 text-slate-400 hover:border-slate-300'
            }`}
          >
            Input Manual
            <span className={`w-1.5 h-1.5 rounded-full ${nettInputMode === 'manual' ? 'bg-orange-500' : 'bg-slate-300'}`} />
          </button>
        </div>

        {nettInputMode === 'manual' ? (
          <>
            <input
              type="number"
              step="1"
              min="0"
              value={manualNett}
              onChange={(e) => setManualNett(Number(e.target.value))}
              className="input-field text-sm font-semibold text-rupiah"
              placeholder="0"
            />
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <Info className="w-3 h-3" />
              Hasil hitung otomatis (gross - potongan): {formatRupiah(Number(grossAmount) - calc.totalDeduction)}
              {calc.variance !== 0 && (
                <span className={calc.variance > 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                  (selisih {calc.variance > 0 ? '+' : ''}{formatRupiah(calc.variance)})
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-xl font-bold text-rbn-red text-rupiah">{formatRupiah(calc.nett)}</p>
        )}

        {detectedVariance !== 0 && (
          <p className="text-xs flex items-center gap-1 pt-2 border-t border-slate-100">
            <TrendingDown className="w-3 h-3 text-slate-400" />
            <span className="text-slate-500">Selisih dengan nett terdeteksi kasir:</span>
            <span className={detectedVariance > 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
              {detectedVariance > 0 ? '+' : ''}{formatRupiah(detectedVariance)}
            </span>
          </p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Catatan (opsional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input-field resize-none"
          rows={2}
          placeholder="Catatan tambahan..."
        />
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end pt-3 border-t border-slate-200">
        <button type="button" onClick={onCancel} className="btn-outline text-sm order-last sm:order-first">
          Batal
        </button>
        {isEditingPosted ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => submit('posted')}
            className="btn-primary text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit('draft')}
              className="btn-outline text-sm"
            >
              {saving ? 'Menyimpan...' : 'Simpan Draft'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit('posted')}
              className="btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Memproses...' : 'Simpan & Post'}
            </button>
          </>
        )}
      </div>
    </form>
  )
}
