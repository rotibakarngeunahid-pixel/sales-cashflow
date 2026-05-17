'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, CalendarCheck, ClipboardPenLine } from 'lucide-react'
import SalesForm from '@/components/sales/SalesForm'

export default function SalesInputPage() {
  const router = useRouter()

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/sales/reports')}
          className="p-2 rounded-lg hover:bg-white text-slate-500 border border-transparent hover:border-slate-200 transition-colors"
          aria-label="Kembali ke laporan"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="page-kicker">Penjualan</p>
          <h2 className="text-2xl font-extrabold text-slate-950">Input Penjualan Harian</h2>
          <p className="text-sm text-slate-500">Tanggal, cabang, channel, lalu simpan draft.</p>
        </div>
      </div>

      {/* Form Card */}
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
            <span className="text-xs font-bold uppercase tracking-wide">Draft dulu</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-orange-950">Review angka sebelum diposting.</p>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <SalesForm
          onSuccess={() => router.push('/sales/reports')}
          onCancel={() => router.push('/sales/reports')}
        />
      </div>
    </div>
  )
}
