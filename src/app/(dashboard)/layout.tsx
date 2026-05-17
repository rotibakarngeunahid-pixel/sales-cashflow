'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { toDateInputValue } from '@/lib/utils/format'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/sales/input': 'Input Penjualan',
  '/sales/reports': 'Laporan Penjualan',
  '/cashflow': 'Cashflow',
  '/cashflow/categories': 'Kategori Cashflow',
  '/branches': 'Manajemen Cabang',
  '/users': 'User Management',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
}

type ReportStatus = 'none' | 'draft' | 'done' | null

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatus>(null)

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (!data || !data.is_active) {
        await supabase.auth.signOut()
        router.push('/login?error=inactive')
        return
      }
      setProfile(data)
    }
    loadProfile()
  }, [router])

  const refreshReportStatus = useCallback(async () => {
    const supabase = createClient()
    const today = toDateInputValue()
    const { data } = await supabase
      .from('sales_reports')
      .select('status')
      .eq('report_date', today)
      .neq('status', 'void')

    if (!data || data.length === 0) {
      setReportStatus('none')
    } else if (data.every((r) => r.status === 'posted')) {
      setReportStatus('done')
    } else {
      setReportStatus('draft')
    }
  }, [])

  useEffect(() => {
    refreshReportStatus()
  }, [refreshReportStatus, pathname])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  const title = pageTitles[pathname] || 'Dashboard'

  return (
    <div className="flex h-screen bg-app-surface overflow-hidden">
      <Sidebar
        profile={profile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          profile={profile}
          title={title}
          onMenuClick={() => setSidebarOpen(true)}
          reportStatus={reportStatus}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 lg:p-7 max-w-screen-2xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
