'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  Banknote,
  BarChart3,
  Building2,
  CircleDollarSign,
  FileSpreadsheet,
  PieChart as PieChartIcon,
  RefreshCw,
  Scale,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { addMonths, differenceInDays, eachDayOfInterval, format, parseISO, startOfMonth } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import type { Branch, CashflowTransaction, SalesReport } from '@/types/database'
import { formatDate, formatPercentage, formatRupiah, cn } from '@/lib/utils/format'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { getCachedData, getOrFetchCached } from '@/lib/utils/client-cache'

const CHART_COLORS = ['#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#DB2777', '#0F766E']
const PROFIT_COLORS = {
  revenue: '#16A34A',
  expense: '#DC2626',
  profit: '#2563EB',
  otherIncome: '#0F766E',
}

type CashPositionRow = {
  branch_id: string
  cash_in: number | null
  cash_out: number | null
  branch?: Pick<Branch, 'id' | 'name'> | null
}

type AnalysisData = {
  sales: SalesReport[]
  cashflow: CashflowTransaction[]
  positionRows: CashPositionRow[]
}

type BranchMetric = {
  branchId: string
  branchName: string
  revenue: number
  otherIncome: number
  grossIncome: number
  expense: number
  netProfit: number
  profitMargin: number
  expenseRatio: number
  revenueShare: number
  reportCount: number
  cashIn: number
  cashOut: number
  netCashflow: number
  cashPosition: number
  avgDailyRevenue: number
}

type CategoryMetric = {
  name: string
  amount: number
  count: number
  avgAmount: number
  pctOfExpense: number
  pctOfIncome: number
}

type DailyMetric = {
  key: string
  label: string
  revenue: number
  otherIncome: number
  grossIncome: number
  expense: number
  netProfit: number
  cashIn: number
  cashOut: number
}

type Insight = {
  title: string
  description: string
  value: string
  tone: 'good' | 'warning' | 'danger' | 'neutral'
  icon: ReactNode
}

type BusinessSummary = {
  title: string
  badge: string
  description: string
  tone: 'good' | 'warning' | 'danger' | 'neutral'
  points: { label: string; value: string }[]
}

