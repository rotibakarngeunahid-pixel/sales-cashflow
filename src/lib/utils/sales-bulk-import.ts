import * as XLSX from 'xlsx'
import { calculateSales } from './calculations'

// ─── Constants ───────────────────────────────────────────────────────────────

const QRIS_MDR_RATE = 0.007

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7, agustus: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, oktober: 9,
  nov: 10, november: 10,
  dec: 11, december: 11, desember: 11,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportRowError = {
  /** 1-based source row number in the file */
  row: number
  /** Column name or 'general' */
  column: string
  /** Human-readable error message */
  message: string
  /** error = blocks import, warning = informational */
  severity: 'error' | 'warning'
}

export type ParsedSalesImportRow = {
  sourceRow: number
  report_date: string
  cash: number
  qris: number
  qris_gross: number
  qris_mdr: number
  gofood_gross: number
  gofood_promo: number
  gofood_commission: number
  gofood_nett: number
  grabfood_gross: number
  grabfood_promo: number
  grabfood_commission: number
  grabfood_ads: number
  grabfood_nett: number
  shopeefood_gross: number
  shopeefood_promo: number
  shopeefood_commission: number
  shopeefood_nett: number
  notes: string
  total_offline: number
  total_online_gross: number
  total_online_nett: number
  total_online_deduction: number
  grand_total_nett_sales: number
  online_deduction_percentage: number
  /** Row-level issues attached to this specific row */
  rowErrors: ImportRowError[]
}

export type SalesImportParseResult = {
  rows: ParsedSalesImportRow[]
  /** Fatal errors that block the entire import (e.g. wrong file format) */
  fatalErrors: string[]
  /** Aggregated list of all row-level issues */
  allIssues: ImportRowError[]
  skippedEmptyRows: number
  /** Dates that were duplicated within the file itself */
  internalDuplicateDates: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(v: number) {
  return String(v).padStart(2, '0')
}

function normalizeYear(year: number) {
  if (!Number.isFinite(year)) return new Date().getFullYear()
  return Math.max(2000, Math.min(2100, Math.trunc(year)))
}

export function parseMoney(value: string | number | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return isFinite(value) ? Math.round(value) : 0

  const normalized = String(value).trim().replace(/\u00A0/g, ' ')
  if (!normalized || /^rp\s*-$/i.test(normalized) || normalized === '-') return 0

  const hasNegativeSign = normalized.startsWith('-')
  const digitsOnly = normalized.replace(/[^0-9]/g, '')
  const parsed = digitsOnly ? Number(digitsOnly) : 0
  return hasNegativeSign ? -parsed : parsed
}

function parseTemplateDate(value: string, year: number): string | null {
  const raw = value.trim()
  if (!raw) return null

  // ISO: 2024-05-20
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch
    return `${yyyy}-${pad(Number(mm))}-${pad(Number(dd))}`
  }

  // DD/MM or DD/MM/YYYY or DD-MM-YY
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/)
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch
    const fullYear = yyyy
      ? Number(yyyy.length === 2 ? `20${yyyy}` : yyyy)
      : normalizeYear(year)
    return `${fullYear}-${pad(Number(mm))}-${pad(Number(dd))}`
  }

  // Named month: 20-Jan, 20 Mei
  const namedMonthMatch = raw.match(/^(\d{1,2})[-\s]([A-Za-z]+)$/)
  if (namedMonthMatch) {
    const [, day, monthName] = namedMonthMatch
    const month = MONTH_LOOKUP[monthName.toLowerCase()]
    if (month === undefined) return null
    return `${normalizeYear(year)}-${pad(month + 1)}-${pad(Number(day))}`
  }

  return null
}

function hasAnySalesValue(row: ParsedSalesImportRow): boolean {
  return (
    row.cash +
      row.qris_gross +
      row.gofood_gross +
      row.gofood_promo +
      row.gofood_commission +
      row.gofood_nett +
      row.grabfood_gross +
      row.grabfood_promo +
      row.grabfood_commission +
      row.grabfood_ads +
      row.grabfood_nett +
      row.shopeefood_gross +
      row.shopeefood_promo +
      row.shopeefood_commission +
      row.shopeefood_nett >
    0
  )
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
      continue
    }
    if (char === '"') { inQuotes = !inQuotes; continue }
    if (char === ',' && !inQuotes) { row.push(cell); cell = ''; continue }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }

  if (cell || row.length > 0) { row.push(cell); rows.push(row) }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '')

  return rows
}

