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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Info,
  RefreshCw,
  Scale,
  ShoppingBag,
  Target,
} from 'lucide-react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from 'date-fns'
import { id } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import type { Branch, CashflowTransaction, SalesReport } from '@/types/database'
import { formatPercentage, formatRupiah, cn } from '@/lib/utils/format'
import { SelectFilter } from '@/components/ui/FilterBar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { getCachedData, getOrFetchCached } from '@/lib/utils/client-cache'
import {
  clampDayOfMonth,
  getDayOfMonth,
  projectMonth,
  type MonthProjectionResult,
} from '@/lib/cashflow/pnl-projection'

const REVENUE_CORRELATED_LABEL = 'Food Waste, Pembelian Gas, Pembelian Kardus, Kurir'

type ProjectionData = {
  sales: SalesReport[]
  cashflow: CashflowTransaction[]
}

function formatShortRupiah(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000)}rb`
  return `${sign}Rp${abs}`
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'neutral',
  highlight = false,
}: {
  title: string
  value: string
  subtitle?: ReactNode
  icon: ReactNode
  tone?: 'green' | 'red' | 'blue' | 'amber' | 'slate' | 'neutral'
  highlight?: boolean
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
    <div className={cn('card h-full p-4', highlight && 'ring-2 ring-rbn-red/20')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
          <p className="mt-2 overflow-x-auto whitespace-nowrap pb-0.5 text-xl font-extrabold leading-tight text-slate-950 text-rupiah scrollbar-thin 2xl:text-2xl">
            {value}
          </p>
          {subtitle && <div className="mt-1 break-words text-xs font-medium leading-5 text-slate-500">{subtitle}</div>}
        </div>
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border', toneClass)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function methodBadge(method: 'revenue_ratio' | 'monthly_average') {
  return method === 'revenue_ratio'
    ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">Rasio Revenue</span>
    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-100">Rata-rata Bulanan</span>
}

export default function CashflowProjectionPage() {
  const today = new Date()
  const [monthCursor, setMonthCursor] = useState(startOfMonth(today))
  const [filterBranch, setFilterBranch] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [sales, setSales] = useState<SalesReport[]>([])
  const [cashflow, setCashflow] = useState<CashflowTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const monthLabel = format(monthCursor, 'MMMM yyyy', { locale: id })
  const isCurrentMonth = isSameMonth(monthCursor, today)
  const cutoffDate = useMemo(() => {
    const monthEnd = endOfMonth(monthCursor)
    return monthEnd < today ? monthEnd : today
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor])

  const rangeStart = useMemo(() => startOfMonth(subMonths(monthCursor, 6)), [monthCursor])
  const rangeEnd = useMemo(() => {
    const monthEnd = endOfMonth(monthCursor)
    return monthEnd < today ? monthEnd : today
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor])

  const load = useCallback(async (options: { force?: boolean } = {}) => {
    const supabase = createClient()
    const rangeStartStr = format(rangeStart, 'yyyy-MM-dd')
    const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd')
    const cacheKey = `pnl-projection:${rangeStartStr}:${rangeEndStr}`
    const cached = getCachedData<ProjectionData>(cacheKey)

    if (cached && !options.force) {
      setSales(cached.sales)
      setCashflow(cached.cashflow)
      setLoading(false)
    } else {
      setLoading(true)
    }

    try {
      const data = await getOrFetchCached<ProjectionData>(
        cacheKey,
        async () => {
          const salesQuery = supabase
            .from('sales_reports')
            .select('*, branch:branches(id,name)')
            .eq('status', 'posted')
            .gte('report_date', rangeStartStr)
            .lte('report_date', rangeEndStr)
            .order('report_date', { ascending: true })

          const cashflowQuery = supabase
            .from('cashflow_transactions')
            .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
            .eq('status', 'active')
            .gte('transaction_date', rangeStartStr)
            .lte('transaction_date', rangeEndStr)
            .order('transaction_date', { ascending: true })

          const [salesResult, cashflowResult] = await Promise.all([salesQuery, cashflowQuery])

          if (salesResult.error) throw salesResult.error
          if (cashflowResult.error) throw cashflowResult.error

          return {
            sales: salesResult.data || [],
            cashflow: cashflowResult.data || [],
          }
        },
        { ttlMs: 60_000, force: options.force || Boolean(cached) }
      )

      setSales(data.sales)
      setCashflow(data.cashflow)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat data proyeksi.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [rangeStart, rangeEnd])

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

  const scopedSales = useMemo(
    () => (filterBranch ? sales.filter((r) => r.branch_id === filterBranch) : sales),
    [sales, filterBranch]
  )
  const scopedCashflow = useMemo(
    () => (filterBranch ? cashflow.filter((tx) => tx.branch_id === filterBranch) : cashflow),
    [cashflow, filterBranch]
  )

  const projection = useMemo<MonthProjectionResult>(
    () => projectMonth({ monthStart: monthCursor, cutoffDate, salesRows: scopedSales, cashflowRows: scopedCashflow }),
    [monthCursor, cutoffDate, scopedSales, scopedCashflow]
  )

  const weekdayChartData = useMemo(
    () => [...projection.weekdayAverages].sort((a, b) => ((a.dayIndex + 6) % 7) - ((b.dayIndex + 6) % 7)),
    [projection.weekdayAverages]
  )

  const backtest = useMemo(() => {
    if (!isCurrentMonth) return null
    const lastMonthStart = startOfMonth(subMonths(monthCursor, 1))
    const backtestCutoff = clampDayOfMonth(lastMonthStart, getDayOfMonth(today))
    const projected = projectMonth({ monthStart: lastMonthStart, cutoffDate: backtestCutoff, salesRows: scopedSales, cashflowRows: scopedCashflow })
    const actual = projectMonth({ monthStart: lastMonthStart, cutoffDate: endOfMonth(lastMonthStart), salesRows: scopedSales, cashflowRows: scopedCashflow })
    if (actual.revenue.total <= 0) return null
    return { projected, actual, cutoffLabel: format(backtestCutoff, 'dd MMM', { locale: id }), monthLabel: format(lastMonthStart, 'MMMM yyyy', { locale: id }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentMonth, monthCursor, scopedSales, scopedCashflow])

  const branchProjections = useMemo(() => {
    if (filterBranch) return []
    return branches
      .map((branch) => {
        const bSales = sales.filter((r) => r.branch_id === branch.id)
        const bCashflow = cashflow.filter((tx) => tx.branch_id === branch.id)
        const result = projectMonth({ monthStart: monthCursor, cutoffDate, salesRows: bSales, cashflowRows: bCashflow })
        return { branchId: branch.id, branchName: branch.name, result }
      })
      .filter((row) => row.result.revenue.total > 0 || row.result.expense.total > 0)
      .sort((a, b) => b.result.netProfit.total - a.result.netProfit.total)
  }, [branches, filterBranch, sales, cashflow, monthCursor, cutoffDate])

  function goPrevMonth() {
    setMonthCursor((prev) => startOfMonth(subMonths(prev, 1)))
  }

  function goNextMonth() {
    if (isCurrentMonth) return
    setMonthCursor((prev) => {
      const next = startOfMonth(addMonths(prev, 1))
      return next > startOfMonth(today) ? prev : next
    })
  }

  async function handleExport() {
    const [XLSX, { saveAs }] = await Promise.all([
      import('xlsx'),
      import('file-saver'),
    ])
    const wb = XLSX.utils.book_new()

    const overviewRows = [{
      Bulan: projection.monthLabel,
      Cabang: filterBranch ? branches.find((b) => b.id === filterBranch)?.name || '' : 'Semua Cabang',
      'Hari Berjalan': `${projection.actualDays} / ${projection.daysInMonth}`,
      'Revenue Aktual': projection.revenue.actual,
      'Revenue Proyeksi Sisa': projection.revenue.projectedRemaining,
      'Revenue Total Proyeksi': projection.revenue.total,
      'HPP Aktual': projection.cogs.actual,
      'HPP Total Proyeksi': projection.cogs.total,
      'Rasio HPP (%)': (projection.cogs.ratio * 100).toFixed(2),
      'Laba Kotor Proyeksi': projection.grossProfit.total,
      'Beban Operasional Proyeksi': projection.operatingExpense.total,
      'Profit Bersih Aktual': projection.netProfit.actual,
      'Profit Bersih Proyeksi Total': projection.netProfit.total,
      'Faktor Tren': projection.trendMultiplier.toFixed(2),
    }]

    const categoryRows = projection.categories.map((c) => ({
      Kategori: c.name,
      Metode: c.method === 'revenue_ratio' ? 'Rasio Revenue' : 'Rata-rata Bulanan',
      'MTD Aktual': c.mtdAmount,
      'Proyeksi Sisa': c.projectedRemaining,
      'Total Proyeksi': c.projectedTotal,
      Basis: c.basisLabel,
    }))

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Ringkasan')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows), 'Kategori Beban')

    if (branchProjections.length > 0) {
      const branchRows = branchProjections.map((row) => ({
        Cabang: row.branchName,
        'Revenue Proyeksi': row.result.revenue.total,
        'HPP Proyeksi': row.result.cogs.total,
        'Rasio HPP (%)': (row.result.cogs.ratio * 100).toFixed(2),
        'Laba Kotor Proyeksi': row.result.grossProfit.total,
        'Profit Bersih Proyeksi': row.result.netProfit.total,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows), 'Per Cabang')
    }

    if (backtest) {
      const backtestRows = [
        { Metrik: 'Revenue', Proyeksi: backtest.projected.revenue.total, Aktual: backtest.actual.revenue.total },
        { Metrik: 'HPP', Proyeksi: backtest.projected.cogs.total, Aktual: backtest.actual.cogs.total },
        { Metrik: 'Beban', Proyeksi: backtest.projected.expense.total, Aktual: backtest.actual.expense.total },
        { Metrik: 'Profit Bersih', Proyeksi: backtest.projected.netProfit.total, Aktual: backtest.actual.netProfit.total },
      ].map((r) => ({ ...r, 'Selisih (%)': r.Aktual !== 0 ? (((r.Proyeksi - r.Aktual) / Math.abs(r.Aktual)) * 100).toFixed(1) : '-' }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backtestRows), 'Akurasi Model')
    }

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `proyeksi-laba-rugi-${format(monthCursor, 'yyyy-MM')}.xlsx`)
  }

  const progressPct = projection.daysInMonth > 0 ? (projection.actualDays / projection.daysInMonth) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Keuangan</p>
          <h2 className="text-2xl font-extrabold text-slate-950">Proyeksi Laba Rugi</h2>
          <p className="text-sm text-slate-500">Estimasi P&L akhir bulan berdasarkan pola hari-dalam-minggu, tren, dan rasio biaya historis.</p>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={goPrevMonth}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[160px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-bold text-slate-700">
              {monthLabel}
            </div>
            <button
              onClick={goNextMonth}
              disabled={isCurrentMonth}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Cabang"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
          {!projection.isComplete && (
            <div className="flex flex-1 items-center gap-3 sm:min-w-[220px]">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-rbn-red" style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
              </div>
              <span className="whitespace-nowrap text-xs font-semibold text-slate-500">
                Hari ke-{projection.actualDays} / {projection.daysInMonth}
              </span>
            </div>
          )}
          {projection.isComplete && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Bulan selesai — semua angka aktual
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoading />
      ) : projection.revenue.total <= 0 && projection.expense.total <= 0 ? (
        <EmptyState title="Belum ada data" description="Tidak ada penjualan atau cashflow pada bulan dan cabang ini." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <MetricCard
              title="Proyeksi Revenue"
              value={formatRupiah(projection.revenue.total)}
              subtitle={`Aktual ${formatShortRupiah(projection.revenue.actual)} + proyeksi ${formatShortRupiah(projection.revenue.projectedRemaining)}`}
              icon={<ArrowUpRight className="h-5 w-5" />}
              tone="green"
            />
            <MetricCard
              title="Proyeksi HPP"
              value={formatRupiah(projection.cogs.total)}
              subtitle={`${formatPercentage(projection.cogs.ratio * 100)} dari revenue`}
              icon={<ShoppingBag className="h-5 w-5" />}
              tone={projection.cogs.ratio * 100 > 40 ? 'red' : projection.cogs.ratio * 100 > 30 ? 'amber' : 'green'}
            />
            <MetricCard
              title="Proyeksi Laba Kotor"
              value={formatRupiah(projection.grossProfit.total)}
              subtitle={`Margin ${formatPercentage(projection.revenue.total > 0 ? (projection.grossProfit.total / projection.revenue.total) * 100 : 0)}`}
              icon={<Scale className="h-5 w-5" />}
              tone={projection.grossProfit.total >= 0 ? 'blue' : 'red'}
            />
            <MetricCard
              title="Proyeksi Beban Operasional"
              value={formatRupiah(projection.operatingExpense.total)}
              subtitle="Di luar HPP (gaji, sewa, dll)"
              icon={<ArrowDownRight className="h-5 w-5" />}
              tone="amber"
            />
            <MetricCard
              title="Proyeksi Profit Bersih"
              value={formatRupiah(projection.netProfit.total)}
              subtitle={`Aktual ${formatShortRupiah(projection.netProfit.actual)} + proyeksi ${formatShortRupiah(projection.netProfit.projectedRemaining)}`}
              icon={projection.netProfit.total >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
              tone={projection.netProfit.total >= 0 ? 'green' : 'red'}
              highlight
            />
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                <Info className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-sm leading-6 text-slate-700">
                <p className="font-bold text-slate-950">Bagaimana proyeksi ini dihitung?</p>
                <p className="mt-1">
                  Revenue sisa bulan diproyeksikan dari rata-rata penjualan tiap hari-dalam-minggu (Senin, Selasa, dst) selama {projection.lookbackDays} hari terakhir,
                  lalu disesuaikan dengan faktor tren <strong>{projection.trendMultiplier.toFixed(2)}x</strong> (perbandingan 14 hari terakhir vs pola normal — dibatasi 0.7x–1.5x supaya tidak overreact ke lonjakan sesaat).
                  HPP diproyeksikan pakai rasio historis <strong>{formatPercentage(projection.cogs.ratio * 100)}</strong> terhadap revenue, begitu juga kategori beban yang mengikuti volume penjualan ({REVENUE_CORRELATED_LABEL}).
                  Kategori beban lain yang bersifat periodik (gaji, sewa, internet, peralatan, dll) diproyeksikan dari rata-rata 3 bulan kalender terakhir, dikurangi yang sudah tercatat bulan ini — supaya biaya yang sudah dibayar tidak dihitung dobel.
                </p>
              </div>
            </div>
          </section>

          {backtest && (
            <section className="card overflow-hidden">
              <div className="border-b border-slate-100 p-4">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-slate-400" />
                  <h3 className="text-base font-bold text-slate-950">Uji Akurasi Model</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Simulasi: jika model ini dijalankan tanggal {backtest.cutoffLabel} (setara hari ke-{getDayOfMonth(today)} bulan lalu), dibandingkan dengan aktual final {backtest.monthLabel}.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] table-auto">
                  <thead>
                    <tr>
                      <th className="table-header">Metrik</th>
                      <th className="table-header text-right">Proyeksi Saat Itu</th>
                      <th className="table-header text-right">Aktual Final</th>
                      <th className="table-header text-right">Selisih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {[
                      { label: 'Revenue', projected: backtest.projected.revenue.total, actual: backtest.actual.revenue.total },
                      { label: 'HPP', projected: backtest.projected.cogs.total, actual: backtest.actual.cogs.total },
                      { label: 'Beban', projected: backtest.projected.expense.total, actual: backtest.actual.expense.total },
                      { label: 'Profit Bersih', projected: backtest.projected.netProfit.total, actual: backtest.actual.netProfit.total },
                    ].map((row) => {
                      const diffPct = row.actual !== 0 ? ((row.projected - row.actual) / Math.abs(row.actual)) * 100 : 0
                      const closeEnough = Math.abs(diffPct) <= 10
                      return (
                        <tr key={row.label} className="hover:bg-slate-50">
                          <td className="table-cell font-semibold">{row.label}</td>
                          <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(row.projected)}</td>
                          <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(row.actual)}</td>
                          <td className={cn('table-cell text-right font-bold', closeEnough ? 'text-emerald-600' : 'text-amber-600')}>
                            {diffPct >= 0 ? '+' : ''}{formatPercentage(diffPct)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="card p-4 xl:col-span-3">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Revenue Harian: Aktual vs Proyeksi</h3>
                <p className="text-xs text-slate-500">Garis solid = aktual, garis putus-putus = proyeksi sisa bulan.</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={projection.dailySeries} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} minTickGap={12} />
                  <YAxis tickFormatter={formatShortRupiah} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatRupiah(value), name]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="actualRevenue" name="Aktual" stroke="#16A34A" strokeWidth={2.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="projectedRevenue" name="Proyeksi" stroke="#2563EB" strokeWidth={2.5} strokeDasharray="6 4" dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4 xl:col-span-2">
              <div className="mb-4">
                <h3 className="text-base font-bold text-slate-950">Pola Rata-rata per Hari</h3>
                <p className="text-xs text-slate-500">Basis proyeksi revenue ({projection.lookbackDays} hari terakhir).</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={weekdayChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="dayName" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatShortRupiah} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: number) => [formatRupiah(value), 'Rata-rata']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                  />
                  <Bar dataKey="average" radius={[8, 8, 0, 0]}>
                    {weekdayChartData.map((_, index) => (
                      <Cell key={index} fill="#EA580C" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-base font-bold text-slate-950">Rincian Proyeksi Kategori Beban</h3>
              <p className="text-xs text-slate-500">Tidak termasuk HPP (ditampilkan terpisah di kartu ringkasan).</p>
            </div>

            {projection.categories.length === 0 ? (
              <EmptyState title="Belum ada beban" description="Tidak ada kategori beban di luar HPP pada bulan ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-auto">
                  <thead>
                    <tr>
                      <th className="table-header">Kategori</th>
                      <th className="table-header">Metode</th>
                      <th className="table-header text-right">Aktual (MTD)</th>
                      <th className="table-header text-right">Proyeksi Sisa</th>
                      <th className="table-header text-right">Total Proyeksi</th>
                      <th className="table-header">Basis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {projection.categories.map((category) => (
                      <tr key={category.name} className="hover:bg-slate-50">
                        <td className="table-cell font-semibold"><div className="truncate">{category.name}</div></td>
                        <td className="table-cell">{methodBadge(category.method)}</td>
                        <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(category.mtdAmount)}</td>
                        <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(category.projectedRemaining)}</td>
                        <td className="table-cell text-right font-bold text-red-600 text-rupiah">{formatRupiah(category.projectedTotal)}</td>
                        <td className="table-cell"><span className="text-xs text-slate-500">{category.basisLabel}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {branchProjections.length > 0 && (
            <section className="card overflow-hidden">
              <div className="border-b border-slate-100 p-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <h3 className="text-base font-bold text-slate-950">Proyeksi per Cabang</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">Diurutkan berdasarkan proyeksi profit bersih tertinggi.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] table-auto">
                  <thead>
                    <tr>
                      <th className="table-header">Cabang</th>
                      <th className="table-header text-right">Revenue Proyeksi</th>
                      <th className="table-header text-right">HPP Proyeksi</th>
                      <th className="table-header text-right">Rasio HPP</th>
                      <th className="table-header text-right">Profit Proyeksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {branchProjections.map((row) => (
                      <tr key={row.branchId} className="hover:bg-slate-50">
                        <td className="table-cell font-semibold"><div className="truncate">{row.branchName}</div></td>
                        <td className="table-cell text-right font-medium text-rupiah">{formatRupiah(row.result.revenue.total)}</td>
                        <td className="table-cell text-right font-medium text-amber-600 text-rupiah">{formatRupiah(row.result.cogs.total)}</td>
                        <td className="table-cell text-right font-semibold">{formatPercentage(row.result.cogs.ratio * 100)}</td>
                        <td className={cn('table-cell text-right font-bold text-rupiah', row.result.netProfit.total >= 0 ? 'text-blue-600' : 'text-red-600')}>
                          {formatRupiah(row.result.netProfit.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!isCurrentMonth && !projection.isComplete && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>Bulan ini belum lengkap tapi bukan bulan berjalan — kemungkinan data belum lengkap tersinkron.</p>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-slate-400">
            <CalendarDays className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <p>Proyeksi bersifat estimasi berdasarkan pola historis, bukan jaminan. Cek kartu &quot;Uji Akurasi Model&quot; di atas untuk melihat rekam jejak akurasi model pada bulan lalu.</p>
          </div>
        </>
      )}
    </div>
  )
}
