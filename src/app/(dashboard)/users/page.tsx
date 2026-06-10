'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, ToggleLeft, ToggleRight, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { formatDateTime } from '@/lib/utils/format'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { ActiveBadge, RoleBadge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { getCachedData, getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'

const addUserSchema = z.object({
  email: z.string().email('Email tidak valid'),
  username: z.string().min(2, 'Username minimal 2 karakter').max(30).regex(/^[a-zA-Z0-9_]+$/, 'Hanya huruf, angka, dan underscore'),
  full_name: z.string().min(1, 'Nama wajib diisi'),
  role: z.enum(['owner', 'admin']),
  password: z.string().min(8, 'Password minimal 8 karakter'),
})

const editUserSchema = z.object({
  full_name: z.string().min(1, 'Nama wajib diisi'),
  username: z.string().min(2, 'Username minimal 2 karakter').max(30).regex(/^[a-zA-Z0-9_]+$/, 'Hanya huruf, angka, dan underscore'),
  role: z.enum(['owner', 'admin']),
})

type AddUserForm = z.infer<typeof addUserSchema>
type EditUserForm = z.infer<typeof editUserSchema>

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addForm = useForm<AddUserForm>({ resolver: zodResolver(addUserSchema) })
  const editForm = useForm<EditUserForm>({ resolver: zodResolver(editUserSchema) })

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const cacheKey = 'users:profiles'
    const cached = getCachedData<Profile[]>(cacheKey)

    if (cached && !options.force) {
      setUsers(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const data = await getOrFetchCached<Profile[]>(
      cacheKey,
      async () => {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at')

        return data || []
      },
      { ttlMs: 60_000, force: options.force || Boolean(cached) }
    )

    setUsers(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
      setProfileLoading(false)
    }
    loadProfile()
  }, [])

  async function handleAddUser(data: AddUserForm) {
    setSaving(true)
    setError(null)

    // User dibuat lewat API server-side (service role) supaya sesi owner
    // tidak tergantikan oleh sesi user baru (efek samping auth.signUp di client).
    try {
      const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          username: data.username,
          full_name: data.full_name,
          role: data.role,
        }),
      })
      const json = await res.json() as { success: boolean; message?: string }

      if (!res.ok || !json.success) {
        setError(json.message || 'Gagal membuat user baru.')
        setSaving(false)
        return
      }
    } catch {
      setError('Gagal terhubung ke server.')
      setSaving(false)
      return
    }

    setSaving(false)
    setAddModalOpen(false)
    addForm.reset()
    invalidateCachedData('users:')
    load({ force: true })
  }

  async function handleEditUser(data: EditUserForm) {
    if (!editTarget) return
    if (editTarget.role === 'owner' && currentProfile?.role !== 'owner') {
      setError('Admin tidak dapat mengubah data owner.')
      return
    }
    setSaving(true)
    const supabase = createClient()
    await supabase.from('profiles').update({
      full_name: data.full_name,
      username: data.username.toLowerCase(),
      role: data.role,
    }).eq('id', editTarget.id)
    setSaving(false)
    setEditTarget(null)
    invalidateCachedData(/^(users:|profile:)/)
    load({ force: true })
  }

  async function handleToggle() {
    if (!toggleTarget) return
    if (toggleTarget.role === 'owner' && currentProfile?.role !== 'owner') {
      setToggleTarget(null)
      return
    }
    // Prevent deactivating yourself
    if (toggleTarget.id === currentProfile?.id) {
      setToggleTarget(null)
      return
    }
    setSaving(true)
    const supabase = createClient()
    await supabase.from('profiles').update({ is_active: !toggleTarget.is_active }).eq('id', toggleTarget.id)
    setSaving(false)
    setToggleTarget(null)
    invalidateCachedData(/^(users:|profile:)/)
    load({ force: true })
  }

  if (loading || profileLoading) return <PageLoading />

  // Only owner can access this page
  if (currentProfile?.role !== 'owner') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Shield className="w-12 h-12 text-gray-300 mb-3" />
        <h3 className="text-base font-semibold text-gray-900">Akses Terbatas</h3>
        <p className="text-sm text-gray-500 mt-1">Hanya Owner yang dapat mengakses halaman ini.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-500">{users.length} pengguna terdaftar</p>
        </div>
        <button onClick={() => { setError(null); addForm.reset(); setAddModalOpen(true) }} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" /> Tambah User
        </button>
      </div>

      <div className="card overflow-hidden">
        {users.length === 0 ? (
          <EmptyState title="Belum ada user" description="Tambahkan user admin pertama." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Nama</th>
                  <th className="table-header">Username</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Bergabung</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rbn-red to-rbn-orange flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {(user.full_name || user.email || 'U')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{user.full_name || '—'}</p>
                          <p className="text-xs text-gray-400">{user.email}{user.id === currentProfile?.id ? ' (Anda)' : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      {user.username ? (
                        <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded text-gray-700">{user.username}</span>
                      ) : (
                        <span className="text-xs text-orange-500 font-medium">Belum diset</span>
                      )}
                    </td>
                    <td className="table-cell"><RoleBadge role={user.role} /></td>
                    <td className="table-cell"><ActiveBadge isActive={user.is_active} /></td>
                    <td className="table-cell text-gray-500 text-xs">{formatDateTime(user.created_at)}</td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditTarget(user)
                            editForm.reset({ full_name: user.full_name || '', username: user.username || '', role: user.role })
                          }}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                          disabled={user.id === currentProfile?.id}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {user.id !== currentProfile?.id && (
                          <button
                            onClick={() => setToggleTarget(user)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              user.is_active
                                ? 'hover:bg-red-50 text-green-500 hover:text-red-600'
                                : 'hover:bg-green-50 text-gray-400 hover:text-green-600'
                            }`}
                          >
                            {user.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
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

      {/* Add User Modal */}
      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title="Tambah User Admin" size="sm">
        <form onSubmit={addForm.handleSubmit(handleAddUser)} className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap <span className="text-red-500">*</span></label>
            <input {...addForm.register('full_name')} className="input-field" placeholder="Nama lengkap" />
            {addForm.formState.errors.full_name && <p className="text-xs text-red-500 mt-1">{addForm.formState.errors.full_name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-red-500">*</span>
              <span className="text-xs text-gray-400 font-normal ml-1">(dipakai saat login)</span>
            </label>
            <input {...addForm.register('username')} className="input-field font-mono" placeholder="contoh: owner, budi123" />
            {addForm.formState.errors.username && <p className="text-xs text-red-500 mt-1">{addForm.formState.errors.username.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
              <span className="text-xs text-gray-400 font-normal ml-1">(untuk Supabase Auth)</span>
            </label>
            <input {...addForm.register('email')} type="email" className="input-field" placeholder="admin@email.com" />
            {addForm.formState.errors.email && <p className="text-xs text-red-500 mt-1">{addForm.formState.errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select {...addForm.register('role')} className="input-field">
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
            <input {...addForm.register('password')} type="password" className="input-field" placeholder="Min. 8 karakter" />
            {addForm.formState.errors.password && <p className="text-xs text-red-500 mt-1">{addForm.formState.errors.password.message}</p>}
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setAddModalOpen(false)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Menyimpan...' : 'Tambah User'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit User" size="sm">
        <form onSubmit={editForm.handleSubmit(handleEditUser)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
            <input {...editForm.register('full_name')} className="input-field" />
            {editForm.formState.errors.full_name && <p className="text-xs text-red-500 mt-1">{editForm.formState.errors.full_name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
              <span className="text-xs text-gray-400 font-normal ml-1">(dipakai saat login)</span>
            </label>
            <input {...editForm.register('username')} className="input-field font-mono" placeholder="contoh: owner, budi123" />
            {editForm.formState.errors.username && <p className="text-xs text-red-500 mt-1">{editForm.formState.errors.username.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select {...editForm.register('role')} className="input-field" disabled={editTarget?.role === 'owner'}>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            {editTarget?.role === 'owner' && <p className="text-xs text-gray-500 mt-1">Role owner tidak dapat diubah.</p>}
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setEditTarget(null)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </Modal>

      {/* Toggle Modal */}
      <ConfirmModal
        isOpen={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleToggle}
        loading={saving}
        title={toggleTarget?.is_active ? 'Nonaktifkan User' : 'Aktifkan User'}
        description={`Yakin ingin ${toggleTarget?.is_active ? 'menonaktifkan' : 'mengaktifkan'} user "${toggleTarget?.full_name || toggleTarget?.email}"?${toggleTarget?.is_active ? ' User tidak akan bisa login setelah dinonaktifkan.' : ''}`}
        confirmLabel={toggleTarget?.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        confirmClass={toggleTarget?.is_active ? 'bg-rbn-red hover:bg-rbn-red-dark text-white' : 'bg-green-600 hover:bg-green-700 text-white'}
      />
    </div>
  )
}
