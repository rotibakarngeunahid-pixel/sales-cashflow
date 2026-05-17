'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import type { SalesReport, CashflowTransaction, Branch } from '@/types/database'
import { formatRupiah, formatDate, formatPercentage, toDateInputValue } from '@/lib/utils/format'
import StatCard from '@/components/ui/StatCard'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { DateRangeFilter, SelectFilter } from '@/components/ui/FilterBar'
import {
  TrendingUp, Store, Smartphone, Wifi, AlertTriangle,
  ArrowUp, ArrowDown, BarChart2, Wallet
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, subDays, differenceInDays, parseISO } from 'date-fns'
import Link from 'next/link'

const CHART_COLORS = ['#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#DB2777']

function formatRupiahK(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}jt`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}rb`
  return `${value}`
}

export default function DashboardPage() {
  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [filterBranch, setFilterBranch] = useState('')
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'name'>[]>([])
  const [sales, setSales] = useState<SalesReport[]>([])
  const [cashflow, setCashflow] = useState<CashflowTransaction[]>([])
  const [loading, setLoading] = useState(true)

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

  const todayStr = toDateInputValue()
  const todaySales = sales.filter((s) => s.report_date === todayStr).reduce((a, s) => a + s.grand_total_nett_sales, 0)
  const thisMonthStr = format(today, 'yyyy-MM')
  const thisMonthSales = sales.filter((s) => s.report_date.startsWith(thisMonthStr)).reduce((a, s) => a + s.grand_total_nett_sales, 0)

  const days = differenceInDays(new Date(endDate), new Date(startDate)) + 1
  const avgDaily = days > 0 ? totalGrand / days : 0

  // Branch ranking
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

  // Daily trend
  const dailyMap: Record<string, number> = {}
  for (const s of sales) {
    dailyMap[s.report_date] = (dailyMap[s.report_date] || 0) + s.grand_total_nett_sales
  }
  const dailyTrend = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date: formatDate(date, 'dd/MM'), total }))

  // Channel data
  const channelData = [
    { name: 'Cash', value: totalCash },
    { name: 'QRIS', value: totalQris },
    { name: 'GoFood', value: totalGofood },
    { name: 'GrabFood', value: totalGrabfood },
    { name: 'ShopeeFood', value: totalShopeefood },
  ].filter((c) => c.value > 0)

  // Cashflow summary
  const totalCashIn = cashflow.filter((c) => c.transaction_type === 'cash_in').reduce((a, c) => a + c.amount, 0)
  const totalCashOut = cashflow.filter((c) => c.transaction_type === 'cash_out').reduce((a, c) => a + c.amount, 0)
  const nettCashflow = totalCashIn - totalCashOut

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-500 mt-0.5">Analisa penjualan dan arus kas Roti Bakar Ngeunah</p>
      </div>

      {/* Filters */}
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
              className="col-span-2 md:col-span-1"
            />
            <StatCard
              title="Sales Hari Ini"
              value={formatRupiah(todaySales)}
              icon={<BarChart2 className="w-5 h-5 text-rbn-orange" />}
            />
            <StatCard
              title="Sales Bulan Ini"
              value={formatRupiah(thisMonthSales)}
              icon={<TrendingUp className="w-5 h-5 text-rbn-yellow" />}
            />
            <StatCard
              title="Rata-rata Harian"
              value={formatRupiah(avgDaily)}
              subtitle={`${days} hari`}
              icon={<BarChart2 className="w-5 h-5 text-blue-500" />}
            />
          </div>

          {/* Channel Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Total Cash" value={formatRupiah(totalCash)} icon={<Wallet className="w-5 h-5 text-emerald-500" />} />
            <StatCard title="Total QRIS" value={formatRupiah(totalQris)} icon={<Smartphone className="w-5 h-5 text-blue-500" />} />
            <StatCard title="Total Offline" value={formatRupiah(totalOffline)} subtitle={`${totalGrand > 0 ? ((totalOffline/totalGrand)*100).toFixed(1) : 0}% dari total`} icon={<Store className="w-5 h-5 text-gray-500" />} />
            <StatCard title="Total Online Nett" value={formatRupiah(totalOnlineNett)} subtitle={`${totalGrand > 0 ? ((totalOnlineNett/totalGrand)*100).toFixed(1) : 0}% dari total`} icon={<Wifi className="w-5 h-5 text-purple-500" />} />
          </div>

          {/* Online Platform Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="GoFood Nett" value={formatRupiah(totalGofood)} valueClassName="text-red-600" />
            <StatCard title="GrabFood Nett" value={formatRupiah(totalGrabfood)} valueClassName="text-green-600" />
            <StatCard title="ShopeeFood Nett" value={formatRupiah(totalShopeefood)} valueClassName="text-orange-600" />
            <StatCard
              title="Potongan Online"
              value={formatRupiah(totalDeduction)}
              subtitle={`${deductionPct.toFixed(1)}% dari gross online`}
              valueClassName={deductionPct > 30 ? 'text-red-600' : 'text-gray-900'}
              icon={deductionPct > 30 ? <AlertTriangle className="w-5 h-5 text-red-500" /> : undefined}
            />
          </div>

          {/* Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Cabang Terbaik & Terendah</h3>
              {branchRanking.length === 0 ? (
                <p className="text-sm text-gray-500">Belum ada data</p>
              ) : (
                <div className="space-y-2">
                  {bestBranch && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                      <ArrowUp className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-green-600 font-medium">Terbaik: {bestBranch.name}</p>
                        <p className="text-sm font-bold text-green-700 text-rupiah">{formatRupiah(bestBranch.total)}</p>
                      </div>
                    </div>
                  )}
                  {worstBranch && worstBranch !== bestBranch && (
                    <div className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                      <ArrowDown className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-red-600 font-medium">Terendah: {worstBranch.name}</p>
                        <p className="text-sm font-bold text-red-700 text-rupiah">{formatRupiah(worstBranch.total)}</p>
                      </div>
                    </div>
                  )}
                  {deductionPct > 30 && (
                    <div className="flex items-center gap-2 p-2 bg-orange-50 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                      <p className="text-xs text-orange-700">Rasio potongan online tinggi: {deductionPct.toFixed(1)}%</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Ringkasan Cashflow</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Total Cash In</span>
                  <span className="font-semibold text-emerald-600 text-rupiah">{formatRupiah(totalCashIn)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Total Cash Out</span>
                  <span className="font-semibold text-red-600 text-rupiah">{formatRupiah(totalCashOut)}</span>
                </div>
                <hr />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-700">Nett Cashflow</span>
                  <span className={`font-bold text-rupiah ${nettCashflow >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>{formatRupiah(nettCashflow)}</span>
                </div>
                <Link href="/cashflow" className="block text-xs text-rbn-red hover:underline mt-2">
                  Lihat detail cashflow →
                </Link>
              </div>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Daily Trend */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Tren Sales Harian</h3>
              {dailyTrend.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Belum ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={dailyTrend} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatRupiahK} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => formatRupiah(v)} />
                    <Line type="monotone" dataKey="total" stroke="#DC2626" strokeWidth={2} dot={false} name="Total Sales" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel Pie */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Sales per Channel</h3>
              {channelData.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Belum ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={channelData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {channelData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatRupiah(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Branch Ranking Chart */}
          {branchRanking.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Ranking Sales per Cabang</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={branchRanking}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatRupiahK} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={55} />
                  <Tooltip formatter={(v: number) => formatRupiah(v)} />
                  <Bar dataKey="total" name="Total Sales" radius={[0, 4, 4, 0]}>
                    {branchRanking.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#DC2626' : i === branchRanking.length - 1 ? '#9CA3AF' : '#EA580C'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Offline vs Online */}
          {(totalOffline > 0 || totalOnlineNett > 0) && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Offline vs Online (Gross vs Nett)</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-center">
                  <div className="w-full bg-gray-100 rounded-full h-3 mb-1">
                    <div
                      className="bg-rbn-red h-3 rounded-full"
                      style={{ width: `${totalGrand > 0 ? (totalOffline / totalGrand) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">Offline {totalGrand > 0 ? ((totalOffline / totalGrand) * 100).toFixed(1) : 0}%</p>
                  <p className="text-sm font-bold text-rupiah">{formatRupiah(totalOffline)}</p>
                </div>
                <div className="text-center">
                  <div className="w-full bg-gray-100 rounded-full h-3 mb-1">
                    <div
                      className="bg-rbn-orange h-3 rounded-full"
                      style={{ width: `${totalGrand > 0 ? (totalOnlineNett / totalGrand) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">Online Nett {totalGrand > 0 ? ((totalOnlineNett / totalGrand) * 100).toFixed(1) : 0}%</p>
                  <p className="text-sm font-bold text-rupiah">{formatRupiah(totalOnlineNett)}</p>
                </div>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Online Gross</span>
                  <span className="font-medium text-rupiah">{formatRupiah(totalOnlineGross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Potongan</span>
                  <span className="font-medium text-red-600 text-rupiah">-{formatRupiah(totalDeduction)} ({deductionPct.toFixed(1)}%)</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-orange-200 mt-1 pt-1">
                  <span>Online Nett</span>
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
