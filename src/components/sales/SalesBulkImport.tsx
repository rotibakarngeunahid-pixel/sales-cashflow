'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatRupiah } from '@/lib/utils/format'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'
import {
  buildSalesBulkTemplateCsv,
  parseSalesBulkCsv,
  type ParsedSalesImportRow,
  type SalesImportParseResult,
} from '@/lib/utils/sales-bulk-import'
import type { Branch, Database } from '@/types/database'

type SalesInsert = Database['public']['Tables']['sales_reports']['Insert']

interface SalesBulkImportProps {
  onSuccess: (message?: string) => void
}

const monthOptions = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' },
]

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function toInsertPayload(
  row: ParsedSalesImportRow,
  branchId: string,
  status: 'draft' | 'submitted',
  userId: string | null
): SalesInsert {
  return {
    report_date: row.report_date,
    branch_id: branchId,
    cash: row.cash,
    qris: row.qris,
    gofood_gross: row.gofood_gross,
    gofood_promo: row.gofood_promo,
    gofood_commission: row.gofood_commission,
    gofood_nett: row.gofood_nett,
    grabfood_gross: row.grabfood_gross,
    grabfood_promo: row.grabfood_promo,
    grabfood_commission: row.grabfood_commission,
    grabfood_ads: row.grabfood_ads,
    grabfood_nett: row.grabfood_nett,
    shopeefood_gross: row.shopeefood_gross,
    shopeefood_promo: row.shopeefood_promo,
    shopeefood_commission: row.shopeefood_commission,
    shopeefood_nett: row.shopeefood_nett,
    total_offline: row.total_offline,
    total_online_gross: row.total_online_gross,
    total_online_nett: row.total_online_nett,
    total_online_deduction: row.total_online_deduction,
    grand_total_nett_sales: row.grand_total_nett_sales,
    online_deduction_percentage: row.online_deduction_percentage,
    status,
    notes: row.notes,
    created_by: userId,
    updated_by: userId,
  }
}