// ─── Core Row Parser ──────────────────────────────────────────────────────────

function parseRowData(
  rawCells: (string | number | undefined)[],
  sourceRow: number,
  year: number
): { parsedRow: ParsedSalesImportRow | null; skipped: boolean } {
  const issues: ImportRowError[] = []

  // ─ Date ─
  const rawDate = String(rawCells[0] ?? '').trim()
  const reportDate = parseTemplateDate(rawDate, year)
  if (!reportDate) {
    issues.push({
      row: sourceRow,
      column: 'Tanggal',
      message: `Format tanggal tidak valid: "${rawDate || '(kosong)'}"`,
      severity: 'error',
    })
    // Cannot continue without a date — return a dummy row carrying the error
    const dummy = buildEmptyParsedRow(sourceRow, '', issues)
    return { parsedRow: dummy, skipped: false }
  }

  // ─ Numeric columns ─
  const cash = parseMoney(rawCells[1])
  const qrisGross = parseMoney(rawCells[2])
  const gofoodGross = parseMoney(rawCells[3])
  const gofoodCommission = parseMoney(rawCells[4])
  const gofoodPromo = parseMoney(rawCells[5])
  const gofoodCompensation = parseMoney(rawCells[6])
  const gofoodNett = parseMoney(rawCells[7])
  const grabfoodGross = parseMoney(rawCells[8])
  const grabfoodCommission = parseMoney(rawCells[9])
  const grabfoodPromo = parseMoney(rawCells[10])
  const grabfoodAds = parseMoney(rawCells[11])
  const grabfoodNett = parseMoney(rawCells[12])
  const shopeefoodGross = parseMoney(rawCells[13])
  const shopeefoodPromo = parseMoney(rawCells[14])
  const shopeefoodCommission = parseMoney(rawCells[15])
  const shopeefoodNett = parseMoney(rawCells[16])

  // ─ Negative value checks ─
  const numericFields: [number, string][] = [
    [cash, 'Cash'], [qrisGross, 'QRIS Gross'],
    [gofoodGross, 'GoFood Gross'], [gofoodCommission, 'GoFood Commission'],
    [gofoodPromo, 'GoFood Promo'], [gofoodNett, 'GoFood Nett'],
    [grabfoodGross, 'GrabFood Gross'], [grabfoodCommission, 'GrabFood Commission'],
    [grabfoodPromo, 'GrabFood Promo'], [grabfoodAds, 'GrabFood Ads'],
    [grabfoodNett, 'GrabFood Nett'], [shopeefoodGross, 'ShopeeFood Gross'],
    [shopeefoodPromo, 'ShopeeFood Promo'], [shopeefoodCommission, 'ShopeeFood Commission'],
    [shopeefoodNett, 'ShopeeFood Nett'],
  ]

  for (const [val, colName] of numericFields) {
    if (val < 0) {
      issues.push({
        row: sourceRow,
        column: colName,
        message: `Nilai negatif tidak diperbolehkan (${val.toLocaleString('id-ID')})`,
        severity: 'warning',
      })
    }
  }

  // ─ QRIS MDR ─
  const qrisMdr = Math.round(qrisGross * QRIS_MDR_RATE)
  const qrisNett = qrisGross - qrisMdr

  const base = {
    sourceRow,
    report_date: reportDate,
    cash,
    qris: qrisNett,
    qris_gross: qrisGross,
    qris_mdr: qrisMdr,
    gofood_gross: gofoodGross,
    gofood_commission: gofoodCommission,
    gofood_promo: gofoodPromo,
    gofood_nett: gofoodNett,
    grabfood_gross: grabfoodGross,
    grabfood_commission: grabfoodCommission,
    grabfood_promo: grabfoodPromo,
    grabfood_ads: grabfoodAds,
    grabfood_nett: grabfoodNett,
    shopeefood_gross: shopeefoodGross,
    shopeefood_promo: shopeefoodPromo,
    shopeefood_commission: shopeefoodCommission,
    shopeefood_nett: shopeefoodNett,
    notes: gofoodCompensation > 0 ? `GoFood compensation dari CSV: ${gofoodCompensation}` : '',
  }

  const calculations = calculateSales(base)
  const parsedRow: ParsedSalesImportRow = { ...base, ...calculations, rowErrors: issues }

  // ─ Skip empty rows ─
  if (!hasAnySalesValue(parsedRow)) {
    return { parsedRow: null, skipped: true }
  }

  // ─ Grand total cross-check ─
  const csvGrandTotal = parseMoney(rawCells[17])
  if (csvGrandTotal > 0 && Math.abs(csvGrandTotal - parsedRow.grand_total_nett_sales) > 1) {
    issues.push({
      row: sourceRow,
      column: 'Grand Total',
      message: `Grand total di file (${csvGrandTotal.toLocaleString('id-ID')}) berbeda dengan hasil perhitungan sistem (${parsedRow.grand_total_nett_sales.toLocaleString('id-ID')})`,
      severity: 'warning',
    })
  }

  parsedRow.rowErrors = issues
  return { parsedRow, skipped: false }
}

