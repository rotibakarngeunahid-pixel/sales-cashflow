import * as XLSX from 'xlsx'
import type { CashflowCategory, CashflowType } from '@/types/database'

type BranchLookup = {
  id: string
  name: string
}

type CategoryLookup = Pick<CashflowCategory, 'id' | 'name' | 'default_type'>

export type CashflowImportIssue = {
  row: number
  column: string
  message: string
  severity: 'error' | 'warning'
}

export type ParsedCashflowImportRow = {
  sourceRow: number
  transaction_date: string
  branch_id: string
  branch_name: string
  transaction_type: CashflowType
  category_id: string
  category_name: string
  description: string
  amount: number
  reference_code: string
  import_key: string
  rowErrors: CashflowImportIssue[]
}

export type CashflowImportParseResult = {
  rows: ParsedCashflowImportRow[]
  fatalErrors: string[]
  allIssues: CashflowImportIssue[]
  skippedEmptyRows: number
  internalDuplicateKeys: string[]
}

export type CashflowDbDuplicateCheckResult = {
  existingKeys: string[]
  validRows: ParsedCashflowImportRow[]
}

type RawCell = string | number | Date | undefined | null

type LookupContext = {
  branches: BranchLookup[]
  categories: CategoryLookup[]
}

const HEADER_ALIASES = [
  ['tanggal', 'date', 'transaction-date', 'tanggal-transaksi'],
  ['cabang', 'branch', 'outlet'],
  ['tipe', 'type', 'jenis', 'transaction-type'],
  ['kategori', 'category'],
  ['deskripsi', 'description', 'keterangan'],
  ['nominal', 'amount', 'jumlah'],
  ['kode-referensi', 'reference-code', 'referensi', 'reference'],
]

const CASHFLOW_IMPORT_SOURCE = 'cashflow-import'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function hasAnyValue(row: RawCell[]) {
  return row.some((cell) => String(cell ?? '').trim())
}

function isEmptyDataRow(row: RawCell[]) {
  return row.slice(0, 7).every((cell) => String(cell ?? '').trim() === '')
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  )
}

function toIsoDate(year: number, month: number, day: number) {
  if (!isValidDateParts(year, month, day)) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function parseDateValue(value: RawCell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return toIsoDate(parsed.y, parsed.m, parsed.d)
  }

  const raw = String(value ?? '').trim()
  if (!raw) return null

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (slash) {
    const year = slash[3].length === 2 ? Number(`20${slash[3]}`) : Number(slash[3])
    return toIsoDate(year, Number(slash[2]), Number(slash[1]))
  }

  return null
}

function parseAmount(value: RawCell): { value: number; error: string | null } {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: 0, error: 'Nominal tidak valid.' }
    if (value <= 0) return { value, error: 'Nominal harus lebih dari 0.' }
    return { value: Math.round(value), error: null }
  }

  const raw = String(value ?? '').trim()
  if (!raw) return { value: 0, error: 'Nominal wajib diisi.' }
  if (!/[0-9]/.test(raw)) return { value: 0, error: `Nominal tidak valid: "${raw}".` }

  const isNegative = raw.includes('-') || /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[^0-9,.-]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned

  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else if (lastComma > -1) {
    const afterComma = cleaned.slice(lastComma + 1)
    normalized = afterComma.length === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.')
  } else if (lastDot > -1) {
    const afterDot = cleaned.slice(lastDot + 1)
    normalized = afterDot.length === 3 ? cleaned.replace(/\./g, '') : cleaned
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return { value: 0, error: `Nominal tidak valid: "${raw}".` }
  const amount = Math.round(Math.abs(parsed))
  if (isNegative || parsed < 0) return { value: -amount, error: 'Nominal tidak boleh negatif.' }
  if (amount <= 0) return { value: amount, error: 'Nominal harus lebih dari 0.' }

  return { value: amount, error: null }
}

