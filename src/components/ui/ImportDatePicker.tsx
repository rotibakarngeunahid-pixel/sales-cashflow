'use client'

// =============================================
// ImportDatePicker
// Kalender kustom (bukan native <input type="date">) khusus untuk halaman
// import dari sumber luar (POS, dst). Native date picker tidak bisa
// menonaktifkan tanggal tertentu (hanya min/max), padahal di halaman import
// kita perlu menonaktifkan tanggal yang SUDAH pernah diimport supaya tidak
// tertukar/dobel tanpa sadar.
// =============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, formatDate, toDateInputValue } from '@/lib/utils/format'

const WEEKDAY_LABELS = ['M', 'S', 'S', 'R', 'K', 'J', 'S']
const MONTH_LABELS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

interface ImportDatePickerProps {
  /** Tanggal terpilih, format YYYY-MM-DD */
  value: string
  onChange: (value: string) => void
  /**
   * Ambil daftar tanggal (YYYY-MM-DD) dalam bulan `monthDate` yang harus
   * ditampilkan nonaktif (abu-abu, tidak bisa diklik) — biasanya tanggal
   * yang sudah pernah diimport. Hasil di-cache per bulan di dalam komponen.
   */
  fetchDisabledDates?: (monthDate: Date) => Promise<Set<string>>
  disabledTooltip?: string
  className?: string
}

export function ImportDatePicker({
  value,
  onChange,
  fetchDisabledDates,
  disabledTooltip = 'Tanggal ini sudah pernah diimport',
  className,
}: ImportDatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseIsoDate(value)
  const [viewDate, setViewDate] = useState<Date>(() => selected ?? new Date())
  const [disabledSet, setDisabledSet] = useState<Set<string>>(new Set())
  const cacheRef = useRef<Map<string, Set<string>>>(new Map())
  const rootRef = useRef<HTMLDivElement>(null)

  // Sinkronkan bulan yang ditampilkan kalau value berubah dari luar (mis. reset form)
  useEffect(() => {
    if (open) return
    const d = parseIsoDate(value)
    if (d) setViewDate(d)
  }, [value, open])

  const loadDisabledDates = useCallback(async (target: Date) => {
    if (!fetchDisabledDates) return
    const key = monthKey(target)
    const cached = cacheRef.current.get(key)
    if (cached) {
      setDisabledSet(cached)
      return
    }
    try {
      const result = await fetchDisabledDates(target)
      cacheRef.current.set(key, result)
      setDisabledSet(result)
    } catch {
      // Gagal ambil status — jangan blokir kalender, biarkan semua tanggal bisa diklik
      setDisabledSet(new Set())
    }
  }, [fetchDisabledDates])

  // Fungsi fetch bisa berganti identitas (mis. filter cabang berubah di parent) —
  // cache lama sudah tidak valid untuk scope baru, jadi harus dibuang.
  useEffect(() => {
    cacheRef.current = new Map()
    setDisabledSet(new Set())
  }, [fetchDisabledDates])

  useEffect(() => {
    if (open) loadDisabledDates(viewDate)
  }, [open, viewDate, loadDisabledDates])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const days = useMemo(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const startOffset = firstOfMonth.getDay() // 0 = Minggu
    const gridStart = new Date(year, month, 1 - startOffset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [viewDate])

  function selectDay(d: Date) {
    onChange(toDateInputValue(d))
    setOpen(false)
  }

  function goToToday() {
    const t = new Date()
    setViewDate(t)
    // Kalau status bulan ini sudah pernah di-cache dan hari ini ternyata nonaktif,
    // cukup pindahkan tampilan ke bulan sekarang tanpa memilihnya. Kalau belum
    // diketahui (belum pernah dibuka), pilih dulu secara optimis — konsisten
    // dengan validasi "sudah pernah diimport" yang tetap berjalan di luar kalender.
    const iso = toDateInputValue(t)
    const cached = cacheRef.current.get(monthKey(t))
    if (!cached?.has(iso)) selectDay(t)
  }

  const todayIso = toDateInputValue(new Date())
  const currentMonth = viewDate.getMonth()

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-rbn-red"
      >
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>
          {selected ? formatDate(value) : 'Pilih tanggal'}
        </span>
        <CalendarIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTH_LABELS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={i} className="py-1 text-center text-[10px] font-bold uppercase text-gray-400">{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const iso = toDateInputValue(d)
              const inMonth = d.getMonth() === currentMonth
              const isSelected = iso === value
              const isToday = iso === todayIso
              const isDisabled = inMonth && disabledSet.has(iso)

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isDisabled || !inMonth}
                  title={isDisabled ? disabledTooltip : undefined}
                  onClick={() => selectDay(d)}
                  className={cn(
                    'h-8 rounded-lg text-xs font-medium transition-colors',
                    !inMonth && 'cursor-default text-gray-300',
                    inMonth && !isDisabled && !isSelected && 'text-gray-700 hover:bg-gray-100',
                    isSelected && 'bg-rbn-red font-bold text-white hover:bg-rbn-red',
                    isDisabled && 'cursor-not-allowed bg-gray-100 text-gray-300',
                    isToday && !isSelected && 'ring-1 ring-inset ring-rbn-red'
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
            <button type="button" onClick={goToToday} className="text-xs font-semibold text-rbn-red hover:underline">
              Hari ini
            </button>
            {fetchDisabledDates && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="h-2 w-2 rounded-sm border border-gray-200 bg-gray-100" /> Sudah diimport
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface ImportDateRangeFilterProps {
  startDate: string
  endDate: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  /** Lihat ImportDatePicker.fetchDisabledDates — dipakai untuk field start & end sekaligus. */
  fetchDisabledDates?: (monthDate: Date) => Promise<Set<string>>
  disabledTooltip?: string
}

export function ImportDateRangeFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  fetchDisabledDates,
  disabledTooltip,
}: ImportDateRangeFilterProps) {
  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <ImportDatePicker
        value={startDate}
        onChange={onStartChange}
        fetchDisabledDates={fetchDisabledDates}
        disabledTooltip={disabledTooltip}
      />
      <span className="hidden text-center text-sm text-gray-400 sm:block">-</span>
      <ImportDatePicker
        value={endDate}
        onChange={onEndChange}
        fetchDisabledDates={fetchDisabledDates}
        disabledTooltip={disabledTooltip}
      />
    </div>
  )
}
