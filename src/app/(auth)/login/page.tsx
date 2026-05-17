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
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-[linear-gradient(135deg,#991B1B_0%,#EA580C_48%,#F59E0B_100%)]">
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />

      {/* Card */}
      <div className="relative w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-2xl shadow-red-950/25 overflow-hidden border border-white/40">

          {/* Logo area */}
          <div className="relative bg-[linear-gradient(180deg,#B91C1C_0%,#EA580C_100%)] px-6 pt-9 pb-14 flex flex-col items-center">
            {/* Logo */}
            <div className="relative z-10 h-36 w-36 overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/20 shadow-xl">
              <Image
                src="https://owner-portal.rotibakarngeunah.my.id/wp-content/uploads/2026/05/cropped-Icon-Roti-Bakar-Ngeunah.webp"
                alt="Roti Bakar Ngeunah"
                width={160}
                height={160}
                className="h-full w-full object-cover"
                priority
              />
            </div>

            {/* Tagline */}
            <p className="relative z-10 mt-4 text-orange-50 text-xs tracking-widest uppercase font-bold">
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
            <h2 className="text-slate-950 text-lg font-extrabold mb-1 text-center">Selamat Datang!</h2>
            <p className="text-slate-500 text-xs text-center mb-6">Masuk untuk mencatat penjualan hari ini</p>

            {/* Error banners */}
            {isInactive && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-red-700 text-xs">Akun Anda tidak aktif. Hubungi owner.</p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
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
                    className="w-full pl-10 pr-11 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 bg-slate-50 transition-all"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-gradient-to-r from-red-600 to-orange-500 text-white py-3 rounded-lg font-bold text-sm hover:from-red-700 hover:to-orange-600 transition-all shadow-lg shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
