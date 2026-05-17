'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, XCircle, FileSpreadsheet, RefreshCw, Info, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { CashflowTransaction, CashflowType, Branch, CashflowCategory, Profile } from '@/types/database'
import { formatDate, formatRupiah, toDateInputValue } from '@/lib/utils/format'
import { exportCashflowToExcel } from '@/lib/utils/export'
import { cashflowSchema, type CashflowFormData } from '@/lib/validations/cashflow'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { CashflowTypeBadge, CashflowStatusBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { format, startOfMonth, endOfMonth } from 'date-fns'

export default function CashflowPage() {
  const [transactions, setTransactions] = useState<CashflowTransaction[]>([])
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [categories, setCategories] = useState<Pick<CashflowCategory, 'id' | 'name' | 'default_type'>[]>([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editTx, setEditTx] = useState<CashflowTransaction | null>(null)
  const [voidTarget, setVoidTarget] = useState<CashflowTransaction | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CashflowTransaction | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CashflowFormData>({
    resolver: zodResolver(cashflowSchema),
  })

  const watchedType = watch('transaction_type')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
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
    setTransactions(data || [])
    setLoading(false)
  }, [startDate, endDate, filterBranch, filterType, filterCat])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const [{ data: br }, { data: cat }, { data: { user } }] = await Promise.all([
        supabase.from('branches').select('id,name').eq('is_active', true).is('deleted_at', null).order('name'),
        supabase.from('cashflow_categories').select('id,name,default_type').eq('is_active', true).is('deleted_at', null).order('name'),
        supabase.auth.getUser(),
      ])
      setBranches(br || [])
      setCategories(cat || [])
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        setProfile(prof)
      }
    }
    init()
  }, [])

  function openAdd() {
    setEditTx(null)
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

  function openEdit(tx: CashflowTransaction) {
    setEditTx(tx)
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
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const isCashIn = data.transaction_type === 'cash_in'
    const payload = {
      transaction_date: data.transaction_date,
      branch_id: data.branch_id,
      transaction_type: data.transaction_type,
      category_id: data.category_id,
      description: data.description || '',
      cash_in: isCashIn ? data.amount : 0,
      cash_out: isCashIn ? 0 : data.amount,
      amount: data.amount,
      source: 'manual' as const,
      updated_by: user?.id ?? null,
    }

    if (editTx) {
      await supabase.from('cashflow_transactions').update(payload).eq('id', editTx.id)
      await supabase.from('audit_logs').insert({
        table_name: 'cashflow_transactions',
        record_id: editTx.id,
        action: 'cashflow_updated',
        old_data: editTx as unknown as Record<string, unknown>,
        new_data: payload as unknown as Record<string, unknown>,
        changed_by: user?.id ?? null,
        changed_at: new Date().toISOString(),
      })
    } else {
      const { data: newTx } = await supabase
        .from('cashflow_transactions')
        .insert({ ...payload, status: 'active', created_by: user?.id ?? null })
        .select()
        .single()
      if (newTx) {
        await supabase.from('audit_logs').insert({
          table_name: 'cashflow_transactions',
          record_id: newTx.id,
          action: 'cashflow_created',
          old_data: null,
          new_data: newTx as unknown as Record<string, unknown>,
          changed_by: user?.id ?? null,
          changed_at: new Date().toISOString(),
        })
      }
    }

    setSaving(false)
    setModalOpen(false)
    load()
  }

  async function handleVoid() {
    if (!voidTarget) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('cashflow_transactions').update({ status: 'void' as const, updated_by: user?.id ?? null }).eq('id', voidTarget.id)
    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: voidTarget.id,
      action: 'cashflow_voided',
      old_data: { status: voidTarget.status } as Record<string, unknown>,
      new_data: { status: 'void' } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: new Date().toISOString(),
    })
    setSaving(false)
    setVoidTarget(null)
    load()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const now = new Date().toISOString()

    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: deleteTarget.id,
      action: 'cashflow_deleted',
      old_data: deleteTarget as unknown as Record<string, unknown>,
      new_data: { delete_reason: deleteReason || null } as Record<string, unknown>,
      changed_by: user?.id ?? null,
      changed_at: now,
    })

    await supabase.from('cashflow_transactions').delete().eq('id', deleteTarget.id)

    setSaving(false)
    setDeleteTarget(null)
    setDeleteReason('')
    load()
  }

  const activeTx = transactions.filter((t) => t.status === 'active')
  const totalCashIn = activeTx.filter((t) => t.transaction_type === 'cash_in').reduce((a, t) => a + t.amount, 0)
  const totalCashOut = activeTx.filter((t) => t.transaction_type === 'cash_out').reduce((a, t) => a + t.amount, 0)
  const nett = totalCashIn - totalCashOut

  const filteredCats = categories.filter((c) =>
    !watchedType || c.default_type === watchedType || c.default_type === 'both'
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cashflow</h2>
          <p className="text-sm text-gray-500">{transactions.length} transaksi</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCashflowToExcel(transactions)} className="btn-outline flex items-center gap-1.5 text-sm">
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
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
          <button onClick={load} className="btn-outline flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
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

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? <PageLoading /> : transactions.length === 0 ? (
          <EmptyState title="Tidak ada transaksi" description="Belum ada transaksi cashflow." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Tanggal</th>
                  <th className="table-header">Cabang</th>
                  <th className="table-header">Tipe</th>
                  <th className="table-header">Kategori</th>
                  <th className="table-header">Deskripsi</th>
                  <th className="table-header text-right">Cash In</th>
                  <th className="table-header text-right">Cash Out</th>
                  <th className="table-header">Sumber</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((tx) => (
                  <tr key={tx.id} className={`hover:bg-gray-50 transition-colors ${tx.status === 'void' ? 'opacity-50' : ''}`}>
                    <td className="table-cell font-medium">{formatDate(tx.transaction_date, 'dd/MM/yy')}</td>
                    <td className="table-cell">{tx.branch?.name || '—'}</td>
                    <td className="table-cell"><CashflowTypeBadge type={tx.transaction_type} /></td>
                    <td className="table-cell">{tx.category?.name || '—'}</td>
                    <td className="table-cell text-gray-500 max-w-xs truncate">{tx.description || '—'}</td>
                    <td className="table-cell text-right text-emerald-600 font-medium text-rupiah">
                      {tx.cash_in > 0 ? formatRupiah(tx.cash_in) : '—'}
                    </td>
                    <td className="table-cell text-right text-red-600 font-medium text-rupiah">
                      {tx.cash_out > 0 ? formatRupiah(tx.cash_out) : '—'}
                    </td>
                    <td className="table-cell">
                      {tx.source === 'sales' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          <Info className="w-3 h-3" /> Auto
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Manual</span>
                      )}
                    </td>
                    <td className="table-cell"><CashflowStatusBadge status={tx.status} /></td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        {tx.source === 'manual' && (
                          <>
                            {tx.status === 'active' && (
                              <>
                                <button onClick={() => openEdit(tx)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setVoidTarget(tx)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Void">
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => { setDeleteTarget(tx); setDeleteReason('') }}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {tx.source === 'sales' && (
                          <span className="text-xs text-gray-400 px-2">Dari Sales</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editTx ? 'Edit Transaksi' : 'Tambah Transaksi Cashflow'} size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Cabang <span className="text-red-500">*</span></label>
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
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
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
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteReason('') }}
        onConfirm={handleDelete}
        loading={saving}
        title="Hapus Transaksi"
        description={`Yakin ingin menghapus transaksi "${deleteTarget?.description || deleteTarget?.category?.name}"? Data akan dihapus permanen dari sistem.`}
        confirmLabel="Hapus Permanen"
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
        showReason
        reason={deleteReason}
        onReasonChange={setDeleteReason}
      />
    </div>
  )
}