function parseTransactionType(value: RawCell): CashflowType | null {
  const normalized = normalizeText(String(value ?? ''))
  if (['cash-in', 'cashin', 'in', 'masuk', 'pemasukan', 'income', 'debit'].includes(normalized)) {
    return 'cash_in'
  }
  if (['cash-out', 'cashout', 'out', 'keluar', 'pengeluaran', 'expense', 'kredit', 'credit'].includes(normalized)) {
    return 'cash_out'
  }
  return null
}

function makeImportKey(row: {
  transaction_date: string
  branch_id: string
  transaction_type: CashflowType
  category_id: string
  amount: number
  description: string
  reference_code: string
}) {
  const explicitReference = normalizeText(row.reference_code)
  if (explicitReference) return `${CASHFLOW_IMPORT_SOURCE}:ref:${explicitReference}`

  return [
    CASHFLOW_IMPORT_SOURCE,
    'auto',
    row.transaction_date,
    row.branch_id,
    row.transaction_type,
    row.category_id,
    row.amount,
    normalizeText(row.description || '-'),
  ].join(':')
}

function buildLookupMaps(context: LookupContext) {
  return {
    branchByName: new Map(context.branches.map((branch) => [normalizeText(branch.name), branch])),
    categoryByName: new Map(context.categories.map((category) => [normalizeText(category.name), category])),
  }
}

function validateHeader(row: RawCell[]) {
  const normalized = row.slice(0, HEADER_ALIASES.length).map((cell) => normalizeText(String(cell ?? '')))

  return HEADER_ALIASES.every((aliases, index) => aliases.includes(normalized[index]))
}

function parseRowData(
  rawCells: RawCell[],
  sourceRow: number,
  context: LookupContext
): ParsedCashflowImportRow {
  const issues: CashflowImportIssue[] = []
  const { branchByName, categoryByName } = buildLookupMaps(context)

  const rawDate = rawCells[0]
  const transactionDate = parseDateValue(rawDate)
  if (!transactionDate) {
    issues.push({
      row: sourceRow,
      column: 'Tanggal',
      message: `Tanggal tidak valid: "${String(rawDate ?? '').trim() || '(kosong)'}".`,
      severity: 'error',
    })
  }

  const rawBranch = String(rawCells[1] ?? '').trim()
  const branch = branchByName.get(normalizeText(rawBranch))
  if (!branch) {
    issues.push({
      row: sourceRow,
      column: 'Cabang',
      message: rawBranch ? `Cabang "${rawBranch}" tidak ditemukan.` : 'Cabang wajib diisi.',
      severity: 'error',
    })
  }

  const rawType = rawCells[2]
  const transactionType = parseTransactionType(rawType)
  if (!transactionType) {
    issues.push({
      row: sourceRow,
      column: 'Tipe',
      message: 'Tipe harus Cash In/Cash Out, Masuk/Keluar, atau cash_in/cash_out.',
      severity: 'error',
    })
  }

  const rawCategory = String(rawCells[3] ?? '').trim()
  const category = categoryByName.get(normalizeText(rawCategory))
  if (!category) {
    issues.push({
      row: sourceRow,
      column: 'Kategori',
      message: rawCategory ? `Kategori "${rawCategory}" tidak ditemukan.` : 'Kategori wajib diisi.',
      severity: 'error',
    })
  } else if (
    transactionType
    && category.default_type !== 'both'
    && category.default_type !== transactionType
  ) {
    issues.push({
      row: sourceRow,
      column: 'Kategori',
      message: `Kategori "${category.name}" tidak cocok untuk tipe ${transactionType === 'cash_in' ? 'Cash In' : 'Cash Out'}.`,
      severity: 'error',
    })
  }

  const description = String(rawCells[4] ?? '').trim()
  const amountResult = parseAmount(rawCells[5])
  if (amountResult.error) {
    issues.push({
      row: sourceRow,
      column: 'Nominal',
      message: amountResult.error,
      severity: 'error',
    })
  }

  const referenceCode = String(rawCells[6] ?? '').trim()
  const base = {
    sourceRow,
    transaction_date: transactionDate ?? '',
    branch_id: branch?.id ?? '',
    branch_name: branch?.name ?? rawBranch,
    transaction_type: transactionType ?? 'cash_out',
    category_id: category?.id ?? '',
    category_name: category?.name ?? rawCategory,
    description,
    amount: amountResult.value > 0 ? amountResult.value : 0,
    reference_code: referenceCode,
    rowErrors: issues,
  }

  return {
    ...base,
    import_key: transactionDate && branch && transactionType && category && amountResult.value > 0
      ? makeImportKey({
        transaction_date: transactionDate,
        branch_id: branch.id,
        transaction_type: transactionType,
        category_id: category.id,
        amount: amountResult.value,
        description,
        reference_code: referenceCode,
      })
      : '',
  }
}

