import { format, parseISO } from 'date-fns'
import { id } from 'date-fns/locale'

// WITA = Waktu Indonesia Tengah = UTC+8
const WITA_OFFSET_MS = 8 * 60 * 60 * 1000

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('id-ID').format(amount)
}

export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatDate(dateStr: string, fmt = 'dd MMM yyyy'): string {
  try {
    return format(parseISO(dateStr), fmt, { locale: id })
  } catch {
    return dateStr
  }
}

export function formatDateInput(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'yyyy-MM-dd')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy HH:mm', { locale: id })
  } catch {
    return dateStr
  }
}

export function toDateInputValue(date: Date = new Date()): string {
  return format(date, 'yyyy-MM-dd')
}

/**
 * Konversi timestamp ke WITA (UTC+8).
 * Jika string sudah punya info timezone (Z / +HH:mm), konversi dari sana.
 * Jika tidak ada timezone, anggap sudah WITA.
 */
export function toWITADate(dateStr: string): Date {
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(dateStr.trim())
  if (hasTimezone) {
    const utcMs = new Date(dateStr).getTime()
    return new Date(utcMs + WITA_OFFSET_MS - new Date().getTimezoneOffset() * 60_000 + new Date().getTimezoneOffset() * 60_000)
  }
  // Tidak ada timezone → anggap WITA, parse literal
  try {
    return parseISO(dateStr)
  } catch {
    return new Date(dateStr)
  }
}

/**
 * Format datetime dalam WITA.
 * Input bisa berupa ISO string, 'YYYY-MM-DD HH:MM:SS', atau 'YYYY-MM-DDTHH:MM:SS'.
 * Hasilnya selalu menambahkan label " WITA".
 */
export function formatDateTimeWITA(dateStr: string): string {
  try {
    const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(dateStr.trim())
    let d: Date
    if (hasTimezone) {
      // Ada timezone → convert ke WITA
      const utcMs = new Date(dateStr).getTime()
      d = new Date(utcMs + WITA_OFFSET_MS)
    } else {
      d = parseISO(dateStr.replace(' ', 'T'))
    }
    return format(d, 'dd MMM yyyy HH:mm', { locale: id }) + ' WITA'
  } catch {
    return dateStr + ' WITA'
  }
}

/**
 * Format hanya waktu (HH:MM) dari timestamp, dalam WITA.
 */
export function formatTimeWITA(timeStr: string): string {
  try {
    const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(timeStr.trim())
    let d: Date
    if (hasTimezone) {
      const utcMs = new Date(timeStr).getTime()
      d = new Date(utcMs + WITA_OFFSET_MS)
    } else {
      // timeStr bisa berupa 'HH:MM:SS' saja
      if (/^\d{2}:\d{2}/.test(timeStr)) {
        return timeStr.slice(0, 5) + ' WITA'
      }
      d = parseISO(timeStr.replace(' ', 'T'))
    }
    return format(d, 'HH:mm', { locale: id }) + ' WITA'
  } catch {
    return timeStr + ' WITA'
  }
}

/**
 * Gabung date + time string menjadi satu ISO-like string (WITA assumed jika tidak ada timezone).
 * Contoh: '2025-01-01' + '10:30:00' → '2025-01-01T10:30:00'
 */
export function combineDateTime(date: string, time: string): string {
  const d = date.trim()
  const t = time.trim()
  if (!t) return d
  if (t.includes('T')) return t // time sudah full datetime
  return `${d}T${t}`
}

export function parseRupiah(value: string): number {
  const cleaned = value.replace(/[^0-9]/g, '')
  return cleaned ? parseInt(cleaned, 10) : 0
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