function toNumber(value: number | null | undefined) {
  return Number(value ?? 0)
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function getCashflowAmount(tx: CashflowTransaction) {
  if (tx.transaction_type === 'cash_in') {
    return toNumber(tx.cash_in) || toNumber(tx.amount)
  }

  return toNumber(tx.cash_out) || toNumber(tx.amount)
}

// Transfer beban antar cabang BUKAN pendapatan/beban baru di level usaha,
// melainkan reklasifikasi beban pokok: cabang pengirim bebannya berkurang
// (dicatat sebagai cash_in) dan cabang penerima bebannya bertambah (cash_out).
function isBebanTransfer(tx: CashflowTransaction) {
  return tx.source === 'beban_transfer'
}

// Kontribusi transaksi ke total beban (contra-beban untuk sisi pengirim transfer).
// Positif = menambah beban, negatif = mengurangi beban.
function getExpenseContribution(tx: CashflowTransaction) {
  const amount = getCashflowAmount(tx)
  if (isBebanTransfer(tx)) {
    return tx.transaction_type === 'cash_in' ? -amount : amount
  }
  return tx.transaction_type === 'cash_out' ? amount : 0
}

function formatShortRupiah(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000)}rb`
  return `${sign}Rp${abs}`
}

function formatSignedRupiah(value: number) {
  if (value > 0) return `+${formatRupiah(value)}`
  return formatRupiah(value)
}

function createBranchMetric(branchId: string, branchName: string): BranchMetric {
  return {
    branchId,
    branchName,
    revenue: 0,
    otherIncome: 0,
    grossIncome: 0,
    expense: 0,
    netProfit: 0,
    profitMargin: 0,
    expenseRatio: 0,
    revenueShare: 0,
    reportCount: 0,
    cashIn: 0,
    cashOut: 0,
    netCashflow: 0,
    cashPosition: 0,
    avgDailyRevenue: 0,
  }
}

function getTrendKey(dateStr: string, groupByMonth: boolean) {
  return groupByMonth ? dateStr.slice(0, 7) : dateStr
}

function getTrendLabel(key: string, groupByMonth: boolean) {
  return groupByMonth ? formatDate(`${key}-01`, 'MMM yy') : formatDate(key, 'dd/MM')
}

function buildTrendSkeleton(startDate: string, endDate: string, groupByMonth: boolean) {
  const map = new Map<string, DailyMetric>()
  const start = parseISO(startDate)
  const end = parseISO(endDate)

  if (groupByMonth) {
    let cursor = startOfMonth(start)
    const endMonth = startOfMonth(end)

    while (cursor <= endMonth) {
      const key = format(cursor, 'yyyy-MM')
      map.set(key, {
        key,
        label: getTrendLabel(key, true),
        revenue: 0,
        otherIncome: 0,
        grossIncome: 0,
        expense: 0,
        netProfit: 0,
        cashIn: 0,
        cashOut: 0,
      })
      cursor = addMonths(cursor, 1)
    }

    return map
  }

  eachDayOfInterval({ start, end }).forEach((date) => {
    const key = format(date, 'yyyy-MM-dd')
    map.set(key, {
      key,
      label: getTrendLabel(key, false),
      revenue: 0,
      otherIncome: 0,
      grossIncome: 0,
      expense: 0,
      netProfit: 0,
      cashIn: 0,
      cashOut: 0,
    })
  })

  return map
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  subtitle?: string
  icon: ReactNode
  tone?: 'green' | 'red' | 'blue' | 'amber' | 'slate' | 'neutral'
}) {
  const toneClass = {
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
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
          {subtitle && <p className="mt-1 break-words text-xs font-medium leading-5 text-slate-500">{subtitle}</p>}
        </div>
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border', toneClass)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function BusinessSummaryCard({ summary }: { summary: BusinessSummary }) {
  const toneStyle = {
    good: {
      accent: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    },
    warning: {
      accent: 'bg-amber-500',
      badge: 'bg-amber-50 text-amber-700 ring-amber-100',
      icon: 'bg-amber-50 text-amber-600 ring-amber-100',
    },
    danger: {
      accent: 'bg-red-500',
      badge: 'bg-red-50 text-red-700 ring-red-100',
      icon: 'bg-red-50 text-red-600 ring-red-100',
    },
    neutral: {
      accent: 'bg-blue-500',
      badge: 'bg-blue-50 text-blue-700 ring-blue-100',
      icon: 'bg-blue-50 text-blue-600 ring-blue-100',
    },
  }[summary.tone]
  const statusIcon = summary.tone === 'danger'
    ? <AlertTriangle className="h-5 w-5" />
    : summary.tone === 'warning'
      ? <Scale className="h-5 w-5" />
      : summary.tone === 'neutral'
        ? <BarChart3 className="h-5 w-5" />
        : <ArrowUpRight className="h-5 w-5" />

  return (
    <section className="card overflow-hidden">
      <div className={cn('h-1.5', toneStyle.accent)} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ring-1', toneStyle.icon)}>
            {statusIcon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ring-1', toneStyle.badge)}>
                {summary.badge}
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Ringkasan Usaha</span>
            </div>
            <h3 className="mt-2 text-xl font-extrabold leading-tight text-slate-950">{summary.title}</h3>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] lg:items-start">
          <p className="max-w-4xl text-sm leading-6 text-slate-700">{summary.description}</p>

          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:border-l lg:border-slate-100 lg:pl-5">
            {summary.points.map((point) => (
              <div key={point.label} className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{point.label}</dt>
                <dd className="mt-1 overflow-x-auto whitespace-nowrap text-base font-extrabold text-slate-950 text-rupiah scrollbar-thin">
                  {point.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
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

function ProgressBar({ value, tone = 'red' }: { value: number; tone?: 'red' | 'green' | 'blue' | 'amber' }) {
  const colorClass = {
    red: 'bg-red-500',
    green: 'bg-emerald-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
  }[tone]

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full', colorClass)} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  )
}

export default function CashflowAnalysisPage() {
  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [sales, setSales] = useState<SalesReport[]>([])
  const [cashflow, setCashflow] = useState<CashflowTransaction[]>([])
  const [positionRows, setPositionRows] = useState<CashPositionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const periodDays = useMemo(() => {
    const days = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1
    return Math.max(days, 1)
  }, [startDate, endDate])

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const cacheKey = `cashflow-analysis:${startDate}:${endDate}:${filterBranch || 'all'}`
    const cached = getCachedData<AnalysisData>(cacheKey)

    if (cached && !options.force) {
      setSales(cached.sales)
      setCashflow(cached.cashflow)
      setPositionRows(cached.positionRows)
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

          let cashflowQuery = supabase
            .from('cashflow_transactions')
            .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
            .eq('status', 'active')
            .gte('transaction_date', startDate)
            .lte('transaction_date', endDate)
            .order('transaction_date', { ascending: true })

          let positionQuery = supabase
            .from('cashflow_transactions')
            .select('branch_id,cash_in,cash_out,branch:branches(id,name)')
            .eq('status', 'active')
            .gte('transaction_date', startDate)
            .lte('transaction_date', endDate)

          if (filterBranch) {
            salesQuery = salesQuery.eq('branch_id', filterBranch)
            cashflowQuery = cashflowQuery.eq('branch_id', filterBranch)
            positionQuery = positionQuery.eq('branch_id', filterBranch)
          }

          const [salesResult, cashflowResult, positionResult] = await Promise.all([
            salesQuery,
            cashflowQuery,
            positionQuery,
          ])

          if (salesResult.error) throw salesResult.error
          if (cashflowResult.error) throw cashflowResult.error
          if (positionResult.error) throw positionResult.error

          return {
            sales: salesResult.data || [],
            cashflow: cashflowResult.data || [],
            positionRows: (positionResult.data || []) as unknown as CashPositionRow[],
          }
        },
        { ttlMs: 60_000, force: options.force || Boolean(cached) }
      )

      setSales(data.sales)
      setCashflow(data.cashflow)
      setPositionRows(data.positionRows)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat analisa cashflow.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [endDate, filterBranch, startDate])

  useEffect(() => { load() }, [load])

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
        { ttlMs: 5 * 60_000 }
      )

      setBranches(data)
    }

    loadBranches()
  }, [])

  const postedSales = useMemo(() => sales.filter((report) => report.status === 'posted'), [sales])
  const pendingSales = useMemo(() => sales.filter((report) => report.status !== 'posted'), [sales])

  const summary = useMemo(() => {
    const revenue = postedSales.reduce((sum, report) => sum + toNumber(report.grand_total_nett_sales), 0)
    // Transfer beban tidak dihitung sebagai cash in / pendapatan.
    const cashIn = cashflow
      .filter((tx) => tx.transaction_type === 'cash_in' && !isBebanTransfer(tx))
      .reduce((sum, tx) => sum + getCashflowAmount(tx), 0)
    const salesCashIn = cashflow
      .filter((tx) => tx.transaction_type === 'cash_in' && tx.source === 'sales')
      .reduce((sum, tx) => sum + getCashflowAmount(tx), 0)
    const otherIncome = cashflow
      .filter((tx) => tx.transaction_type === 'cash_in' && tx.source !== 'sales' && !isBebanTransfer(tx))
      .reduce((sum, tx) => sum + getCashflowAmount(tx), 0)
    // Beban = total cash out, dikurangi kredit transfer beban (sisi pengirim).
    const expense = cashflow.reduce((sum, tx) => sum + getExpenseContribution(tx), 0)
    const cashPosition = positionRows.reduce((sum, row) => sum + toNumber(row.cash_in) - toNumber(row.cash_out), 0)
    const grossIncome = revenue + otherIncome
    const netProfit = grossIncome - expense

    return {
      revenue,
      otherIncome,
      grossIncome,
      expense,
      netProfit,
      profitMargin: percent(netProfit, grossIncome),
      expenseRatio: percent(expense, grossIncome),
      cashIn,
      salesCashIn,
      cashOut: expense,
      netCashflow: cashIn - expense,
      cashPosition,
      avgDailyRevenue: revenue / periodDays,
      avgDailyExpense: expense / periodDays,
      postedReportCount: postedSales.length,
      pendingReportCount: pendingSales.length,
      pendingSalesValue: pendingSales.reduce((sum, report) => sum + toNumber(report.grand_total_nett_sales), 0),
    }
  }, [cashflow, pendingSales, periodDays, positionRows, postedSales])

  const branchMetrics = useMemo(() => {
    const branchMap = new Map<string, BranchMetric>()
    const visibleBranches = filterBranch
      ? branches.filter((branch) => branch.id === filterBranch)
      : branches

    visibleBranches.forEach((branch) => {
      branchMap.set(branch.id, createBranchMetric(branch.id, branch.name))
    })

    function ensureBranch(branchId: string, fallbackName?: string | null) {
      const existing = branchMap.get(branchId)
      if (existing) return existing

      const metric = createBranchMetric(branchId, fallbackName || 'Cabang')
      branchMap.set(branchId, metric)
      return metric
    }

    postedSales.forEach((report) => {
      const metric = ensureBranch(report.branch_id, report.branch?.name)
      metric.revenue += toNumber(report.grand_total_nett_sales)
      metric.reportCount += 1
    })

    cashflow.forEach((tx) => {
      const amount = getCashflowAmount(tx)
      const metric = ensureBranch(tx.branch_id, tx.branch?.name)

      // Transfer beban: reklasifikasi beban antar cabang, bukan pendapatan/cash flow operasional.
      if (isBebanTransfer(tx)) {
        metric.expense += getExpenseContribution(tx)
        return
      }

      if (tx.transaction_type === 'cash_in') {
        metric.cashIn += amount
        if (tx.source !== 'sales') metric.otherIncome += amount
      } else {
        metric.cashOut += amount
        metric.expense += amount
      }
    })

    positionRows.forEach((row) => {
      const metric = ensureBranch(row.branch_id, row.branch?.name)
      metric.cashPosition += toNumber(row.cash_in) - toNumber(row.cash_out)
    })

    return Array.from(branchMap.values())
      .map((metric) => {
        const grossIncome = metric.revenue + metric.otherIncome
        const netProfit = grossIncome - metric.expense

        return {
          ...metric,
          grossIncome,
          netProfit,
          netCashflow: metric.cashIn - metric.cashOut,
          profitMargin: percent(netProfit, grossIncome),
          expenseRatio: percent(metric.expense, grossIncome),
          revenueShare: percent(metric.revenue, summary.revenue),
          avgDailyRevenue: metric.revenue / periodDays,
        }
      })
      .sort((a, b) => b.netProfit - a.netProfit || b.revenue - a.revenue || a.branchName.localeCompare(b.branchName))
  }, [branches, cashflow, filterBranch, periodDays, positionRows, postedSales, summary.revenue])

  const expenseCategories = useMemo<CategoryMetric[]>(() => {
    const map = new Map<string, { amount: number; count: number }>()

    cashflow
      // Cash out biasa + kredit transfer beban (sisi pengirim) sebagai pengurang.
      .filter((tx) => tx.transaction_type === 'cash_out' || isBebanTransfer(tx))
      .forEach((tx) => {
        const name = tx.category?.name || 'Tanpa Kategori'
        const existing = map.get(name) || { amount: 0, count: 0 }
        existing.amount += getExpenseContribution(tx)
        existing.count += 1
        map.set(name, existing)
      })

    return Array.from(map.entries())
      .map(([name, row]) => ({
        name,
        amount: row.amount,
        count: row.count,
        avgAmount: row.count > 0 ? row.amount / row.count : 0,
        pctOfExpense: percent(row.amount, summary.expense),
        pctOfIncome: percent(row.amount, summary.grossIncome),
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [cashflow, summary.expense, summary.grossIncome])

  const incomeCategories = useMemo<CategoryMetric[]>(() => {
    const map = new Map<string, { amount: number; count: number }>()

    cashflow
      .filter((tx) => tx.transaction_type === 'cash_in' && tx.source !== 'sales' && !isBebanTransfer(tx))
      .forEach((tx) => {
        const name = tx.category?.name || 'Cash In Lainnya'
        const existing = map.get(name) || { amount: 0, count: 0 }
        existing.amount += getCashflowAmount(tx)
        existing.count += 1
        map.set(name, existing)
      })

    return Array.from(map.entries())
      .map(([name, row]) => ({
        name,
        amount: row.amount,
        count: row.count,
        avgAmount: row.count > 0 ? row.amount / row.count : 0,
        pctOfExpense: 0,
        pctOfIncome: percent(row.amount, summary.grossIncome),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [cashflow, summary.grossIncome])

  const largestExpenses = useMemo(() => {
    return cashflow
      // Transfer beban internal tidak ditampilkan sebagai beban terbesar.
      .filter((tx) => tx.transaction_type === 'cash_out' && !isBebanTransfer(tx))
      .sort((a, b) => getCashflowAmount(b) - getCashflowAmount(a))
      .slice(0, 10)
  }, [cashflow])

  const trendData = useMemo<DailyMetric[]>(() => {
    const groupByMonth = periodDays > 120
    const map = buildTrendSkeleton(startDate, endDate, groupByMonth)

    function ensureRow(dateStr: string) {
      const key = getTrendKey(dateStr, groupByMonth)
      const existing = map.get(key)
      if (existing) return existing

      const row: DailyMetric = {
        key,
        label: getTrendLabel(key, groupByMonth),
        revenue: 0,
        otherIncome: 0,
        grossIncome: 0,
        expense: 0,
        netProfit: 0,
        cashIn: 0,
        cashOut: 0,
      }
      map.set(key, row)
      return row
    }

    postedSales.forEach((report) => {
      const row = ensureRow(report.report_date)
      row.revenue += toNumber(report.grand_total_nett_sales)
    })

    cashflow.forEach((tx) => {
      const row = ensureRow(tx.transaction_date)
      const amount = getCashflowAmount(tx)

      // Transfer beban: reklasifikasi beban, bukan pendapatan.
      if (isBebanTransfer(tx)) {
        row.expense += getExpenseContribution(tx)
        return
      }

      if (tx.transaction_type === 'cash_in') {
        row.cashIn += amount
        if (tx.source !== 'sales') row.otherIncome += amount
      } else {
        row.cashOut += amount
        row.expense += amount
      }
    })

    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => {
        const grossIncome = row.revenue + row.otherIncome
        return {
          ...row,
          grossIncome,
          netProfit: grossIncome - row.expense,
        }
      })
  }, [cashflow, endDate, periodDays, postedSales, startDate])

  const expenseChartData = useMemo(() => {
    const top = expenseCategories.slice(0, 6).map((category) => ({
      name: category.name,
      value: category.amount,
    }))
    const others = expenseCategories.slice(6).reduce((sum, category) => sum + category.amount, 0)

    if (others > 0) top.push({ name: 'Lainnya', value: others })
    return top
  }, [expenseCategories])

  const branchChartData = useMemo(() => {
    return branchMetrics
      .filter((branch) => branch.revenue > 0 || branch.expense > 0 || branch.otherIncome > 0)
      .slice(0, 10)
      .map((branch) => ({
        name: branch.branchName,
        netProfit: branch.netProfit,
        revenue: branch.revenue,
        expense: branch.expense,
      }))
  }, [branchMetrics])

  const insights = useMemo<Insight[]>(() => {
    const rows: Insight[] = []
    const topExpense = expenseCategories[0]
    const topBranch = branchMetrics.find((branch) => branch.revenue > 0)
    const negativeBranches = branchMetrics.filter((branch) => branch.netProfit < 0)
    const negativeCashBranches = branchMetrics.filter((branch) => branch.cashPosition < 0)

    if (summary.grossIncome === 0) {
      rows.push({
        title: 'P&L',
        value: 'Belum Ada Revenue',
        description: 'Tidak ada sales posted atau cash in lain pada filter ini.',
        tone: 'neutral',
        icon: <Scale className="h-4 w-4" />,
      })
    } else if (summary.netProfit < 0) {
      rows.push({
        title: 'P&L',
        value: formatRupiah(summary.netProfit),
        description: `Rugi bersih ${formatPercentage(Math.abs(summary.profitMargin))} dari income.`,
        tone: 'danger',
        icon: <ArrowDownRight className="h-4 w-4" />,
      })
    } else {
      rows.push({
        title: 'P&L',
        value: formatRupiah(summary.netProfit),
        description: `Margin bersih ${formatPercentage(summary.profitMargin)} dari income.`,
        tone: 'good',
        icon: <ArrowUpRight className="h-4 w-4" />,
      })
    }

    rows.push({
      title: 'Rasio Beban',
      value: formatPercentage(summary.expenseRatio),
      description: summary.expenseRatio > 80
        ? 'Beban sudah sangat tinggi terhadap income.'
        : summary.expenseRatio > 60
          ? 'Beban perlu dikontrol agar margin tidak tertekan.'
          : 'Beban masih sehat terhadap income periode ini.',
      tone: summary.expenseRatio > 80 ? 'danger' : summary.expenseRatio > 60 ? 'warning' : 'good',
      icon: <PieChartIcon className="h-4 w-4" />,
    })

    if (topExpense) {
      rows.push({
        title: 'Beban Terbesar',
        value: topExpense.name,
        description: `${formatRupiah(topExpense.amount)} atau ${formatPercentage(topExpense.pctOfExpense)} dari total beban.`,
        tone: topExpense.pctOfExpense >= 35 ? 'warning' : 'neutral',
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    }

    if (topBranch) {
      rows.push({
        title: 'Kontributor Sales',
        value: topBranch.branchName,
        description: `${formatPercentage(topBranch.revenueShare)} dari revenue posted berasal dari cabang ini.`,
        tone: topBranch.revenueShare >= 55 && branchMetrics.length > 1 ? 'warning' : 'neutral',
        icon: <Building2 className="h-4 w-4" />,
      })
    }

    if (negativeBranches.length > 0) {
      rows.push({
        title: 'Cabang Rugi',
        value: `${negativeBranches.length} cabang`,
        description: `Rugi terbesar ada di ${negativeBranches[0].branchName}: ${formatRupiah(negativeBranches[0].netProfit)}.`,
        tone: 'danger',
        icon: <ArrowDownRight className="h-4 w-4" />,
      })
    }

    if (negativeCashBranches.length > 0) {
      rows.push({
        title: 'Posisi Kas',
        value: `${negativeCashBranches.length} cabang minus`,
        description: `Kas terendah ada di ${negativeCashBranches[0].branchName}: ${formatRupiah(negativeCashBranches[0].cashPosition)}.`,
        tone: 'danger',
        icon: <Wallet className="h-4 w-4" />,
      })
    }

    if (summary.pendingReportCount > 0) {
      rows.push({
        title: 'Data Sales',
        value: `${summary.pendingReportCount} belum posted`,
        description: `Nilai belum final ${formatRupiah(summary.pendingSalesValue)} tidak dihitung ke P&L.`,
        tone: 'warning',
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    }

    return rows.slice(0, 6)
  }, [branchMetrics, expenseCategories, summary])

  const businessSummary = useMemo<BusinessSummary>(() => {
    const selectedBranch = filterBranch
      ? branches.find((branch) => branch.id === filterBranch)
      : null
    const scope = selectedBranch ? `cabang ${selectedBranch.name}` : 'semua cabang'
    const topExpense = expenseCategories[0]
    const topBranch = branchMetrics.find((branch) => branch.revenue > 0)
    const pendingText = summary.pendingReportCount > 0
      ? ` Ada ${summary.pendingReportCount} laporan belum posted senilai ${formatRupiah(summary.pendingSalesValue)}, jadi angka final bisa berubah setelah laporan diposting.`
      : ''
    const expenseText = topExpense
      ? ` Pengeluaran terbesar adalah ${topExpense.name} sebesar ${formatRupiah(topExpense.amount)} (${formatPercentage(topExpense.pctOfExpense)} dari total beban).`
      : ' Tidak ada pengeluaran aktif pada periode ini.'
    const branchText = !selectedBranch && topBranch
      ? ` Kontributor sales terbesar adalah ${topBranch.branchName} dengan porsi ${formatPercentage(topBranch.revenueShare)} dari revenue posted.`
      : ''

    if (summary.grossIncome <= 0) {
      return {
        title: 'Belum ada income yang bisa dianalisa',
        badge: 'Perlu data',
        description: `Pada periode ini ${scope} belum memiliki sales posted atau pendapatan lain. Cashflow belum bisa dinilai sebagai untung atau rugi sampai laporan penjualan diposting dan transaksi kas tercatat.${pendingText}`,
        tone: 'neutral',
        points: [
          { label: 'Income', value: formatRupiah(summary.grossIncome) },
          { label: 'Beban', value: formatRupiah(summary.expense) },
          { label: 'Profit', value: formatRupiah(summary.netProfit) },
          { label: 'Kas', value: formatRupiah(summary.cashPosition) },
        ],
      }
    }

    if (summary.netProfit < 0) {
      return {
        title: 'Usaha sedang rugi pada periode ini',
        badge: 'Rugi',
        description: `Untuk ${scope}, beban ${formatRupiah(summary.expense)} melebihi income ${formatRupiah(summary.grossIncome)}, sehingga rugi bersih menjadi ${formatRupiah(summary.netProfit)}. Prioritasnya adalah menekan beban terbesar dan mengecek cabang dengan profit negatif.${expenseText}${branchText}${pendingText}`,
        tone: 'danger',
        points: [
          { label: 'Income', value: formatRupiah(summary.grossIncome) },
          { label: 'Beban', value: formatRupiah(summary.expense) },
          { label: 'Margin', value: formatPercentage(summary.profitMargin) },
          { label: 'Net Cashflow', value: formatRupiah(summary.netCashflow) },
        ],
      }
    }

    if (summary.profitMargin >= 50 && summary.expenseRatio <= 35) {
      return {
        title: 'Income kuat, beban rendah',
        badge: 'Sangat sehat',
        description: `Untuk ${scope}, income mencapai ${formatRupiah(summary.grossIncome)} dan beban hanya ${formatRupiah(summary.expense)} (${formatPercentage(summary.expenseRatio)} dari income). Profit bersih ${formatRupiah(summary.netProfit)} dengan margin ${formatPercentage(summary.profitMargin)}, jadi cashflow periode ini sangat kuat.${expenseText}${branchText}${pendingText}`,
        tone: 'good',
        points: [
          { label: 'Income', value: formatRupiah(summary.grossIncome) },
          { label: 'Beban', value: formatRupiah(summary.expense) },
          { label: 'Profit', value: formatRupiah(summary.netProfit) },
          { label: 'Margin', value: formatPercentage(summary.profitMargin) },
        ],
      }
    }

    if (summary.profitMargin >= 20) {
      return {
        title: 'Kondisi usaha cukup sehat',
        badge: 'Sehat',
        description: `Untuk ${scope}, usaha menghasilkan profit ${formatRupiah(summary.netProfit)} dari income ${formatRupiah(summary.grossIncome)}. Rasio beban ${formatPercentage(summary.expenseRatio)}, sehingga margin masih sehat tetapi tetap perlu dipantau agar biaya tidak naik terlalu cepat.${expenseText}${branchText}${pendingText}`,
        tone: 'good',
        points: [
          { label: 'Income', value: formatRupiah(summary.grossIncome) },
          { label: 'Beban', value: formatRupiah(summary.expense) },
          { label: 'Profit', value: formatRupiah(summary.netProfit) },
          { label: 'Kas', value: formatRupiah(summary.cashPosition) },
        ],
      }
    }

    return {
      title: 'Profit masih positif, tetapi margin tipis',
      badge: 'Perlu kontrol',
      description: `Untuk ${scope}, profit masih positif di ${formatRupiah(summary.netProfit)}, tetapi margin hanya ${formatPercentage(summary.profitMargin)} karena beban sudah mencapai ${formatPercentage(summary.expenseRatio)} dari income. Fokus kontrol biaya sebelum margin turun lebih jauh.${expenseText}${branchText}${pendingText}`,
      tone: 'warning',
      points: [
        { label: 'Income', value: formatRupiah(summary.grossIncome) },
        { label: 'Beban', value: formatRupiah(summary.expense) },
        { label: 'Margin', value: formatPercentage(summary.profitMargin) },
        { label: 'Net Cashflow', value: formatRupiah(summary.netCashflow) },
      ],
    }
  }, [branchMetrics, branches, expenseCategories, filterBranch, summary])

  async function handleExport() {
    const [XLSX, { saveAs }] = await Promise.all([
      import('xlsx'),
      import('file-saver'),
    ])
    const wb = XLSX.utils.book_new()

    const overviewRows = [{
      'Periode Awal': formatDate(startDate, 'dd/MM/yyyy'),
      'Periode Akhir': formatDate(endDate, 'dd/MM/yyyy'),
      Cabang: filterBranch ? branches.find((branch) => branch.id === filterBranch)?.name || '' : 'Semua Cabang',
      'Revenue Posted': summary.revenue,
      'Pendapatan Lain': summary.otherIncome,
      'Income Total': summary.grossIncome,
      'Beban': summary.expense,
      'Profit Bersih': summary.netProfit,
      'Margin Profit (%)': summary.profitMargin.toFixed(2),
      'Rasio Beban (%)': summary.expenseRatio.toFixed(2),
      'Posisi Kas': summary.cashPosition,
      'Sales Posted': summary.postedReportCount,
      'Sales Belum Posted': summary.pendingReportCount,
    }]

    const branchRows = branchMetrics.map((branch) => ({
      Cabang: branch.branchName,
      'Revenue Posted': branch.revenue,
      'Pendapatan Lain': branch.otherIncome,
      'Income Total': branch.grossIncome,
      Beban: branch.expense,
      'Profit Bersih': branch.netProfit,
      'Margin Profit (%)': branch.profitMargin.toFixed(2),
      'Rasio Beban (%)': branch.expenseRatio.toFixed(2),
      'Share Revenue (%)': branch.revenueShare.toFixed(2),
      'Cash In': branch.cashIn,
      'Cash Out': branch.cashOut,
      'Net Cashflow': branch.netCashflow,
      'Posisi Kas': branch.cashPosition,
      'Jumlah Laporan Posted': branch.reportCount,
    }))

    const expenseRows = expenseCategories.map((category) => ({
      Kategori: category.name,
      Total: category.amount,
      Transaksi: category.count,
      'Rata-rata': category.avgAmount,
      '% dari Beban': category.pctOfExpense.toFixed(2),
      '% dari Income': category.pctOfIncome.toFixed(2),
    }))

    const largestRows = largestExpenses.map((tx) => ({
      Tanggal: formatDate(tx.transaction_date, 'dd/MM/yyyy'),
      Cabang: tx.branch?.name || '',
      Kategori: tx.category?.name || 'Tanpa Kategori',
      Deskripsi: tx.description || '',
      Nominal: getCashflowAmount(tx),
      '% dari Beban': percent(getCashflowAmount(tx), summary.expense).toFixed(2),
    }))

    const insightRows = insights.map((insight) => ({
      Analisa: insight.title,
      Nilai: insight.value,
      Status: insight.tone,
      Keterangan: insight.description,
    }))

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Ringkasan')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows), 'P&L Cabang')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), 'Kategori Beban')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(largestRows), 'Beban Terbesar')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(insightRows), 'Insight')

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `analisa-cashflow-${startDate}-${endDate}.xlsx`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Keuangan</p>
          <h2 className="text-2xl font-extrabold text-slate-950">Analisa Cashflow</h2>
          <p className="text-sm text-slate-500">P&L, komposisi beban, profit cabang, posisi kas, dan sinyal risiko.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            onClick={handleExport}
            disabled={loading}
            className="btn-outline flex w-full items-center gap-2 text-sm sm:w-auto"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Analisa
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

      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Cabang"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            {periodDays} hari
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoading />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <MetricCard
              title="Revenue Posted"
              value={formatRupiah(summary.revenue)}
              subtitle={`${summary.postedReportCount} laporan posted`}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="green"
            />
            <MetricCard
              title="Pendapatan Lain"
              value={formatRupiah(summary.otherIncome)}
              subtitle="Cash in non-sales"
              icon={<CircleDollarSign className="h-5 w-5" />}
              tone="blue"
            />
            <MetricCard
              title="Total Beban"
              value={formatRupiah(summary.expense)}
              subtitle={`${formatPercentage(summary.expenseRatio)} dari income`}
              icon={<ArrowDownRight className="h-5 w-5" />}
              tone="red"
            />
            <MetricCard
              title="Profit Bersih"
              value={formatRupiah(summary.netProfit)}
              subtitle={`Margin ${formatPercentage(summary.profitMargin)}`}
              icon={summary.netProfit >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
              tone={summary.netProfit >= 0 ? 'green' : 'red'}
            />
            <MetricCard
              title="Posisi Kas"
              value={formatRupiah(summary.cashPosition)}
              subtitle={`Sampai ${formatDate(endDate)}`}
              icon={<Wallet className="h-5 w-5" />}
              tone={summary.cashPosition >= 0 ? 'slate' : 'amber'}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <MetricCard
              title="Cash In Periode"
              value={formatRupiah(summary.cashIn)}
              subtitle={`Sales sync ${formatRupiah(summary.salesCashIn)}`}
              icon={<Banknote className="h-5 w-5" />}
              tone="green"
            />
            <MetricCard
              title="Net Cashflow"
              value={formatRupiah(summary.netCashflow)}
              subtitle={`Cash in - cash out periode`}
              icon={<Scale className="h-5 w-5" />}
              tone={summary.netCashflow >= 0 ? 'blue' : 'amber'}
            />
            <MetricCard
              title="Rata-rata Harian"
              value={formatRupiah(summary.avgDailyRevenue)}
              subtitle={`Beban harian ${formatRupiah(summary.avgDailyExpense)}`}
              icon={<BarChart3 className="h-5 w-5" />}
              tone="neutral"
            />
          </div>

          <BusinessSummaryCard summary={businessSummary} />

          {insights.length > 0 && (
            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {insights.map((insight) => (
                <InsightCard key={`${insight.title}-${insight.value}`} insight={insight} />
              ))}
            </section>
          )}

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="card p-4 xl:col-span-3">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-950">Tren P&L</h3>
                  <p className="text-xs text-slate-500">{periodDays > 120 ? 'Agregasi bulanan' : 'Agregasi harian'}</p>
                </div>
                <span className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-bold',
                  summary.netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                )}>
                  {formatSignedRupiah(summary.netProfit)}
                </span>
              </div>

              {trendData.length === 0 ? (
                <EmptyState title="Belum ada tren" description="Tidak ada data pada filter ini." />
              ) : (
                <ResponsiveContainer width="100%" height={290}>
                  <LineChart data={trendData} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} minTickGap={18} />
                    <YAxis tickFormatter={formatShortRupiah} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatRupiah(value), name]}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="grossIncome" name="Income" stroke={PROFIT_COLORS.revenue} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="expense" name="Beban" stroke={PROFIT_COLORS.expense} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="netProfit" name="Profit" stroke={PROFIT_COLORS.profit} strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card p-4 xl:col-span-2">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Komposisi Beban</h3>
                <p className="text-xs text-slate-500">{expenseCategories.length} kategori beban</p>
              </div>

              {expenseChartData.length === 0 ? (
                <EmptyState title="Belum ada beban" description="Tidak ada cash out aktif pada filter ini." />
              ) : (
                <ResponsiveContainer width="100%" height={290}>
                  <RechartsPieChart>
                    <Pie
                      data={expenseChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={54}
                      outerRadius={92}
                      paddingAngle={3}
                      label={({ percent: pct }) => `${(pct * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {expenseChartData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
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
          </section>

          {branchChartData.length > 0 && (
            <section className="card p-4">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Profit Bersih per Cabang</h3>
                <p className="text-xs text-slate-500">Diurutkan berdasarkan profit bersih periode filter.</p>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(220, branchChartData.length * 44)}>
                <BarChart data={branchChartData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 74 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatShortRupiah} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} width={70} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatRupiah(value), name]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                  />
                  <Bar dataKey="netProfit" name="Profit Bersih" radius={[0, 8, 8, 0]}>
                    {branchChartData.map((branch, index) => (
                      <Cell key={index} fill={branch.netProfit >= 0 ? '#2563EB' : '#DC2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-base font-bold text-slate-950">P&L per Cabang</h3>
              <p className="text-xs text-slate-500">Revenue posted + pendapatan lain - beban cash out.</p>
            </div>

            {branchMetrics.length === 0 ? (
              <EmptyState title="Belum ada cabang" description="Tidak ada cabang aktif pada filter ini." />
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1120px] table-auto">
                    <thead>
                      <tr>
                        <th className="table-header w-[16%]">Cabang</th>
                        <th className="table-header text-right">Revenue</th>
                        <th className="table-header text-right">Income Lain</th>
                        <th className="table-header text-right">Beban</th>
                        <th className="table-header text-right">Profit</th>
                        <th className="table-header text-right">Margin</th>
                        <th className="table-header text-right">Rasio Beban</th>
                        <th className="table-header text-right">Posisi Kas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {branchMetrics.map((branch) => (
                        <tr key={branch.branchId} className="hover:bg-slate-50">
                          <td className="table-cell font-semibold"><div className="truncate">{branch.branchName}</div></td>
                          <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(branch.revenue)}</td>
                          <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(branch.otherIncome)}</td>
                          <td className="table-cell text-right font-medium text-red-600 text-rupiah">{formatRupiah(branch.expense)}</td>
                          <td className={cn('table-cell text-right font-bold text-rupiah', branch.netProfit >= 0 ? 'text-blue-600' : 'text-red-600')}>
                            {formatRupiah(branch.netProfit)}
                          </td>
                          <td className="table-cell text-right font-semibold">{formatPercentage(branch.profitMargin)}</td>
                          <td className="table-cell text-right font-semibold">{formatPercentage(branch.expenseRatio)}</td>
                          <td className={cn('table-cell text-right font-bold text-rupiah', branch.cashPosition >= 0 ? 'text-slate-700' : 'text-amber-600')}>
                            {formatRupiah(branch.cashPosition)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 lg:hidden">
                  {branchMetrics.map((branch) => (
                    <article key={branch.branchId} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-950">{branch.branchName}</p>
                          <p className="text-xs text-slate-500">{branch.reportCount} laporan posted</p>
                        </div>
                        <span className={cn(
                          'rounded-full px-2 py-1 text-xs font-bold',
                          branch.netProfit >= 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                        )}>
                          {formatPercentage(branch.profitMargin)}
                        </span>
                      </div>
                      <p className={cn('mt-3 overflow-x-auto whitespace-nowrap pb-0.5 text-xl font-extrabold text-rupiah scrollbar-thin', branch.netProfit >= 0 ? 'text-blue-600' : 'text-red-600')}>
                        {formatRupiah(branch.netProfit)}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-slate-500">Revenue</p>
                          <p className="overflow-x-auto whitespace-nowrap font-semibold text-rupiah scrollbar-thin">{formatRupiah(branch.revenue)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Beban</p>
                          <p className="overflow-x-auto whitespace-nowrap font-semibold text-red-600 text-rupiah scrollbar-thin">{formatRupiah(branch.expense)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Rasio Beban</p>
                          <p className="font-semibold">{formatPercentage(branch.expenseRatio)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Posisi Kas</p>
                          <p className="overflow-x-auto whitespace-nowrap font-semibold text-rupiah scrollbar-thin">{formatRupiah(branch.cashPosition)}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 p-4">
                <h3 className="text-base font-bold text-slate-950">Kategori Beban Terbesar</h3>
                <p className="text-xs text-slate-500">Persentase dihitung dari total cash out periode ini.</p>
              </div>

              {expenseCategories.length === 0 ? (
                <EmptyState title="Belum ada beban" description="Tidak ada kategori cash out pada filter ini." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {expenseCategories.slice(0, 8).map((category) => (
                    <div key={category.name} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-950">{category.name}</p>
                          <p className="text-xs text-slate-500">
                            {category.count} transaksi, rata-rata {formatRupiah(category.avgAmount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="overflow-x-auto whitespace-nowrap text-sm font-extrabold text-red-600 text-rupiah scrollbar-thin">{formatRupiah(category.amount)}</p>
                          <p className="text-xs font-bold text-slate-500">{formatPercentage(category.pctOfExpense)}</p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <ProgressBar value={category.pctOfExpense} tone="red" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 p-4">
                <h3 className="text-base font-bold text-slate-950">Transaksi Beban Terbesar</h3>
                <p className="text-xs text-slate-500">Top transaksi cash out aktif pada periode filter.</p>
              </div>

              {largestExpenses.length === 0 ? (
                <EmptyState title="Belum ada transaksi" description="Tidak ada cash out aktif pada filter ini." />
              ) : (
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[900px] table-auto">
                    <thead>
                      <tr>
                        <th className="table-header w-[15%]">Tanggal</th>
                        <th className="table-header w-[18%]">Cabang</th>
                        <th className="table-header">Kategori</th>
                        <th className="table-header text-right">Nominal</th>
                        <th className="table-header w-[13%] text-right">Porsi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {largestExpenses.map((tx) => {
                        const amount = getCashflowAmount(tx)
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="table-cell font-medium">{formatDate(tx.transaction_date, 'dd/MM/yy')}</td>
                            <td className="table-cell"><div className="truncate">{tx.branch?.name || '-'}</div></td>
                            <td className="table-cell">
                              <div className="min-w-0">
                                <p className="truncate font-semibold">{tx.category?.name || 'Tanpa Kategori'}</p>
                                {tx.description && <p className="truncate text-xs text-slate-500">{tx.description}</p>}
                              </div>
                            </td>
                            <td className="table-cell text-right font-bold text-red-600 text-rupiah">{formatRupiah(amount)}</td>
                            <td className="table-cell text-right font-semibold">{formatPercentage(percent(amount, summary.expense))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {largestExpenses.length > 0 && (
                <div className="space-y-3 p-3 md:hidden">
                  {largestExpenses.map((tx) => {
                    const amount = getCashflowAmount(tx)
                    return (
                      <article key={tx.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-950">{formatDate(tx.transaction_date, 'dd MMM yyyy')}</p>
                            <p className="truncate text-xs text-slate-500">{tx.branch?.name || '-'}</p>
                          </div>
                          <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-600">
                            {formatPercentage(percent(amount, summary.expense))}
                          </span>
                        </div>
                        <p className="mt-3 truncate text-sm font-bold text-slate-950">{tx.category?.name || 'Tanpa Kategori'}</p>
                        {tx.description && <p className="truncate text-xs text-slate-500">{tx.description}</p>}
                        <p className="mt-2 overflow-x-auto whitespace-nowrap text-lg font-extrabold text-red-600 text-rupiah scrollbar-thin">{formatRupiah(amount)}</p>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {incomeCategories.length > 0 && (
            <section className="card overflow-hidden">
              <div className="border-b border-slate-100 p-4">
                <h3 className="text-base font-bold text-slate-950">Pendapatan Non-Sales</h3>
                <p className="text-xs text-slate-500">Cash in manual atau sumber selain sinkronisasi sales.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {incomeCategories.map((category) => (
                  <article key={category.name} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-950">{category.name}</p>
                        <p className="text-xs text-slate-500">{category.count} transaksi</p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                        {formatPercentage(category.pctOfIncome)}
                      </span>
                    </div>
                    <p className="mt-3 overflow-x-auto whitespace-nowrap text-xl font-extrabold text-emerald-600 text-rupiah scrollbar-thin">{formatRupiah(category.amount)}</p>
                    <div className="mt-3">
                      <ProgressBar value={category.pctOfIncome} tone="green" />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
