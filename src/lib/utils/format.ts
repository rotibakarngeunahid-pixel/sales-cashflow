import { format, parseISO } from 'date-fns'
import { id } from 'date-fns/locale'

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

export function parseRupiah(value: string): number {
  const cleaned = value.replace(/[^0-9]/g, '')
  return cleaned ? parseInt(cleaned, 10) : 0
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
