import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import type { SalesReport, CashflowTransaction } from '@/types/database'
import { formatDate } from './format'

type CashPositionExport = {
  branchName: string
  cashIn: number
  cashOut: number
  balance: number
}

type CashflowExportOptions = {
  filename?: string
  cashPositions?: CashPositionExport[]
  positionAsOfDate?: string
}

export function exportSalesToExcel(data: SalesReport[], filename = 'laporan-penjualan') {
  const rows = data.map((row) => ({
    Tanggal: formatDate(row.report_date, 'dd/MM/yyyy'),
    Cabang: row.branch?.name ?? '',
    Cash: row.cash,
    QRIS: row.qris,
    'GoFood Nett': row.gofood_nett,
    'GrabFood Nett': row.grabfood_nett,
    'ShopeeFood Nett': row.shopeefood_nett,
    'Total Offline': row.total_offline,
    'Total Online Gross': row.total_online_gross,
    'Total Online Nett': row.total_online_nett,
    'Total Potongan Online': row.total_online_deduction,
    'Potongan (%)': row.online_deduction_percentage.toFixed(2),
    'Grand Total Nett Sales': row.grand_total_nett_sales,
    Status: row.status,
    Catatan: row.notes ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan Penjualan')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}.xlsx`)
}

export function exportSalesToCSV(data: SalesReport[], filename = 'laporan-penjualan') {
  const rows = data.map((row) => ({
    Tanggal: formatDate(row.report_date, 'dd/MM/yyyy'),
    Cabang: row.branch?.name ?? '',
    Cash: row.cash,
    QRIS: row.qris,
    'GoFood Nett': row.gofood_nett,
    'GrabFood Nett': row.grabfood_nett,
    'ShopeeFood Nett': row.shopeefood_nett,
    'Total Offline': row.total_offline,
    'Total Online Gross': row.total_online_gross,
    'Total Online Nett': row.total_online_nett,
    'Grand Total Nett Sales': row.grand_total_nett_sales,
    Status: row.status,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${filename}.csv`)
}

export function exportCashflowToExcel(
  data: CashflowTransaction[],
  options: CashflowExportOptions | string = {}
) {
  const filename = typeof options === 'string' ? options : options.filename ?? 'laporan-cashflow'
  const cashPositions = typeof options === 'string' ? [] : options.cashPositions ?? []
  const positionAsOfDate = typeof options === 'string' ? '' : options.positionAsOfDate ?? ''

  const rows = data.map((row) => ({
    Tanggal: formatDate(row.transaction_date, 'dd/MM/yyyy'),
    Cabang: row.branch?.name ?? '',
    Tipe: row.transaction_type === 'cash_in' ? 'Cash In' : 'Cash Out',
    Kategori: row.category?.name ?? '',
    Deskripsi: row.description ?? '',
    'Cash In': row.cash_in,
    'Cash Out': row.cash_out,
    Amount: row.amount,
    Sumber: row.source,
    Status: row.status,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cashflow')

  if (cashPositions.length > 0) {
    const positionRows = cashPositions.map((row) => ({
      'Tanggal Acuan': positionAsOfDate ? formatDate(positionAsOfDate, 'dd/MM/yyyy') : '',
      Cabang: row.branchName,
      'Total Cash In': row.cashIn,
      'Total Cash Out': row.cashOut,
      'Posisi Kas': row.balance,
    }))
    const positionWs = XLSX.utils.json_to_sheet(positionRows)
    XLSX.utils.book_append_sheet(wb, positionWs, 'Posisi Kas')
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}.xlsx`)
}

export function exportCashflowToCSV(data: CashflowTransaction[], filename = 'laporan-cashflow') {
  const rows = data.map((row) => ({
    Tanggal: formatDate(row.transaction_date, 'dd/MM/yyyy'),
    Cabang: row.branch?.name ?? '',
    Tipe: row.transaction_type === 'cash_in' ? 'Cash In' : 'Cash Out',
    Kategori: row.category?.name ?? '',
    Deskripsi: row.description ?? '',
    'Cash In': row.cash_in,
    'Cash Out': row.cash_out,
    Amount: row.amount,
    Status: row.status,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${filename}.csv`)
}