function parseRawRows(rawRows: RawCell[][], context: LookupContext, kind: 'CSV' | 'Excel'): CashflowImportParseResult {
  const filledRows = rawRows.filter(hasAnyValue)
  const fatalErrors: string[] = []
  let skippedEmptyRows = 0

  if (filledRows.length < 2) {
    fatalErrors.push(`File ${kind} harus memiliki satu baris header dan minimal satu baris data.`)
    return { rows: [], fatalErrors, allIssues: [], skippedEmptyRows, internalDuplicateKeys: [] }
  }

  if (!validateHeader(filledRows[0])) {
    fatalErrors.push('Header template tidak sesuai. Gunakan template Cashflow yang disediakan sistem.')
    return { rows: [], fatalErrors, allIssues: [], skippedEmptyRows, internalDuplicateKeys: [] }
  }

  const parsedRows: ParsedCashflowImportRow[] = []

  filledRows.slice(1).forEach((rawRow, index) => {
    const sourceRow = index + 2
    if (isEmptyDataRow(rawRow)) {
      skippedEmptyRows += 1
      return
    }
    parsedRows.push(parseRowData(rawRow, sourceRow, context))
  })

  const keyMap = new Map<string, ParsedCashflowImportRow[]>()
  parsedRows.forEach((row) => {
    if (!row.import_key) return
    keyMap.set(row.import_key, [...(keyMap.get(row.import_key) ?? []), row])
  })

  const internalDuplicateKeys: string[] = []
  keyMap.forEach((rows, key) => {
    if (rows.length <= 1) return
    internalDuplicateKeys.push(key)
    const sourceRows = rows.map((row) => row.sourceRow).join(', ')
    rows.forEach((row) => {
      row.rowErrors.push({
        row: row.sourceRow,
        column: 'Duplikat',
        message: `Data duplikat dalam file pada baris ${sourceRows}.`,
        severity: 'error',
      })
    })
  })

  const allIssues = parsedRows.flatMap((row) => row.rowErrors)
  return { rows: parsedRows, fatalErrors, allIssues, skippedEmptyRows, internalDuplicateKeys }
}

export function parseCashflowCsv(text: string, context: LookupContext): CashflowImportParseResult {
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
  return parseRawRows(rows, context, 'CSV')
}

export function parseCashflowXlsx(buffer: ArrayBuffer, context: LookupContext): CashflowImportParseResult {
  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch {
    return {
      rows: [],
      fatalErrors: ['File Excel tidak dapat dibaca. Pastikan file tidak rusak.'],
      allIssues: [],
      skippedEmptyRows: 0,
      internalDuplicateKeys: [],
    }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return {
      rows: [],
      fatalErrors: ['File Excel tidak memiliki sheet data.'],
      allIssues: [],
      skippedEmptyRows: 0,
      internalDuplicateKeys: [],
    }
  }

  const rawRows = XLSX.utils.sheet_to_json<RawCell[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
  })

  return parseRawRows(rawRows, context, 'Excel')
}

