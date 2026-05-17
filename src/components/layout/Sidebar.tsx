'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  PlusSquare,
  FileText,
  Wallet,
  Tag,
  Building2,
  Users,
  ClipboardList,
  Settings,
  X,
  ChevronRight,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import { cn } from '@/lib/utils/format'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sales/input', label: 'Input Penjualan', icon: PlusSquare },
  { href: '/sales/reports', label: 'Laporan Penjualan', icon: FileText },
  { href: '/cashflow', label: 'Cashflow', icon: Wallet },
  { href: '/cashflow/categories', label: 'Kategori Cashflow', icon: Tag },
  { href: '/branches', label: 'Cabang', icon: Building2 },
  { href: '/users', label: 'User Management', icon: Users, ownerOnly: true },
  { href: '/audit-log', label: 'Audit Log', icon: ClipboardList, ownerOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings },
]

interface SidebarProps {
  profile: Profile | null
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ profile, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const isOwner = profile?.role === 'owner'

  const visibleNavItems = navItems.filter((item) => !item.ownerOnly || isOwner)

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-100 z-50 flex flex-col transition-transform duration-300',
          'lg:translate-x-0 lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rbn-red to-rbn-orange flex items-center justify-center overflow-hidden flex-shrink-0">
              <Image
                src="/rbngeunahicon.webp"
                alt="RBN"
                width={36}
                height={36}
                className="object-contain"
                onError={(e) => {
                  const t = e.target as HTMLImageElement
                  t.style.display = 'none'
                }}
              />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Roti Bakar</p>
              <p className="text-xs text-rbn-orange font-semibold leading-tight">Ngeunah</p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-0.5">
            {visibleNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href))

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group',
                      isActive
                        ? 'bg-rbn-red text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-4.5 h-4.5 flex-shrink-0',
                        isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {isActive && <ChevronRight className="w-3.5 h-3.5 text-white/70" />}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rbn-red to-rbn-orange flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {(profile?.full_name || profile?.email || 'U')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {profile?.full_name || 'Admin'}
              </p>
              <p className="text-xs text-gray-500 capitalize">{profile?.role || 'admin'}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
