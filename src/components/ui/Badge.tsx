import type { SalesStatus, CashflowStatus, CashflowType } from '@/types/database'

export function SalesBadge({ status }: { status: SalesStatus }) {
  const map: Record<SalesStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'badge-draft' },
    posted: { label: 'Posted', className: 'badge-posted' },
    void: { label: 'Void', className: 'badge-void' },
  }
  const { label, className } = map[status] ?? map.draft
  return <span className={className}>{label}</span>
}

export function CashflowStatusBadge({ status }: { status: CashflowStatus }) {
  if (status === 'void') {
    return <span className="badge-void">Void</span>
  }
  return <span className="badge-active">Active</span>
}

export function CashflowTypeBadge({ type }: { type: CashflowType }) {
  if (type === 'cash_in') {
    return <span className="badge-cash-in">Cash In</span>
  }
  return <span className="badge-cash-out">Cash Out</span>
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return <span className="badge-active">Aktif</span>
  }
  return <span className="badge-void">Nonaktif</span>
}

export function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
        Owner
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      Admin
    </span>
  )
}