export async function parseCashflowImportFile(
  file: File,
  context: LookupContext
): Promise<CashflowImportParseResult> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    return parseCashflowCsv(await file.text(), context)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseCashflowXlsx(await file.arrayBuffer(), context)
  }

  return {
    rows: [],
    fatalErrors: ['Format file tidak didukung. Gunakan file .xlsx atau .csv.'],
    allIssues: [],
    skippedEmptyRows: 0,
    internalDuplicateKeys: [],
  }
}

export async function checkCashflowDbDuplicates(
  rows: ParsedCashflowImportRow[],
  // eslint-disable-next-line
  supabase: any
): Promise<CashflowDbDuplicateCheckResult> {
  const keys = rows.map((row) => row.import_key).filter(Boolean)
  if (keys.length === 0) return { existingKeys: [], validRows: rows }

  const { data, error } = await supabase
    .from('cashflow_transactions')
    .select('import_key')
    .in('import_key', keys)

  if (error) throw error

  const existingKeys = (data ?? [])
    .map((row: { import_key: string | null }) => row.import_key)
    .filter((key: string | null): key is string => Boolean(key))
  const existingSet = new Set(existingKeys)

  return {
    existingKeys,
    validRows: rows.filter((row) => !existingSet.has(row.import_key)),
  }
}

function escapeCsvCell(value: string | number) {
  const cell = String(value)
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export function buildCashflowTemplateCsv() {
  const rows: (string | number)[][] = [
    ['Tanggal', 'Cabang', 'Tipe', 'Kategori', 'Deskripsi', 'Nominal', 'Kode Referensi'],
    ['', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
  ]

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

export function buildCashflowTemplateXlsx(branches: BranchLookup[], categories: CategoryLookup[]): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const templateRows: (string | number)[][] = [
    ['Tanggal', 'Cabang', 'Tipe', 'Kategori', 'Deskripsi', 'Nominal', 'Kode Referensi'],
  ]

  for (let index = 0; index < 50; index += 1) {
    templateRows.push(['', '', '', '', '', '', ''])
  }

  const templateSheet = XLSX.utils.aoa_to_sheet(templateRows)
  templateSheet['!cols'] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 14 },
    { wch: 26 },
    { wch: 42 },
    { wch: 16 },
    { wch: 24 },
  ]
  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Template')

  const branchSheet = XLSX.utils.aoa_to_sheet([
    ['Cabang Aktif'],
    ...branches.map((branch) => [branch.name]),
  ])
  branchSheet['!cols'] = [{ wch: 32 }]
  XLSX.utils.book_append_sheet(workbook, branchSheet, 'Cabang')

  const categorySheet = XLSX.utils.aoa_to_sheet([
    ['Kategori Aktif', 'Tipe Default'],
    ...categories.map((category) => [
      category.name,
      category.default_type === 'both' ? 'Cash In / Cash Out' : category.default_type === 'cash_in' ? 'Cash In' : 'Cash Out',
    ]),
  ])
  categorySheet['!cols'] = [{ wch: 32 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(workbook, categorySheet, 'Kategori')

  const instructionSheet = XLSX.utils.aoa_to_sheet([
    ['Petunjuk Import Cashflow'],
    [''],
    ['1. Isi data hanya pada sheet Template.'],
    ['2. Kolom Tanggal menerima format YYYY-MM-DD atau DD/MM/YYYY.'],
    ['3. Kolom Tipe menerima Cash In, Cash Out, Masuk, Keluar, cash_in, atau cash_out.'],
    ['4. Cabang dan Kategori harus sama dengan daftar pada sheet referensi.'],
    ['5. Nominal harus angka positif tanpa tanda minus.'],
    ['6. Kode Referensi opsional, tetapi disarankan jika data punya nomor bukti/nota.'],
    ['7. Data akan masuk sebagai transaksi cashflow manual hasil import file, bukan laporan sales.'],
  ])
  instructionSheet['!cols'] = [{ wch: 90 }]
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Petunjuk')

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}
