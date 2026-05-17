'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, LogIn, AlertCircle, Lock } from 'lucide-react'

const LOGIN_USERNAME = process.env.NEXT_PUBLIC_LOGIN_USERNAME || 'owner'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isInactive = searchParams.get('error') === 'inactive'

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    // Look up email by username via RPC (callable without auth)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: email, error: rpcError } = await (supabase as any).rpc('get_email_by_username', {
      p_username: LOGIN_USERNAME,
    })

    if (rpcError || !email) {
      setError('Password salah. Silakan coba lagi.')
      setLoading(false)
      return
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError('Password salah. Silakan coba lagi.')
      setLoading(false)
      return
    }

    // Verify account is still active
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', user.id)
        .single()
      const profile = profileData as { is_active: boolean } | null

      if (!profile?.is_active) {
        await supabase.auth.signOut()
        setError('Akun Anda tidak aktif. Hubungi owner untuk bantuan.')
        setLoading(false)
        return
      }
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient + blobs */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-700 via-orange-600 to-yellow-500" />
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-yellow-400/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-red-900/30 rounded-full blur-3xl" />

      {/* Card */}
      <div className="relative w-full max-w-sm">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">

          {/* Logo area */}
          <div className="relative bg-gradient-to-b from-red-700 to-orange-600 px-6 pt-10 pb-16 flex flex-col items-center">
            {/* Glow behind logo */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <div className="w-48 h-48 bg-yellow-400 rounded-full blur-3xl" />
            </div>

            {/* Logo */}
            <div className="relative z-10 w-52 h-auto flex items-center justify-center">
              <Image
                src="/rbngeunahicon.webp"
                alt="Roti Bakar Ngeunah"
                width={210}
                height={210}
                className="object-contain drop-shadow-2xl"
                priority
              />
            </div>

            {/* Tagline */}
            <p className="relative z-10 mt-3 text-orange-100 text-xs tracking-widest uppercase font-medium">
              Sales &amp; Cashflow System
            </p>
          </div>

          {/* Wave divider */}
          <div className="-mt-8 relative z-10">
            <svg viewBox="0 0 400 40" className="w-full fill-white" preserveAspectRatio="none">
              <path d="M0,20 C100,40 300,0 400,20 L400,40 L0,40 Z" />
            </svg>
          </div>

          {/* Form */}
          <div className="px-7 pb-8 -mt-2">
            <h2 className="text-gray-900 text-lg font-bold mb-1 text-center">Selamat Datang!</h2>
            <p className="text-gray-400 text-xs text-center mb-6">Masuk ke sistem internal admin</p>

            {/* Error banners */}
            {isInactive && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-red-700 text-xs">Akun Anda tidak aktif. Hubungi owner.</p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-red-700 text-xs">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-11 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50 transition-all"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-gradient-to-r from-red-600 to-orange-500 text-white py-3 rounded-xl font-bold text-sm hover:from-red-700 hover:to-orange-600 transition-all shadow-lg shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Masuk</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Bottom note */}
          <div className="px-7 pb-5 text-center">
            <p className="text-xs text-gray-300">Sistem internal — hanya untuk Owner &amp; Admin</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-orange-50" />}>
      <LoginForm />
    </Suspense>
  )
}