function buildEmptyParsedRow(sourceRow: number, reportDate: string, rowErrors: ImportRowError[]): ParsedSalesImportRow {
  return {
    sourceRow,
    report_date: reportDate,
    cash: 0, qris: 0, qris_gross: 0, qris_mdr: 0,
    gofood_gross: 0, gofood_promo: 0, gofood_commission: 0, gofood_nett: 0,
    grabfood_gross: 0, grabfood_promo: 0, grabfood_commission: 0, grabfood_ads: 0, grabfood_nett: 0,
    shopeefood_gross: 0, shopeefood_promo: 0, shopeefood_commission: 0, shopeefood_nett: 0,
    notes: '',
    total_offline: 0, total_online_gross: 0, total_online_nett: 0,
    total_online_deduction: 0, grand_total_nett_sales: 0, online_deduction_percentage: 0,
    rowErrors,
  }
}

// ─── Main Parsers ─────────────────────────────────────────────────────────────

export function parseSalesBulkCsv(text: string, year: number): SalesImportParseResult {
  const rawRows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()))
  const fatalErrors: string[] = []
  const allIssues: ImportRowError[] = []
  let skippedEmptyRows = 0

  if (rawRows.length < 3) {
    fatalErrors.push('File CSV harus memiliki minimal dua baris header dan satu baris data.')
    return { rows: [], fatalErrors, allIssues, skippedEmptyRows, internalDuplicateDates: [] }
  }

  const parsedRows: ParsedSalesImportRow[] = []
  const seenDates = new Map<string, number>() // date → first sourceRow
  const internalDuplicateDates: string[] = []

  rawRows.slice(2).forEach((rawRow, index) => {
    const sourceRow = index + 3
    const { parsedRow, skipped } = parseRowData(rawRow, sourceRow, year)

    if (skipped) { skippedEmptyRows += 1; return }
    if (!parsedRow) return

    // ─ Internal duplicate detection ─
    if (parsedRow.report_date) {
      const firstSeen = seenDates.get(parsedRow.report_date)
      if (firstSeen !== undefined) {
        const dupIssue: ImportRowError = {
          row: sourceRow,
          column: 'Tanggal',
          message: `Tanggal ${parsedRow.report_date} sudah ada di baris ${firstSeen} dalam file ini`,
          severity: 'error',
        }
        parsedRow.rowErrors = [...parsedRow.rowErrors, dupIssue]
        if (!internalDuplicateDates.includes(parsedRow.report_date)) {
          internalDuplicateDates.push(parsedRow.report_date)
        }
      } else {
        seenDates.set(parsedRow.report_date, sourceRow)
      }
    }

    allIssues.push(...parsedRow.rowErrors)
    parsedRows.push(parsedRow)
  })

  return { rows: parsedRows, fatalErrors, allIssues, skippedEmptyRows, internalDuplicateDates }
}

