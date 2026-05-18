'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, ToggleLeft, ToggleRight, Building2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, Profile } from '@/types/database'
import { formatDateTime } from '@/lib/utils/format'
import { branchSchema, type BranchFormData } from '@/lib/validations/branch'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { ActiveBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectFilter } from '@/components/ui/FilterBar'
import { getCachedData, getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [filterActive, setFilterActive] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editBranch, setEditBranch] = useState<Branch | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Branch | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BranchFormData>({
    resolver: zodResolver(branchSchema),
  })

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const cacheKey = `branches:${filterActive || 'all'}`
    const cached = getCachedData<Branch[]>(cacheKey)

    if (cached && !options.force) {
      setBranches(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const data = await getOrFetchCached<Branch[]>(
      cacheKey,
      async () => {
        let query = supabase.from('branches').select('*').is('deleted_at', null).order('name')
        if (filterActive !== '') {
          query = query.eq('is_active', filterActive === 'true')
        }
        const { data } = await query
        return data || []
      },
      { ttlMs: 5 * 60_000, force: options.force || Boolean(cached) }
    )

    setBranches(data)
    setLoading(false)
  }, [filterActive])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const data = await getOrFetchCached<Profile | null>(
          `profile:${session.user.id}`,
          async () => {
            const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
            return data
          },
          { ttlMs: 5 * 60_000 }
        )
        setCurrentProfile(data)
      }
    }
    loadProfile()
  }, [])

  function openAdd() {
    setEditBranch(null)
    reset({ name: '', address: '' })
    setModalOpen(true)
  }

  function openEdit(branch: Branch) {
    setEditBranch(branch)
    reset({ name: branch.name, address: branch.address || '' })
    setModalOpen(true)
  }

  async function onSubmit(data: BranchFormData) {
    setSaving(true)
    const supabase = createClient()

    if (editBranch) {
      await supabase.from('branches').update(data).eq('id', editBranch.id)
      // Audit log
      await supabase.from('audit_logs').insert({
        table_name: 'branches',
        record_id: editBranch.id,
        action: 'branch_updated',
        old_data: editBranch as unknown as Record<string, unknown>,
        new_data: data as unknown as Record<string, unknown>,
        changed_by: currentProfile?.id ?? null,
        changed_at: new Date().toISOString(),
      })
    } else {
      const { data: newBranch } = await supabase.from('branches').insert(data).select().single()
      if (newBranch) {
        await supabase.from('audit_logs').insert({
          table_name: 'branches',
          record_id: newBranch.id,
          action: 'branch_created',
          old_data: null,
          new_data: newBranch as unknown as Record<string, unknown>,
          changed_by: currentProfile?.id ?? null,
          changed_at: new Date().toISOString(),
        })
      }
    }

    setSaving(false)
    setModalOpen(false)
    invalidateCachedData(/^(branches:|branches:active|branches:active-full)/)
    load({ force: true })
  }

  async function handleToggle() {
    if (!toggleTarget) return
    setSaving(true)
    const supabase = createClient()
    const newStatus = !toggleTarget.is_active
    await supabase.from('branches').update({ is_active: newStatus }).eq('id', toggleTarget.id)
    await supabase.from('audit_logs').insert({
      table_name: 'branches',
      record_id: toggleTarget.id,
      action: newStatus ? 'branch_activated' : 'branch_deactivated',
      old_data: { is_active: toggleTarget.is_active } as Record<string, unknown>,
      new_data: { is_active: newStatus } as Record<string, unknown>,
      changed_by: currentProfile?.id ?? null,
      changed_at: new Date().toISOString(),
    })
    setSaving(false)
    setToggleTarget(null)
    invalidateCachedData(/^(branches:|branches:active|branches:active-full)/)
    load({ force: true })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    const supabase = createClient()
    const now = new Date().toISOString()

    // Try hard delete first; fall back to soft delete on FK constraint violation
    const { error } = await supabase.from('branches').delete().eq('id', deleteTarget.id)
    if (error) {
      await supabase.from('branches').update({ deleted_at: now }).eq('id', deleteTarget.id)
    }

    await supabase.from('audit_logs').insert({
      table_name: 'branches',
      record_id: deleteTarget.id,
      action: 'branch_deleted',
      old_data: deleteTarget as unknown as Record<string, unknown>,
      new_data: { delete_reason: deleteReason || null, soft_deleted: !!error } as Record<string, unknown>,
      changed_by: currentProfile?.id ?? null,
      changed_at: now,
    })

    setSaving(false)
    setDeleteTarget(null)
    setDeleteReason('')
    invalidateCachedData(/^(branches:|branches:active|branches:active-full|dashboard:|cashflow:|cash-positions:)/)
    load({ force: true })
  }

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Manajemen Cabang</h2>
          <p className="text-sm text-gray-500 mt-0.5">Kelola data cabang Roti Bakar Ngeunah</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" />
          <span>Tambah Cabang</span>
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
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

      {/* Table */}
      <div className="card overflow-hidden">
        {branches.length === 0 ? (
          <EmptyState
            title="Belum ada cabang"
            description="Tambahkan cabang pertama untuk memulai."
            action={
              <button onClick={openAdd} className="btn-primary text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" /> Tambah Cabang
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Nama Cabang</th>
                  <th className="table-header">Alamat</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Dibuat</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {branches.map((branch) => (
                  <tr key={branch.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-rbn-orange/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-3.5 h-3.5 text-rbn-orange" />
                        </div>
                        <span className="font-medium text-gray-900">{branch.name}</span>
                      </div>
                    </td>
                    <td className="table-cell text-gray-500">{branch.address || '—'}</td>
                    <td className="table-cell">
                      <ActiveBadge isActive={branch.is_active} />
                    </td>
                    <td className="table-cell text-gray-500 text-xs">
                      {formatDateTime(branch.created_at)}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(branch)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setToggleTarget(branch)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            branch.is_active
                              ? 'hover:bg-red-50 text-green-500 hover:text-red-600'
                              : 'hover:bg-green-50 text-gray-400 hover:text-green-600'
                          }`}
                          title={branch.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        >
                          {branch.is_active ? (
                            <ToggleRight className="w-4 h-4" />
                          ) : (
                            <ToggleLeft className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => { setDeleteTarget(branch); setDeleteReason('') }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editBranch ? 'Edit Cabang' : 'Tambah Cabang'}
        size="sm"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nama Cabang <span className="text-red-500">*</span>
            </label>
            <input
              {...register('name')}
              className="input-field"
              placeholder="Contoh: Buduk"
            />
            {errors.name && (
              <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alamat</label>
            <textarea
              {...register('address')}
              className="input-field resize-none"
              rows={3}
              placeholder="Alamat cabang (opsional)"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-outline text-sm">
              Batal
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? 'Menyimpan...' : editBranch ? 'Simpan Perubahan' : 'Tambah Cabang'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Toggle Confirm Modal */}
      <ConfirmModal
        isOpen={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleToggle}
        loading={saving}
        title={toggleTarget?.is_active ? 'Nonaktifkan Cabang' : 'Aktifkan Cabang'}
        description={
          toggleTarget?.is_active
            ? `Yakin ingin menonaktifkan cabang "${toggleTarget?.name}"? Data lama tetap tersimpan.`
            : `Yakin ingin mengaktifkan kembali cabang "${toggleTarget?.name}"?`
        }
        confirmLabel={toggleTarget?.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        confirmClass={
          toggleTarget?.is_active
            ? 'bg-rbn-red hover:bg-rbn-red-dark text-white'
            : 'bg-green-600 hover:bg-green-700 text-white'
        }
      />

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteReason('') }}
        onConfirm={handleDelete}
        loading={saving}
        title="Hapus Cabang"
        description={`Yakin ingin menghapus cabang "${deleteTarget?.name}"? Jika cabang sudah memiliki transaksi, data tetap aman namun cabang tidak akan muncul di sistem.`}
        confirmLabel="Hapus"
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
        showReason
        reason={deleteReason}
        onReasonChange={setDeleteReason}
      />
    </div>
  )
}
