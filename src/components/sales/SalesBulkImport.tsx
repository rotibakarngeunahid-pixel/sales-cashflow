'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatRupiah } from '@/lib/utils/format'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'
import {
  buildSalesBulkTemplateCsv,
  buildSalesBulkTemplateXlsx,
  checkDbDuplicates,
  parseImportFile,
  type ImportRowError,
  type ParsedSalesImportRow,
  type SalesImportParseResult,
} from '@/lib/utils/sales-bulk-import'
import type { Branch, Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type SalesInsert = Database['public']['Tables']['sales_reports']['Insert']

type Step = 'upload' | 'review' | 'result'

interface ImportResult {
  successCount: number
  failureCount: number
  skippedCount: number
  message: string
}

interface SalesBulkImportProps {
  onSuccess: (message?: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const monthOptions = [
  { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' }, { value: 4, label: 'April' },
  { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' }, { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' }, { value: 12, label: 'Desember' },
]

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function downloadBlob(blob: Blob, filename: string) {
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
    qris_gross: row.qris_gross,
    qris_mdr: row.qris_mdr,
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'upload', label: 'Upload File' },
    { id: 'review', label: 'Review Data' },
    { id: 'result', label: 'Hasil Import' },
  ]
  const activeIndex = steps.findIndex((s) => s.id === step)

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => {
        const isActive = s.id === step
        const isDone = i < activeIndex
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-rbn-red to-rbn-orange text-white shadow-sm shadow-red-200'
                    : isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-400',
                ].join(' ')}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={[
                  'text-xs font-semibold hidden sm:block',
                  isActive ? 'text-slate-900' : isDone ? 'text-emerald-600' : 'text-slate-400',
                ].join(' ')}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={[
                  'mx-3 h-px w-10 sm:w-16',
                  i < activeIndex ? 'bg-emerald-400' : 'bg-slate-200',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function IssuesBadge({ issues }: { issues: ImportRowError[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  if (!errors && !warnings) return null
  return (
    <span className="flex items-center gap-1">
      {errors > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
          <XCircle className="h-3 w-3" />{errors}
        </span>
      )}
      {warnings > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
          <AlertTriangle className="h-3 w-3" />{warnings}
        </span>
      )}
    </span>
  )
}

// ─── Row Tooltip ──────────────────────────────────────────────────────────────

function RowIssueTooltip({ issues }: { issues: ImportRowError[] }) {
  const [open, setOpen] = useState(false)
  if (!issues.length) return null
  const hasError = issues.some((i) => i.severity === 'error')

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className={[
          'inline-flex h-5 w-5 items-center justify-center rounded-full text-white',
          hasError ? 'bg-red-500' : 'bg-amber-400',
        ].join(' ')}
      >
        {hasError ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3 w-3" />}
      </button>
      {open && (
        <div className="absolute left-6 top-0 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg">
          {issues.map((iss, idx) => (
            <div
              key={idx}
              className={[
                'mb-1 last:mb-0 rounded-lg px-2 py-1 text-xs',
                iss.severity === 'error'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700',
              ].join(' ')}
            >
              <span className="font-bold">{iss.column}:</span> {iss.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Collapsible Issue Panel ──────────────────────────────────────────────────

function IssuePanel({
  title,
  issues,
  defaultOpen = true,
  variant,
}: {
  title: string
  issues: ImportRowError[]
  defaultOpen?: boolean
  variant: 'error' | 'warning' | 'info'
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!issues.length) return null

  const colorMap = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  }

  return (
    <div className={`rounded-xl border ${colorMap[variant]} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 font-semibold text-sm"
      >
        <span className="flex items-center gap-2">
          {variant === 'error' && <XCircle className="h-4 w-4" />}
          {variant === 'warning' && <AlertTriangle className="h-4 w-4" />}
          {variant === 'info' && <Info className="h-4 w-4" />}
          {title} ({issues.length})
        </span>
        {open ? <ChevronUp className="h-4 w-4 opacity-60" /> : <ChevronDown className="h-4 w-4 opacity-60" />}
      </button>
      {open && (
        <ul className="border-t border-current/10 px-4 py-3 space-y-1.5 max-h-48 overflow-y-auto">
          {issues.map((iss, idx) => (
            <li key={idx} className="text-xs">
              <span className="font-bold">Baris {iss.row} — {iss.column}:</span>{' '}
              {iss.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

function ConfirmModal({
  validCount,
  skippedDbCount,
  branchName,
  status,
  onConfirm,
  onCancel,
  loading,
}: {
  validCount: number
  skippedDbCount: number
  branchName: string
  status: string
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-slide-up">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-rbn-red to-rbn-orange">
            <FileSpreadsheet className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900">Konfirmasi Import</h3>
            <p className="text-xs text-slate-500">Pastikan data sudah benar sebelum disimpan</p>
          </div>
        </div>

        <div className="mb-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Data akan diimport</span>
            <span className="font-bold text-emerald-600">{validCount} baris</span>
          </div>
          {skippedDbCount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Dilewati (sudah ada di DB)</span>
              <span className="font-bold text-slate-500">{skippedDbCount} baris</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-600">Cabang</span>
            <span className="font-bold text-slate-900">{branchName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Status</span>
            <span className={`font-bold capitalize ${status === 'submitted' ? 'text-blue-600' : 'text-amber-600'}`}>
              {status}
            </span>
          </div>
        </div>

        <p className="mb-5 text-xs text-slate-500">
          Data yang sudah disimpan tidak dapat dibatalkan melalui fitur ini. Pastikan data sudah benar.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-outline flex-1"
          >
            Batalkan
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Ya, Import Sekarang
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SalesBulkImport({ onSuccess }: SalesBulkImportProps) {
  const today = new Date()

  // ─ Config state ─
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [branchId, setBranchId] = useState('')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [status, setStatus] = useState<'draft' | 'submitted'>('draft')

  // ─ Wizard state ─
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [parseResult, setParseResult] = useState<SalesImportParseResult | null>(null)
  const [dbCheck, setDbCheck] = useState<{ existingDates: string[]; validRows: ParsedSalesImportRow[] } | null>(null)
  const [checkingDb, setCheckingDb] = useState(false)

  // ─ Import state ─
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─ Load branches ─
  useEffect(() => {
    const supabase = createClient()
    getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
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
    ).then(setBranches)
  }, [])

  // ─ Trigger DB duplicate check when review step is reached ─
  useEffect(() => {
    if (step !== 'review' || !parseResult || !branchId) return
    setCheckingDb(true)
    setDbCheck(null)

    const supabase = createClient()
    const rowsWithoutInternalDups = parseResult.rows.filter(
      (r) => !parseResult.internalDuplicateDates.includes(r.report_date)
    )
    checkDbDuplicates(rowsWithoutInternalDups, branchId, supabase)
      .then(setDbCheck)
      .catch((err) => setError(err?.message ?? 'Gagal memeriksa duplikat ke database.'))
      .finally(() => setCheckingDb(false))
  }, [step, parseResult, branchId])

  const selectedBranch = branches.find((b) => b.id === branchId)

  // ─ Stats ─
  const stats = useMemo(() => {
    if (!parseResult) return null
    const allErrors = parseResult.allIssues.filter((i) => i.severity === 'error')
    const allWarnings = parseResult.allIssues.filter((i) => i.severity === 'warning')
    const rowsWithErrors = parseResult.rows.filter((r) =>
      r.rowErrors.some((e) => e.severity === 'error')
    )
    const rowsWithoutErrors = parseResult.rows.filter((r) =>
      r.rowErrors.every((e) => e.severity !== 'error')
    )
    const dbDupCount = dbCheck?.existingDates.length ?? 0
    const importableRows = (dbCheck?.validRows ?? rowsWithoutErrors).filter(
      (r) => r.rowErrors.every((e) => e.severity !== 'error')
    )
    const grandTotal = importableRows.reduce((s, r) => s + r.grand_total_nett_sales, 0)

    return {
      total: parseResult.rows.length,
      errorRows: rowsWithErrors.length,
      warningOnlyRows: rowsWithoutErrors.filter((r) => r.rowErrors.some((e) => e.severity === 'warning')).length,
      allErrors,
      allWarnings,
      importableRows,
      grandTotal,
      dbDupCount,
    }
  }, [parseResult, dbCheck])

  // ─ Template download ─
  function handleDownloadCsv() {
    const branchSlug = selectedBranch ? `-${slugify(selectedBranch.name)}` : ''
    const filename = `template-sales-${year}-${String(month).padStart(2, '0')}${branchSlug}.csv`
    const csv = buildSalesBulkTemplateCsv(month, year)
    downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), filename)
  }

  function handleDownloadXlsx() {
    const branchSlug = selectedBranch ? `-${slugify(selectedBranch.name)}` : ''
    const filename = `template-sales-${year}-${String(month).padStart(2, '0')}${branchSlug}.xlsx`
    const buffer = buildSalesBulkTemplateXlsx(month, year)
    downloadBlob(
      new Blob([buffer.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      filename
    )
  }

  // ─ File upload & parse ─
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      setError(null)

      if (!file) { setFileName(''); setParseResult(null); return }

      if (!branchId) {
        setError('Pilih cabang terlebih dahulu sebelum upload file.')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      setFileName(file.name)
      const result = await parseImportFile(file, year)
      setParseResult(result)

      if (result.fatalErrors.length > 0) {
        setError(result.fatalErrors.join(' '))
        return
      }

      if (result.rows.length === 0 && result.skippedEmptyRows === 0) {
        setError('Tidak ada data yang dapat dibaca dari file.')
        return
      }

      setStep('review')
    },
    [branchId, year]
  )

  // ─ Go back to upload ─
  function handleBackToUpload() {
    setStep('upload')
    setParseResult(null)
    setDbCheck(null)
    setFileName('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─ Import handler ─
  async function handleImport() {
    if (!stats?.importableRows.length || !branchId) return
    setShowConfirm(false)
    setImporting(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id ?? null

      const payload = stats.importableRows.map((row) =>
        toInsertPayload(row, branchId, status, userId)
      )

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

      invalidateCachedData(/^(sales-reports:|dashboard:|dashboard-today:|sales-report-status:|cashflow:|cash-positions:)/)

      const dbDupCount = dbCheck?.existingDates.length ?? 0
      const errorRowCount = stats.errorRows
      const skippedTotal = dbDupCount + errorRowCount + (parseResult?.skippedEmptyRows ?? 0)

      setImportResult({
        successCount: inserted?.length ?? payload.length,
        failureCount: 0,
        skippedCount: skippedTotal,
        message: `${inserted?.length ?? payload.length} laporan berhasil diimport.`,
      })
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import gagal diproses.')
      setImporting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <StepIndicator step={step} />
      </div>

      {/* ── STEP 1: UPLOAD ── */}
      {step === 'upload' && (
        <div className="card p-5 space-y-5 animate-fade-in">
          <div>
            <p className="page-kicker">Langkah 1</p>
            <h3 className="text-lg font-extrabold text-slate-950">Konfigurasi & Upload File</h3>
            <p className="text-sm text-slate-500 mt-0.5">Pilih cabang, download template, isi data, lalu upload.</p>
          </div>

          {/* Config grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Cabang <span className="text-red-500">*</span>
              </label>
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
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tahun</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="input-field"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Bulan Template</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="input-field"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Status Import</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'draft' | 'submitted')}
                className="input-field"
              >
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
              </select>
            </div>
          </div>

          {/* Template download */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">
              <Download className="inline h-4 w-4 mr-1.5 text-slate-400" />
              Download Template
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadXlsx}
                className="btn-primary text-sm px-3 py-1.5"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Template Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="btn-outline text-sm px-3 py-1.5"
              >
                <Download className="h-4 w-4" />
                Template CSV (.csv)
              </button>
            </div>
          </div>

          {/* File upload area */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Upload File Data
            </label>
            <label
              className={[
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all',
                !branchId
                  ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                  : 'border-slate-300 bg-white hover:border-rbn-orange hover:bg-orange-50',
              ].join(' ')}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                <Upload className="h-6 w-6 text-slate-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">
                  {fileName || 'Klik untuk pilih file'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Mendukung format .xlsx dan .csv
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                onChange={handleFileChange}
                disabled={!branchId}
                className="sr-only"
              />
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Tips */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
            <p className="font-semibold mb-2 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Petunjuk Pengisian
            </p>
            <ul className="space-y-1 text-xs list-disc list-inside text-blue-600">
              <li>Pilih cabang terlebih dahulu, lalu download template sesuai bulan/tahun.</li>
              <li>Isi data di template — kolom tanggal sudah terisi otomatis.</li>
              <li>Masukkan angka murni tanpa format Rupiah (contoh: 150000).</li>
              <li>Simpan file lalu upload di sini untuk ditinjau sebelum disimpan.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── STEP 2: REVIEW ── */}
      {step === 'review' && parseResult && (
        <div className="space-y-4 animate-fade-in">
          <div className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="page-kicker">Langkah 2</p>
                <h3 className="text-lg font-extrabold text-slate-950">Review Data Import</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  File: <span className="font-medium text-slate-700">{fileName}</span>
                  {selectedBranch && (
                    <> · Cabang: <span className="font-medium text-slate-700">{selectedBranch.name}</span></>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={handleBackToUpload}
                className="btn-outline text-sm flex-shrink-0"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Ganti File</span>
              </button>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Baris</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{parseResult.rows.length}</p>
              {parseResult.skippedEmptyRows > 0 && (
                <p className="text-xs text-slate-400 mt-0.5">+{parseResult.skippedEmptyRows} kosong dilewati</p>
              )}
            </div>
            <div className={`card p-4 ${stats?.importableRows.length ? 'border-emerald-200' : ''}`}>
              <p className="text-xs font-semibold text-slate-500">Siap Diimport</p>
              {checkingDb ? (
                <Loader2 className="mt-2 h-5 w-5 animate-spin text-slate-400" />
              ) : (
                <p className="mt-1 text-2xl font-extrabold text-emerald-600">
                  {stats?.importableRows.length ?? '…'}
                </p>
              )}
            </div>
            <div className={`card p-4 ${(stats?.errorRows ?? 0) > 0 ? 'border-red-200 bg-red-50' : ''}`}>
              <p className="text-xs font-semibold text-slate-500">Baris Error</p>
              <p className={`mt-1 text-2xl font-extrabold ${(stats?.errorRows ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {stats?.errorRows ?? 0}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Grand Nett</p>
              <p className="mt-1 text-lg font-extrabold text-rbn-red text-rupiah">
                {checkingDb ? '…' : formatRupiah(stats?.grandTotal ?? 0)}
              </p>
            </div>
          </div>

          {/* Issue panels */}
          {parseResult.fatalErrors.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                {parseResult.fatalErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            </div>
          )}

          {stats && (
            <>
              {stats.allErrors.length > 0 && (
                <IssuePanel
                  title="Error (harus diperbaiki)"
                  issues={stats.allErrors}
                  variant="error"
                  defaultOpen
                />
              )}
              {stats.allWarnings.length > 0 && (
                <IssuePanel
                  title="Peringatan (dapat diimport)"
                  issues={stats.allWarnings}
                  variant="warning"
                  defaultOpen={false}
                />
              )}
            </>
          )}

          {/* DB duplicates panel */}
          {dbCheck && dbCheck.existingDates.length > 0 && (
            <IssuePanel
              title={`Duplikat Database (akan dilewati)`}
              issues={dbCheck.existingDates.map((d) => ({
                row: 0,
                column: 'Tanggal',
                message: `${d} — laporan sudah ada untuk cabang ${selectedBranch?.name}`,
                severity: 'warning' as const,
              }))}
              variant="info"
              defaultOpen={false}
            />
          )}

          {/* Data Table */}
          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h4 className="font-bold text-sm text-slate-800">Detail Data ({parseResult.rows.length} baris)</h4>
              <p className="text-xs text-slate-400">Scroll horizontal untuk melihat semua kolom</p>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-header sticky left-0 bg-slate-50 z-10 w-8">#</th>
                    <th className="table-header w-10"></th>
                    <th className="table-header">Tanggal</th>
                    <th className="table-header text-right">Cash</th>
                    <th className="table-header text-right">QRIS Gross</th>
                    <th className="table-header text-right">GF Gross</th>
                    <th className="table-header text-right">GF Nett</th>
                    <th className="table-header text-right">GB Gross</th>
                    <th className="table-header text-right">GB Nett</th>
                    <th className="table-header text-right">SF Gross</th>
                    <th className="table-header text-right">SF Nett</th>
                    <th className="table-header text-right font-extrabold">Grand Total</th>
                    <th className="table-header">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {parseResult.rows.map((row, idx) => {
                    const hasRowErrors = row.rowErrors.some((e) => e.severity === 'error')
                    const hasRowWarnings = row.rowErrors.some((e) => e.severity === 'warning')
                    const isDbDup = dbCheck?.existingDates.includes(row.report_date) ?? false
                    const isInternalDup = parseResult.internalDuplicateDates.includes(row.report_date)

                    const rowBg = hasRowErrors || isInternalDup
                      ? 'bg-red-50/70'
                      : isDbDup
                        ? 'bg-slate-50'
                        : hasRowWarnings
                          ? 'bg-amber-50/40'
                          : ''

                    return (
                      <tr key={`${row.sourceRow}-${row.report_date}`} className={`${rowBg} hover:brightness-95 transition-all`}>
                        <td className="table-cell sticky left-0 bg-inherit z-10 text-slate-400">{idx + 1}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            {row.rowErrors.length > 0 && (
                              <RowIssueTooltip issues={row.rowErrors} />
                            )}
                            {isDbDup && (
                              <span className="inline-block rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 whitespace-nowrap">
                                DB
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`table-cell font-semibold ${(hasRowErrors || isInternalDup) ? 'text-red-700' : isDbDup ? 'text-slate-400 line-through' : ''}`}>
                          {row.report_date || '—'}
                        </td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.cash)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.qris_gross)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.gofood_gross)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.gofood_nett)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.grabfood_gross)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.grabfood_nett)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.shopeefood_gross)}</td>
                        <td className="table-cell text-right text-rupiah">{formatRupiah(row.shopeefood_nett)}</td>
                        <td className={`table-cell text-right font-bold text-rupiah ${isDbDup ? 'text-slate-400' : 'text-rbn-red'}`}>
                          {formatRupiah(row.grand_total_nett_sales)}
                        </td>
                        <td className="table-cell text-slate-500 max-w-[120px] truncate">{row.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom actions */}
          <div className="card p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-sm text-slate-600 flex items-center gap-2">
              {checkingDb ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  <span>Memeriksa duplikat di database...</span>
                </>
              ) : stats?.importableRows.length ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span>
                    <span className="font-bold text-emerald-600">{stats.importableRows.length} baris</span> siap diimport
                    {stats.dbDupCount > 0 && (
                      <span className="text-slate-400"> · {stats.dbDupCount} duplikat dilewati</span>
                    )}
                    {stats.errorRows > 0 && (
                      <span className="text-red-500"> · {stats.errorRows} baris error dilewati</span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-red-600 font-medium">Tidak ada data valid untuk diimport</span>
                </>
              )}
            </div>

            <div className="flex gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleBackToUpload}
                className="btn-outline flex-1 sm:flex-none text-sm"
              >
                ← Kembali
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={
                  checkingDb ||
                  importing ||
                  !stats?.importableRows.length
                }
                className="btn-primary flex-1 sm:flex-none text-sm"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Import {stats?.importableRows.length ?? 0} Data
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: RESULT ── */}
      {step === 'result' && importResult && (
        <div className="card p-8 text-center space-y-5 animate-fade-in">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-900">Import Berhasil!</h3>
            <p className="text-slate-500 mt-1">{importResult.message}</p>
          </div>
          <div className="inline-flex flex-wrap justify-center gap-4 rounded-2xl bg-slate-50 px-6 py-4">
            <div className="text-center">
              <p className="text-2xl font-extrabold text-emerald-600">{importResult.successCount}</p>
              <p className="text-xs text-slate-500 font-semibold mt-0.5">Berhasil Disimpan</p>
            </div>
            {importResult.skippedCount > 0 && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-slate-400">{importResult.skippedCount}</p>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">Dilewati</p>
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setStep('upload')
                setParseResult(null)
                setDbCheck(null)
                setFileName('')
                setImportResult(null)
                setError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="btn-outline"
            >
              Import Lagi
            </button>
            <button
              type="button"
              onClick={() => onSuccess(importResult.message)}
              className="btn-primary"
            >
              <CheckCircle2 className="h-4 w-4" />
              Lihat Laporan
            </button>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && stats && selectedBranch && (
        <ConfirmModal
          validCount={stats.importableRows.length}
          skippedDbCount={stats.dbDupCount}
          branchName={selectedBranch.name}
          status={status}
          onConfirm={handleImport}
          onCancel={() => setShowConfirm(false)}
          loading={importing}
        />
      )}
    </div>
  )
}
