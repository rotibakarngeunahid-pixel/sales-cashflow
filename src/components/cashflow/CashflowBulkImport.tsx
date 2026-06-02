'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatRupiah } from '@/lib/utils/format'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'
import { ConfirmModal } from '@/components/ui/Modal'
import type { Branch, CashflowCategory, CashflowType, CategoryDefaultType, Database } from '@/types/database'
import {
  buildCashflowTemplateCsv,
  buildCashflowTemplateXlsx,
  checkCashflowDbDuplicates,
  parseCashflowImportFile,
  type CashflowImportIssue,
  type CashflowImportParseResult,
  type ParsedCashflowImportRow,
} from '@/lib/utils/cashflow-bulk-import'

type CashflowInsert = Database['public']['Tables']['cashflow_transactions']['Insert']
type Step = 'upload' | 'review' | 'result'

interface CashflowBulkImportProps {
  onSuccess: (message?: string) => void
}

interface ImportResult {
  successCount: number
  skippedCount: number
  cashInTotal: number
  cashOutTotal: number
  message: string
}

const SOURCE_LABEL = 'Cashflow Excel/CSV Import'

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
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

function getDefaultType(types: Set<CashflowType>): CategoryDefaultType {
  if (types.size > 1) return 'both'
  return types.has('cash_in') ? 'cash_in' : 'cash_out'
}

