'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { toDateInputValue } from '@/lib/utils/format'
import { getOrFetchCached } from '@/lib/utils/client-cache'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/sales/input': 'Input Penjualan',
  '/sales/reports': 'Laporan Penjualan',
  '/sales/analysis': 'Analisa Sales',
  '/cashflow': 'Cashflow',
  '/cashflow/import': 'Import Cashflow',
  '/cashflow/import-bahan-baku': 'Import Pengeluaran Bahan Baku',
  '/cashflow/analysis': 'Analisa Cashflow',
  '/cashflow/categories': 'Kategori Cashflow',
  '/branches': 'Manajemen Cabang',
  '/users': 'User Management',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
}

type ReportStatus = 'none' | 'draft' | 'done' | null

const prefetchPaths = [
  '/dashboard',
  '/sales/input',
  '/sales/reports',
  '/sales/analysis',
  '/cashflow',
  '/cashflow/import',
  '/cashflow/import-bahan-baku',
  '/cashflow/analysis',
  '/cashflow/categories',
  '/branches',
  '/users',
  '/audit-log',
  '/settings',
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [reportStatus, setReportStatus] = useState<ReportStatus>(null)

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }
      const data = await getOrFetchCached<Profile | null>(
        `profile:${session.user.id}`,
        async () => {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          return data
        },
        { ttlMs: 5 * 60_000 }
      )
      if (!data || !data.is_active) {
        await supabase.auth.signOut()
        router.push('/login?error=inactive')
        return
      }
      setProfile(data)
    }
    loadProfile()
  }, [router])

  useEffect(() => {
    prefetchPaths.forEach((path) => router.prefetch(path))
  }, [router])

  const refreshReportStatus = useCallback(async () => {
    const supabase = createClient()
    const today = toDateInputValue()
    const status = await getOrFetchCached<ReportStatus>(
      `sales-report-status:${today}`,
      async () => {
        const { data } = await supabase
          .from('sales_reports')
          .select('status')
          .eq('report_date', today)
          .neq('status', 'void')

        if (!data || data.length === 0) return 'none'
        if (data.every((r) => r.status === 'posted')) return 'done'
        return 'draft'
      },
      { ttlMs: 30_000 }
    )

    setReportStatus(status)
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
