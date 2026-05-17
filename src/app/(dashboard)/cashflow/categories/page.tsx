'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { CashflowCategory, Profile } from '@/types/database'
import { categorySchema, type CategoryFormData } from '@/lib/validations/cashflow'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { ActiveBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectFilter } from '@/components/ui/FilterBar'

const defaultTypeLabels: Record<string, string> = {
  cash_in: 'Cash In',
  cash_out: 'Cash Out',
  both: 'Keduanya',
}

const defaultTypeColors: Record<string, string> = {
  cash_in: 'bg-emerald-100 text-emerald-700',
  cash_out: 'bg-red-100 text-red-700',
  both: 'bg-blue-100 text-blue-700',
}

export default function CashflowCategoriesPage() {
  const [categories, setCategories] = useState<CashflowCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<CashflowCategory | null>(null)
  const [toggleTarget, setToggleTarget] = useState<CashflowCategory | null>(null)
  const [saving, setSaving] = useState(false)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
  })

  const load = useCallback(async () => {
    const supabase = createClient()
    let query = supabase.from('cashflow_categories').select('*').order('default_type').order('name')
    if (filterType) query = query.eq('default_type', filterType)
    if (filterActive !== '') query = query.eq('is_active', filterActive === 'true')
    const { data } = await query
    setCategories(data || [])
    setLoading(false)
  }, [filterType, filterActive])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        setCurrentProfile(data)
      }
    }
    loadProfile()
  }, [])

  function openAdd() {
    setEditCategory(null)
    reset({ name: '', default_type: 'cash_out', description: '' })
    setModalOpen(true)
  }

  function openEdit(cat: CashflowCategory) {
    setEditCategory(cat)
    reset({ name: cat.name, default_type: cat.default_type, description: cat.description || '' })
    setModalOpen(true)
  }

  async function onSubmit(data: CategoryFormData) {
    setSaving(true)
    const supabase = createClient()

    if (editCategory) {
      await supabase.from('cashflow_categories').update(data).eq('id', editCategory.id)
      await supabase.from('audit_logs').insert({
        table_name: 'cashflow_categories',
        record_id: editCategory.id,
        action: 'category_updated',
        old_data: editCategory as unknown as Record<string, unknown>,
        new_data: data as unknown as Record<string, unknown>,
        changed_by: currentProfile?.id ?? null,
        changed_at: new Date().toISOString(),
      })
    } else {
      const { data: newCat } = await supabase.from('cashflow_categories').insert(data).select().single()
      if (newCat) {
        await supabase.from('audit_logs').insert({
          table_name: 'cashflow_categories',
          record_id: newCat.id,
          action: 'category_created',
          old_data: null,
          new_data: newCat as unknown as Record<string, unknown>,
          changed_by: currentProfile?.id ?? null,
          changed_at: new Date().toISOString(),
        })
      }
    }

    setSaving(false)
    setModalOpen(false)
    load()
  }

  async function handleToggle() {
    if (!toggleTarget) return
    setSaving(true)
    const supabase = createClient()
    const newStatus = !toggleTarget.is_active
    await supabase.from('cashflow_categories').update({ is_active: newStatus }).eq('id', toggleTarget.id)
    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_categories',
      record_id: toggleTarget.id,
      action: newStatus ? 'category_activated' : 'category_deactivated',
      old_data: { is_active: toggleTarget.is_active } as Record<string, unknown>,
      new_data: { is_active: newStatus } as Record<string, unknown>,
      changed_by: currentProfile?.id ?? null,
      changed_at: new Date().toISOString(),
    })
    setSaving(false)
    setToggleTarget(null)
    load()
  }

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Kategori Cashflow</h2>
          <p className="text-sm text-gray-500">{categories.length} kategori</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" /> Tambah Kategori
        </button>
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        <SelectFilter
          value={filterType}
          onChange={setFilterType}
          placeholder="Semua Tipe"
          options={[
            { value: 'cash_in', label: 'Cash In' },
            { value: 'cash_out', label: 'Cash Out' },
            { value: 'both', label: 'Keduanya' },
          ]}
        />
        <SelectFilter
          value={filterActive}
          onChange={setFilterActive}
          placeholder="Semua Status"
          options={[
            { value: 'true', label: 'Aktif' },
            { value: 'false', label: 'Nonaktif' },
          ]}
        />
      </div>

      <div className="card overflow-hidden">
        {categories.length === 0 ? (
          <EmptyState title="Belum ada kategori" description="Tambahkan kategori cashflow." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Nama Kategori</th>
                  <th className="table-header">Tipe Default</th>
                  <th className="table-header">Deskripsi</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium">{cat.name}</td>
                    <td className="table-cell">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${defaultTypeColors[cat.default_type]}`}>
                        {defaultTypeLabels[cat.default_type]}
                      </span>
                    </td>
                    <td className="table-cell text-gray-500">{cat.description || '—'}</td>
                    <td className="table-cell">
                      <ActiveBadge isActive={cat.is_active} />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(cat)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setToggleTarget(cat)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            cat.is_active
                              ? 'hover:bg-red-50 text-green-500 hover:text-red-600'
                              : 'hover:bg-green-50 text-gray-400 hover:text-green-600'
                          }`}
                        >
                          {cat.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editCategory ? 'Edit Kategori' : 'Tambah Kategori'} size="sm">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Kategori <span className="text-red-500">*</span></label>
            <input {...register('name')} className="input-field" placeholder="Nama kategori" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipe Default <span className="text-red-500">*</span></label>
            <select {...register('default_type')} className="input-field">
              <option value="cash_in">Cash In</option>
              <option value="cash_out">Cash Out</option>
              <option value="both">Keduanya</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deskripsi</label>
            <textarea {...register('description')} className="input-field resize-none" rows={2} placeholder="Deskripsi (opsional)" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? 'Menyimpan...' : editCategory ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleToggle}
        loading={saving}
        title={toggleTarget?.is_active ? 'Nonaktifkan Kategori' : 'Aktifkan Kategori'}
        description={`Yakin ingin ${toggleTarget?.is_active ? 'menonaktifkan' : 'mengaktifkan'} kategori "${toggleTarget?.name}"?`}
        confirmLabel={toggleTarget?.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        confirmClass={toggleTarget?.is_active ? 'bg-rbn-red hover:bg-rbn-red-dark text-white' : 'bg-green-600 hover:bg-green-700 text-white'}
      />
    </div>
  )
}