export default function SalesBulkImport({ onSuccess }: SalesBulkImportProps) {
  const today = new Date()
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [branchId, setBranchId] = useState('')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [status, setStatus] = useState<'draft' | 'submitted'>('draft')
  const [rawCsv, setRawCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [parseResult, setParseResult] = useState<SalesImportParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    async function loadBranches() {
      const supabase = createClient()
      const data = await getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
        'branches:active',
        async () => {
          const { data } = await supabase
            .from('branches')
            .select('id,name')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name')

          return data || []
        },
        { ttlMs: 5 * 60_000 }
      )

      setBranches(data)
    }

    loadBranches()
  }, [])

  useEffect(() => {
    if (!rawCsv) {
      setParseResult(null)
      return
    }

    setParseResult(parseSalesBulkCsv(rawCsv, year))
  }, [rawCsv, year])

  const selectedBranch = branches.find((branch) => branch.id === branchId)

  const previewTotals = useMemo(() => {
    const rows = parseResult?.rows ?? []
    return rows.reduce(
      (acc, row) => ({
        count: acc.count + 1,
        grand: acc.grand + row.grand_total_nett_sales,
      }),
      { count: 0, grand: 0 }
    )
  }, [parseResult])

  function handleDownloadTemplate() {
    const branchSlug = selectedBranch ? `-${slugify(selectedBranch.name)}` : ''
    const filename = `template-sales-${year}-${String(month).padStart(2, '0')}${branchSlug}.csv`
    downloadCsv(filename, buildSalesBulkTemplateCsv(month, year))
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError(null)

    if (!file) {
      setRawCsv('')
      setFileName('')
      return
    }

    setFileName(file.name)
    setRawCsv(await file.text())
  }

  async function handleImport() {
    setError(null)

    if (!branchId) {
      setError('Cabang wajib dipilih.')
      return
    }

    if (!parseResult || parseResult.rows.length === 0) {
      setError('Tidak ada baris penjualan yang siap diimport.')
      return
    }

    if (parseResult.errors.length > 0) {
      setError('Perbaiki error CSV sebelum import.')
      return
    }

    setImporting(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id ?? null
      const dates = parseResult.rows.map((row) => row.report_date)

      const { data: existing, error: existingError } = await supabase
        .from('sales_reports')
        .select('report_date,status')
        .eq('branch_id', branchId)
        .in('report_date', dates)
        .neq('status', 'void')

      if (existingError) throw existingError

      const existingDates = new Set((existing || []).map((row) => row.report_date))
      const importRows = parseResult.rows.filter((row) => !existingDates.has(row.report_date))

      if (importRows.length === 0) {
        setError('Semua tanggal di CSV sudah memiliki laporan aktif untuk cabang ini.')
        return
      }

      const payload = importRows.map((row) => toInsertPayload(row, branchId, status, userId))
      const { data: inserted, error: insertError } = await supabase
        .from('sales_reports')
        .insert(payload)
        .select()

      if (insertError) throw insertError

      if (inserted && inserted.length > 0) {
        await supabase.from('audit_logs').insert(
          inserted.map((row) => ({
            table_name: 'sales_reports',
            record_id: row.id,
            action: 'sales_bulk_imported',
            old_data: null,
            new_data: row as unknown as Record<string, unknown>,
            changed_by: userId,
            changed_at: new Date().toISOString(),
          }))
        )
      }

      invalidateCachedData(/^(sales-reports:|dashboard:|dashboard-today:|sales-report-status:)/)

      const skippedExisting = parseResult.rows.length - importRows.length
      const message = [
        `Import ${inserted?.length ?? importRows.length} laporan berhasil.`,
        skippedExisting > 0 ? `${skippedExisting} tanggal dilewati karena sudah ada.` : '',
      ].filter(Boolean).join(' ')

      onSuccess(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import gagal diproses.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="page-kicker">Bulk Input</p>
          <h3 className="text-lg font-extrabold text-slate-950">Import Penjualan CSV</h3>
        </div>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="btn-outline flex w-full items-center gap-2 text-sm lg:w-auto"
        >
          <Download className="h-4 w-4" />
          Download Template
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.6fr_0.8fr_0.8fr]">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Cabang
          </label>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="input-field">
            <option value="">Pilih cabang...</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Tahun
          </label>
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="input-field"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Bulan Template
          </label>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="input-field">
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Status Import
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'submitted')} className="input-field">
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
          </select>
        </div>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition-colors hover:border-rbn-orange hover:bg-orange-50">
        <Upload className="h-5 w-5 text-slate-400" />
        <span className="text-sm font-bold text-slate-700">
          {fileName || 'Pilih file CSV'}
        </span>
        <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="sr-only" />
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {parseResult && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">Baris Siap Import</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{previewTotals.count}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">Total Nett</p>
              <p className="mt-1 text-xl font-extrabold text-rbn-red text-rupiah">{formatRupiah(previewTotals.grand)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-500">Baris Kosong</p>
              <p className="mt-1 text-xl font-extrabold text-slate-950">{parseResult.skippedEmptyRows}</p>
            </div>
          </div>

          {parseResult.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {parseResult.errors.slice(0, 4).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          )}

          {parseResult.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {parseResult.warnings.slice(0, 4).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          )}

          {parseResult.rows.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Tanggal</th>
                    <th className="px-3 py-2 text-right">Offline</th>
                    <th className="px-3 py-2 text-right">Online Nett</th>
                    <th className="px-3 py-2 text-right">Grand Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {parseResult.rows.slice(0, 6).map((row) => (
                    <tr key={`${row.sourceRow}-${row.report_date}`}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{formatDate(row.report_date, 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2 text-right text-rupiah">{formatRupiah(row.total_offline)}</td>
                      <td className="px-3 py-2 text-right text-rupiah">{formatRupiah(row.total_online_nett)}</td>
                      <td className="px-3 py-2 text-right font-bold text-rbn-red text-rupiah">{formatRupiah(row.grand_total_nett_sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || !parseResult || parseResult.rows.length === 0 || parseResult.errors.length > 0}
          className="btn-primary flex w-full items-center gap-2 text-sm sm:w-auto"
        >
          {importing ? (
            <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          {importing ? 'Mengimport...' : 'Import CSV'}
        </button>
      </div>

      {parseResult?.rows.length ? (
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          <span>CSV terbaca dan siap disimpan.</span>
        </div>
      ) : null}
    </div>
  )
}