export function parseSalesBulkXlsx(buffer: ArrayBuffer, year: number): SalesImportParseResult {
  const fatalErrors: string[] = []
  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch {
    fatalErrors.push('File Excel tidak dapat dibaca. Pastikan file tidak rusak.')
    return { rows: [], fatalErrors, allIssues: [], skippedEmptyRows: 0, internalDuplicateDates: [] }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    fatalErrors.push('File Excel tidak memiliki sheet data.')
    return { rows: [], fatalErrors, allIssues: [], skippedEmptyRows: 0, internalDuplicateDates: [] }
  }

  const sheet = workbook.Sheets[sheetName]
  // raw: true to get unformatted values; defval: '' for empty cells
  const rawRows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })

  const filledRows = rawRows.filter((row) => row.some((cell) => String(cell ?? '').trim()))

  if (filledRows.length < 3) {
    fatalErrors.push('File Excel harus memiliki minimal dua baris header dan satu baris data.')
    return { rows: [], fatalErrors, allIssues: [], skippedEmptyRows: 0, internalDuplicateDates: [] }
  }

  const allIssues: ImportRowError[] = []
  let skippedEmptyRows = 0
  const parsedRows: ParsedSalesImportRow[] = []
  const seenDates = new Map<string, number>()
  const internalDuplicateDates: string[] = []

  filledRows.slice(2).forEach((rawRow, index) => {
    const sourceRow = index + 3
    const { parsedRow, skipped } = parseRowData(rawRow, sourceRow, year)

    if (skipped) { skippedEmptyRows += 1; return }
    if (!parsedRow) return

    if (parsedRow.report_date) {
      const firstSeen = seenDates.get(parsedRow.report_date)
      if (firstSeen !== undefined) {
        const dupIssue: ImportRowError = {
          row: sourceRow,
          column: 'Tanggal',
          message: `Tanggal ${parsedRow.report_date} sudah ada di baris ${firstSeen} dalam file ini`,
          severity: 'error',
        }
        parsedRow.rowErrors = [...parsedRow.rowErrors, dupIssue]
        if (!internalDuplicateDates.includes(parsedRow.report_date)) {
          internalDuplicateDates.push(parsedRow.report_date)
        }
      } else {
        seenDates.set(parsedRow.report_date, sourceRow)
      }
    }

    allIssues.push(...parsedRow.rowErrors)
    parsedRows.push(parsedRow)
  })

  return { rows: parsedRows, fatalErrors, allIssues, skippedEmptyRows, internalDuplicateDates }
}

/** Unified parser — accepts .csv or .xlsx/.xls files */
export async function parseImportFile(file: File, year: number): Promise<SalesImportParseResult> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    const text = await file.text()
    return parseSalesBulkCsv(text, year)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    return parseSalesBulkXlsx(buffer, year)
  }

  return {
    rows: [],
    fatalErrors: ['Format file tidak didukung. Gunakan file .xlsx atau .csv.'],
    allIssues: [],
    skippedEmptyRows: 0,
    internalDuplicateDates: [],
  }
}

// ─── DB Duplicate Check ───────────────────────────────────────────────────────

export type DbDuplicateCheckResult = {
  /** Dates that already have a non-void report in the database */
  existingDates: string[]
  /** Rows that are NOT duplicated against the DB (safe to import) */
  validRows: ParsedSalesImportRow[]
}

export async function checkDbDuplicates(
  rows: ParsedSalesImportRow[],
  branchId: string,
  // eslint-disable-next-line
  supabase: any
): Promise<DbDuplicateCheckResult> {
  const dates = rows.map((r) => r.report_date)
  if (!dates.length || !branchId) {
    return { existingDates: [], validRows: rows }
  }

  const { data } = await supabase
    .from('sales_reports')
    .select('report_date')
    .eq('branch_id', branchId)
    .in('report_date', dates)
    .neq('status', 'void')

  const existingDates: string[] = (data ?? []).map((r: { report_date: string }) => r.report_date)
  const existingSet = new Set(existingDates)
  const validRows = rows.filter((r) => !existingSet.has(r.report_date))

  return { existingDates, validRows }
}

// ─── Template Generators ──────────────────────────────────────────────────────

