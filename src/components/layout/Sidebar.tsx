'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  PlusSquare,
  FileText,
  Wallet,
  BarChart3,
  LineChart,
  Tag,
  Tags,
  Building2,
  Users,
  ClipboardList,
  Settings,
  X,
  ChevronRight,
  Eraser,
  Store,
  Package,
  ArrowLeftRight,
  RotateCcw,
  Trash2,
  Smartphone,
  Target,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import { cn } from '@/lib/utils/format'
import { useMemo } from 'react'

const LOGO_URL = '/rbngeunahicon.webp'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Pencatatan',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/sales/input', label: 'Input Penjualan', icon: PlusSquare },
      { href: '/sales/online', label: 'Penjualan Online', icon: Smartphone },
      { href: '/sales/reports', label: 'Laporan Penjualan', icon: FileText },
      { href: '/sales/analysis', label: 'Analisa Sales', icon: LineChart },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      { href: '/cashflow', label: 'Cashflow', icon: Wallet },
      { href: '/kasir-import', label: 'Import dari POS', icon: Store },
      { href: '/kasir-import/category-mapping', label: 'Pemetaan Kategori POS', icon: Tags },
      { href: '/cashflow/import-bahan-baku', label: 'Import Bahan Baku', icon: Package },
      { href: '/cashflow/import-food-waste', label: 'Import Food Waste', icon: Trash2 },
      { href: '/cashflow/transfer-beban', label: 'Transfer Beban Pokok', icon: ArrowLeftRight },
      { href: '/cashflow/analysis', label: 'Analisa Cashflow', icon: BarChart3 },
      { href: '/cashflow/proyeksi', label: 'Proyeksi Laba Rugi', icon: Target },
      { href: '/cashflow/categories', label: 'Kategori Cashflow', icon: Tag },
    ],
  },
  {
    label: 'Manajemen',
    items: [
      { href: '/branches', label: 'Cabang', icon: Building2 },
      { href: '/users', label: 'User Management', icon: Users, ownerOnly: true },
      { href: '/audit-log', label: 'Audit Log', icon: ClipboardList, ownerOnly: true },
      { href: '/data-management', label: 'Manajemen Data', icon: Eraser, ownerOnly: true },
      { href: '/reset-cabang', label: 'Reset Data Cabang', icon: RotateCcw, ownerOnly: true },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const allNavItems = navGroups.flatMap((group) => group.items)

interface SidebarProps {
  profile: Profile | null
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ profile, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const isOwner = profile?.role === 'owner'

  const visibleNavItems = useMemo(
    () => allNavItems.filter((item) => !item.ownerOnly || isOwner),
    [isOwner]
  )

  const activeHref = useMemo(() => {
    return [...visibleNavItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      ?.href
  }, [pathname, visibleNavItems])

  const initials = (profile?.full_name || profile?.email || 'U')[0].toUpperCase()

  function handleNavigation(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    onClose()

    if (pathname === href) event.preventDefault()
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-72 z-50 flex flex-col',
          'transition-transform duration-300 ease-in-out',
          'lg:translate-x-0 lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'bg-white border-r border-slate-200 shadow-xl shadow-slate-900/5'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100">
          <a
            href="/dashboard"
            className="flex items-center gap-3 min-w-0 group"
            onClick={(event) => handleNavigation(event, '/dashboard')}
          >
            <div className="relative w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-orange-100 group-hover:ring-orange-300 transition-all shadow-sm">
              <Image
                src={LOGO_URL}
                alt="Roti Bakar Ngeunah"
                width={44}
                height={44}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <div className="text-left leading-tight">
              <p className="text-sm font-black text-slate-900 tracking-tight">Roti Bakar</p>
              <p className="text-xs font-extrabold text-rbn-red tracking-widest uppercase">Ngeunah</p>
            </div>
          </a>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4 scrollbar-thin">
          {navGroups.map((group) => {
            const groupItems = group.items.filter((item) => !item.ownerOnly || isOwner)
            if (groupItems.length === 0) return null

            return (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {groupItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeHref === item.href

                    return (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={(event) => handleNavigation(event, item.href)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group',
                            isActive
                              ? 'bg-gradient-to-r from-rbn-red to-rbn-orange text-white shadow-md shadow-red-200'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-4 h-4 flex-shrink-0 transition-transform group-hover:scale-110',
                              isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'
                            )}
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {isActive && (
                            <ChevronRight className="w-3.5 h-3.5 text-white/70 flex-shrink-0" />
                          )}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        {/* User info */}
        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-slate-50 to-orange-50/50 border border-slate-200 p-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rbn-red to-rbn-orange flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-200">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">
                {profile?.full_name || 'Admin'}
              </p>
              <p className="text-xs text-slate-500 capitalize">{profile?.role || 'admin'}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
