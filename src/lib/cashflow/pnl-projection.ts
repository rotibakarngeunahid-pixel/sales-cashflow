import { addDays, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, getDate, getDay, getDaysInMonth, parseISO, subMonths } from 'date-fns'
import { id } from 'date-fns/locale'
import type { CashflowTransaction, SalesReport } from '@/types/database'
import {
  getCashflowAmount,
  getExpenseContribution,
  isAdditionalRevenueCashIn,
  isCogsCategory,
  isExpenseTransaction,
  isOtherIncomeCashIn,
  isRevenueCorrelatedCategory,
  toNumber,
} from './pnl'

// =====================================================================================
// Proyeksi Laba Rugi — mesin proyeksi murni (tanpa I/O), dipakai oleh halaman
// /cashflow/proyeksi. Prinsip: jangan ekstrapolasi linear naif (total/hari-berjalan
// * hari-sebulan) karena revenue punya pola hari-dalam-minggu yang kuat dan beban
// punya campuran biaya tetap (gaji, sewa) vs biaya variabel (bahan baku, gas, kurir).
//
// Metodologi:
// 1. Revenue sisa bulan = rata-rata revenue per hari-dalam-minggu dari 56 hari terakhir,
//    dikali faktor tren (14 hari terakhir vs rata-rata 56 hari, dibatasi 0.7x-1.5x).
// 2. HPP & kategori beban yang berkorelasi dengan volume (Food Waste, Pembelian Gas,
//    Pembelian Kardus, Kurir) diproyeksikan pakai rasio historis terhadap revenue,
//    diterapkan ke revenue sisa bulan yang diproyeksikan.
// 3. Kategori beban lain (gaji, sewa, internet, peralatan, dll — bersifat periodik/tetap)
//    diproyeksikan pakai rata-rata 3 bulan kalender terakhir, dikurangi yang sudah
//    tercatat bulan ini (supaya tidak dobel hitung biaya yang sudah dibayar).
// =====================================================================================

const DEFAULT_LOOKBACK_DAYS = 56
const TREND_WINDOW_DAYS = 14
const TREND_MULTIPLIER_MIN = 0.7
const TREND_MULTIPLIER_MAX = 1.5
const FIXED_CATEGORY_LOOKBACK_MONTHS = 3

export type ProjectionCategoryMethod = 'revenue_ratio' | 'monthly_average'

export type ProjectionCategoryRow = {
  name: string
  method: ProjectionCategoryMethod
  mtdAmount: number
  projectedRemaining: number
  projectedTotal: number
  basisLabel: string
}

export type ProjectionLine = {
  actual: number
  projectedRemaining: number
  total: number
}

export type DailyProjectionPoint = {
  date: string
  label: string
  actualRevenue: number | null
  projectedRevenue: number | null
}

