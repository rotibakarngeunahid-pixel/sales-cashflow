'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Lock,
  RefreshCw,
  Search,
  ShoppingBag,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  addDays,
  addMonths,
  differenceInDays,
  eachDayOfInterval,
  format,
  getDay,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import type { Branch, Profile, SalesReport } from '@/types/database'
import { cn, formatDate, formatNumber, formatPercentage, formatRupiah } from '@/lib/utils/format'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { getCachedData, getOrFetchCached } from '@/lib/utils/client-cache'

// ─── constants ─────────────────────────────────────────────────────────────────

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

const PLATFORM_OPTIONS = [
  { value: 'cash', label: 'Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'gofood', label: 'GoFood' },
  { value: 'grabfood', label: 'GrabFood' },
  { value: 'shopeefood', label: 'ShopeeFood' },
]

const PLATFORM_COLORS: Record<string, string> = {
  cash: '#16A34A',
  qris: '#2563EB',
  gofood: '#DC2626',
  grabfood: '#22C55E',
  shopeefood: '#EA580C',
}

const CHART_COLORS = ['#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#DB2777', '#0F766E']

const ROWS_PER_PAGE = 20

// ─── helpers ───────────────────────────────────────────────────────────────────

function toN(v: number | null | undefined): number {
  return Number(v ?? 0)
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}

function formatShortRupiah(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000)}rb`
  return `${sign}Rp${abs}`
}

// Returns nett omzet for a report by platform (for metrics calculations)
function getReportNett(report: SalesReport, platform: string): number {
  switch (platform) {
    case 'cash': return toN(report.cash)
    case 'qris': return toN(report.qris)
    case 'gofood': return toN(report.gofood_nett)
    case 'grabfood': return toN(report.grabfood_nett)
    case 'shopeefood': return toN(report.shopeefood_nett)
    default: return toN(report.grand_total_nett_sales)
  }
}

// Returns gross for a report by platform (for breakdown display)
function getReportGross(report: SalesReport, platform: string): number {
  switch (platform) {
    case 'cash': return toN(report.cash)
    case 'qris': return toN(report.qris_gross)
    case 'gofood': return toN(report.gofood_gross)
    case 'grabfood': return toN(report.grabfood_gross)
    case 'shopeefood': return toN(report.shopeefood_gross)
    default: return toN(report.cash) + toN(report.qris_gross) + toN(report.gofood_gross) + toN(report.grabfood_gross) + toN(report.shopeefood_gross)
  }
}

// ─── types ─────────────────────────────────────────────────────────────────────

type OutletMetric = {
  branchId: string
  branchName: string
  totalOmzet: number
  reportCount: number
  avgOmzetPerDay: number
  revenueShare: number
  cash: number
  qris: number
  gofood: number
  grabfood: number
  shopeefood: number
  bestDay: string
  bestDayAvg: number
}

type PlatformMetric = {
  key: string
  label: string
  grossAmount: number
  nettAmount: number
  reportCount: number
  pctOfGross: number
  avgPerReport: number
  topBranch: string
  color: string
}

type DayMetric = {
  dayIndex: number
  dayName: string
  totalOmzet: number
  reportCount: number
  avgOmzet: number
  topBranch: string
}

type DailyTrend = {
  key: string
  label: string
  omzet: number
  reportCount: number
}

type Insight = {
  title: string
  value: string
  description: string
  tone: 'good' | 'warning' | 'danger' | 'neutral'
  icon: ReactNode
}

type AnalysisData = {
  sales: SalesReport[]
  prevSales: SalesReport[]
}

// ─── sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  subtitle?: ReactNode
  icon: ReactNode
  tone?: 'green' | 'red' | 'blue' | 'amber' | 'orange' | 'neutral'
}) {
  const toneClass = {
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    neutral: 'bg-orange-50 text-rbn-red border-orange-100',
  }[tone]

  return (
    <div className="card h-full p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
          <p className="mt-2 overflow-x-auto whitespace-nowrap pb-0.5 text-xl font-extrabold leading-tight text-slate-950 text-rupiah scrollbar-thin 2xl:text-2xl">
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 break-words text-xs font-medium leading-5 text-slate-500">{subtitle}</p>
          )}
        </div>
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border', toneClass)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const toneClass = {
    good: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-100 bg-amber-50 text-amber-700',
    danger: 'border-red-100 bg-red-50 text-red-700',
    neutral: 'border-slate-100 bg-slate-50 text-slate-700',
  }[insight.tone]

  return (
    <article className={cn('rounded-xl border p-4', toneClass)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/70">
          {insight.icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] opacity-70">{insight.title}</p>
          <p className="mt-1 break-words text-lg font-extrabold text-rupiah">{insight.value}</p>
          <p className="mt-1 text-sm leading-5 opacity-90">{insight.description}</p>
        </div>
      </div>
    </article>
  )
}

function ProgressBar({ value, tone = 'red' }: { value: number; tone?: 'red' | 'green' | 'blue' | 'orange' }) {
  const colorClass = {
    red: 'bg-red-500',
    green: 'bg-emerald-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
  }[tone]

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn('h-full rounded-full transition-all', colorClass)}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  )
}

function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
        Belum ada data pembanding
      </span>
    )
  }
  const isUp = value >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
        isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}
    >
      {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isUp ? '+' : ''}{formatPercentage(value)} vs periode lalu
    </span>
  )
}

// ─── main component ────────────────────────────────────────────────────────────

export default function SalesAnalysisPage() {
  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [sales, setSales] = useState<SalesReport[]>([])
  const [prevSales, setPrevSales] = useState<SalesReport[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchDetail, setSearchDetail] = useState('')
  const [detailPage, setDetailPage] = useState(1)
  const [sortField, setSortField] = useState<'report_date' | 'grand_total_nett_sales'>('report_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const periodDays = useMemo(() => {
    const d = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1
    return Math.max(d, 1)
  }, [startDate, endDate])

  const prevEndDate = useMemo(
    () => format(addDays(parseISO(startDate), -1), 'yyyy-MM-dd'),
    [startDate],
  )
  const prevStartDate = useMemo(
    () => format(addDays(parseISO(startDate), -periodDays), 'yyyy-MM-dd'),
    [startDate, periodDays],
  )

  // Load profile for role check
  useEffect(() => {
    async function loadProfile() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          setProfileLoading(false)
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
          { ttlMs: 5 * 60_000 },
        )
        setProfile(data)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [])

  const load = useCallback(
    async (options: { force?: boolean } = {}) => {
      const supabase = createClient()
      const cacheKey = `sales-analysis:${startDate}:${endDate}:${filterBranch || 'all'}`
      const cached = getCachedData<AnalysisData>(cacheKey)

      if (cached && !options.force) {
        setSales(cached.sales)
        setPrevSales(cached.prevSales)
        setLoading(false)
      } else {
        setLoading(true)
      }

      try {
        const data = await getOrFetchCached<AnalysisData>(
          cacheKey,
          async () => {
            let salesQuery = supabase
              .from('sales_reports')
              .select('*, branch:branches(id,name)')
              .neq('status', 'void')
              .gte('report_date', startDate)
              .lte('report_date', endDate)
              .order('report_date', { ascending: true })

            let prevQuery = supabase
              .from('sales_reports')
              .select('*, branch:branches(id,name)')
              .eq('status', 'posted')
              .gte('report_date', prevStartDate)
              .lte('report_date', prevEndDate)
              .order('report_date', { ascending: true })

            if (filterBranch) {
              salesQuery = salesQuery.eq('branch_id', filterBranch)
              prevQuery = prevQuery.eq('branch_id', filterBranch)
            }

            const [salesResult, prevResult] = await Promise.all([salesQuery, prevQuery])
            if (salesResult.error) throw salesResult.error
            if (prevResult.error) throw prevResult.error

            return {
              sales: salesResult.data || [],
              prevSales: prevResult.data || [],
            }
          },
          { ttlMs: 60_000, force: options.force || Boolean(cached) },
        )

        setSales(data.sales)
        setPrevSales(data.prevSales)
        setError(null)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat data analisa sales.'
        setError(msg)
      } finally {
        setLoading(false)
      }
    },
    [endDate, filterBranch, prevEndDate, prevStartDate, startDate],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    async function loadBranches() {
      const supabase = createClient()
      const data = await getOrFetchCached<Pick<Branch, 'id' | 'name'>[]>(
        'branches:active',
        async () => {
          const { data } = await supabase
            .from('branches')
            .select('id,name')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name')
          return data || []
        },
        { ttlMs: 5 * 60_000 },
      )
      setBranches(data)
    }
    loadBranches()
  }, [])

  useEffect(() => {
    setDetailPage(1)
  }, [searchDetail, filterBranch, filterPlatform, startDate, endDate])

  // ─── computed ─────────────────────────────────────────────────────────────

  const postedSales = useMemo(() => sales.filter((r) => r.status === 'posted'), [sales])
  const prevPostedSales = useMemo(() => prevSales.filter((r) => r.status === 'posted'), [prevSales])
  const pendingSales = useMemo(() => sales.filter((r) => r.status !== 'posted'), [sales])

  const totalOmzet = useMemo(
    () => postedSales.reduce((sum, r) => sum + getReportNett(r, filterPlatform), 0),
    [postedSales, filterPlatform],
  )

  const prevTotalOmzet = useMemo(
    () => prevPostedSales.reduce((sum, r) => sum + getReportNett(r, filterPlatform), 0),
    [prevPostedSales, filterPlatform],
  )

  const growth = useMemo<number | null>(() => {
    if (prevTotalOmzet <= 0) return null
    return ((totalOmzet - prevTotalOmzet) / prevTotalOmzet) * 100
  }, [totalOmzet, prevTotalOmzet])

  const platformMetrics = useMemo<PlatformMetric[]>(() => {
    const totalGross = postedSales.reduce(
      (sum, r) =>
        sum + toN(r.cash) + toN(r.qris_gross) + toN(r.gofood_gross) + toN(r.grabfood_gross) + toN(r.shopeefood_gross),
      0,
    )

    return PLATFORM_OPTIONS.map((p) => {
      const branchMap = new Map<string, { name: string; gross: number }>()
      let gross = 0
      let nett = 0
      let count = 0

      postedSales.forEach((r) => {
        const g = getReportGross(r, p.value)
        const n = getReportNett(r, p.value)
        if (g > 0 || n > 0) {
          gross += g
          nett += n
          count += 1
          const bname = r.branch?.name || 'Cabang'
          const existing = branchMap.get(r.branch_id) || { name: bname, gross: 0 }
          existing.gross += g
          branchMap.set(r.branch_id, existing)
        }
      })

      const topBranchEntry = Array.from(branchMap.values()).sort((a, b) => b.gross - a.gross)[0]

      return {
        key: p.value,
        label: p.label,
        grossAmount: gross,
        nettAmount: nett,
        reportCount: count,
        pctOfGross: pct(gross, totalGross),
        avgPerReport: count > 0 ? gross / count : 0,
        topBranch: topBranchEntry?.name || '-',
        color: PLATFORM_COLORS[p.value] || '#64748B',
      }
    })
      .filter((p) => p.grossAmount > 0)
      .sort((a, b) => b.grossAmount - a.grossAmount)
  }, [postedSales])

  const outletMetrics = useMemo<OutletMetric[]>(() => {
    const branchMap = new Map<string, OutletMetric>()
    const branchDayMap = new Map<string, Map<number, { total: number; count: number }>>()

    const seedBranches = filterBranch ? branches.filter((b) => b.id === filterBranch) : branches
    seedBranches.forEach((b) => {
      branchMap.set(b.id, {
        branchId: b.id,
        branchName: b.name,
        totalOmzet: 0,
        reportCount: 0,
        avgOmzetPerDay: 0,
        revenueShare: 0,
        cash: 0,
        qris: 0,
        gofood: 0,
        grabfood: 0,
        shopeefood: 0,
        bestDay: '',
        bestDayAvg: 0,
      })
    })

    postedSales.forEach((r) => {
      const existing = branchMap.get(r.branch_id)
      const metric: OutletMetric = existing || {
        branchId: r.branch_id,
        branchName: r.branch?.name || 'Cabang',
        totalOmzet: 0,
        reportCount: 0,
        avgOmzetPerDay: 0,
        revenueShare: 0,
        cash: 0,
        qris: 0,
        gofood: 0,
        grabfood: 0,
        shopeefood: 0,
        bestDay: '',
        bestDayAvg: 0,
      }

      metric.totalOmzet += getReportNett(r, filterPlatform)
      metric.reportCount += 1
      metric.cash += toN(r.cash)
      metric.qris += toN(r.qris_gross)
      metric.gofood += toN(r.gofood_gross)
      metric.grabfood += toN(r.grabfood_gross)
      metric.shopeefood += toN(r.shopeefood_gross)
      branchMap.set(r.branch_id, metric)

      // Track day-of-week
      const dayIdx = getDay(parseISO(r.report_date))
      if (!branchDayMap.has(r.branch_id)) branchDayMap.set(r.branch_id, new Map())
      const dayMap = branchDayMap.get(r.branch_id)!
      const dayEntry = dayMap.get(dayIdx) || { total: 0, count: 0 }
      dayEntry.total += getReportNett(r, filterPlatform)
      dayEntry.count += 1
      dayMap.set(dayIdx, dayEntry)
    })

    return Array.from(branchMap.values())
      .map((metric) => {
        const dayMap = branchDayMap.get(metric.branchId)
        let bestDay = ''
        let bestDayAvg = 0
        if (dayMap) {
          dayMap.forEach((val, idx) => {
            const avg = val.count > 0 ? val.total / val.count : 0
            if (avg > bestDayAvg) {
              bestDayAvg = avg
              bestDay = HARI[idx]
            }
          })
        }
        return {
          ...metric,
          avgOmzetPerDay: metric.totalOmzet / periodDays,
          revenueShare: pct(metric.totalOmzet, totalOmzet),
          bestDay,
          bestDayAvg,
        }
      })
      .filter((m) => m.totalOmzet > 0 || m.reportCount > 0)
      .sort((a, b) => b.totalOmzet - a.totalOmzet)
  }, [branches, filterBranch, filterPlatform, periodDays, postedSales, totalOmzet])

  const dayMetrics = useMemo<DayMetric[]>(() => {
    const map = new Map<
      number,
      { total: number; count: number; branchTotals: Map<string, { name: string; total: number }> }
    >()
    for (let i = 0; i < 7; i++) {
      map.set(i, { total: 0, count: 0, branchTotals: new Map() })
    }

    postedSales.forEach((r) => {
      const dayIdx = getDay(parseISO(r.report_date))
      const omzet = getReportNett(r, filterPlatform)
      const entry = map.get(dayIdx)!
      entry.total += omzet
      entry.count += 1
      const bname = r.branch?.name || 'Cabang'
      const bt = entry.branchTotals.get(r.branch_id) || { name: bname, total: 0 }
      bt.total += omzet
      entry.branchTotals.set(r.branch_id, bt)
    })

    return Array.from(map.entries()).map(([dayIdx, val]) => {
      const topEntry = Array.from(val.branchTotals.values()).sort((a, b) => b.total - a.total)[0]
      return {
        dayIndex: dayIdx,
        dayName: HARI[dayIdx],
        totalOmzet: val.total,
        reportCount: val.count,
        avgOmzet: val.count > 0 ? val.total / val.count : 0,
        topBranch: topEntry?.name || '-',
      }
    })
  }, [filterPlatform, postedSales])

  // Sort days Mon–Sun (1..6,0) for display
  const dayMetricsSorted = useMemo(
    () => [...dayMetrics].sort((a, b) => ((a.dayIndex + 6) % 7) - ((b.dayIndex + 6) % 7)),
    [dayMetrics],
  )

  const trendData = useMemo<DailyTrend[]>(() => {
    const groupByMonth = periodDays > 120
    const map = new Map<string, DailyTrend>()

    if (groupByMonth) {
      let cursor = startOfMonth(parseISO(startDate))
      const endMonth = startOfMonth(parseISO(endDate))
      while (cursor <= endMonth) {
        const key = format(cursor, 'yyyy-MM')
        map.set(key, { key, label: formatDate(`${key}-01`, 'MMM yy'), omzet: 0, reportCount: 0 })
        cursor = addMonths(cursor, 1)
      }
    } else {
      eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }).forEach((d) => {
        const key = format(d, 'yyyy-MM-dd')
        map.set(key, { key, label: formatDate(key, 'dd/MM'), omzet: 0, reportCount: 0 })
      })
    }

    postedSales.forEach((r) => {
      const key = groupByMonth ? r.report_date.slice(0, 7) : r.report_date
      const entry = map.get(key) || { key, label: key, omzet: 0, reportCount: 0 }
      entry.omzet += getReportNett(r, filterPlatform)
      entry.reportCount += 1
      map.set(key, entry)
    })

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
  }, [endDate, filterPlatform, periodDays, postedSales, startDate])

  const topDay = useMemo(
    () => [...dayMetrics].sort((a, b) => b.avgOmzet - a.avgOmzet)[0] || null,
    [dayMetrics],
  )
  const topPlatform = useMemo(() => platformMetrics[0] || null, [platformMetrics])
  const topOutlet = useMemo(() => outletMetrics[0] || null, [outletMetrics])

  const insights = useMemo<Insight[]>(() => {
    const rows: Insight[] = []

    if (totalOmzet === 0) {
      rows.push({
        title: 'Status Penjualan',
        value: 'Belum Ada Data',
        description: 'Tidak ada laporan penjualan posted pada periode dan filter ini.',
        tone: 'neutral',
        icon: <ShoppingBag className="h-4 w-4" />,
      })
      return rows
    }

    // Growth vs previous period
    if (growth !== null) {
      rows.push({
        title: 'Growth vs Periode Lalu',
        value: `${growth >= 0 ? '+' : ''}${formatPercentage(growth)}`,
        description:
          growth >= 0
            ? `Omzet naik ${formatPercentage(growth)} dibanding periode sebelumnya (${formatRupiah(prevTotalOmzet)}).`
            : `Omzet turun ${formatPercentage(Math.abs(growth))} dibanding periode sebelumnya (${formatRupiah(prevTotalOmzet)}).`,
        tone: growth >= 5 ? 'good' : growth >= 0 ? 'neutral' : growth >= -10 ? 'warning' : 'danger',
        icon: growth >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />,
      })
    }

    // Top outlet
    if (topOutlet) {
      rows.push({
        title: 'Outlet Terbaik',
        value: topOutlet.branchName,
        description: `${formatRupiah(topOutlet.totalOmzet)} — porsi ${formatPercentage(topOutlet.revenueShare)} dari total omzet. Paling ramai hari ${topOutlet.bestDay || '?'}.`,
        tone: topOutlet.revenueShare >= 75 && outletMetrics.length > 1 ? 'warning' : 'neutral',
        icon: <Building2 className="h-4 w-4" />,
      })
    }

    // Top platform
    if (topPlatform) {
      rows.push({
        title: 'Platform Terkuat',
        value: topPlatform.label,
        description: `${topPlatform.label} menyumbang ${formatPercentage(topPlatform.pctOfGross)} dari gross sales (${formatShortRupiah(topPlatform.grossAmount)}).`,
        tone: 'neutral',
        icon: <Star className="h-4 w-4" />,
      })
    }

    // Best day
    if (topDay && topDay.avgOmzet > 0) {
      rows.push({
        title: 'Hari Paling Ramai',
        value: topDay.dayName,
        description: `Rata-rata omzet ${formatRupiah(topDay.avgOmzet)} setiap hari ${topDay.dayName}. Outlet terlaris: ${topDay.topBranch}.`,
        tone: 'good',
        icon: <CalendarDays className="h-4 w-4" />,
      })
    }

    // Sepi day (lowest non-zero average)
    const activeDays = dayMetrics.filter((d) => d.avgOmzet > 0)
    if (activeDays.length >= 3) {
      const sepiDay = [...activeDays].sort((a, b) => a.avgOmzet - b.avgOmzet)[0]
      if (sepiDay.dayName !== topDay?.dayName) {
        rows.push({
          title: 'Hari Paling Sepi',
          value: sepiDay.dayName,
          description: `Rata-rata omzet hanya ${formatRupiah(sepiDay.avgOmzet)} pada hari ${sepiDay.dayName}. Pertimbangkan promo khusus hari ini.`,
          tone: 'warning',
          icon: <TrendingDown className="h-4 w-4" />,
        })
      }
    }

    // Platform deduction warning
    const onlinePlatforms = platformMetrics.filter((p) => p.key !== 'cash' && p.key !== 'qris')
    const highDeduct = onlinePlatforms.find((p) => {
      const deductPct = p.grossAmount > 0 ? ((p.grossAmount - p.nettAmount) / p.grossAmount) * 100 : 0
      return deductPct > 30
    })
    if (highDeduct) {
      const deductPct = pct(highDeduct.grossAmount - highDeduct.nettAmount, highDeduct.grossAmount)
      rows.push({
        title: 'Potongan Platform Tinggi',
        value: highDeduct.label,
        description: `${highDeduct.label} memotong ${formatPercentage(deductPct)} dari gross (${formatRupiah(highDeduct.grossAmount - highDeduct.nettAmount)} potongan). Evaluasi efektivitas platform ini.`,
        tone: 'warning',
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    }

    // Pending sales warning
    if (pendingSales.length > 0) {
      const pendingVal = pendingSales.reduce((sum, r) => sum + toN(r.grand_total_nett_sales), 0)
      rows.push({
        title: 'Laporan Belum Posted',
        value: `${pendingSales.length} laporan`,
        description: `Nilai belum final ${formatRupiah(pendingVal)} tidak dihitung ke total omzet sampai laporan diposting.`,
        tone: 'warning',
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    }

    return rows.slice(0, 6)
  }, [
    dayMetrics,
    growth,
    outletMetrics,
    pendingSales,
    platformMetrics,
    prevTotalOmzet,
    topDay,
    topOutlet,
    topPlatform,
    totalOmzet,
  ])

  // Detail table
  const filteredDetailRows = useMemo(() => {
    let rows = [...postedSales]

    if (searchDetail.trim()) {
      const q = searchDetail.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          (r.branch?.name || '').toLowerCase().includes(q) ||
          formatDate(r.report_date, 'EEEE dd MMMM yyyy').toLowerCase().includes(q),
      )
    }

    if (filterPlatform) {
      rows = rows.filter((r) => getReportNett(r, filterPlatform) > 0)
    }

    rows.sort((a, b) => {
      if (sortField === 'report_date') {
        const cmp = a.report_date.localeCompare(b.report_date)
        return sortDir === 'asc' ? cmp : -cmp
      }
      const cmp = getReportNett(a, filterPlatform) - getReportNett(b, filterPlatform)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [filterPlatform, postedSales, searchDetail, sortDir, sortField])

  const totalDetailPages = Math.max(1, Math.ceil(filteredDetailRows.length / ROWS_PER_PAGE))
  const paginatedDetailRows = filteredDetailRows.slice(
    (detailPage - 1) * ROWS_PER_PAGE,
    detailPage * ROWS_PER_PAGE,
  )

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function handleReset() {
    setFilterBranch('')
    setFilterPlatform('')
    setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'))
    setEndDate(format(today, 'yyyy-MM-dd'))
    setSearchDetail('')
  }

  async function handleExport() {
    const [XLSX, { saveAs }] = await Promise.all([import('xlsx'), import('file-saver')])
    const wb = XLSX.utils.book_new()
    const branchName = filterBranch ? branches.find((b) => b.id === filterBranch)?.name || '' : 'Semua Cabang'
    const platName = filterPlatform ? PLATFORM_OPTIONS.find((p) => p.value === filterPlatform)?.label || '' : 'Semua Platform'

    const overviewRows = [
      {
        'Periode Awal': formatDate(startDate, 'dd/MM/yyyy'),
        'Periode Akhir': formatDate(endDate, 'dd/MM/yyyy'),
        'Jumlah Hari': periodDays,
        Cabang: branchName,
        Platform: platName,
        'Total Omzet (Nett)': totalOmzet,
        'Total Laporan Posted': postedSales.length,
        'Avg Omzet/Hari': totalOmzet / periodDays,
        'Avg Omzet/Laporan': postedSales.length > 0 ? totalOmzet / postedSales.length : 0,
        'Outlet Terbaik': topOutlet?.branchName || '-',
        'Platform Terkuat': topPlatform?.label || '-',
        'Hari Terlaris': topDay?.dayName || '-',
        'Growth (%)': growth !== null ? growth.toFixed(2) : 'N/A',
      },
    ]

    const outletRows = outletMetrics.map((o) => ({
      Outlet: o.branchName,
      'Total Omzet': o.totalOmzet,
      'Jumlah Laporan': o.reportCount,
      'Avg Omzet/Hari': o.avgOmzetPerDay,
      'Share (%)': o.revenueShare.toFixed(2),
      Tunai: o.cash,
      QRIS: o.qris,
      GoFood: o.gofood,
      GrabFood: o.grabfood,
      ShopeeFood: o.shopeefood,
      'Hari Terlaris': o.bestDay || '-',
    }))

    const platformRows = platformMetrics.map((p) => ({
      Platform: p.label,
      'Gross Sales': p.grossAmount,
      'Nett Sales': p.nettAmount,
      'Potongan': p.grossAmount - p.nettAmount,
      '% Potongan': p.grossAmount > 0 ? ((p.grossAmount - p.nettAmount) / p.grossAmount * 100).toFixed(2) : '0',
      '% dari Total Gross': p.pctOfGross.toFixed(2),
      'Jumlah Laporan': p.reportCount,
      'Avg per Laporan': p.avgPerReport,
      'Outlet Terkuat': p.topBranch,
    }))

    const hariRows = dayMetricsSorted.map((d) => ({
      Hari: d.dayName,
      'Total Omzet': d.totalOmzet,
      'Jumlah Laporan': d.reportCount,
      'Avg Omzet': d.avgOmzet,
      'Outlet Terlaris': d.topBranch,
    }))

    const detailRows = filteredDetailRows.map((r) => ({
      Tanggal: formatDate(r.report_date, 'dd/MM/yyyy'),
      Hari: HARI[getDay(parseISO(r.report_date))],
      Outlet: r.branch?.name || '-',
      Status: r.status,
      Tunai: toN(r.cash),
      'QRIS Gross': toN(r.qris_gross),
      'QRIS Nett': toN(r.qris),
      'GoFood Gross': toN(r.gofood_gross),
      'GoFood Nett': toN(r.gofood_nett),
      'GrabFood Gross': toN(r.grabfood_gross),
      'GrabFood Nett': toN(r.grabfood_nett),
      'ShopeeFood Gross': toN(r.shopeefood_gross),
      'ShopeeFood Nett': toN(r.shopeefood_nett),
      'Total Nett': toN(r.grand_total_nett_sales),
    }))

    const insightRows = insights.map((ins) => ({
      Analisa: ins.title,
      Nilai: ins.value,
      Keterangan: ins.description,
      Status: ins.tone,
    }))

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Ringkasan')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(outletRows), 'Per Outlet')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(platformRows), 'Per Platform')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hariRows), 'Hari Ramai')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detail Sales')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(insightRows), 'Insight')

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(
      new Blob([buffer], { type: 'application/octet-stream' }),
      `analisa-sales-${startDate}-${endDate}.xlsx`,
    )
  }

  // ─── access check ─────────────────────────────────────────────────────────

  if (!profileLoading && profile && profile.role !== 'owner' && profile.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 border border-red-100">
          <Lock className="h-8 w-8 text-red-500" />
        </div>
        <h3 className="text-lg font-extrabold text-slate-950">Akses Ditolak</h3>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Halaman Analisa Sales hanya dapat diakses oleh Admin dan Owner. Hubungi administrator untuk
          mendapatkan akses.
        </p>
      </div>
    )
  }

  // ─── render ────────────────────────────────────────────────────────────────

  const selectedBranchName = filterBranch
    ? branches.find((b) => b.id === filterBranch)?.name || 'Cabang'
    : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Penjualan</p>
          <h2 className="text-2xl font-extrabold text-slate-950">Analisa Sales</h2>
          <p className="text-sm text-slate-500">
            Performa penjualan per outlet, platform, hari, tren, dan insight otomatis.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            onClick={handleExport}
            disabled={loading || postedSales.length === 0}
            className="btn-outline flex w-full items-center gap-2 text-sm sm:w-auto"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </button>
          <button
            onClick={() => load({ force: true })}
            disabled={loading}
            className="btn-primary flex w-full items-center gap-2 text-sm sm:w-auto"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Outlet"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectFilter
            value={filterPlatform}
            onChange={setFilterPlatform}
            placeholder="Semua Platform"
            options={PLATFORM_OPTIONS}
          />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            {periodDays} hari
          </div>
          <button
            onClick={handleReset}
            className="btn-outline text-xs"
          >
            Reset Filter
          </button>
        </div>
        {(filterBranch || filterPlatform) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedBranchName && (
              <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
                Outlet: {selectedBranchName}
              </span>
            )}
            {filterPlatform && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                Platform: {PLATFORM_OPTIONS.find((p) => p.value === filterPlatform)?.label}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}{' '}
          <button onClick={() => load({ force: true })} className="underline hover:no-underline">
            Coba lagi
          </button>
        </div>
      )}

      {loading ? (
        <PageLoading />
      ) : postedSales.length === 0 ? (
        <>
          {pendingSales.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-700">
              Ada {pendingSales.length} laporan belum diposting. Data hanya muncul setelah laporan
              berstatus <strong>Posted</strong>.
            </div>
          )}
          <EmptyState
            title="Belum ada data penjualan"
            description="Tidak ada laporan penjualan posted pada periode dan filter yang dipilih. Coba ubah rentang tanggal atau reset filter."
            action={
              <button onClick={handleReset} className="btn-primary text-sm">
                Reset Filter
              </button>
            }
          />
        </>
      ) : (
        <>
          {/* Summary Cards Row 1 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Total Omzet (Nett)"
              value={formatRupiah(totalOmzet)}
              subtitle={
                <span className="inline-flex items-center gap-1">
                  <GrowthBadge value={growth} />
                </span>
              }
              icon={<TrendingUp className="h-5 w-5" />}
              tone="green"
            />
            <MetricCard
              title="Total Laporan Posted"
              value={formatNumber(postedSales.length)}
              subtitle={pendingSales.length > 0 ? `+${pendingSales.length} belum posted` : 'Semua laporan posted'}
              icon={<ShoppingBag className="h-5 w-5" />}
              tone="neutral"
            />
            <MetricCard
              title="Rata-rata Omzet / Hari"
              value={formatRupiah(totalOmzet / periodDays)}
              subtitle={`Periode ${periodDays} hari`}
              icon={<BarChart3 className="h-5 w-5" />}
              tone="blue"
            />
            <MetricCard
              title="Rata-rata per Laporan"
              value={postedSales.length > 0 ? formatRupiah(totalOmzet / postedSales.length) : 'Rp0'}
              subtitle="Omzet rata-rata tiap laporan"
              icon={<BarChart3 className="h-5 w-5" />}
              tone="orange"
            />
          </div>

          {/* Summary Cards Row 2 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Outlet Omzet Tertinggi"
              value={topOutlet?.branchName || '—'}
              subtitle={topOutlet ? `${formatRupiah(topOutlet.totalOmzet)} (${formatPercentage(topOutlet.revenueShare)})` : 'Belum ada data'}
              icon={<Building2 className="h-5 w-5" />}
              tone="neutral"
            />
            <MetricCard
              title="Platform Terkuat"
              value={topPlatform?.label || '—'}
              subtitle={topPlatform ? `${formatPercentage(topPlatform.pctOfGross)} dari gross sales` : 'Belum ada data'}
              icon={<Star className="h-5 w-5" />}
              tone="neutral"
            />
            <MetricCard
              title="Hari Paling Ramai"
              value={topDay?.dayName || '—'}
              subtitle={topDay ? `Avg ${formatRupiah(topDay.avgOmzet)}/hari` : 'Belum ada data'}
              icon={<CalendarDays className="h-5 w-5" />}
              tone="amber"
            />
            <MetricCard
              title="Omzet Periode Lalu"
              value={prevTotalOmzet > 0 ? formatRupiah(prevTotalOmzet) : '—'}
              subtitle={
                prevTotalOmzet > 0
                  ? `${formatDate(prevStartDate)} – ${formatDate(prevEndDate)}`
                  : 'Belum ada data pembanding'
              }
              icon={growth !== null && growth >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
              tone={growth === null ? 'neutral' : growth >= 0 ? 'green' : 'red'}
            />
          </div>

          {/* Insights */}
          {insights.length > 0 && (
            <section>
              <h3 className="mb-3 text-base font-bold text-slate-950">
                Insight Penjualan
                <span className="ml-2 text-xs font-normal text-slate-400">Otomatis berdasarkan data</span>
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {insights.map((insight, i) => (
                  <InsightCard key={i} insight={insight} />
                ))}
              </div>
            </section>
          )}

          {/* Charts: Trend + Day */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            {/* Tren Omzet */}
            <div className="card p-4 xl:col-span-3">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-950">Tren Omzet</h3>
                  <p className="text-xs text-slate-500">
                    {periodDays > 120 ? 'Agregasi bulanan' : 'Agregasi harian'} •{' '}
                    {filterPlatform
                      ? PLATFORM_OPTIONS.find((p) => p.value === filterPlatform)?.label
                      : 'Semua platform'}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  {formatShortRupiah(totalOmzet)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={18}
                  />
                  <YAxis
                    tickFormatter={formatShortRupiah}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatRupiah(value), 'Omzet']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="omzet"
                    name="Omzet"
                    stroke="#DC2626"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Hari Ramai */}
            <div className="card p-4 xl:col-span-2">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Analisa Hari Ramai</h3>
                <p className="text-xs text-slate-500">Rata-rata omzet per hari dalam seminggu</p>
              </div>
              {dayMetricsSorted.every((d) => d.avgOmzet === 0) ? (
                <EmptyState title="Belum ada data" description="Data hari ramai belum tersedia." />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dayMetricsSorted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="dayName"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: string) => v.slice(0, 3)}
                    />
                    <YAxis
                      tickFormatter={formatShortRupiah}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatRupiah(value), 'Avg Omzet']}
                      labelFormatter={(label) => `Hari ${label}`}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Bar dataKey="avgOmzet" name="Avg Omzet" radius={[6, 6, 0, 0]}>
                      {dayMetricsSorted.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={entry.dayIndex === (topDay?.dayIndex ?? -1) ? '#DC2626' : '#FCA5A5'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Charts: Platform + Outlet */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            {/* Platform Pie */}
            <div className="card p-4 xl:col-span-2">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Komposisi Platform</h3>
                <p className="text-xs text-slate-500">Berdasarkan gross sales per platform</p>
              </div>
              {platformMetrics.length === 0 ? (
                <EmptyState title="Belum ada data" description="Tidak ada data platform tersedia." />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <RechartsPieChart>
                    <Pie
                      data={platformMetrics.map((p) => ({ name: p.label, value: p.grossAmount }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={54}
                      outerRadius={92}
                      paddingAngle={3}
                      label={({ percent: p }) => `${(p * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {platformMetrics.map((p, i) => (
                        <Cell key={i} fill={p.color || CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [formatRupiah(value), name]}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Outlet Bar */}
            <div className="card p-4 xl:col-span-3">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Perbandingan Outlet</h3>
                <p className="text-xs text-slate-500">Total omzet nett per outlet periode ini</p>
              </div>
              {outletMetrics.length === 0 ? (
                <EmptyState title="Belum ada data outlet" description="Tidak ada outlet dengan penjualan." />
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(220, outletMetrics.length * 44)}
                >
                  <BarChart
                    data={outletMetrics.slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 74 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={formatShortRupiah}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="branchName"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      width={70}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatRupiah(value), 'Omzet']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Bar dataKey="totalOmzet" name="Omzet" radius={[0, 8, 8, 0]}>
                      {outletMetrics.slice(0, 8).map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Analisa Hari Ramai - Detail Table */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-base font-bold text-slate-950">Detail Hari Ramai</h3>
              <p className="text-xs text-slate-500">
                Omzet dan laporan per hari dalam seminggu (Senin – Minggu)
              </p>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-auto">
                <thead>
                  <tr>
                    <th className="table-header w-[18%]">Hari</th>
                    <th className="table-header text-right">Total Omzet</th>
                    <th className="table-header text-right">Avg Omzet</th>
                    <th className="table-header text-right">Jumlah Laporan</th>
                    <th className="table-header">Outlet Terlaris</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {dayMetricsSorted.map((d) => (
                    <tr
                      key={d.dayIndex}
                      className={cn(
                        'hover:bg-slate-50',
                        d.dayIndex === topDay?.dayIndex && 'bg-red-50/40',
                      )}
                    >
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-950">{d.dayName}</span>
                          {d.dayIndex === topDay?.dayIndex && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                              Terlaris
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell text-right font-semibold text-rupiah">
                        {d.totalOmzet > 0 ? formatRupiah(d.totalOmzet) : '—'}
                      </td>
                      <td className="table-cell text-right font-semibold text-rupiah">
                        {d.avgOmzet > 0 ? formatRupiah(d.avgOmzet) : '—'}
                      </td>
                      <td className="table-cell text-right">{d.reportCount}</td>
                      <td className="table-cell text-slate-600">
                        {d.reportCount > 0 ? d.topBranch : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile */}
            <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
              {dayMetricsSorted.map((d) => (
                <article key={d.dayIndex} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-950">{d.dayName}</span>
                    {d.dayIndex === topDay?.dayIndex && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                        Terlaris
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-lg font-extrabold text-rupiah text-emerald-600">
                    {d.avgOmzet > 0 ? formatRupiah(d.avgOmzet) : '—'}
                  </p>
                  <p className="text-xs text-slate-500">{d.reportCount} laporan • {d.topBranch}</p>
                </article>
              ))}
            </div>
          </section>

          {/* Analisa per Outlet */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-base font-bold text-slate-950">Analisa per Outlet</h3>
              <p className="text-xs text-slate-500">
                Performa omzet, platform, dan hari terlaris per outlet.
              </p>
            </div>

            {outletMetrics.length === 0 ? (
              <EmptyState
                title="Belum ada data outlet"
                description="Tidak ada outlet dengan laporan posted pada periode ini."
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[960px] table-auto">
                    <thead>
                      <tr>
                        <th className="table-header w-[16%]">Outlet</th>
                        <th className="table-header text-right">Total Omzet</th>
                        <th className="table-header text-right">Share</th>
                        <th className="table-header text-right">Avg/Hari</th>
                        <th className="table-header text-right">Laporan</th>
                        <th className="table-header text-right">Tunai</th>
                        <th className="table-header text-right">QRIS</th>
                        <th className="table-header text-right">Online</th>
                        <th className="table-header">Hari Terlaris</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {outletMetrics.map((o) => {
                        const online = o.gofood + o.grabfood + o.shopeefood
                        return (
                          <tr key={o.branchId} className="hover:bg-slate-50">
                            <td className="table-cell">
                              <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-slate-950">{o.branchName}</p>
                                </div>
                                {o === outletMetrics[0] && (
                                  <span className="flex-shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                    #1
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="table-cell text-right font-bold text-slate-950 text-rupiah">
                              {formatRupiah(o.totalOmzet)}
                            </td>
                            <td className="table-cell text-right">
                              <div>
                                <p className="font-semibold">{formatPercentage(o.revenueShare)}</p>
                                <div className="mt-1 w-16">
                                  <ProgressBar
                                    value={o.revenueShare}
                                    tone={o.revenueShare >= 40 ? 'red' : 'orange'}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="table-cell text-right font-medium text-rupiah">
                              {formatRupiah(o.avgOmzetPerDay)}
                            </td>
                            <td className="table-cell text-right">{o.reportCount}</td>
                            <td className="table-cell text-right text-rupiah text-slate-600">
                              {o.cash > 0 ? formatShortRupiah(o.cash) : '—'}
                            </td>
                            <td className="table-cell text-right text-rupiah text-slate-600">
                              {o.qris > 0 ? formatShortRupiah(o.qris) : '—'}
                            </td>
                            <td className="table-cell text-right text-rupiah text-slate-600">
                              {online > 0 ? formatShortRupiah(online) : '—'}
                            </td>
                            <td className="table-cell font-medium text-slate-700">
                              {o.bestDay || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 lg:hidden">
                  {outletMetrics.map((o, i) => (
                    <article key={o.branchId} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-950">{o.branchName}</p>
                          <p className="text-xs text-slate-500">{o.reportCount} laporan</p>
                        </div>
                        {i === 0 && (
                          <span className="flex-shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">
                            Terbaik
                          </span>
                        )}
                      </div>
                      <p className="mt-2 overflow-x-auto whitespace-nowrap text-xl font-extrabold text-slate-950 text-rupiah scrollbar-thin">
                        {formatRupiah(o.totalOmzet)}
                      </p>
                      <div className="mt-1">
                        <ProgressBar value={o.revenueShare} tone="red" />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-slate-400">Share</p>
                          <p className="font-bold">{formatPercentage(o.revenueShare)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Avg/Hari</p>
                          <p className="font-bold text-rupiah">{formatShortRupiah(o.avgOmzetPerDay)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Hari Terlaris</p>
                          <p className="font-bold">{o.bestDay || '—'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Online</p>
                          <p className="font-bold text-rupiah">
                            {o.gofood + o.grabfood + o.shopeefood > 0
                              ? formatShortRupiah(o.gofood + o.grabfood + o.shopeefood)
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Analisa per Platform */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-base font-bold text-slate-950">Analisa per Platform</h3>
              <p className="text-xs text-slate-500">
                Gross sales, potongan, dan kontribusi tiap platform penjualan.
              </p>
            </div>

            {platformMetrics.length === 0 ? (
              <EmptyState title="Belum ada data platform" description="Data platform tidak tersedia." />
            ) : (
              <div className="divide-y divide-slate-100">
                {platformMetrics.map((p) => {
                  const deduction = p.grossAmount - p.nettAmount
                  const deductPct = pct(deduction, p.grossAmount)
                  return (
                    <div key={p.key} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: p.color }}
                            />
                            <p className="font-bold text-slate-950">{p.label}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              {formatPercentage(p.pctOfGross)} dari total gross
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {p.reportCount} laporan • Avg {formatRupiah(p.avgPerReport)}/laporan •
                            Outlet terkuat: {p.topBranch}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="overflow-x-auto whitespace-nowrap text-sm font-extrabold text-slate-950 text-rupiah scrollbar-thin">
                            {formatRupiah(p.grossAmount)}
                          </p>
                          <p className="text-xs text-slate-400">gross</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <p className="text-slate-400">Nett Diterima</p>
                          <p className="font-bold text-emerald-700 text-rupiah">{formatRupiah(p.nettAmount)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Potongan</p>
                          <p className={cn('font-bold text-rupiah', deduction > 0 ? 'text-red-600' : 'text-slate-500')}>
                            {deduction > 0 ? `${formatRupiah(deduction)} (${formatPercentage(deductPct)})` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Porsi Gross</p>
                          <ProgressBar value={p.pctOfGross} tone="orange" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Detail Sales Table */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-950">Detail Sales</h3>
                  <p className="text-xs text-slate-500">
                    {filteredDetailRows.length} laporan ditemukan
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchDetail}
                    onChange={(e) => setSearchDetail(e.target.value)}
                    placeholder="Cari outlet atau tanggal..."
                    className="input-field pl-9"
                  />
                </div>
              </div>
            </div>

            {filteredDetailRows.length === 0 ? (
              <EmptyState
                title="Tidak ada hasil"
                description="Tidak ada laporan yang cocok dengan pencarian."
              />
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[900px] table-auto">
                    <thead>
                      <tr>
                        <th
                          className="table-header cursor-pointer hover:bg-slate-100"
                          onClick={() => handleSort('report_date')}
                        >
                          Tanggal {sortField === 'report_date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th className="table-header">Hari</th>
                        <th className="table-header">Outlet</th>
                        <th className="table-header text-right">Tunai</th>
                        <th className="table-header text-right">QRIS</th>
                        <th className="table-header text-right">GoFood</th>
                        <th className="table-header text-right">GrabFood</th>
                        <th className="table-header text-right">ShopeeFood</th>
                        <th
                          className="table-header cursor-pointer text-right hover:bg-slate-100"
                          onClick={() => handleSort('grand_total_nett_sales')}
                        >
                          Total Nett {sortField === 'grand_total_nett_sales' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {paginatedDetailRows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="table-cell font-medium">
                            {formatDate(r.report_date, 'dd MMM yyyy')}
                          </td>
                          <td className="table-cell text-slate-600">
                            {HARI[getDay(parseISO(r.report_date))]}
                          </td>
                          <td className="table-cell">
                            <div className="truncate font-semibold text-slate-950">
                              {r.branch?.name || '—'}
                            </div>
                          </td>
                          <td className="table-cell text-right text-rupiah text-slate-700">
                            {toN(r.cash) > 0 ? formatShortRupiah(toN(r.cash)) : '—'}
                          </td>
                          <td className="table-cell text-right text-rupiah text-slate-700">
                            {toN(r.qris_gross) > 0 ? formatShortRupiah(toN(r.qris_gross)) : '—'}
                          </td>
                          <td className="table-cell text-right text-rupiah text-slate-700">
                            {toN(r.gofood_gross) > 0 ? formatShortRupiah(toN(r.gofood_gross)) : '—'}
                          </td>
                          <td className="table-cell text-right text-rupiah text-slate-700">
                            {toN(r.grabfood_gross) > 0 ? formatShortRupiah(toN(r.grabfood_gross)) : '—'}
                          </td>
                          <td className="table-cell text-right text-rupiah text-slate-700">
                            {toN(r.shopeefood_gross) > 0 ? formatShortRupiah(toN(r.shopeefood_gross)) : '—'}
                          </td>
                          <td className="table-cell text-right font-bold text-slate-950 text-rupiah">
                            {formatRupiah(getReportNett(r, filterPlatform))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="divide-y divide-slate-100 lg:hidden">
                  {paginatedDetailRows.map((r) => (
                    <div key={r.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-950">
                            {formatDate(r.report_date, 'EEEE, dd MMMM yyyy')}
                          </p>
                          <p className="text-xs text-slate-500">{r.branch?.name || '—'}</p>
                        </div>
                        <p className="overflow-x-auto whitespace-nowrap text-base font-extrabold text-slate-950 text-rupiah scrollbar-thin">
                          {formatRupiah(getReportNett(r, filterPlatform))}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {toN(r.cash) > 0 && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            Tunai {formatShortRupiah(toN(r.cash))}
                          </span>
                        )}
                        {toN(r.qris_gross) > 0 && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            QRIS {formatShortRupiah(toN(r.qris_gross))}
                          </span>
                        )}
                        {toN(r.gofood_gross) > 0 && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                            GoFood {formatShortRupiah(toN(r.gofood_gross))}
                          </span>
                        )}
                        {toN(r.grabfood_gross) > 0 && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            GrabFood {formatShortRupiah(toN(r.grabfood_gross))}
                          </span>
                        )}
                        {toN(r.shopeefood_gross) > 0 && (
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
                            ShopeeFood {formatShortRupiah(toN(r.shopeefood_gross))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalDetailPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                    <p className="text-xs text-slate-500">
                      Halaman {detailPage} dari {totalDetailPages} ({filteredDetailRows.length} laporan)
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                        disabled={detailPage === 1}
                        className="btn-outline flex h-8 w-8 items-center justify-center p-0 disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {Array.from({ length: Math.min(5, totalDetailPages) }, (_, i) => {
                        const start = Math.max(1, Math.min(detailPage - 2, totalDetailPages - 4))
                        const page = start + i
                        return (
                          <button
                            key={page}
                            onClick={() => setDetailPage(page)}
                            className={cn(
                              'h-8 w-8 rounded-lg text-xs font-semibold transition-colors',
                              page === detailPage
                                ? 'bg-gradient-to-r from-rbn-red to-rbn-orange text-white shadow-sm'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                            )}
                          >
                            {page}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setDetailPage((p) => Math.min(totalDetailPages, p + 1))}
                        disabled={detailPage === totalDetailPages}
                        className="btn-outline flex h-8 w-8 items-center justify-center p-0 disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
