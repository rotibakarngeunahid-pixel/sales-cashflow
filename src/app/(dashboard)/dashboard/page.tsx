'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import type { SalesReport, CashflowTransaction, Branch } from '@/types/database'
import { formatRupiah, formatDate, toDateInputValue } from '@/lib/utils/format'
import StatCard from '@/components/ui/StatCard'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import {
  TrendingUp, Store, Smartphone, Wifi, AlertTriangle,
  ArrowUp, ArrowDown, BarChart2, Wallet, PlusCircle,
  CheckCircle2, Clock, ClipboardList, ArrowRight,
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, differenceInDays } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const CHART_COLORS = ['#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#DB2777']

function formatRupiahK(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}jt`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}rb`
  return `${value}`
}

type TodayStatus = 'loading' | 'none' | 'draft' | 'done'

interface TodayReport {
  status: string
  grand_total_nett_sales: number
}

export default function DashboardPage() {
  const router = useRouter()
  const today = new Date()
  const todayStr = toDateInputValue()
  const todayLabel = format(today, 'EEEE, d MMMM yyyy').replace(/\b\w/g, (c) => c.toUpperCase())

  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [sales, setSales] = useState<SalesReport[]>([])
  const [cashflow, setCashflow] = useState<CashflowTransaction[]>([])
  const [loading, setLoading] = useState(true)

  // Today's report status (independent of date filter)
  const [todayReports, setTodayReports] = useState<TodayReport[]>([])
  const [todayStatus, setTodayStatus] = useState<TodayStatus>('loading')

  // Load today's reports independently
  useEffect(() => {
    async function loadToday() {
      const supabase = createClient()
      const { data } = await supabase
        .from('sales_reports')
        .select('status, grand_total_nett_sales')
        .eq('report_date', todayStr)
        .neq('status', 'void')

      const reports = (data || []) as TodayReport[]
      setTodayReports(reports)

      if (reports.length === 0) {
        setTodayStatus('none')
      } else if (reports.every((r) => r.status === 'posted')) {
        setTodayStatus('done')
      } else {
        setTodayStatus('draft')
      }
    }
    loadToday()
  }, [todayStr])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let salesQuery = supabase
      .from('sales_reports')
      .select('*, branch:branches(id,name)')
      .neq('status', 'void')
      .gte('report_date', startDate)
      .lte('report_date', endDate)
      .order('report_date')

    if (filterBranch) salesQuery = salesQuery.eq('branch_id', filterBranch)

    let cfQuery = supabase
      .from('cashflow_transactions')
      .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
      .eq('status', 'active')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)

    if (filterBranch) cfQuery = cfQuery.eq('branch_id', filterBranch)

    const [{ data: salesData }, { data: cfData }] = await Promise.all([salesQuery, cfQuery])

    setSales(salesData || [])
    setCashflow(cfData || [])
    setLoading(false)
  }, [startDate, endDate, filterBranch])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function loadBranches() {
      const supabase = createClient()
      const { data } = await supabase.from('branches').select('id,name').eq('is_active', true).order('name')
      setBranches(data || [])
    }
    loadBranches()
  }, [])

  // Calculations
  const totalGrand = sales.reduce((a, s) => a + s.grand_total_nett_sales, 0)
  const totalCash = sales.reduce((a, s) => a + s.cash, 0)
  const totalQris = sales.reduce((a, s) => a + s.qris, 0)
  const totalOffline = sales.reduce((a, s) => a + s.total_offline, 0)
  const totalOnlineGross = sales.reduce((a, s) => a + s.total_online_gross, 0)
  const totalOnlineNett = sales.reduce((a, s) => a + s.total_online_nett, 0)
  const totalDeduction = sales.reduce((a, s) => a + s.total_online_deduction, 0)
  const totalGofood = sales.reduce((a, s) => a + s.gofood_nett, 0)
  const totalGrabfood = sales.reduce((a, s) => a + s.grabfood_nett, 0)
  const totalShopeefood = sales.reduce((a, s) => a + s.shopeefood_nett, 0)
  const deductionPct = totalOnlineGross > 0 ? (totalDeduction / totalOnlineGross) * 100 : 0

  const thisMonthStr = format(today, 'yyyy-MM')
  const thisMonthSales = sales.filter((s) => s.report_date.startsWith(thisMonthStr)).reduce((a, s) => a + s.grand_total_nett_sales, 0)
  const days = differenceInDays(new Date(endDate), new Date(startDate)) + 1
  const avgDaily = days > 0 ? totalGrand / days : 0

  const branchMap: Record<string, { name: string; total: number; count: number }> = {}
  for (const s of sales) {
    const name = s.branch?.name || 'Unknown'
    if (!branchMap[name]) branchMap[name] = { name, total: 0, count: 0 }
    branchMap[name].total += s.grand_total_nett_sales
    branchMap[name].count += 1
  }
  const branchRanking = Object.values(branchMap).sort((a, b) => b.total - a.total)
  const bestBranch = branchRanking[0]
  const worstBranch = branchRanking[branchRanking.length - 1]

  const dailyMap: Record<string, number> = {}
  for (const s of sales) {
    dailyMap[s.report_date] = (dailyMap[s.report_date] || 0) + s.grand_total_nett_sales
  }
  const dailyTrend = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date: formatDate(date, 'dd/MM'), total }))

  const channelData = [
    { name: 'Cash', value: totalCash },
    { name: 'QRIS', value: totalQris },
    { name: 'GoFood', value: totalGofood },
    { name: 'GrabFood', value: totalGrabfood },
    { name: 'ShopeeFood', value: totalShopeefood },
  ].filter((c) => c.value > 0)

  const totalCashIn = cashflow.filter((c) => c.transaction_type === 'cash_in').reduce((a, c) => a + c.amount, 0)
  const totalCashOut = cashflow.filter((c) => c.transaction_type === 'cash_out').reduce((a, c) => a + c.amount, 0)
  const nettCashflow = totalCashIn - totalCashOut

  const todayTotal = todayReports.reduce((a, r) => a + r.grand_total_nett_sales, 0)
  const todayDraftCount = todayReports.filter((r) => r.status === 'draft').length
  const todayPostedCount = todayReports.filter((r) => r.status === 'posted').length

  return (
    <div className="space-y-5">

      {/* ===== TODAY'S REPORT STATUS BANNER ===== */}
      {todayStatus === 'none' && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rbn-red via-red-600 to-rbn-orange p-5 text-white shadow-lg shadow-red-200">
          <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_70%_50%,#fff_0%,transparent_60%)]" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <ClipboardList className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-white/70">
                  Laporan Hari Ini
                </p>
                <p className="text-lg font-extrabold leading-tight">{todayLabel}</p>
                <p className="text-sm text-white/80 mt-0.5">
                  Belum ada laporan yang dicatat hari ini.
                </p>
              </div>
            </div>
            <button
              onClick={() => router.push('/sales/input')}
              className="flex items-center gap-2 px-5 py-2.5 bg-white text-rbn-red font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 flex-shrink-0"
            >
              <PlusCircle className="w-4 h-4" />
              Input Laporan Sekarang
            </button>
          </div>
        </div>
      )}

      {todayStatus === 'draft' && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white shadow-lg shadow-amber-200">
          <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_70%_50%,#fff_0%,transparent_60%)]" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-white/70">
                  Laporan Hari Ini · {todayLabel}
                </p>
                <p className="text-lg font-extrabold leading-tight">
                  {todayDraftCount} Laporan Draft
                  {todayPostedCount > 0 && `, ${todayPostedCount} Sudah Posted`}
                </p>
                <p className="text-sm text-white/80 mt-0.5">
                  Total: <span className="font-bold text-rupiah">{formatRupiah(todayTotal)}</span>
                  {' · '}Review dan posting laporan sebelum tutup hari.
                </p>
              </div>
            </div>
            <Link
              href="/sales/reports"
              className="flex items-center gap-2 px-5 py-2.5 bg-white text-amber-600 font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 flex-shrink-0"
            >
              Review Laporan
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {todayStatus === 'done' && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 p-5 text-white shadow-lg shadow-emerald-200">
          <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_70%_50%,#fff_0%,transparent_60%)]" />
          <div className="relative flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">
                Laporan Hari Ini · {todayLabel}
              </p>
              <p className="text-lg font-extrabold leading-tight">
                Semua Laporan Sudah Dicatat ✓
              </p>
              <p className="text-sm text-white/80 mt-0.5">
                {todayPostedCount} laporan posted · Total:{' '}
                <span className="font-bold text-rupiah">{formatRupiah(todayTotal)}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===== FILTERS ===== */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-center">
          <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
          <SelectFilter
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder="Semua Cabang"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
      </div>

      {loading ? <PageLoading /> : (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              title="Total Sales"
              value={formatRupiah(totalGrand)}
              icon={<TrendingUp className="w-5 h-5 text-rbn-red" />}
              iconBg="bg-red-50"
              className="col-span-2 md:col-span-1"
            />
            <StatCard
              title="Sales Bulan Ini"
              value={formatRupiah(thisMonthSales)}
              icon={<TrendingUp className="w-5 h-5 text-rbn-orange" />}
              iconBg="bg-orange-50"
            />
            <StatCard
              title="Rata-rata Harian"
              value={formatRupiah(avgDaily)}
              subtitle={`${days} hari`}
              icon={<BarChart2 className="w-5 h-5 text-blue-500" />}
              iconBg="bg-blue-50"
            />
            <StatCard
              title="Nett Cashflow"
              value={formatRupiah(nettCashflow)}
              icon={<Wallet className="w-5 h-5 text-emerald-500" />}
              iconBg="bg-emerald-50"
              valueClassName={nettCashflow >= 0 ? 'text-emerald-600' : 'text-red-600'}
            />
          </div>

          {/* Channel Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Total Cash" value={formatRupiah(totalCash)} icon={<Wallet className="w-5 h-5 text-emerald-500" />} iconBg="bg-emerald-50" />
            <StatCard title="Total QRIS" value={formatRupiah(totalQris)} icon={<Smartphone className="w-5 h-5 text-blue-500" />} iconBg="bg-blue-50" />
            <StatCard
              title="Total Offline"
              value={formatRupiah(totalOffline)}
              subtitle={`${totalGrand > 0 ? ((totalOffline / totalGrand) * 100).toFixed(1) : 0}% dari total`}
              icon={<Store className="w-5 h-5 text-slate-500" />}
              iconBg="bg-slate-50"
            />
            <StatCard
              title="Total Online Nett"
              value={formatRupiah(totalOnlineNett)}
              subtitle={`${totalGrand > 0 ? ((totalOnlineNett / totalGrand) * 100).toFixed(1) : 0}% dari total`}
              icon={<Wifi className="w-5 h-5 text-purple-500" />}
              iconBg="bg-purple-50"
            />
          </div>

          {/* Platform Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="GoFood Nett" value={formatRupiah(totalGofood)} valueClassName="text-red-600" iconBg="bg-red-50" />
            <StatCard title="GrabFood Nett" value={formatRupiah(totalGrabfood)} valueClassName="text-green-600" iconBg="bg-green-50" />
            <StatCard title="ShopeeFood Nett" value={formatRupiah(totalShopeefood)} valueClassName="text-orange-600" iconBg="bg-orange-50" />
            <StatCard
              title="Potongan Online"
              value={formatRupiah(totalDeduction)}
              subtitle={`${deductionPct.toFixed(1)}% dari gross online`}
              valueClassName={deductionPct > 30 ? 'text-red-600' : 'text-slate-900'}
              icon={deductionPct > 30 ? <AlertTriangle className="w-5 h-5 text-red-500" /> : undefined}
              iconBg="bg-red-50"
            />
          </div>

          {/* Insights Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-rbn-red/10 flex items-center justify-center">
                  <Store className="w-3 h-3 text-rbn-red" />
                </span>
                Cabang Terbaik &amp; Terendah
              </h3>
              {branchRanking.length === 0 ? (
                <p className="text-sm text-slate-400">Belum ada data cabang</p>
              ) : (
                <div className="space-y-2">
                  {bestBranch && (
                    <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <ArrowUp className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-xs text-emerald-600 font-semibold">{bestBranch.name}</p>
                        <p className="text-sm font-bold text-emerald-800 text-rupiah">{formatRupiah(bestBranch.total)}</p>
                      </div>
                    </div>
                  )}
                  {worstBranch && worstBranch !== bestBranch && (
                    <div className="flex items-center gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                      <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                        <ArrowDown className="w-4 h-4 text-red-500" />
                      </div>
                      <div>
                        <p className="text-xs text-red-600 font-semibold">{worstBranch.name}</p>
                        <p className="text-sm font-bold text-red-800 text-rupiah">{formatRupiah(worstBranch.total)}</p>
                      </div>
                    </div>
                  )}
                  {deductionPct > 30 && (
                    <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                      <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                      <p className="text-xs text-orange-700 font-medium">
                        Rasio potongan online tinggi: {deductionPct.toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Wallet className="w-3 h-3 text-emerald-600" />
                </span>
                Ringkasan Cashflow
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-slate-500">Total Cash In</span>
                  <span className="font-bold text-emerald-600 text-rupiah">{formatRupiah(totalCashIn)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-slate-500">Total Cash Out</span>
                  <span className="font-bold text-red-600 text-rupiah">{formatRupiah(totalCashOut)}</span>
                </div>
                <div className="h-px bg-slate-100" />
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm font-bold text-slate-700">Nett Cashflow</span>
                  <span className={`font-extrabold text-rupiah ${nettCashflow >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {formatRupiah(nettCashflow)}
                  </span>
                </div>
                <Link
                  href="/cashflow"
                  className="flex items-center gap-1.5 text-xs text-rbn-red hover:underline font-semibold mt-1"
                >
                  Lihat detail cashflow <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Tren Sales Harian</h3>
              {dailyTrend.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                  Belum ada data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={dailyTrend} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatRupiahK} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v: number) => [formatRupiah(v), 'Sales']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#DC2626"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4, fill: '#DC2626' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Sales per Channel</h3>
              {channelData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                  Belum ada data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={channelData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={78}
                      innerRadius={36}
                      paddingAngle={3}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {channelData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [formatRupiah(v), 'Sales']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {branchRanking.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Ranking Sales per Cabang</h3>
              <ResponsiveContainer width="100%" height={Math.max(160, branchRanking.length * 44)}>
                <BarChart
                  data={branchRanking}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatRupiahK} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} width={55} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => [formatRupiah(v), 'Total Sales']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                  />
                  <Bar dataKey="total" radius={[0, 8, 8, 0]}>
                    {branchRanking.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i === 0 ? '#DC2626' : i === branchRanking.length - 1 ? '#CBD5E1' : '#EA580C'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {(totalOffline > 0 || totalOnlineNett > 0) && (
            <div className="card p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Offline vs Online</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>Offline</span>
                    <span>{totalGrand > 0 ? ((totalOffline / totalGrand) * 100).toFixed(1) : 0}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5">
                    <div
                      className="bg-gradient-to-r from-rbn-red to-red-400 h-2.5 rounded-full transition-all"
                      style={{ width: `${totalGrand > 0 ? (totalOffline / totalGrand) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-sm font-bold text-rupiah mt-1">{formatRupiah(totalOffline)}</p>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>Online Nett</span>
                    <span>{totalGrand > 0 ? ((totalOnlineNett / totalGrand) * 100).toFixed(1) : 0}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5">
                    <div
                      className="bg-gradient-to-r from-rbn-orange to-amber-400 h-2.5 rounded-full transition-all"
                      style={{ width: `${totalGrand > 0 ? (totalOnlineNett / totalGrand) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-sm font-bold text-rupiah mt-1">{formatRupiah(totalOnlineNett)}</p>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Online Gross</span>
                  <span className="font-semibold text-rupiah">{formatRupiah(totalOnlineGross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Potongan</span>
                  <span className="font-semibold text-red-600 text-rupiah">
                    -{formatRupiah(totalDeduction)} ({deductionPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-1.5">
                  <span className="text-slate-700">Online Nett</span>
                  <span className="text-rupiah">{formatRupiah(totalOnlineNett)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