export type MonthProjectionResult = {
  monthLabel: string
  monthStart: string
  monthEnd: string
  cutoffDate: string
  daysInMonth: number
  actualDays: number
  remainingDays: number
  isComplete: boolean
  revenue: ProjectionLine
  otherIncome: ProjectionLine
  cogs: ProjectionLine & { ratio: number }
  operatingExpense: ProjectionLine
  expense: ProjectionLine
  grossIncome: ProjectionLine
  grossProfit: ProjectionLine
  netProfit: ProjectionLine
  categories: ProjectionCategoryRow[]
  trendMultiplier: number
  lookbackDays: number
  lookbackRevenueTotal: number
  weekdayAverages: { dayIndex: number; dayName: string; average: number }[]
  dailySeries: DailyProjectionPoint[]
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu']

function line(actual: number, total: number): ProjectionLine {
  return { actual, projectedRemaining: total - actual, total }
}

function dateStr(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

// Rata-rata jumlah kategori beban (selain HPP) per bulan kalender, untuk N bulan
// yang berakhir TEPAT SEBELUM referenceMonthStart (tidak menyentuh bulan target itu sendiri).
function computeFixedCategoryAverages(
  cashflowRows: CashflowTransaction[],
  referenceMonthStart: Date,
  numMonths: number
): Map<string, { avg: number; monthsWithActivity: number }> {
  const monthKeys = new Set<string>()
  for (let i = 1; i <= numMonths; i++) {
    monthKeys.add(format(subMonths(referenceMonthStart, i), 'yyyy-MM'))
  }

  const perCategoryPerMonth = new Map<string, Map<string, number>>()

  cashflowRows.forEach((tx) => {
    if (!isExpenseTransaction(tx) || isCogsCategory(tx)) return
    const txMonthKey = tx.transaction_date.slice(0, 7)
    if (!monthKeys.has(txMonthKey)) return

    const name = tx.category?.name || 'Tanpa Kategori'
    if (!perCategoryPerMonth.has(name)) perCategoryPerMonth.set(name, new Map())
    const monthMap = perCategoryPerMonth.get(name)!
    monthMap.set(txMonthKey, (monthMap.get(txMonthKey) || 0) + getExpenseContribution(tx))
  })

  const result = new Map<string, { avg: number; monthsWithActivity: number }>()
  perCategoryPerMonth.forEach((monthMap, name) => {
    const total = Array.from(monthMap.values()).reduce((sum, v) => sum + v, 0)
    result.set(name, { avg: total / numMonths, monthsWithActivity: monthMap.size })
  })

  return result
}

export function projectMonth(params: {
  monthStart: Date
  cutoffDate: Date
  salesRows: Pick<SalesReport, 'report_date' | 'branch_id' | 'grand_total_nett_sales'>[]
  cashflowRows: CashflowTransaction[]
  lookbackDays?: number
}): MonthProjectionResult {
  const { monthStart, cutoffDate, salesRows, cashflowRows } = params
  const lookbackDays = params.lookbackDays ?? DEFAULT_LOOKBACK_DAYS

  const monthEnd = endOfMonth(monthStart)
  const daysInMonth = getDaysInMonth(monthStart)
  const actualEnd = cutoffDate < monthEnd ? cutoffDate : monthEnd
  const hasActualDays = actualEnd >= monthStart
  const actualDays = hasActualDays ? differenceInCalendarDays(actualEnd, monthStart) + 1 : 0
  const remainingDates = actualEnd < monthEnd ? eachDayOfInterval({ start: addDays(actualEnd, 1), end: monthEnd }) : []
  const remainingDays = remainingDates.length
  const isComplete = remainingDays === 0 && actualDays >= daysInMonth

  const monthStartStr = dateStr(monthStart)
  const monthEndStr = dateStr(monthEnd)
  const actualEndStr = dateStr(actualEnd)
  const cutoffStr = dateStr(cutoffDate)

  // ── Aktual bulan berjalan (MTD) ──────────────────────────────────────────
  const mtdSales = hasActualDays
    ? salesRows.filter((r) => r.report_date >= monthStartStr && r.report_date <= actualEndStr)
    : []
  const mtdCoreRevenue = mtdSales.reduce((sum, r) => sum + toNumber(r.grand_total_nett_sales), 0)

  const mtdCashflow = hasActualDays
    ? cashflowRows.filter((tx) => tx.transaction_date >= monthStartStr && tx.transaction_date <= actualEndStr)
    : []
  const mtdAdditionalRevenue = mtdCashflow.filter(isAdditionalRevenueCashIn).reduce((sum, tx) => sum + getCashflowAmount(tx), 0)
  const mtdRevenue = mtdCoreRevenue + mtdAdditionalRevenue
  const mtdOtherIncome = mtdCashflow.filter(isOtherIncomeCashIn).reduce((sum, tx) => sum + getCashflowAmount(tx), 0)
  const mtdCogs = mtdCashflow
    .filter((tx) => isExpenseTransaction(tx) && isCogsCategory(tx))
    .reduce((sum, tx) => sum + getExpenseContribution(tx), 0)
  const mtdExpense = mtdCashflow.reduce((sum, tx) => sum + getExpenseContribution(tx), 0)
  const mtdOperatingExpense = mtdExpense - mtdCogs

  // ── Jendela lookback (56 hari terakhir s/d cutoff) untuk pola & rasio ──────
  const lookbackStart = addDays(cutoffDate, -(lookbackDays - 1))
  const lookbackStartStr = dateStr(lookbackStart)
  const lookbackSales = salesRows.filter((r) => r.report_date >= lookbackStartStr && r.report_date <= cutoffStr)
  const lookbackCashflow = cashflowRows.filter((tx) => tx.transaction_date >= lookbackStartStr && tx.transaction_date <= cutoffStr)
  const lookbackRevenueTotal = lookbackSales.reduce((sum, r) => sum + toNumber(r.grand_total_nett_sales), 0)
  const lookbackSpanDays = differenceInCalendarDays(cutoffDate, lookbackStart) + 1
  const overallDailyAvg = lookbackRevenueTotal / Math.max(1, lookbackSpanDays)

  const weekdaySum = new Array(7).fill(0)
  const weekdayCount = new Array(7).fill(0)
  lookbackSales.forEach((r) => {
    const dow = getDay(parseISO(r.report_date))
    weekdaySum[dow] += toNumber(r.grand_total_nett_sales)
    weekdayCount[dow] += 1
  })
  const weekdayAverageValues = weekdaySum.map((sum, i) => (weekdayCount[i] > 0 ? sum / weekdayCount[i] : overallDailyAvg))
  const weekdayAverages = weekdayAverageValues.map((average, dayIndex) => ({ dayIndex, dayName: HARI[dayIndex], average }))

  // ── Faktor tren: 14 hari terakhir (aktual) vs baseline hari-dalam-minggu ────
  // Dibandingkan terhadap ekspektasi pola mingguan (bukan rata-rata harian mentah),
  // supaya sinyal tren tidak bias oleh kebetulan komposisi weekday/weekend pada
  // jendela 14 hari (mis. jendela yang kebetulan berisi lebih banyak akhir pekan
  // akan terlihat "naik" padahal tidak ada tren sama sekali).
  const trendStart = addDays(cutoffDate, -(TREND_WINDOW_DAYS - 1))
  const trendStartStr = dateStr(trendStart)
  const recentActualTotal = lookbackSales
    .filter((r) => r.report_date >= trendStartStr)
    .reduce((sum, r) => sum + toNumber(r.grand_total_nett_sales), 0)
  const recentExpectedTotal = eachDayOfInterval({ start: trendStart, end: cutoffDate })
    .reduce((sum, d) => sum + weekdayAverageValues[getDay(d)], 0)
  const rawTrendMultiplier = recentExpectedTotal > 0 ? recentActualTotal / recentExpectedTotal : 1
  const trendMultiplier = Number.isFinite(rawTrendMultiplier)
    ? Math.min(TREND_MULTIPLIER_MAX, Math.max(TREND_MULTIPLIER_MIN, rawTrendMultiplier))
    : 1

  // ── Proyeksi revenue harian untuk sisa bulan ────────────────────────────────
  const remainingDailyRevenue = new Map<string, number>()
  let projectedRemainingRevenue = 0
  remainingDates.forEach((date) => {
    const predicted = weekdayAverageValues[getDay(date)] * trendMultiplier
    remainingDailyRevenue.set(dateStr(date), predicted)
    projectedRemainingRevenue += predicted
  })

  // ── HPP: rasio historis (lookback) terhadap revenue, diterapkan ke proyeksi ──
  const lookbackCogs = lookbackCashflow
    .filter((tx) => isExpenseTransaction(tx) && isCogsCategory(tx))
    .reduce((sum, tx) => sum + getExpenseContribution(tx), 0)
  const cogsRatio = lookbackRevenueTotal > 0 ? lookbackCogs / lookbackRevenueTotal : 0
  const projectedRemainingCogs = projectedRemainingRevenue * cogsRatio

  // ── Pendapatan lain: ekstrapolasi linear sederhana dari rata-rata MTD ───────
  const projectedRemainingOtherIncome = actualDays > 0 ? (mtdOtherIncome / actualDays) * remainingDays : 0

  // ── Kategori beban non-HPP: rasio-revenue (variabel) vs rata-rata bulanan (tetap) ──
  const categoryNames = new Set<string>()
  const collectNames = (rows: CashflowTransaction[]) => {
    rows.forEach((tx) => {
      if (isExpenseTransaction(tx) && !isCogsCategory(tx)) {
        categoryNames.add(tx.category?.name || 'Tanpa Kategori')
      }
    })
  }
  collectNames(lookbackCashflow)
  collectNames(mtdCashflow)

  const fixedCategoryAverages = computeFixedCategoryAverages(cashflowRows, monthStart, FIXED_CATEGORY_LOOKBACK_MONTHS)

  const sumByCategory = (rows: CashflowTransaction[], name: string) =>
    rows
      .filter((tx) => isExpenseTransaction(tx) && !isCogsCategory(tx) && (tx.category?.name || 'Tanpa Kategori') === name)
      .reduce((sum, tx) => sum + getExpenseContribution(tx), 0)

  const categories: ProjectionCategoryRow[] = Array.from(categoryNames)
    .map((name) => {
      const mtdAmount = sumByCategory(mtdCashflow, name)

      if (isRevenueCorrelatedCategory(name)) {
        const lookbackAmount = sumByCategory(lookbackCashflow, name)
        const ratio = lookbackRevenueTotal > 0 ? lookbackAmount / lookbackRevenueTotal : 0
        const projectedRemaining = projectedRemainingRevenue * ratio
        return {
          name,
          method: 'revenue_ratio' as const,
          mtdAmount,
          projectedRemaining,
          projectedTotal: mtdAmount + projectedRemaining,
          basisLabel: `${(ratio * 100).toFixed(1)}% dari revenue (56 hari terakhir)`,
        }
      }

      const historical = fixedCategoryAverages.get(name)
      const avgAmount = historical?.avg ?? 0
      const projectedRemaining = Math.max(0, avgAmount - mtdAmount)
      return {
        name,
        method: 'monthly_average' as const,
        mtdAmount,
        projectedRemaining,
        projectedTotal: mtdAmount + projectedRemaining,
        basisLabel: historical
          ? `rata-rata ${FIXED_CATEGORY_LOOKBACK_MONTHS} bln terakhir (aktif ${historical.monthsWithActivity} bln)`
          : 'belum ada data historis',
      }
    })
    .sort((a, b) => b.projectedTotal - a.projectedTotal)

  const projectedRemainingOperatingExpense = categories.reduce((sum, c) => sum + c.projectedRemaining, 0)

  // ── Rangkuman total ───────────────────────────────────────────────────────
  const revenueTotal = mtdRevenue + projectedRemainingRevenue
  const otherIncomeTotal = mtdOtherIncome + projectedRemainingOtherIncome
  const cogsTotal = mtdCogs + projectedRemainingCogs
  const operatingExpenseTotal = mtdOperatingExpense + projectedRemainingOperatingExpense
  const expenseTotal = cogsTotal + operatingExpenseTotal
  const grossIncomeTotal = revenueTotal + otherIncomeTotal
  const grossProfitTotal = revenueTotal - cogsTotal
  const netProfitTotal = grossIncomeTotal - expenseTotal

  const grossIncomeMtd = mtdRevenue + mtdOtherIncome
  const grossProfitMtd = mtdRevenue - mtdCogs
  const netProfitMtd = grossIncomeMtd - mtdExpense

  // ── Seri harian untuk chart (aktual solid -> proyeksi putus-putus) ─────────
  const dailySeries: DailyProjectionPoint[] = eachDayOfInterval({ start: monthStart, end: monthEnd }).map((date) => {
    const key = dateStr(date)
    const label = format(date, 'dd')
    if (hasActualDays && key <= actualEndStr) {
      const dayRevenue = mtdSales.filter((r) => r.report_date === key).reduce((sum, r) => sum + toNumber(r.grand_total_nett_sales), 0)
      return { date: key, label, actualRevenue: dayRevenue, projectedRevenue: key === actualEndStr ? dayRevenue : null }
    }
    return { date: key, label, actualRevenue: null, projectedRevenue: remainingDailyRevenue.get(key) ?? 0 }
  })

  return {
    monthLabel: format(monthStart, 'MMMM yyyy', { locale: id }),
    monthStart: monthStartStr,
    monthEnd: monthEndStr,
    cutoffDate: cutoffStr,
    daysInMonth,
    actualDays,
    remainingDays,
    isComplete,
    revenue: line(mtdRevenue, revenueTotal),
    otherIncome: line(mtdOtherIncome, otherIncomeTotal),
    cogs: { ...line(mtdCogs, cogsTotal), ratio: cogsRatio },
    operatingExpense: line(mtdOperatingExpense, operatingExpenseTotal),
    expense: line(mtdExpense, expenseTotal),
    grossIncome: line(grossIncomeMtd, grossIncomeTotal),
    grossProfit: line(grossProfitMtd, grossProfitTotal),
    netProfit: line(netProfitMtd, netProfitTotal),
    categories,
    trendMultiplier,
    lookbackDays,
    lookbackRevenueTotal,
    weekdayAverages,
    dailySeries,
  }
}

// Cari tanggal "hari ke-N" di bulan target, dibatasi ke tanggal terakhir bulan itu
// (mis. hari ke-31 di bulan Februari -> tanggal 28/29). Dipakai untuk backtest bulan lalu
// pada titik-hari-berjalan yang setara dengan hari ini.
export function clampDayOfMonth(monthStart: Date, dayOfMonth: number): Date {
  const daysInMonth = getDaysInMonth(monthStart)
  return addDays(monthStart, Math.min(dayOfMonth, daysInMonth) - 1)
}

export function getDayOfMonth(date: Date): number {
  return getDate(date)
}
