'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu, LogOut, ChevronDown, PlusCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'

interface HeaderProps {
  profile: Profile | null
  title: string
  onMenuClick: () => void
  reportStatus?: 'none' | 'draft' | 'done' | null
}

export default function Header({ profile, title, onMenuClick, reportStatus }: HeaderProps) {
  const router = useRouter()
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = (profile?.full_name || profile?.email || 'U')[0].toUpperCase()

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm shadow-slate-900/5">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        {/* Left: menu + title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors flex-shrink-0"
            aria-label="Buka menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate leading-tight">{title}</h1>
            <p className="hidden md:block text-xs text-slate-400 leading-tight">
              Roti Bakar Ngeunah · Sistem Internal Admin
            </p>
          </div>
        </div>

        {/* Right: report CTA + user */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Today's report quick action */}
          {reportStatus === 'none' && (
            <Link
              href="/sales/input"
              prefetch
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-rbn-red to-rbn-orange text-white text-xs font-bold shadow-md shadow-red-200 hover:shadow-lg hover:shadow-red-300 transition-all hover:-translate-y-0.5"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Input Laporan Hari Ini
            </Link>
          )}
          {reportStatus === 'draft' && (
            <Link
              href="/sales/reports"
              prefetch
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-200 hover:bg-amber-600 transition-all hover:-translate-y-0.5"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Laporan Draft
            </Link>
          )}
          {reportStatus === 'done' && (
            <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Laporan Lengkap
            </span>
          )}

          {/* User dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rbn-red to-rbn-orange flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-200">
                <span className="text-white text-xs font-bold">{initials}</span>
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <p className="text-sm font-semibold text-slate-900">
                  {profile?.full_name || 'Admin'}
                </p>
                <p className="text-xs text-slate-400 capitalize">{profile?.role}</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {showDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl shadow-slate-900/10 border border-slate-100 z-20 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {profile?.full_name || 'Admin'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{profile?.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={loading}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{loading ? 'Keluar...' : 'Keluar'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
