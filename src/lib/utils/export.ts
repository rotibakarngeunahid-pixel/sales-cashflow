import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import type { SalesReport, CashflowTransaction } from '@/types/database'
import { formatDate } from './format'

// ─── Arus Kas Export (styled Excel) ─────────────────────────────────────────

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const MONTH_SHORT_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function rupiahExport(amount: number): string {
  return `Rp ${new Intl.NumberFormat('en-US').format(amount)}`
}

function saldoExport(amount: number): string {
  if (amount === 0) return 'Rp -'
  const abs = new Intl.NumberFormat('en-US').format(Math.abs(amount))
  return amount < 0 ? `(Rp ${abs})` : `Rp ${abs}`
}

export async function exportArusKas(
  transactions: CashflowTransaction[],
  options: {
    branchName: string
    businessName?: string
    year: number
    month: number // 1–12
  }
) {
  const { default: ExcelJS } = await import('exceljs')
  const { saveAs: fileSaveAs } = await import('file-saver')

  const { branchName, businessName = 'Roti Bakar Ngeunah', year, month } = options
  const periodLabel = `${MONTH_NAMES_ID[month - 1]} ${year}`
  const monthShort = MONTH_SHORT_EN[month - 1]

  // Sort ascending by date then created_at for correct running balance
  const sorted = [...transactions].sort(
    (a, b) =>
      a.transaction_date.localeCompare(b.transaction_date) ||
      a.created_at.localeCompare(b.created_at)
  )

  type ExportRow = {
    date: string
    jenis: string
    kategori: string
    deskripsi: string
    masuk: string
    keluar: string
    saldo: number
  }

  const rows: ExportRow[] = []

  // Opening balance row (always 0 — period-relative running balance)
  rows.push({
    date: `1-${monthShort}`,
    jenis: 'Saldo Awal',
    kategori: 'Saldo Awal',
    deskripsi: '',
    masuk: 'Rp -',
    keluar: 'Rp -',
    saldo: 0,
  })

  let running = 0
  for (const tx of sorted) {
    const day = parseInt(tx.transaction_date.split('-')[2], 10)
    const isCashIn = tx.transaction_type === 'cash_in'
    const amount = isCashIn ? (tx.cash_in || tx.amount) : (tx.cash_out || tx.amount)
    running += isCashIn ? amount : -amount
    rows.push({
      date: `${day}-${monthShort}`,
      jenis: isCashIn ? 'Pendapatan' : 'Pengeluaran',
      kategori: tx.category?.name || '',
      deskripsi: tx.description || '',
      masuk: isCashIn ? rupiahExport(amount) : '',
      keluar: isCashIn ? '' : rupiahExport(amount),
      saldo: running,
    })
  }

  // Build workbook
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Arus Kas')

  ws.columns = [
    { width: 12 },  // A Tanggal
    { width: 20 },  // B Jenis Transaksi
    { width: 24 },  // C Kategori
    { width: 36 },  // D Deskripsi
    { width: 18 },  // E Masuk
    { width: 18 },  // F Keluar
    { width: 18 },  // G Saldo
  ]

  // Row 1: merged title
  ws.mergeCells('A1:G1')
  const titleCell = ws.getCell('A1')
  titleCell.value = `Arus Kas ${businessName} - ${branchName}`
  titleCell.font = { bold: true, size: 12 }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 22

  // Row 2: period
  ws.getCell('A2').value = periodLabel
  ws.getCell('A2').font = { bold: true }
  ws.getRow(2).height = 16

  // Row 3: spacer
  ws.getRow(3).height = 6

  // Row 4: header
  const HDR_BG = '2D3748'
  const HDR_FG = 'FFFFFF'
  const headers = ['Tanggal', 'Jenis Transaksi', 'Kategori', 'Deskripsi', 'Masuk', 'Keluar', 'Saldo']
  const hdrRow = ws.getRow(4)
  hdrRow.height = 18
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: HDR_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } }
    cell.border = {
      top: { style: 'thin', color: { argb: 'AAAAAA' } },
      left: { style: 'thin', color: { argb: 'AAAAAA' } },
      bottom: { style: 'thin', color: { argb: 'AAAAAA' } },
      right: { style: 'thin', color: { argb: 'AAAAAA' } },
    }
    // right-align currency columns (E=4, F=5, G=6, 0-indexed)
    cell.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle' }
  })

  // Data rows (Row 5+)
  const THIN_BORDER = { style: 'thin' as const, color: { argb: 'E5E7EB' } }
  const cellBorder = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER }
  const RED_ARGB = 'FFDC2626'

  rows.forEach((row, idx) => {
    const r = ws.getRow(5 + idx)
    r.height = 16
    const vals = [row.date, row.jenis, row.kategori, row.deskripsi, row.masuk, row.keluar, saldoExport(row.saldo)]
    vals.forEach((val, i) => {
      const cell = r.getCell(i + 1)
      cell.value = val
      cell.border = cellBorder
      if (i >= 4) cell.alignment = { horizontal: 'right' }
    })
    if (row.saldo < 0) {
      r.getCell(7).font = { color: { argb: RED_ARGB } }
    }
  })

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `Arus_Kas_${branchName.replace(/\s+/g, '_')}_${MONTH_NAMES_ID[month - 1]}_${year}.xlsx`
  fileSaveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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
  positionStartDate?: string
  positionEndDate?: string
  branchName?: string
}