async function ensureImportCategories(
  supabase: ReturnType<typeof createClient>,
  rows: ParsedCashflowImportRow[],
  userId: string | null
) {
  const missingByKey = new Map<string, { name: string; types: Set<CashflowType> }>()

  rows.forEach((row) => {
    if (row.category_id || !row.category_name.trim()) return

    const key = normalizeName(row.category_name)
    const existing = missingByKey.get(key)
    if (existing) {
      existing.types.add(row.transaction_type)
      return
    }

    missingByKey.set(key, {
      name: row.category_name.trim(),
      types: new Set([row.transaction_type]),
    })
  })

  if (missingByKey.size === 0) return rows

  const { data: existingCategories, error: loadError } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .is('deleted_at', null)

  if (loadError) throw loadError

  const categoryByKey = new Map(
    (existingCategories || []).map((category) => [normalizeName(category.name), category])
  )
  const categoriesToCreate = Array.from(missingByKey.entries())
    .filter(([key]) => !categoryByKey.has(key))
    .map(([, item]) => ({
      name: item.name,
      default_type: getDefaultType(item.types),
      description: 'Dibuat otomatis dari import cashflow',
      is_active: true,
    }))

  if (categoriesToCreate.length > 0) {
    const { data: insertedCategories, error: insertError } = await supabase
      .from('cashflow_categories')
      .insert(categoriesToCreate)
      .select('id,name,default_type')

    if (insertError) throw insertError

    ;(insertedCategories || []).forEach((category) => {
      categoryByKey.set(normalizeName(category.name), category)
    })

    if (insertedCategories && insertedCategories.length > 0) {
      await supabase.from('audit_logs').insert(
        insertedCategories.map((category) => ({
          table_name: 'cashflow_categories',
          record_id: category.id,
          action: 'category_created',
          old_data: null,
          new_data: category as unknown as Record<string, unknown>,
          changed_by: userId,
          changed_at: new Date().toISOString(),
        }))
      )
    }
  }

  invalidateCachedData(/^(cashflow-categories:|cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)

  return rows.map((row) => {
    if (row.category_id) return row
    const category = categoryByKey.get(normalizeName(row.category_name))
    return category ? { ...row, category_id: category.id } : row
  })
}

function toInsertPayload(row: ParsedCashflowImportRow, userId: string | null, fileName: string): CashflowInsert {
  const isCashIn = row.transaction_type === 'cash_in'

  return {
    transaction_date: row.transaction_date,
    branch_id: row.branch_id,
    transaction_type: row.transaction_type,
    category_id: row.category_id,
    description: row.description,
    cash_in: isCashIn ? row.amount : 0,
    cash_out: isCashIn ? 0 : row.amount,
    amount: row.amount,
    source: 'manual',
    import_key: row.import_key,
    source_label: SOURCE_LABEL,
    source_metadata: {
      imported_from: 'cashflow_file',
      imported_file: fileName,
      source_row: row.sourceRow,
      reference_code: row.reference_code || null,
      branch_name: row.branch_name,
      category_name: row.category_name,
    },
    status: 'active',
    created_by: userId,
    updated_by: userId,
  }
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'upload', label: 'Upload File' },
    { id: 'review', label: 'Review Data' },
    { id: 'result', label: 'Hasil Import' },
  ]
  const activeIndex = steps.findIndex((item) => item.id === step)

  return (
    <div className="flex items-center gap-0">
      {steps.map((item, index) => {
        const active = item.id === step
        const done = index < activeIndex

        return (
          <div key={item.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                  active ? 'bg-rbn-red text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400',
                ].join(' ')}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
              </div>
              <span
                className={[
                  'hidden text-xs font-semibold sm:block',
                  active ? 'text-slate-900' : done ? 'text-emerald-600' : 'text-slate-400',
                ].join(' ')}
              >
                {item.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={`mx-3 h-px w-10 sm:w-16 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function IssuePanel({
  title,
  issues,
  variant,
}: {
  title: string
  issues: CashflowImportIssue[]
  variant: 'error' | 'warning' | 'info'
}) {
  if (issues.length === 0) return null

  const colors = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  }[variant]

  const Icon = variant === 'error' ? XCircle : variant === 'warning' ? AlertTriangle : Info

  return (
    <div className={`rounded-xl border ${colors} p-4`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-bold">
        <Icon className="h-4 w-4" />
        {title} ({issues.length})
      </p>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {issues.map((issue, index) => (
          <li key={`${issue.row}-${issue.column}-${index}`}>
            <span className="font-bold">Baris {issue.row} - {issue.column}:</span> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RowIssues({ issues }: { issues: CashflowImportIssue[] }) {
  if (issues.length === 0) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />

  const hasError = issues.some((issue) => issue.severity === 'error')
  return hasError
    ? <XCircle className="h-4 w-4 text-red-500" />
    : <AlertTriangle className="h-4 w-4 text-amber-500" />
}

export default function CashflowBulkImport({ onSuccess }: CashflowBulkImportProps) {
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [categories, setCategories] = useState<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>([])
  const [lookupsLoaded, setLookupsLoaded] = useState(false)
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [parseResult, setParseResult] = useState<CashflowImportParseResult | null>(null)
  const [dbCheck, setDbCheck] = useState<{ existingKeys: string[]; validRows: ParsedCashflowImportRow[] } | null>(null)
  const [checkingDb, setCheckingDb] = useState(false)
  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadLookups() {
      const supabase = createClient()
      const [branchRows, categoryRows] = await Promise.all([
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
        ),
        getOrFetchCached<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>(
          'cashflow-categories:active',
          async () => {
            const { data } = await supabase
              .from('cashflow_categories')
              .select('id,name,default_type')
              .eq('is_active', true)
              .is('deleted_at', null)
              .order('name')
            return data || []
          },
          { ttlMs: 5 * 60_000 }
        ),
      ])

      setBranches(branchRows)
      setCategories(categoryRows)
      setLookupsLoaded(true)
    }

    loadLookups()
  }, [])

  useEffect(() => {
    if (step !== 'review' || !parseResult) return

    const rowsWithoutErrors = parseResult.rows.filter((row) =>
      row.rowErrors.every((issue) => issue.severity !== 'error')
    )

    setCheckingDb(true)
    setDbCheck(null)
    checkCashflowDbDuplicates(rowsWithoutErrors, createClient())
      .then(setDbCheck)
      .catch((err) => setError(err?.message ?? 'Gagal memeriksa duplikat ke database.'))
      .finally(() => setCheckingDb(false))
  }, [parseResult, step])

  const stats = useMemo(() => {
    if (!parseResult) return null

    const allErrors = parseResult.allIssues.filter((issue) => issue.severity === 'error')
    const allWarnings = parseResult.allIssues.filter((issue) => issue.severity === 'warning')
    const rowsWithErrors = parseResult.rows.filter((row) =>
      row.rowErrors.some((issue) => issue.severity === 'error')
    )
    const rowsWithoutErrors = parseResult.rows.filter((row) =>
      row.rowErrors.every((issue) => issue.severity !== 'error')
    )
    const importableRows = (dbCheck?.validRows ?? rowsWithoutErrors).filter((row) =>
      row.rowErrors.every((issue) => issue.severity !== 'error') &&
      !removedRowKeys.has(row.import_key)
    )
    const cashInTotal = importableRows
      .filter((row) => row.transaction_type === 'cash_in')
      .reduce((sum, row) => sum + row.amount, 0)
    const cashOutTotal = importableRows
      .filter((row) => row.transaction_type === 'cash_out')
      .reduce((sum, row) => sum + row.amount, 0)

    return {
      allErrors,
      allWarnings,
      errorRows: rowsWithErrors.length,
      importableRows,
      dbDupCount: dbCheck?.existingKeys.length ?? 0,
      cashInTotal,
      cashOutTotal,
    }
  }, [dbCheck, parseResult, removedRowKeys])

  function handleDownloadCsv() {
    downloadBlob(
      new Blob(['\uFEFF', buildCashflowTemplateCsv()], { type: 'text/csv;charset=utf-8' }),
      `template-cashflow-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }

  function handleDownloadXlsx() {
    const buffer = buildCashflowTemplateXlsx(branches, categories)
    downloadBlob(
      new Blob([buffer.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `template-cashflow-${new Date().toISOString().slice(0, 10)}.xlsx`
    )
  }

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      setError(null)
      setDbCheck(null)

      if (!file) {
        setFileName('')
        setParseResult(null)
        return
      }

      if (!lookupsLoaded) {
        setError('Data cabang dan kategori belum selesai dimuat.')
        return
      }

      setFileName(file.name)
      const result = await parseCashflowImportFile(file, { branches, categories })
      setParseResult(result)

      if (result.fatalErrors.length > 0) {
        setError(result.fatalErrors.join(' '))
        return
      }

      if (result.rows.length === 0) {
        setError(
          result.skippedEmptyRows > 0
            ? 'Tidak ada data bernominal lebih dari 0 untuk diimport.'
            : 'Tidak ada data cashflow yang dapat dibaca dari file.'
        )
        return
      }

      setStep('review')
    },
    [branches, categories, lookupsLoaded]
  )

  function resetImport() {
    setStep('upload')
    setFileName('')
    setParseResult(null)
    setDbCheck(null)
    setRemovedRowKeys(new Set())
    setImportResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleImport() {
    if (!stats?.importableRows.length) return

    setShowConfirm(false)
    setImporting(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id ?? null
      const resolvedRows = await ensureImportCategories(supabase, stats.importableRows, userId)
      const unresolvedCategory = resolvedRows.find((row) => !row.category_id)
      if (unresolvedCategory) {
        throw new Error(`Kategori "${unresolvedCategory.category_name}" gagal dibuat otomatis.`)
      }

      const payload = resolvedRows.map((row) => toInsertPayload(row, userId, fileName))

      const { data: inserted, error: insertError } = await supabase
        .from('cashflow_transactions')
        .insert(payload)
        .select()

      if (insertError) throw insertError

      if (inserted && inserted.length > 0) {
        await supabase.from('audit_logs').insert(
          inserted.map((row) => ({
            table_name: 'cashflow_transactions',
            record_id: row.id,
            action: 'cashflow_bulk_imported',
            old_data: null,
            new_data: row as unknown as Record<string, unknown>,
            changed_by: userId,
            changed_at: new Date().toISOString(),
          }))
        )
      }

      invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|dashboard:)/)

      const skippedCount = (parseResult?.skippedEmptyRows ?? 0) + (stats?.errorRows ?? 0) + (stats?.dbDupCount ?? 0)
      setImportResult({
        successCount: inserted?.length ?? payload.length,
        skippedCount,
        cashInTotal: stats.cashInTotal,
        cashOutTotal: stats.cashOutTotal,
        message: `${inserted?.length ?? payload.length} transaksi cashflow berhasil diimport.`,
      })
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import cashflow gagal diproses.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <StepIndicator step={step} />

      {step === 'upload' && (
        <div className="card p-5 space-y-5">
          <div>
            <p className="page-kicker">Langkah 1</p>
            <h3 className="text-lg font-extrabold text-slate-950">Template & Upload Cashflow</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Import ini khusus transaksi cashflow manual, terpisah dari import sales.
            </p>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
            <p className="mb-2 flex items-center gap-2 font-semibold">
              <Info className="h-4 w-4" />
              Perbedaan fitur import
            </p>
            <ul className="list-inside list-disc space-y-1 text-xs text-blue-600">
              <li>Import Sales menyimpan laporan penjualan harian ke modul Sales.</li>
              <li>Import Cashflow menyimpan transaksi kas langsung ke modul Cashflow.</li>
              <li>Import Bahan Baku mengambil data dari integrasi purchase order, bukan dari file template umum.</li>
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Cabang tersedia</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{branches.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori tersedia</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{categories.length}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Download className="h-4 w-4 text-slate-400" />
              Download Template
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadXlsx}
                disabled={!lookupsLoaded}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Template Excel
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="btn-outline px-3 py-1.5 text-sm"
              >
                <Download className="h-4 w-4" />
                Template CSV
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Upload File Cashflow
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-8 text-center transition-all hover:border-rbn-orange hover:bg-orange-50">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                <Upload className="h-6 w-6 text-slate-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">{fileName || 'Klik untuk pilih file'}</p>
                <p className="mt-1 text-xs text-slate-400">Mendukung format .xlsx dan .csv</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {step === 'review' && parseResult && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="page-kicker">Langkah 2</p>
                <h3 className="text-lg font-extrabold text-slate-950">Review Import Cashflow</h3>
                <p className="mt-0.5 text-sm text-slate-500">File: <span className="font-medium text-slate-700">{fileName}</span></p>
              </div>
              <button type="button" onClick={resetImport} className="btn-outline flex-shrink-0 text-sm">
                <X className="h-4 w-4" />
                Ganti File
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Total Baris</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{parseResult.rows.length}</p>
              {parseResult.skippedEmptyRows > 0 && (
                <p className="mt-0.5 text-xs text-slate-400">
                  +{parseResult.skippedEmptyRows} kosong/0 dilewati
                </p>
              )}
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Siap Diimport</p>
              {checkingDb ? <Loader2 className="mt-2 h-5 w-5 animate-spin text-slate-400" /> : (
                <p className="mt-1 text-2xl font-extrabold text-emerald-600">{stats?.importableRows.length ?? 0}</p>
              )}
            </div>
            <div className={`card p-4 ${(stats?.errorRows ?? 0) > 0 ? 'border-red-200 bg-red-50' : ''}`}>
              <p className="text-xs font-semibold text-slate-500">Baris Error</p>
              <p className={`mt-1 text-2xl font-extrabold ${(stats?.errorRows ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {stats?.errorRows ?? 0}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold text-slate-500">Net Import</p>
              <p className="mt-1 text-lg font-extrabold text-rupiah text-slate-900">
                {formatRupiah((stats?.cashInTotal ?? 0) - (stats?.cashOutTotal ?? 0))}
              </p>
            </div>
          </div>

          <IssuePanel title="Error (harus diperbaiki)" issues={stats?.allErrors ?? []} variant="error" />
          <IssuePanel title="Peringatan" issues={stats?.allWarnings ?? []} variant="warning" />
          {dbCheck && dbCheck.existingKeys.length > 0 && (
            <IssuePanel
              title="Duplikat Database (akan dilewati)"
              variant="info"
              issues={dbCheck.existingKeys.map((key) => ({
                row: 0,
                column: 'Kode Import',
                message: `${key} sudah pernah diimport.`,
                severity: 'warning',
              }))}
            />
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h4 className="text-sm font-bold text-slate-800">Detail Data ({parseResult.rows.length} baris)</h4>
              <p className="text-xs text-slate-400">Scroll horizontal untuk melihat semua kolom</p>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-header w-8">#</th>
                    <th className="table-header w-10"></th>
                    <th className="table-header">Tanggal</th>
                    <th className="table-header">Cabang</th>
                    <th className="table-header">Tipe</th>
                    <th className="table-header">Kategori</th>
                    <th className="table-header">Deskripsi</th>
                    <th className="table-header text-right">Nominal</th>
                    <th className="table-header">Referensi</th>
                    <th className="table-header w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {parseResult.rows.map((row, index) => {
                    const hasError = row.rowErrors.some((issue) => issue.severity === 'error')
                    const isDbDup = dbCheck?.existingKeys.includes(row.import_key) ?? false
                    const isRemoved = removedRowKeys.has(row.import_key)
                    const canRemove = !hasError && !isDbDup
                    const rowClass = hasError
                      ? 'bg-red-50/70'
                      : isDbDup
                        ? 'bg-slate-50 text-slate-400'
                        : isRemoved
                          ? 'bg-slate-50 opacity-50'
                          : ''

                    return (
                      <tr key={`${row.sourceRow}-${row.import_key || index}`} className={rowClass}>
                        <td className="table-cell text-slate-400">{index + 1}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            <RowIssues issues={row.rowErrors} />
                            {isDbDup && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">DB</span>}
                            {isRemoved && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">SKIP</span>}
                          </div>
                        </td>
                        <td className={`table-cell font-semibold ${isRemoved ? 'line-through text-slate-400' : ''}`}>{row.transaction_date || '-'}</td>
                        <td className="table-cell">{row.branch_name || '-'}</td>
                        <td className="table-cell">{row.transaction_type === 'cash_in' ? 'Cash In' : 'Cash Out'}</td>
                        <td className="table-cell">{row.category_name || '-'}</td>
                        <td className={`table-cell max-w-[220px] truncate ${isRemoved ? 'line-through text-slate-400' : ''}`}>{row.description || '-'}</td>
                        <td className={`table-cell text-right font-bold text-rupiah ${isRemoved ? 'line-through text-slate-300' : row.transaction_type === 'cash_in' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatRupiah(row.amount)}
                        </td>
                        <td className="table-cell max-w-[160px] truncate">{row.reference_code || '-'}</td>
                        <td className="table-cell">
                          {canRemove && (
                            <button
                              type="button"
                              onClick={() => setRemovedRowKeys((prev) => {
                                const next = new Set(prev)
                                if (next.has(row.import_key)) next.delete(row.import_key)
                                else next.add(row.import_key)
                                return next
                              })}
                              title={isRemoved ? 'Batalkan — masukkan kembali' : 'Hapus dari import ini'}
                              className={`p-1 rounded transition-colors ${isRemoved ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-300 hover:bg-red-50 hover:text-red-500'}`}
                            >
                              {isRemoved ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card flex flex-col items-center justify-between gap-3 p-4 sm:flex-row">
            <div className="text-sm text-slate-600">
              {checkingDb ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  Memeriksa duplikat di database...
                </span>
              ) : stats?.importableRows.length ? (
                <span>
                  <span className="font-bold text-emerald-600">{stats.importableRows.length} baris</span> siap diimport
                  {stats.dbDupCount > 0 && <span className="text-slate-400"> - {stats.dbDupCount} duplikat dilewati</span>}
                </span>
              ) : (
                <span className="font-medium text-red-600">Tidak ada data valid untuk diimport</span>
              )}
            </div>

            <div className="flex w-full gap-3 sm:w-auto">
              <button type="button" onClick={resetImport} className="btn-outline flex-1 text-sm sm:flex-none">
                Kembali
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={checkingDb || importing || !stats?.importableRows.length}
                className="btn-primary flex-1 text-sm sm:flex-none"
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

      {step === 'result' && importResult && (
        <div className="card space-y-5 p-8 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-900">Import Cashflow Berhasil</h3>
            <p className="mt-1 text-slate-500">{importResult.message}</p>
          </div>
          <div className="inline-flex flex-wrap justify-center gap-4 rounded-2xl bg-slate-50 px-6 py-4">
            <div>
              <p className="text-2xl font-extrabold text-emerald-600">{importResult.successCount}</p>
              <p className="text-xs font-semibold text-slate-500">Disimpan</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-500">{importResult.skippedCount}</p>
              <p className="text-xs font-semibold text-slate-500">Dilewati</p>
            </div>
            <div>
              <p className="text-lg font-extrabold text-rupiah text-slate-900">
                {formatRupiah(importResult.cashInTotal - importResult.cashOutTotal)}
              </p>
              <p className="text-xs font-semibold text-slate-500">Net Import</p>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button type="button" onClick={resetImport} className="btn-outline">
              Import Lagi
            </button>
            <button type="button" onClick={() => onSuccess(importResult.message)} className="btn-primary">
              <CheckCircle2 className="h-4 w-4" />
              Lihat Cashflow
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleImport}
        loading={importing}
        title="Konfirmasi Import Cashflow"
        description={`Import ${stats?.importableRows.length ?? 0} transaksi cashflow dari file ini? Data akan langsung masuk sebagai transaksi aktif.`}
        confirmLabel="Import Sekarang"
      />
    </div>
  )
}
