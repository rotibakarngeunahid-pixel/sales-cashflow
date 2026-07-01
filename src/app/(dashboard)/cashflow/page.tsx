'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Pencil, XCircle, FileSpreadsheet, RefreshCw, Info, Trash2, CheckCircle2, X, Upload, Scissors, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { CashflowTransaction, CashflowType, Branch, CashflowCategory, Profile } from '@/types/database'
import { formatDate, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { cashflowSchema, type CashflowFormData } from '@/lib/validations/cashflow'
import {
  distributeAutoSplitAmount,
  getAutoSplitPreviewError,
  isKurirBawaBahanCategory,
} from '@/lib/cashflow/auto-split-kurir'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import SplitExpenseModal from './SplitExpenseModal'
import ExportArusKasModal from './ExportArusKasModal'
import { CashflowTypeBadge, CashflowStatusBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { format, startOfMonth } from 'date-fns'
import { getCachedData, getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'

type CashPosition = {
  branchId: string
  branchName: string
  cashIn: number
  cashOut: number
  balance: number
}

type CashPositionRow = {
  branch_id: string
  cash_in: number | null
  cash_out: number | null
  branch?: Pick<Branch, 'id' | 'name'> | null
}

const CASHFLOW_TOAST_KEY = 'cashflowToast'

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
        type === 'success'
          ? 'bg-emerald-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success'
        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        : <XCircle className="w-4 h-4 flex-shrink-0" />
      }
      <span>{message}</span>
      <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function getNominalAmount(tx: CashflowTransaction) {
  return tx.transaction_type === 'cash_in'
    ? tx.cash_in || tx.amount
    : tx.cash_out || tx.amount
}

function getNominalLabel(tx: CashflowTransaction) {
  const prefix = tx.transaction_type === 'cash_out' ? '-' : ''
  return `${prefix}${formatRupiah(getNominalAmount(tx))}`
}

function normalizeCategoryName(name?: string | null) {
  return (name || '').trim().toLowerCase()
}

function isCourierCategoryName(name?: string | null) {
  const normalized = normalizeCategoryName(name)
  return normalized === 'kurir' || normalized === 'beban kurir' || normalized.includes('kurir')
}

function isCourierExpense(tx: CashflowTransaction) {
  return tx.transaction_type === 'cash_out' && isCourierCategoryName(tx.category?.name)
}

function isActiveCourierExpense(tx: CashflowTransaction) {
  return tx.status === 'active' && isCourierExpense(tx)
}

function isAutoSplitKurirChild(tx: CashflowTransaction) {
  return tx.source === 'auto_split_kurir' || Boolean(tx.auto_split_group_id)
}

function canManageCashflowTx(tx: CashflowTransaction) {
  return tx.status === 'active'
    && tx.source !== 'sales'
    && tx.source !== 'purchase_order'
    && !isAutoSplitKurirChild(tx)
}

function canSplitCashflowTx(tx: CashflowTransaction) {
  return canManageCashflowTx(tx) && isCourierExpense(tx)
}

// Transaksi hasil pembagian beban kurir selalu punya reference_group_id
// dengan source manual.
function isSplitTx(tx: CashflowTransaction) {
  return (tx.source === 'manual' && Boolean(tx.reference_group_id)) || isAutoSplitKurirChild(tx)
}

function SplitStatusBadge({ tx }: { tx: CashflowTransaction }) {
  if (isAutoSplitKurirChild(tx)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
        <Scissors className="w-3 h-3" /> Auto split
      </span>
    )
  }

  if (!isActiveCourierExpense(tx)) return null

  if (isSplitTx(tx)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <Scissors className="w-3 h-3" /> Dibagi
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
      Belum dibagi
    </span>
  )
}

function CashflowSourceLabel({ tx }: { tx: CashflowTransaction }) {
  if (tx.source === 'auto_split_kurir') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Auto Split Kurir
      </span>
    )
  }

  if (tx.source === 'sales') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Auto Sales
      </span>
    )
  }

  if (tx.source === 'purchase_order') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Auto Bahan Baku
      </span>
    )
  }

  if (tx.source === 'beban_transfer') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Transfer Beban
      </span>
    )
  }

  if (tx.source === 'kasir_sales' || tx.source === 'kasir_expenses') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Import POS
      </span>
    )
  }

  if (tx.source_label) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
        <Info className="w-3 h-3" /> Import File
      </span>
    )
  }

  return <span className="text-xs text-gray-500">Manual</span>
}

