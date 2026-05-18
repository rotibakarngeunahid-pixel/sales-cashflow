'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CalendarCheck, ClipboardPenLine, CheckCircle2 } from 'lucide-react'
import SalesForm from '@/components/sales/SalesForm'
import SalesBulkImport from '@/components/sales/SalesBulkImport'

const REPORTS_PATH = '/sales/reports'
const SALES_REPORTS_TOAST_KEY = 'salesReportsToast'

export default function SalesInputPage() {
  const router = useRouter()
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const fallbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current)
    }
  }, [])

  function handleSuccess(msg?: string) {
    const message = msg || 'Berhasil disimpan!'
    setSuccessMsg(message)
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current)

    try {
      window.sessionStorage.setItem(SALES_REPORTS_TOAST_KEY, message)
    } catch {
      // Ignore storage failures; navigation must still continue.
    }

    router.replace(REPORTS_PATH)

    fallbackTimerRef.current = window.setTimeout(() => {
      window.location.assign(REPORTS_PATH)
    }, 900)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(REPORTS_PATH)}
          className="p-2 rounded-lg hover:bg-white text-slate-500 border border-transparent hover:border-slate-200 transition-colors"
          aria-label="Kembali ke laporan"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="page-kicker">Penjualan</p>
          <h2 className="text-2xl font-extrabold text-slate-950">Input Penjualan Harian</h2>
          <p className="text-sm text-slate-500">Isi data, simpan sebagai draft, atau langsung submit.</p>
        </div>
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg} Mengalihkan ke halaman laporan...</span>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <CalendarCheck className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wide">Rutinitas harian</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-emerald-950">Catat setiap selesai shift.</p>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-center gap-2 text-orange-700">
            <ClipboardPenLine className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wide">Alur kerja</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-orange-950">Draft → Submit → Post (Final)</p>
        </div>
      </div>

      <SalesBulkImport onSuccess={handleSuccess} />

      <div className="card p-4 sm:p-5">
        <SalesForm
          onSuccess={handleSuccess}
          onCancel={() => router.push(REPORTS_PATH)}
        />
      </div>
    </div>
  )
}
