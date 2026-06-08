import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'
import type { CashflowTransaction } from '@/types/database'

export const dynamic = 'force-dynamic'

type CashPositionPayload = {
  branchName: string
  cashIn: number
  cashOut: number
  balance: number
}

type RequestBody = {
  transactions: CashflowTransaction[]
  branchName?: string
  positionStartDate?: string
  positionEndDate?: string
  cashPositions?: CashPositionPayload[]
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as RequestBody
  const {
    transactions = [],
    branchName = '',
    positionStartDate = '',
    positionEndDate = '',
    cashPositions = [],
  } = body

  // ── Shared helpers ─────────────────────────────────────────────────
  function fmtDate(dateStr: string): string {
    try {
      const [y, m, d] = dateStr.split('-')
      const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des']
      return `${d}/${m}/${y}`
    } catch { return dateStr }
  }

  function fmtRp(n: number): string {
    return n === 0 ? '-' : `Rp ${new Intl.NumberFormat('en-US').format(n)}`
  }

  function fmtRpAlways(n: number): string {
    return `Rp ${new Intl.NumberFormat('en-US').format(n)}`
  }

  const displayBranch = branchName || 'Semua Cabang'
  const periodStart = positionStartDate ? fmtDate(positionStartDate) : '-'
  const periodEnd   = positionEndDate   ? fmtDate(positionEndDate)   : '-'

  // ── ARGB palette ───────────────────────────────────────────────────
  const C_TEAL_DARK = 'FF1B4B43'
  const C_TEAL_MED  = 'FF2D6B5E'
  const C_WHITE     = 'FFFFFFFF'
  const C_GRAY_ROW  = 'FFF5F5F5'
  const C_BORDER    = 'FFD0D0D0'
  const C_GREEN     = 'FF2E7D32'
  const C_RED       = 'FFD32F2F'

  // ── Workbook / worksheet ───────────────────────────────────────────
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

  // Row 1: Title
  ws.mergeCells('A1:H1')
  ws.getRow(1).height = 28
  const titleCell = ws.getCell('A1')
  titleCell.value = `Laporan Cashflow — ${displayBranch}`
  titleCell.font = { bold: true, size: 14, color: { argb: C_WHITE } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_DARK } }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }

  // Row 2: Period
  ws.mergeCells('A2:H2')
  ws.getRow(2).height = 20
  const periodCell = ws.getCell('A2')
  periodCell.value = `Periode: ${periodStart} s/d ${periodEnd}`
  periodCell.font = { italic: true, size: 11, color: { argb: C_WHITE } }
  periodCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
  periodCell.alignment = { horizontal: 'left', vertical: 'middle' }

  // Row 3: Spacer
  ws.getRow(3).height = 8

  // Row 4: Headers
  const headers = ['Tanggal', 'Cabang', 'Tipe', 'Kategori', 'Deskripsi', 'Cash In', 'Cash Out', 'Amount']
  const hdrRow = ws.getRow(4)
  hdrRow.height = 18
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: C_WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
    cell.border = {
      top: { style: 'thin', color: { argb: C_WHITE } },
      left: { style: 'thin', color: { argb: C_WHITE } },
      bottom: { style: 'thin', color: { argb: C_WHITE } },
      right: { style: 'thin', color: { argb: C_WHITE } },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', activeCell: 'A5' }]

  // Data rows
  type FontOpts = { bold?: boolean; color?: { argb: string } }
  const THIN = { style: 'thin' as const, color: { argb: C_BORDER } }
  const dBorder = { top: THIN, left: THIN, bottom: THIN, right: THIN }

  transactions.forEach((tx, idx) => {
    const r = ws.getRow(5 + idx)
    r.height = 15
    const isCashIn = tx.transaction_type === 'cash_in'
    const bgArgb = idx % 2 === 0 ? C_WHITE : C_GRAY_ROW
    const bg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } }

    const put = (col: number, val: string, align: 'left' | 'center' | 'right', font?: FontOpts) => {
      const c = r.getCell(col)
      c.value = val
      c.fill = bg
      c.border = dBorder
      c.alignment = { horizontal: align }
      if (font) c.font = font
    }

    put(1, fmtDate(tx.transaction_date), 'center')
    put(2, tx.branch?.name ?? '', 'center')
    put(3, isCashIn ? 'Cash In' : 'Cash Out', 'center')
    put(4, tx.category?.name ?? '', 'center')
    put(5, tx.description ?? '', 'left')
    put(6, fmtRp(tx.cash_in), 'right')
    put(7, fmtRp(tx.cash_out), 'right')
    put(8, fmtRpAlways(tx.amount), 'right', {
      bold: true, color: { argb: isCashIn ? C_GREEN : C_RED },
    })
  })

  // Total row
  const totalRowNum  = 5 + transactions.length
  const totalCashIn  = transactions.reduce((s, t) => s + t.cash_in,  0)
  const totalCashOut = transactions.reduce((s, t) => s + t.cash_out, 0)
  const net = totalCashIn - totalCashOut

  const totBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: C_TEAL_DARK } }
  const totBorder = {
    top: { style: 'thin' as const }, left: { style: 'thin' as const },
    bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
  }
  const totalRow = ws.getRow(totalRowNum)
  totalRow.height = 18

  ws.mergeCells(`A${totalRowNum}:E${totalRowNum}`)
  const lblCell = ws.getCell(`A${totalRowNum}`)
  lblCell.value = 'TOTAL'
  lblCell.font = { bold: true, color: { argb: C_WHITE } }
  lblCell.fill = totBg
  lblCell.alignment = { horizontal: 'center', vertical: 'middle' }
  lblCell.border = totBorder

  const putTotal = (col: number, val: string, colorArgb: string) => {
    const c = totalRow.getCell(col)
    c.value = val
    c.font = { bold: true, color: { argb: colorArgb } }
    c.fill = totBg
    c.alignment = { horizontal: 'right' }
    c.border = totBorder
  }

  putTotal(6, fmtRpAlways(totalCashIn),  C_WHITE)
  putTotal(7, fmtRpAlways(totalCashOut), C_WHITE)
  const netStr = net < 0
    ? `(Rp ${new Intl.NumberFormat('en-US').format(Math.abs(net))})`
    : `Rp ${new Intl.NumberFormat('en-US').format(net)}`
  putTotal(8, netStr, net >= 0 ? C_GREEN : C_RED)

  // Posisi Kas sheet
  if (cashPositions.length > 0) {
    const posWs = wb.addWorksheet('Posisi Kas')
    posWs.columns = [
      { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 },
    ]
    const posHdrRow = posWs.getRow(1)
    posHdrRow.height = 18
    ;['Cabang', 'Total Cash In', 'Total Cash Out', 'Posisi Kas'].forEach((h, i) => {
      const c = posHdrRow.getCell(i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: C_WHITE } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TEAL_MED } }
      c.alignment = { horizontal: 'center' }
    })
    const thinPos = { style: 'thin' as const, color: { argb: C_BORDER } }
    const posBorder = { top: thinPos, left: thinPos, bottom: thinPos, right: thinPos }
    cashPositions.forEach((pos, idx) => {
      const r = posWs.getRow(2 + idx)
      r.height = 15
      const bgArgb = idx % 2 === 0 ? C_WHITE : C_GRAY_ROW
      const bg2 = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } }
      const putPos = (col: number, val: string, align: 'left' | 'center' | 'right', color?: string) => {
        const c = r.getCell(col)
        c.value = val
        c.fill = bg2
        c.border = posBorder
        c.alignment = { horizontal: align }
        if (color) c.font = { color: { argb: color } }
      }
      putPos(1, pos.branchName,           'left')
      putPos(2, fmtRpAlways(pos.cashIn),  'right')
      putPos(3, fmtRpAlways(pos.cashOut), 'right')
      putPos(4, fmtRpAlways(pos.balance), 'right', pos.balance < 0 ? C_RED : C_GREEN)
    })
  }

  // ── Build filename & respond ───────────────────────────────────────
  const branchPart = (branchName || 'Semua_Cabang').replace(/\s+/g, '_')
  const startPart  = positionStartDate ? positionStartDate.replace(/-/g, '') : ''
  const endPart    = positionEndDate   ? positionEndDate.replace(/-/g, '')   : ''
  const datePart   = startPart && endPart ? `_${startPart}-${endPart}` : ''
  const filename   = `Laporan_Cashflow_${branchPart}${datePart}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}
