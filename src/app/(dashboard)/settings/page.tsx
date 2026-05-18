'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Lock, CheckCircle } from 'lucide-react'
import { getOrFetchCached, invalidateCachedData } from '@/lib/utils/client-cache'

const profileSchema = z.object({
  full_name: z.string().min(1, 'Nama wajib diisi'),
})

const passwordSchema = z.object({
  new_password: z.string().min(8, 'Password minimal 8 karakter'),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, {
  message: 'Password tidak cocok',
  path: ['confirm_password'],
})

type ProfileForm = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) })
  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })
  const { reset: resetProfileForm } = profileForm

  useEffect(() => {
    async function load() {
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
        setProfile(data)
        resetProfileForm({ full_name: data?.full_name || '' })
      }
    }
    load()
  }, [resetProfileForm])

  async function handleProfileSave(data: ProfileForm) {
    if (!profile) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('profiles').update({ full_name: data.full_name }).eq('id', profile.id)
    if (err) {
      setError(err.message)
    } else {
      setSuccess('Profil berhasil diperbarui.')
      setProfile({ ...profile, full_name: data.full_name })
      invalidateCachedData(/^profile:/)
    }
    setSaving(false)
  }

  async function handlePasswordChange(data: PasswordForm) {
    setSavingPassword(true)
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password: data.new_password })
    if (err) {
      setError(err.message)
    } else {
      setSuccess('Password berhasil diubah.')
      passwordForm.reset()
    }
    setSavingPassword(false)
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">Kelola profil dan keamanan akun Anda</p>
      </div>

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Profile info */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-5">
          <User className="w-5 h-5 text-rbn-orange" />
          <h3 className="font-semibold text-gray-900">Informasi Profil</h3>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span className="font-medium">{profile?.email}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500">Role</span>
            <span className="font-medium capitalize">{profile?.role}</span>
          </div>
        </div>

        <form onSubmit={profileForm.handleSubmit(handleProfileSave)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
            <input {...profileForm.register('full_name')} className="input-field" />
            {profileForm.formState.errors.full_name && (
              <p className="text-xs text-red-500 mt-1">{profileForm.formState.errors.full_name.message}</p>
            )}
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </div>
        </form>
      </div>

      {/* Password */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-5">
          <Lock className="w-5 h-5 text-rbn-orange" />
          <h3 className="font-semibold text-gray-900">Ganti Password</h3>
        </div>

        <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password Baru</label>
            <input {...passwordForm.register('new_password')} type="password" className="input-field" placeholder="Min. 8 karakter" />
            {passwordForm.formState.errors.new_password && (
              <p className="text-xs text-red-500 mt-1">{passwordForm.formState.errors.new_password.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Konfirmasi Password</label>
            <input {...passwordForm.register('confirm_password')} type="password" className="input-field" placeholder="Ulangi password baru" />
            {passwordForm.formState.errors.confirm_password && (
              <p className="text-xs text-red-500 mt-1">{passwordForm.formState.errors.confirm_password.message}</p>
            )}
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={savingPassword} className="btn-primary text-sm">
              {savingPassword ? 'Mengubah...' : 'Ganti Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