function escapeCsvCell(value: string | number) {
  const cell = String(value)
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

function templateMoney(value = '') {
  return value || 'Rp -'
}

export function buildSalesBulkTemplateCsv(month: number, year: number): string {
  const safeMonth = Math.max(0, Math.min(11, month - 1))
  const safeYear = normalizeYear(year)
  const days = new Date(safeYear, safeMonth + 1, 0).getDate()

  const rows: (string | number)[][] = [
    [
      'Date', 'Cash', 'QRIS',
      'Gofood', '', '', '', '',
      'Grabfood', '', '', '', '',
      'Shopeefood', '', '', '',
      'Grand Total Nett Sales', '', '', '',
    ],
    [
      '', '', '',
      'Gross', 'Commision', 'Promotion', 'Compensasion', 'Nett',
      'Gross', 'Commision', 'Promotion', 'Ads/Iklan', 'Nett',
      'Gross', 'Promotion', 'Commision', 'Nett',
      '', '', 'Recap', '',
    ],
  ]

  for (let day = 1; day <= days; day += 1) {
    rows.push([
      `${day}-${MONTHS_SHORT[safeMonth]}`,
      '', '',
      templateMoney(), templateMoney(), templateMoney(), templateMoney(), templateMoney(),
      templateMoney(), templateMoney(), templateMoney(), templateMoney(), templateMoney(),
      templateMoney(), templateMoney(), templateMoney(), templateMoney(),
      templateMoney(), '', MONTHS_ID[day - 1] ?? '', '',
    ])
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

export function buildSalesBulkTemplateXlsx(month: number, year: number): Uint8Array {
  const safeMonth = Math.max(0, Math.min(11, month - 1))
  const safeYear = normalizeYear(year)
  const days = new Date(safeYear, safeMonth + 1, 0).getDate()
  const monthLabel = MONTHS_ID[safeMonth]

  const wb = XLSX.utils.book_new()

  // ─ Template sheet ─
  const wsData: (string | number)[][] = [
    // Row 1 — Group headers
    [
      'Tanggal', 'Cash', 'QRIS',
      'GoFood', '', '', '', '',
      'GrabFood', '', '', '', '',
      'ShopeeFood', '', '', '',
      'Grand Total Nett Sales',
    ],
    // Row 2 — Sub-headers
    [
      '', '', '',
      'Gross', 'Commission', 'Promo', 'Compensation', 'Nett',
      'Gross', 'Commission', 'Promo', 'Ads/Iklan', 'Nett',
      'Gross', 'Promo', 'Commission', 'Nett',
      '',
    ],
  ]

  // Data rows — one per day
  for (let day = 1; day <= days; day += 1) {
    wsData.push([
      `${day}-${MONTHS_SHORT[safeMonth]}`,
      0, 0,   // Cash, QRIS
      0, 0, 0, 0, 0,   // GoFood
      0, 0, 0, 0, 0,   // GrabFood
      0, 0, 0, 0,      // ShopeeFood
      0,               // Grand Total
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, // Tanggal
    { wch: 14 }, { wch: 14 }, // Cash, QRIS
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, // GoFood
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, // GrabFood
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, // ShopeeFood
    { wch: 18 }, // Grand Total
  ]

  // Merges for group headers
  ws['!merges'] = [
    { s: { r: 0, c: 3 }, e: { r: 0, c: 7 } },  // GoFood
    { s: { r: 0, c: 8 }, e: { r: 0, c: 12 } }, // GrabFood
    { s: { r: 0, c: 13 }, e: { r: 0, c: 16 } }, // ShopeeFood
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Template')

  // ─ Petunjuk sheet ─
  const wsPetunjuk = XLSX.utils.aoa_to_sheet([
    [`Template Import Penjualan — ${monthLabel} ${safeYear}`],
    [''],
    ['PETUNJUK PENGISIAN:'],
    ['1. Isi kolom-kolom di sheet "Template" sesuai data penjualan harian.'],
    ['2. Kolom Tanggal sudah terisi otomatis, jangan diubah.'],
    ['3. Isi angka murni tanpa format Rupiah (contoh: 150000, bukan Rp 150.000).'],
    ['4. Jika tidak ada transaksi untuk platform tertentu, isi dengan 0.'],
    ['5. Kolom Grand Total Nett Sales akan divalidasi otomatis oleh sistem.'],
    ['6. Jangan menambah/menghapus kolom — urutan kolom sangat penting.'],
    ['7. Simpan file sebagai .xlsx atau .csv sebelum di-upload.'],
    [''],
    ['KETERANGAN KOLOM:'],
    ['- Cash: Total penjualan tunai'],
    ['- QRIS: Gross penerimaan QRIS (MDR 0.7% akan dihitung otomatis)'],
    ['- GoFood Gross: Total tagihan ke pelanggan via GoFood'],
    ['- GoFood Commission: Potongan komisi GoFood'],
    ['- GoFood Promo: Potongan promosi GoFood'],
    ['- GoFood Compensation: Kompensasi GoFood (opsional, dicatat di Notes)'],
    ['- GoFood Nett: Penerimaan bersih dari GoFood (setelah potongan)'],
    ['- GrabFood Gross, Commission, Promo, Ads/Iklan, Nett: Sama dengan GoFood'],
    ['- ShopeeFood Gross, Promo, Commission, Nett: Sama dengan GoFood'],
    ['- Grand Total Nett Sales: Cash + QRIS Nett + Total Online Nett (untuk validasi silang)'],
  ])
  wsPetunjuk['!cols'] = [{ wch: 80 }]
  XLSX.utils.book_append_sheet(wb, wsPetunjuk, 'Petunjuk')

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}
