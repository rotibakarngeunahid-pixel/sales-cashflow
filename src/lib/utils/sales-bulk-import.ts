import { calculateSales } from './calculations'

const QRIS_MDR_RATE = 0.007

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maret: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  desember: 11,
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
}

export type SalesImportParseResult = {
  rows: ParsedSalesImportRow[]
  errors: string[]
  warnings: string[]
  skippedEmptyRows: number
}

export function parseCsv(text: string) {
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

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

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

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '')

  return rows
}

export function parseMoney(value: string | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\u00A0/g, ' ')

  if (!normalized || /^rp\s*-$/i.test(normalized) || normalized === '-') return 0

  const hasNegativeSign = normalized.includes('-')
  const digitsOnly = normalized.replace(/[^0-9]/g, '')
  const parsed = digitsOnly ? Number(digitsOnly) : 0

  return hasNegativeSign ? -parsed : parsed
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function normalizeYear(year: number) {
  if (!Number.isFinite(year)) return new Date().getFullYear()
  return Math.max(2000, Math.min(2100, Math.trunc(year)))
}

function parseTemplateDate(value: string, year: number) {
  const raw = value.trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch
    return `${yyyy}-${pad(Number(mm))}-${pad(Number(dd))}`
  }

  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/)
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch
    const fullYear = yyyy
      ? Number(yyyy.length === 2 ? `20${yyyy}` : yyyy)
      : normalizeYear(year)
    return `${fullYear}-${pad(Number(mm))}-${pad(Number(dd))}`
  }

  const namedMonthMatch = raw.match(/^(\d{1,2})[-\s]([A-Za-z]+)$/)
  if (namedMonthMatch) {
    const [, day, monthName] = namedMonthMatch
    const month = MONTH_LOOKUP[monthName.toLowerCase()]
    if (month === undefined) return null
    return `${normalizeYear(year)}-${pad(month + 1)}-${pad(Number(day))}`
  }

  return null
}

function hasAnySalesValue(row: ParsedSalesImportRow) {
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

export function parseSalesBulkCsv(text: string, year: number): SalesImportParseResult {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()))
  const errors: string[] = []
  const warnings: string[] = []
  let skippedEmptyRows = 0

  if (rows.length < 3) {
    return {
      rows: [],
      errors: ['CSV harus memiliki minimal dua baris header dan satu baris data.'],
      warnings,
      skippedEmptyRows,
    }
  }

  const parsedRows = rows.slice(2).reduce<ParsedSalesImportRow[]>((acc, row, index) => {
    const sourceRow = index + 3
    const reportDate = parseTemplateDate(row[0] ?? '', year)

    if (!reportDate) {
      errors.push(`Baris ${sourceRow}: format tanggal tidak terbaca (${row[0] || 'kosong'}).`)
      return acc
    }

    const gofoodCompensation = parseMoney(row[6])
    const qrisGross = parseMoney(row[2])
    const qrisMdr = Math.round(qrisGross * QRIS_MDR_RATE)
    const qrisNett = qrisGross - qrisMdr
    const base = {
      sourceRow,
      report_date: reportDate,
      cash: parseMoney(row[1]),
      qris: qrisNett,
      qris_gross: qrisGross,
      qris_mdr: qrisMdr,
      gofood_gross: parseMoney(row[3]),
      gofood_commission: parseMoney(row[4]),
      gofood_promo: parseMoney(row[5]),
      gofood_nett: parseMoney(row[7]),
      grabfood_gross: parseMoney(row[8]),
      grabfood_commission: parseMoney(row[9]),
      grabfood_promo: parseMoney(row[10]),
      grabfood_ads: parseMoney(row[11]),
      grabfood_nett: parseMoney(row[12]),
      shopeefood_gross: parseMoney(row[13]),
      shopeefood_promo: parseMoney(row[14]),
      shopeefood_commission: parseMoney(row[15]),
      shopeefood_nett: parseMoney(row[16]),
      notes: gofoodCompensation > 0 ? `GoFood compensation dari CSV: ${gofoodCompensation}` : '',
    }

    const calculations = calculateSales(base)
    const parsedRow: ParsedSalesImportRow = { ...base, ...calculations }

    if (!hasAnySalesValue(parsedRow)) {
      skippedEmptyRows += 1
      return acc
    }

    const csvGrandTotal = parseMoney(row[17])
    if (csvGrandTotal > 0 && Math.abs(csvGrandTotal - parsedRow.grand_total_nett_sales) > 1) {
      warnings.push(
        `Baris ${sourceRow}: grand total CSV berbeda dengan hasil hitung sistem (${csvGrandTotal} vs ${parsedRow.grand_total_nett_sales}).`
      )
    }

    acc.push(parsedRow)
    return acc
  }, [])

  return { rows: parsedRows, errors, warnings, skippedEmptyRows }
}

function escapeCsvCell(value: string | number) {
  const cell = String(value)
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

function templateMoney(value = '') {
  return value || 'Rp -'
}

export function buildSalesBulkTemplateCsv(month: number, year: number) {
  const safeMonth = Math.max(0, Math.min(11, month - 1))
  const safeYear = normalizeYear(year)
  const days = new Date(safeYear, safeMonth + 1, 0).getDate()

  const rows: (string | number)[][] = [
    [
      'Date',
      'Cash',
      'QRIS',
      'Gofood',
      '',
      '',
      '',
      '',
      'Grabfood',
      '',
      '',
      '',
      '',
      'Shopeefood',
      '',
      '',
      '',
      'Grand Total Nett Sales',
      '',
      '',
      '',
    ],
    [
      '',
      '',
      '',
      'Gross',
      'Commision',
      'Promotion',
      'Compensasion',
      'Nett',
      'Gross',
      'Commision',
      'Promotion',
      'Ads/Iklan',
      'Nett',
      'Gross',
      'Promotion',
      'Commision',
      'Nett',
      '',
      '',
      'Recap',
      '',
    ],
  ]

  for (let day = 1; day <= days; day += 1) {
    rows.push([
      `${day}-${MONTHS_SHORT[safeMonth]}`,
      '',
      '',
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      templateMoney(),
      '',
      MONTHS_LONG[day - 1] ?? '',
      '',
    ])
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}