export function exportSalesToExcel(data: SalesReport[], filename = 'laporan-penjualan') {
  const rows = data.map((row) => ({
    Tanggal: formatDate(row.report_date, 'dd/MM/yyyy'),
    Cabang: row.branch?.name ?? '',
    Cash: row.cash,
    'QRIS Gross': row.qris_gross ?? row.qris,
    'QRIS MDR': row.qris_mdr ?? 0,
    'QRIS Nett': row.qris,
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
    'QRIS Gross': row.qris_gross ?? row.qris,
    'QRIS MDR': row.qris_mdr ?? 0,
    'QRIS Nett': row.qris,
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

export async function exportCashflowToExcel(
  data: CashflowTransaction[],
  options: CashflowExportOptions | string = {}
) {
  const { default: ExcelJS } = await import('exceljs')
  const { saveAs: fileSaveAs } = await import('file-saver')

  const isStr = typeof options === 'string'
  const branchName       = isStr ? '' : (options.branchName ?? '')
  const cashPositions    = isStr ? [] : (options.cashPositions ?? [])
  const positionStartDate = isStr ? '' : (options.positionStartDate ?? '')
  const positionEndDate  = isStr ? '' : (options.positionEndDate ?? '')

  const displayBranch = branchName || 'Semua Cabang'
  const periodStart = positionStartDate ? formatDate(positionStartDate, 'dd/MM/yyyy') : '-'
  const periodEnd   = positionEndDate   ? formatDate(positionEndDate,   'dd/MM/yyyy') : '-'

  // ── ARGB palette (fully-opaque: FF + RRGGBB) ─────────────────────
  const C_TEAL_DARK = 'FF1B4B43'
  const C_TEAL_MED  = 'FF2D6B5E'
  const C_WHITE     = 'FFFFFFFF'
  const C_GRAY_ROW  = 'FFF5F5F5'
  const C_BORDER    = 'FFD0D0D0'
  const C_GREEN     = 'FF2E7D32'
  const C_RED       = 'FFD32F2F'

  const fmtRp = (n: number) =>
    n === 0 ? '-' : `Rp ${new Intl.NumberFormat('en-US').format(n)}`
  const fmtRpAlways = (n: number) =>
    `Rp ${new Intl.NumberFormat('en-US').format(n)}`

  // ── Workbook / worksheet ──────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Cashflow')

  ws.columns = [
    { width: 14 }, // A Tanggal
    { width: 14 }, // B Cabang
    { width: 12 }, // C Tipe
    { width: 16 }, // D Kategori
    { width: 28 }, // E Deskripsi
    { width: 16 }, // F Cash In
    { width: 16 }, // G Cash Out
    { width: 16 }, // H Amount
  ]

  // ── Row 1 — Title ─────────────────────────────────────────────────
  ws.mergeCells('A1:H1')
  ws.getRow(1).height = 28
  const titleCell = ws.getCell('A1')
  titleCell.value     = `Laporan Cashflow — ${displayBranch}`
  titleCell.font      = { bold: true, size: 14, color: { argb: C_WHITE } }
  titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_DARK } }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }

  // ── Row 2 — Period ────────────────────────────────────────────────
  ws.mergeCells('A2:H2')
  ws.getRow(2).height = 20
  const periodCell = ws.getCell('A2')
  periodCell.value     = `Periode: ${periodStart} s/d ${periodEnd}`
  periodCell.font      = { italic: true, size: 11, color: { argb: C_WHITE } }
  periodCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
  periodCell.alignment = { horizontal: 'left', vertical: 'middle' }

  // ── Row 3 — Spacer ────────────────────────────────────────────────
  ws.getRow(3).height = 8

  // ── Row 4 — Column headers ────────────────────────────────────────
  const headers = ['Tanggal', 'Cabang', 'Tipe', 'Kategori', 'Deskripsi', 'Cash In', 'Cash Out', 'Amount']
  const hdrRow = ws.getRow(4)
  hdrRow.height = 18
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1)
    cell.value     = h
    cell.font      = { bold: true, size: 10, color: { argb: C_WHITE } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
    cell.border    = { top: { style: 'thin', color: { argb: C_WHITE } }, left: { style: 'thin', color: { argb: C_WHITE } }, bottom: { style: 'thin', color: { argb: C_WHITE } }, right: { style: 'thin', color: { argb: C_WHITE } } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  // Freeze header row so it stays visible while scrolling
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', activeCell: 'A5' }]

  // ── Rows 5+ — Data ────────────────────────────────────────────────
  type FontOpts = { bold?: boolean; color?: { argb: string } }
  const THIN = { style: 'thin' as const, color: { argb: C_BORDER } }
  const dBorder = { top: THIN, left: THIN, bottom: THIN, right: THIN }

  data.forEach((tx, idx) => {
    const r = ws.getRow(5 + idx)
    r.height = 15
    const isCashIn = tx.transaction_type === 'cash_in'
    const bgArgb   = idx % 2 === 0 ? C_WHITE : C_GRAY_ROW
    const bg       = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } }

    const put = (col: number, val: string, align: 'left' | 'center' | 'right', font?: FontOpts) => {
      const c = r.getCell(col)
      c.value     = val
      c.fill      = bg
      c.border    = dBorder
      c.alignment = { horizontal: align }
      if (font) c.font = font
    }

    put(1, formatDate(tx.transaction_date, 'dd/MM/yyyy'), 'center')     // A Tanggal
    put(2, tx.branch?.name ?? '', 'center')                              // B Cabang
    put(3, isCashIn ? 'Cash In' : 'Cash Out', 'center')                 // C Tipe
    put(4, tx.category?.name ?? '', 'center')                           // D Kategori
    put(5, tx.description ?? '', 'left')                                 // E Deskripsi
    put(6, fmtRp(tx.cash_in), 'right')                                   // F Cash In
    put(7, fmtRp(tx.cash_out), 'right')                                  // G Cash Out
    put(8, fmtRpAlways(tx.amount), 'right', {                           // H Amount (bold, colored)
      bold: true, color: { argb: isCashIn ? C_GREEN : C_RED },
    })
  })

  // ── Total row ─────────────────────────────────────────────────────
  const totalRowNum  = 5 + data.length
  const totalCashIn  = data.reduce((s, t) => s + t.cash_in,  0)
  const totalCashOut = data.reduce((s, t) => s + t.cash_out, 0)
  const net = totalCashIn - totalCashOut

  const totBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: C_TEAL_DARK } }
  const totBorder = { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } }
  const totalRow = ws.getRow(totalRowNum)
  totalRow.height = 18

  ws.mergeCells(`A${totalRowNum}:E${totalRowNum}`)
  const lblCell = ws.getCell(`A${totalRowNum}`)
  lblCell.value     = 'TOTAL'
  lblCell.font      = { bold: true, color: { argb: C_WHITE } }
  lblCell.fill      = totBg
  lblCell.alignment = { horizontal: 'center', vertical: 'middle' }
  lblCell.border    = totBorder

  const putTotal = (col: number, val: string, colorArgb: string) => {
    const c = totalRow.getCell(col)
    c.value     = val
    c.font      = { bold: true, color: { argb: colorArgb } }
    c.fill      = totBg
    c.alignment = { horizontal: 'right' }
    c.border    = totBorder
  }

  putTotal(6, fmtRpAlways(totalCashIn),  C_WHITE)  // F Total Cash In
  putTotal(7, fmtRpAlways(totalCashOut), C_WHITE)  // G Total Cash Out
  const netStr = net < 0
    ? `(Rp ${new Intl.NumberFormat('en-US').format(Math.abs(net))})`
    : `Rp ${new Intl.NumberFormat('en-US').format(net)}`
  putTotal(8, netStr, net >= 0 ? C_GREEN : C_RED)  // H Net Amount

  // ── Posisi Kas sheet ──────────────────────────────────────────────
  if (cashPositions.length > 0) {
    const posWs = wb.addWorksheet('Posisi Kas')
    posWs.columns = [
      { width: 22 }, // Cabang
      { width: 18 }, // Cash In
      { width: 18 }, // Cash Out
      { width: 18 }, // Posisi Kas
    ]

    const posHeaders = ['Cabang', 'Total Cash In', 'Total Cash Out', 'Posisi Kas']
    const posHdrRow = posWs.getRow(1)
    posHdrRow.height = 18
    posHeaders.forEach((h, i) => {
      const c = posHdrRow.getCell(i + 1)
      c.value     = h
      c.font      = { bold: true, color: { argb: C_WHITE } }
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
      c.alignment = { horizontal: 'center' }
    })

    const thinPos = { style: 'thin' as const, color: { argb: C_BORDER } }
    const posBorder = { top: thinPos, left: thinPos, bottom: thinPos, right: thinPos }
    cashPositions.forEach((pos, idx) => {
      const r = posWs.getRow(2 + idx)
      r.height  = 15
      const bgArgb = idx % 2 === 0 ? C_WHITE : C_GRAY_ROW
      const bg2 = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } }

      const putPos = (col: number, val: string, align: 'left' | 'center' | 'right', colorArgb?: string) => {
        const c = r.getCell(col)
        c.value     = val
        c.fill      = bg2
        c.border    = posBorder
        c.alignment = { horizontal: align }
        if (colorArgb) c.font = { color: { argb: colorArgb } }
      }

      putPos(1, pos.branchName,           'left')
      putPos(2, fmtRpAlways(pos.cashIn),  'right')
      putPos(3, fmtRpAlways(pos.cashOut), 'right')
      putPos(4, fmtRpAlways(pos.balance), 'right', pos.balance < 0 ? C_RED : C_GREEN)
    })
  }

  // ── Build filename & save ─────────────────────────────────────────
  const branchPart = (branchName || 'Semua_Cabang').replace(/\s+/g, '_')
  const startPart  = positionStartDate ? positionStartDate.replace(/-/g, '') : ''
  const endPart    = positionEndDate   ? positionEndDate.replace(/-/g, '')   : ''
  const datePart   = startPart && endPart ? `_${startPart}-${endPart}` : ''
  const exportFilename = `Laporan_Cashflow_${branchPart}${datePart}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  fileSaveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    exportFilename
  )
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