export default function CashflowPage() {
  const [transactions, setTransactions] = useState<CashflowTransaction[]>([])
  const [cashPositions, setCashPositions] = useState<CashPosition[]>([])
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [categories, setCategories] = useState<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [lookupsLoaded, setLookupsLoaded] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const isOwner = profile?.role === 'owner'

  const toastTimerRef = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    let message: string | null = null

    try {
      message = window.sessionStorage.getItem(CASHFLOW_TOAST_KEY)
      if (message) window.sessionStorage.removeItem(CASHFLOW_TOAST_KEY)
    } catch {
      message = null
    }

    if (message) toastTimerRef(message, 'success')
  }, [toastTimerRef])

  async function handleExport() {
    const { exportCashflowToExcel } = await import('@/lib/utils/export')
    const branchDisplayName = filterBranch
      ? (branches.find((b) => b.id === filterBranch)?.name ?? '')
      : ''
    await exportCashflowToExcel(transactions, {
      cashPositions,
      positionStartDate: startDate,
      positionEndDate: endDate,
      branchName: branchDisplayName,
    })
  }

  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterSplit, setFilterSplit] = useState('') // '' | 'split' | 'unsplit'

  const [modalOpen, setModalOpen] = useState(false)
  const [exportArusKasOpen, setExportArusKasOpen] = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitSourceTx, setSplitSourceTx] = useState<CashflowTransaction | null>(null)
  const [editTx, setEditTx] = useState<CashflowTransaction | null>(null)
  const [voidTarget, setVoidTarget] = useState<CashflowTransaction | null>(null)
  const [voidAutoSplitTarget, setVoidAutoSplitTarget] = useState<CashflowTransaction | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CashflowTransaction | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [formIdempotencyKey, setFormIdempotencyKey] = useState('')
  const canDeleteCashflow = useCallback((tx: CashflowTransaction) => (
    isOwner && tx.source === 'manual' && tx.status === 'void'
  ), [isOwner])

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CashflowFormData>({
    resolver: zodResolver(cashflowSchema),
  })

  const watchedType = watch('transaction_type')
  const watchedCategoryId = watch('category_id')
  const watchedAmount = watch('amount')

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const cacheKey = `cashflow:${startDate}:${endDate}:${filterBranch || 'all'}:${filterType || 'all'}:${filterCat || 'all'}:${filterSplit || 'all'}`
    const cached = getCachedData<CashflowTransaction[]>(cacheKey)

    if (cached && !options.force) {
      setTransactions(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const data = await getOrFetchCached<CashflowTransaction[]>(
      cacheKey,
      async () => {
        let query = supabase
          .from('cashflow_transactions')
          .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
          .gte('transaction_date', startDate)
          .lte('transaction_date', endDate)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (filterBranch) query = query.eq('branch_id', filterBranch)
        if (filterType) query = query.eq('transaction_type', filterType as CashflowType)
        if (filterCat) query = query.eq('category_id', filterCat)

        const { data } = await query
        const rows = data || []

        if (filterSplit === 'split') {
          return rows.filter((tx) => isActiveCourierExpense(tx) && isSplitTx(tx))
        }

        if (filterSplit === 'unsplit') {
          return rows.filter((tx) => isActiveCourierExpense(tx) && !isSplitTx(tx))
        }

        return rows
      },
      { ttlMs: 60_000, force: options.force || Boolean(cached) }
    )

    setTransactions(data)
    setLoading(false)
  }, [startDate, endDate, filterBranch, filterType, filterCat, filterSplit])

  useEffect(() => { load() }, [load])

  const loadCashPositions = useCallback(async (options: { force?: boolean } = {}) => {
    if (!lookupsLoaded) return

    const supabase = createClient()
    const cacheKey = `cash-positions:${startDate}:${endDate}:${filterBranch || 'all'}:${branches.map((branch) => branch.id).join(',')}`
    const cached = getCachedData<CashPosition[]>(cacheKey)

    if (cached && !options.force) {
      setCashPositions(cached)
    }

    const positions = await getOrFetchCached<CashPosition[]>(
      cacheKey,
      async () => {
        let query = supabase
          .from('cashflow_transactions')
          .select('branch_id,cash_in,cash_out,branch:branches(id,name)')
          .eq('status', 'active')
          .gte('transaction_date', startDate)
          .lte('transaction_date', endDate)

        if (filterBranch) query = query.eq('branch_id', filterBranch)

        const { data, error } = await query

        if (error) {
          toastTimerRef(`Gagal memuat posisi kas: ${error.message}`, 'error')
          return []
        }

        const rows = (data || []) as unknown as CashPositionRow[]
        const positions = new Map<string, Omit<CashPosition, 'balance'>>()
        const visibleBranches = filterBranch
          ? branches.filter((branch) => branch.id === filterBranch)
          : branches

        visibleBranches.forEach((branch) => {
          positions.set(branch.id, {
            branchId: branch.id,
            branchName: branch.name,
            cashIn: 0,
            cashOut: 0,
          })
        })

        rows.forEach((row) => {
          const branchId = row.branch_id
          const existing = positions.get(branchId) ?? {
            branchId,
            branchName: row.branch?.name || 'Cabang',
            cashIn: 0,
            cashOut: 0,
          }

          existing.cashIn += row.cash_in || 0
          existing.cashOut += row.cash_out || 0
          positions.set(branchId, existing)
        })

        return Array.from(positions.values())
          .map((position) => ({
            ...position,
            balance: position.cashIn - position.cashOut,
          }))
          .sort((a, b) => a.branchName.localeCompare(b.branchName))
      },
      { ttlMs: 60_000, force: options.force || Boolean(cached) }
    )

    setCashPositions(positions)
  }, [branches, endDate, filterBranch, lookupsLoaded, startDate, toastTimerRef])

  useEffect(() => { loadCashPositions() }, [loadCashPositions])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const [br, cat, { data: { session } }] = await Promise.all([
        getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
          'branches:active',
          async () => {
            const { data } = await supabase.from('branches').select('id,name').eq('is_active', true).is('deleted_at', null).order('name')
            return data || []
          },
          { ttlMs: 5 * 60_000 }
        ),
        getOrFetchCached<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>(
          'cashflow-categories:active',
          async () => {
            const { data } = await supabase.from('cashflow_categories').select('id,name,default_type').eq('is_active', true).is('deleted_at', null).order('name')
            return data || []
          },
          { ttlMs: 5 * 60_000 }
        ),
        supabase.auth.getSession(),
      ])
      setBranches(br)
      setCategories(cat)
      setLookupsLoaded(true)
      if (session?.user) {
        const prof = await getOrFetchCached<Profile | null>(
          `profile:${session.user.id}`,
          async () => {
            const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
            return data
          },
          { ttlMs: 5 * 60_000 }
        )
        setProfile(prof)
      }
    }
    init()
  }, [])

  function openAdd() {
    setEditTx(null)
    setFormIdempotencyKey(crypto.randomUUID())
    reset({
      transaction_date: toDateInputValue(),
      branch_id: '',
      transaction_type: 'cash_out',
      category_id: '',
      description: '',
      amount: 0,
    })
    setModalOpen(true)
  }

  function openSplitFromTx(tx: CashflowTransaction) {
    if (!canSplitCashflowTx(tx)) {
      toastTimerRef('Hanya Beban Kurir yang bisa dibagi ke cabang.', 'error')
      return
    }

    setSplitSourceTx(tx)
    setSplitModalOpen(true)
  }

  function openEdit(tx: CashflowTransaction) {
    setEditTx(tx)
    setFormIdempotencyKey(crypto.randomUUID())
    reset({
      transaction_date: tx.transaction_date,
      branch_id: tx.branch_id,
      transaction_type: tx.transaction_type,
      category_id: tx.category_id || '',
      description: tx.description || '',
      amount: tx.amount,
    })
    setModalOpen(true)
  }

  async function onSubmit(data: CashflowFormData) {
    setSaving(true)

    const payload = {
      transaction_date: data.transaction_date,
      branch_id: data.branch_id,
      transaction_type: data.transaction_type,
      category_id: data.category_id,
      description: data.description || '',
      amount: data.amount,
      idempotency_key: formIdempotencyKey || crypto.randomUUID(),
    }

    const endpoint = editTx
      ? `/api/cashflow/transactions/${editTx.id}`
      : '/api/cashflow/transactions'
    const method = editTx ? 'PATCH' : 'POST'

    let result: { success?: boolean; message?: string; mode?: string }

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        toastTimerRef(result.message || 'Gagal menyimpan transaksi.', 'error')
        setSaving(false)
        return
      }
    } catch {
      toastTimerRef('Gagal terhubung ke server.', 'error')
      setSaving(false)
      return
    }

    setSaving(false)
    setModalOpen(false)
    toastTimerRef(
      result.message || (editTx ? 'Transaksi berhasil diperbarui.' : 'Transaksi berhasil ditambahkan.'),
      'success'
    )
    invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
    load({ force: true })
    loadCashPositions({ force: true })
  }

  async function handleVoid() {
    if (!voidTarget) return
    setSaving(true)

    try {
      const response = await fetch(`/api/cashflow/transactions/${voidTarget.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: null }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        toastTimerRef(result.message || 'Gagal void transaksi.', 'error')
        setSaving(false)
        setVoidTarget(null)
        return
      }
    } catch {
      toastTimerRef('Gagal terhubung ke server.', 'error')
      setSaving(false)
      setVoidTarget(null)
      return
    }

    setSaving(false)
    setVoidTarget(null)
    toastTimerRef('Transaksi berhasil divoid.', 'success')
    invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
    load({ force: true })
    loadCashPositions({ force: true })
  }

  async function handleVoidAutoSplitGroup() {
    if (!voidAutoSplitTarget?.auto_split_group_id) return
    setSaving(true)

    try {
      const response = await fetch(`/api/cashflow/auto-split-groups/${voidAutoSplitTarget.auto_split_group_id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Dibatalkan dari halaman cashflow.' }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        toastTimerRef(result.message || 'Gagal membatalkan auto split.', 'error')
        setSaving(false)
        setVoidAutoSplitTarget(null)
        return
      }

      toastTimerRef(result.message || 'Auto split Kurir bawa Bahan berhasil dibatalkan.', 'success')
    } catch {
      toastTimerRef('Gagal terhubung ke server.', 'error')
      setSaving(false)
      setVoidAutoSplitTarget(null)
      return
    }

    setSaving(false)
    setVoidAutoSplitTarget(null)
    invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
    load({ force: true })
    loadCashPositions({ force: true })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    if (!isOwner) {
      toastTimerRef('Hanya owner yang dapat menghapus transaksi permanen.', 'error')
      setDeleteTarget(null)
      setDeleteReason('')
      return
    }
    if (deleteTarget.source !== 'manual' || deleteTarget.status !== 'void') {
      toastTimerRef('Hanya transaksi manual yang sudah void dapat dihapus dari halaman cashflow.', 'error')
      setDeleteTarget(null)
      setDeleteReason('')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    const now = new Date().toISOString()

    const { error: auditError } = await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: deleteTarget.id,
      action: 'cashflow_deleted',
      old_data: deleteTarget as unknown as Record<string, unknown>,
      new_data: { delete_reason: deleteReason || null } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: now,
    })

    if (auditError) {
      toastTimerRef(`Gagal mencatat audit log: ${auditError.message}`, 'error')
      setSaving(false)
      return
    }

    const { error: deleteError } = await supabase
      .from('cashflow_transactions')
      .delete()
      .eq('id', deleteTarget.id)

    if (deleteError) {
      toastTimerRef(`Gagal menghapus transaksi: ${deleteError.message}`, 'error')
      setSaving(false)
      return
    }

    setSaving(false)
    setDeleteTarget(null)
    setDeleteReason('')
    toastTimerRef('Transaksi void berhasil dihapus permanen.', 'success')
    invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
    load({ force: true })
    loadCashPositions({ force: true })
  }

  const activeTx = transactions.filter((t) => t.status === 'active')
  const totalCashIn = activeTx.filter((t) => t.transaction_type === 'cash_in').reduce((a, t) => a + t.amount, 0)
  const totalCashOut = activeTx.filter((t) => t.transaction_type === 'cash_out').reduce((a, t) => a + t.amount, 0)
  const nett = totalCashIn - totalCashOut

  const filteredCats = categories.filter((c) =>
    !watchedType || c.default_type === watchedType || c.default_type === 'both'
  )
  const selectedCategory = categories.find((c) => c.id === watchedCategoryId)
  const isAutoSplitForm = watchedType === 'cash_out' && isKurirBawaBahanCategory(selectedCategory?.name)
  const autoSplitAmount = Number(watchedAmount || 0)
  const autoSplitAllocations = useMemo(
    () => isAutoSplitForm ? distributeAutoSplitAmount(autoSplitAmount, branches) : [],
    [autoSplitAmount, branches, isAutoSplitForm]
  )
  const autoSplitPreviewError = isAutoSplitForm
    ? getAutoSplitPreviewError(autoSplitAmount, branches.length)
    : null
  const autoSplitRemainderCount = isAutoSplitForm && branches.length > 0
    ? autoSplitAmount - Math.floor(autoSplitAmount / branches.length) * branches.length
    : 0

  return (
    <div className="space-y-4">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cashflow</h2>
          <p className="text-sm text-gray-500">{transactions.length} transaksi</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href="/cashflow/import"
            prefetch
            className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto"
          >
            <Upload className="w-4 h-4" />
            <span>Import</span>
          </Link>
          <button
            onClick={handleExport}
            className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setExportArusKasOpen(true)}
            className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto text-emerald-700 border-emerald-200 hover:bg-emerald-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Arus Kas</span>
          </button>
          <button
            onClick={() => { setSplitSourceTx(null); setSplitModalOpen(true) }}
            className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto text-orange-600 border-orange-200 hover:bg-orange-50"
          >
            <Scissors className="w-4 h-4" />
            Bagi Kurir
          </button>
          <button onClick={openAdd} className="btn-primary flex w-full items-center gap-2 sm:w-auto">
            <Plus className="w-4 h-4" /> Tambah Transaksi
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
          <SelectFilter value={filterBranch} onChange={setFilterBranch} placeholder="Semua Cabang" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <SelectFilter value={filterType} onChange={setFilterType} placeholder="Semua Tipe" options={[{ value: 'cash_in', label: 'Cash In' }, { value: 'cash_out', label: 'Cash Out' }]} />
          <SelectFilter value={filterCat} onChange={setFilterCat} placeholder="Semua Kategori" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          <SelectFilter value={filterSplit} onChange={setFilterSplit} placeholder="Pembagian Kurir" options={[{ value: 'split', label: 'Kurir Sudah Dibagi' }, { value: 'unsplit', label: 'Kurir Belum Dibagi' }]} />
          <button onClick={() => { load({ force: true }); loadCashPositions({ force: true }) }} className="btn-outline flex w-full items-center gap-1.5 text-sm sm:w-auto">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-3 text-center border-l-4 border-emerald-500">
          <p className="text-xs text-gray-500 mb-0.5">Total Cash In</p>
          <p className="text-base font-bold text-emerald-600 text-rupiah">{formatRupiah(totalCashIn)}</p>
        </div>
        <div className="card p-3 text-center border-l-4 border-red-500">
          <p className="text-xs text-gray-500 mb-0.5">Total Cash Out</p>
          <p className="text-base font-bold text-red-600 text-rupiah">{formatRupiah(totalCashOut)}</p>
        </div>
        <div className={`card p-3 text-center border-l-4 ${nett >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
          <p className="text-xs text-gray-500 mb-0.5">Nett Cashflow</p>
          <p className={`text-base font-bold text-rupiah ${nett >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>{formatRupiah(nett)}</p>
        </div>
      </div>

      {/* Cash Position */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Posisi Kas Periode</h3>
            <p className="text-xs text-slate-500">Posisi {formatDate(startDate)} - {formatDate(endDate)} berdasarkan cashflow aktif.</p>
          </div>
          <span className="text-xs font-medium text-slate-500">{cashPositions.length} cabang</span>
        </div>

        {cashPositions.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">Belum ada cabang aktif untuk filter ini.</div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full table-fixed">
                <thead>
                  <tr>
                    <th className="table-header">Cabang</th>
                    <th className="table-header text-right">Cash In</th>
                    <th className="table-header text-right">Cash Out</th>
                    <th className="table-header text-right">Posisi Kas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cashPositions.map((position) => (
                    <tr key={position.branchId}>
                      <td className="table-cell font-medium"><div className="truncate">{position.branchName}</div></td>
                      <td className="table-cell text-right font-medium text-emerald-600 text-rupiah"><div className="truncate">{formatRupiah(position.cashIn)}</div></td>
                      <td className="table-cell text-right font-medium text-red-600 text-rupiah"><div className="truncate">{formatRupiah(position.cashOut)}</div></td>
                      <td className={`table-cell text-right font-bold text-rupiah ${position.balance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                        <div className="truncate">{formatRupiah(position.balance)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 md:hidden">
              {cashPositions.map((position) => (
                <article key={position.branchId} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <p className="truncate text-sm font-semibold text-slate-900">{position.branchName}</p>
                  <p className={`mt-2 break-words text-xl font-bold text-rupiah ${position.balance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {formatRupiah(position.balance)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">Cash In</p>
                      <p className="break-words font-semibold text-emerald-600 text-rupiah">{formatRupiah(position.cashIn)}</p>
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="text-xs text-slate-500">Cash Out</p>
                      <p className="break-words font-semibold text-red-600 text-rupiah">{formatRupiah(position.cashOut)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? <PageLoading /> : transactions.length === 0 ? (
          <EmptyState title="Tidak ada transaksi" description="Belum ada transaksi cashflow." />
        ) : (
          <>
          <div className="hidden md:block">
            <table className="w-full table-fixed">
              <thead>
                <tr>
                  <th className="table-header w-[11%]">Tanggal</th>
                  <th className="table-header w-[14%]">Cabang</th>
                  <th className="table-header w-[10%]">Tipe</th>
                  <th className="table-header">Kategori</th>
                  <th className="table-header text-right">Nominal</th>
                  <th className="table-header w-[10%]">Sumber</th>
                  <th className="table-header w-[10%]">Status</th>
                  <th className="table-header w-[15%] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((tx) => (
                  <tr key={tx.id} className={`hover:bg-gray-50 transition-colors ${tx.status === 'void' ? 'opacity-50' : ''}`}>
                    <td className="table-cell font-medium">{formatDate(tx.transaction_date, 'dd/MM/yy')}</td>
                    <td className="table-cell"><div className="truncate">{tx.branch?.name || '-'}</div></td>
                    <td className="table-cell"><CashflowTypeBadge type={tx.transaction_type} /></td>
                    <td className="table-cell">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{tx.category?.name || '-'}</p>
                        {tx.description && <p className="truncate text-xs text-gray-500">{tx.description}</p>}
                        <div className="mt-1"><SplitStatusBadge tx={tx} /></div>
                      </div>
                    </td>
                    <td className={`table-cell text-right font-bold text-rupiah ${tx.transaction_type === 'cash_in' ? 'text-emerald-600' : 'text-red-600'}`}>
                      <div className="truncate">{getNominalLabel(tx)}</div>
                    </td>
                    <td className="table-cell">
                      <CashflowSourceLabel tx={tx} />
                    </td>
                    <td className="table-cell"><CashflowStatusBadge status={tx.status} /></td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        {canManageCashflowTx(tx) && (
                          <>
                            <button onClick={() => openEdit(tx)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {canSplitCashflowTx(tx) && (
                              <button onClick={() => openSplitFromTx(tx)} className="p-1.5 rounded-lg hover:bg-orange-50 text-gray-400 hover:text-orange-600" title="Bagi beban kurir ke cabang">
                                <Scissors className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => setVoidTarget(tx)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Void">
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {tx.status === 'active' && isAutoSplitKurirChild(tx) && tx.auto_split_group_id && (
                          <button
                            onClick={() => setVoidAutoSplitTarget(tx)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
                            title="Void auto split"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDeleteCashflow(tx) && (
                          <button
                            onClick={() => { setDeleteTarget(tx); setDeleteReason('') }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title="Hapus Transaksi Void"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {tx.source === 'manual' && tx.status === 'void' && !canDeleteCashflow(tx) && (
                          <span className="text-xs text-gray-400 px-2">Void</span>
                        )}
                        {tx.source === 'sales' && (
                          <span className="text-xs text-gray-400 px-2">{tx.status === 'void' ? 'Hapus lewat Sales' : 'Dari Sales'}</span>
                        )}
                        {tx.source === 'purchase_order' && (
                          <span className="text-xs text-gray-400 px-2">Dari Import</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-3 md:hidden">
            {transactions.map((tx) => (
              <article key={tx.id} className={`rounded-xl border border-slate-100 bg-white p-3 shadow-sm ${tx.status === 'void' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{formatDate(tx.transaction_date, 'dd MMM yyyy')}</p>
                    <p className="truncate text-xs text-slate-500">{tx.branch?.name || '-'}</p>
                  </div>
                  <CashflowStatusBadge status={tx.status} />
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CashflowTypeBadge type={tx.transaction_type} />
                      <p className="mt-2 truncate text-sm font-semibold text-slate-900">{tx.category?.name || '-'}</p>
                      {tx.description && <p className="mt-0.5 truncate text-xs text-slate-500">{tx.description}</p>}
                      <div className="mt-1.5"><SplitStatusBadge tx={tx} /></div>
                    </div>
                    <p className={`max-w-[48%] break-words text-right text-base font-bold text-rupiah ${tx.transaction_type === 'cash_in' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {getNominalLabel(tx)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <CashflowSourceLabel tx={tx} />

                  <div className="flex flex-wrap justify-end gap-2">
                    {canManageCashflowTx(tx) && (
                      <>
                        <button
                          onClick={() => openEdit(tx)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {canSplitCashflowTx(tx) && (
                          <button
                            onClick={() => openSplitFromTx(tx)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
                            title="Bagi beban kurir ke cabang"
                          >
                            <Scissors className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setVoidTarget(tx)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="Void"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {tx.status === 'active' && isAutoSplitKurirChild(tx) && tx.auto_split_group_id && (
                      <button
                        onClick={() => setVoidAutoSplitTarget(tx)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Void auto split"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {canDeleteCashflow(tx) && (
                      <button
                        onClick={() => { setDeleteTarget(tx); setDeleteReason('') }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Hapus Transaksi Void"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editTx ? 'Edit Transaksi' : 'Tambah Transaksi Cashflow'} size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
              <input type="date" {...register('transaction_date')} className="input-field" />
              {errors.transaction_date && <p className="text-xs text-red-500 mt-1">{errors.transaction_date.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipe <span className="text-red-500">*</span></label>
              <select {...register('transaction_type')} className="input-field">
                <option value="cash_in">Cash In</option>
                <option value="cash_out">Cash Out</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isAutoSplitForm ? 'Cabang pencatat' : 'Cabang'} <span className="text-red-500">*</span>
            </label>
            <select {...register('branch_id')} className="input-field">
              <option value="">Pilih cabang...</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {errors.branch_id && <p className="text-xs text-red-500 mt-1">{errors.branch_id.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kategori <span className="text-red-500">*</span></label>
            <select {...register('category_id')} className="input-field">
              <option value="">Pilih kategori...</option>
              {filteredCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.category_id && <p className="text-xs text-red-500 mt-1">{errors.category_id.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nominal (Rp) <span className="text-red-500">*</span></label>
            <input type="number" step="1" min="1" {...register('amount')} className="input-field" placeholder="0" />
            {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deskripsi</label>
            <textarea {...register('description')} className="input-field resize-none" rows={2} placeholder="Keterangan transaksi..." />
          </div>
          {isAutoSplitForm && (
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-sky-900">Auto split Kurir bawa Bahan</p>
                  <p className="mt-0.5 text-xs text-sky-700">
                    Pengeluaran dengan kategori Kurir bawa Bahan akan otomatis dibagi rata ke semua outlet aktif.
                  </p>
                </div>
              </div>

              {autoSplitPreviewError ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-white px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{autoSplitPreviewError}</span>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-slate-500">Outlet aktif</p>
                      <p className="mt-0.5 font-semibold text-slate-900">{branches.length}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-slate-500">Total</p>
                      <p className="mt-0.5 break-words font-semibold text-slate-900 text-rupiah">{formatRupiah(autoSplitAmount)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 col-span-2 sm:col-span-1">
                      <p className="text-slate-500">Pembulatan</p>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {autoSplitRemainderCount > 0 ? `${autoSplitRemainderCount} outlet +Rp1` : 'Tidak ada'}
                      </p>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-sky-100 bg-white">
                    {autoSplitAllocations.map((allocation) => (
                      <div key={allocation.branch_id} className="flex items-center justify-between gap-3 border-b border-slate-50 px-3 py-2 last:border-b-0">
                        <span className="min-w-0 truncate text-sm text-slate-700">{allocation.branch_name}</span>
                        <span className="flex-shrink-0 text-sm font-semibold text-slate-900 text-rupiah">{formatRupiah(allocation.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving || Boolean(autoSplitPreviewError)} className="btn-primary text-sm">
              {saving ? 'Menyimpan...' : editTx ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={handleVoid}
        loading={saving}
        title="Void Transaksi"
        description={`Yakin ingin void transaksi "${voidTarget?.description || voidTarget?.category?.name}"? Transaksi tidak akan dihitung dalam laporan.`}
        confirmLabel="Void"
        confirmClass="bg-rbn-red hover:bg-rbn-red-dark text-white"
      />

      <ConfirmModal
        isOpen={!!voidAutoSplitTarget}
        onClose={() => setVoidAutoSplitTarget(null)}
        onConfirm={handleVoidAutoSplitGroup}
        loading={saving}
        title="Void Auto Split"
        description={`Yakin ingin void auto split "${voidAutoSplitTarget?.description || voidAutoSplitTarget?.category?.name}"? Semua pembagian outlet dalam grup ini akan dibatalkan.`}
        confirmLabel="Void Auto Split"
        confirmClass="bg-rbn-red hover:bg-rbn-red-dark text-white"
      />

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteReason('') }}
        onConfirm={handleDelete}
        loading={saving}
        title="Hapus Permanen Transaksi Void"
        description={`Yakin ingin menghapus permanen transaksi manual void "${deleteTarget?.description || deleteTarget?.category?.name}"? Data akan hilang dari cashflow operasional.`}
        confirmLabel="Hapus Permanen"
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
        showReason
        reason={deleteReason}
        onReasonChange={setDeleteReason}
      />

      {/* Export Arus Kas Modal */}
      {exportArusKasOpen && (
        <ExportArusKasModal
          branches={branches}
          onClose={() => setExportArusKasOpen(false)}
        />
      )}

      {/* Split Expense Modal */}
      {splitModalOpen && (
        <SplitExpenseModal
          branches={branches}
          categories={categories}
          onClose={() => { setSplitModalOpen(false); setSplitSourceTx(null) }}
          onSuccess={async () => {
            // Void transaksi asal jika split dari transaksi existing
            if (splitSourceTx) {
              const supabase = createClient()
              const { data: { session } } = await supabase.auth.getSession()
              await supabase
                .from('cashflow_transactions')
                .update({ status: 'void' as const, updated_by: session?.user?.id ?? null })
                .eq('id', splitSourceTx.id)
              await supabase.from('audit_logs').insert({
                table_name: 'cashflow_transactions',
                record_id: splitSourceTx.id,
                action: 'cashflow_voided',
                old_data: { status: splitSourceTx.status } as Record<string, unknown>,
                new_data: { status: 'void', reason: 'split_to_branches' } as Record<string, unknown>,
                changed_by: session?.user?.id ?? null,
                changed_at: new Date().toISOString(),
              })
            }
            invalidateCachedData(/^(cashflow:|cash-positions:|cashflow-analysis:|sales-analysis:|dashboard:)/)
            load({ force: true })
            loadCashPositions({ force: true })
            toastTimerRef(
              splitSourceTx
                ? 'Transaksi berhasil dibagi ke cabang-cabang. Transaksi asal divoid.'
                : 'Biaya bersama berhasil disimpan.',
              'success'
            )
            setSplitSourceTx(null)
          }}
          initialValues={splitSourceTx ? {
            date: splitSourceTx.transaction_date,
            description: splitSourceTx.description || '',
            category_id: splitSourceTx.category_id || undefined,
            total: splitSourceTx.amount,
          } : undefined}
          title={splitSourceTx
            ? `Bagi: ${splitSourceTx.description || splitSourceTx.category?.name || 'Transaksi'}`
            : undefined}
        />
      )}
    </div>
  )
}
