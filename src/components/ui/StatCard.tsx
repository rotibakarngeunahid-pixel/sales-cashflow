import { cn } from '@/lib/utils/format'

interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  icon?: React.ReactNode
  iconBg?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  className?: string
  valueClassName?: string
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconBg = 'bg-slate-50',
  trend,
  trendValue,
  className,
  valueClassName,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'relative bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-900/5',
        'p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-900/10',
        'group',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.12em] truncate">
            {title}
          </p>
          <p
            className={cn(
              'text-xl font-extrabold text-slate-900 mt-1.5 truncate text-rupiah leading-none',
              valueClassName
            )}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1 truncate">{subtitle}</p>
          )}
          {trend && trendValue && (
            <p
              className={cn(
                'text-xs font-semibold mt-1.5 flex items-center gap-1',
                trend === 'up'
                  ? 'text-emerald-600'
                  : trend === 'down'
                  ? 'text-red-500'
                  : 'text-slate-400'
              )}
            >
              <span>{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span>
              {trendValue}
            </p>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center',
              'transition-transform duration-200 group-hover:scale-110',
              iconBg
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
