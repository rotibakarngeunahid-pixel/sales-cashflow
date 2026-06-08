import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const MONTH_SHORT_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function rupiahFmt(amount: number): string {
  return `Rp ${new Intl.NumberFormat('en-US').format(amount)}`
}

function saldoFmt(amount: number): string {
  if (amount === 0) return 'Rp -'
  const abs = new Intl.NumberFormat('en-US').format(Math.abs(amount))
  return amount < 0 ? `(Rp ${abs})` : `Rp ${abs}`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    branch_id,
    year,
    month,
    branch_name = 'Cabang',
    business_name = 'Roti Bakar Ngeunah',
  } = body as {
    branch_id: string
    year: number
    month: number
    branch_name?: string
    business_name?: string
  }

  if (!branch_id || !year || !month) {
    return NextResponse.json({ error: 'Parameter tidak lengkap.' }, { status: 400 })
  }

  const mm = String(month).padStart(2, '0')
  const startDate = `${year}-${mm}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('cashflow_transactions')
    .select('*, branch:branches(id,name), category:cashflow_categories(id,name)')
    .eq('branch_id', branch_id)
    .eq('status', 'active')
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate)
    .order('transaction_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const transactions = data ?? []
  const monthShort = MONTH_SHORT_EN[month - 1]
  const periodLabel = `${MONTH_NAMES_ID[month - 1]} ${year}`

  // ── Build workbook ─────────────────────────────────────────────────
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

  // Row 1: Title (merged A1:G1)
  ws.mergeCells('A1:G1')
  const titleCell = ws.getCell('A1')
  titleCell.value = `Arus Kas ${business_name} - ${branch_name}`
  titleCell.font = { bold: true, size: 12 }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 22

  // Row 2: Period
  ws.getCell('A2').value = periodLabel
  ws.getCell('A2').font = { bold: true }
  ws.getRow(2).height = 16

  // Row 3: Spacer
  ws.getRow(3).height = 6

  // Row 4: Column headers
  const HDR_BG = 'FF2D3748'
  const HDR_FG = 'FFFFFFFF'
  const headers = ['Tanggal', 'Jenis Transaksi', 'Kategori', 'Deskripsi', 'Masuk', 'Keluar', 'Saldo']
  const hdrRow = ws.getRow(4)
  hdrRow.height = 18
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: HDR_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } }
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFAAAAAA' } },
      left:   { style: 'thin', color: { argb: 'FFAAAAAA' } },
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      right:  { style: 'thin', color: { argb: 'FFAAAAAA' } },
    }
    cell.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle' }
  })

  // ── Build data rows ────────────────────────────────────────────────
  type Row = {
    date: string; jenis: string; kategori: string; deskripsi: string;
    masuk: string; keluar: string; saldo: number;
  }
  const rows: Row[] = []

  // Saldo Awal (opening balance = 0, period-relative)
  rows.push({
    date: `1-${monthShort}`, jenis: 'Saldo Awal', kategori: 'Saldo Awal',
    deskripsi: '', masuk: 'Rp -', keluar: 'Rp -', saldo: 0,
  })

  let running = 0
  for (const tx of transactions) {
    const day = parseInt((tx.transaction_date as string).split('-')[2], 10)
    const isCashIn = tx.transaction_type === 'cash_in'
    const amount = isCashIn
      ? ((tx.cash_in as number) || (tx.amount as number))
      : ((tx.cash_out as number) || (tx.amount as number))
    running += isCashIn ? amount : -amount
    rows.push({
      date: `${day}-${monthShort}`,
      jenis: isCashIn ? 'Pendapatan' : 'Pengeluaran',
      kategori: (tx.category as { name?: string } | null)?.name ?? '',
      deskripsi: (tx.description as string | null) ?? '',
      masuk: isCashIn ? rupiahFmt(amount) : '',
      keluar: isCashIn ? '' : rupiahFmt(amount),
      saldo: running,
    })
  }

  // ── Write data rows ────────────────────────────────────────────────
  const THIN = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }
  const cellBorder = { top: THIN, left: THIN, bottom: THIN, right: THIN }

  rows.forEach((row, idx) => {
    const r = ws.getRow(5 + idx)
    r.height = 16
    const vals = [
      row.date, row.jenis, row.kategori, row.deskripsi,
      row.masuk, row.keluar, saldoFmt(row.saldo),
    ]
    vals.forEach((val, i) => {
      const cell = r.getCell(i + 1)
      cell.value = val
      cell.border = cellBorder
      if (i >= 4) cell.alignment = { horizontal: 'right' }
    })
    if (row.saldo < 0) {
      r.getCell(7).font = { color: { argb: 'FFDC2626' } }
    }
  })

  // ── Generate file ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const filename = `Arus_Kas_${branch_name.replace(/\s+/g, '_')}_${MONTH_NAMES_ID[month - 1]}_${year}.xlsx`

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}
