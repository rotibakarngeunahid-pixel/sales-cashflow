'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, FileSpreadsheet } from 'lucide-react'
import SalesBulkImport from '@/components/sales/SalesBulkImport'

const REPORTS_PATH = '/sales/reports'
const SALES_REPORTS_TOAST_KEY = 'salesReportsToast'

export default function SalesImportPage() {
  const router = useRouter()

  function handleSuccess(msg?: string) {
    const message = msg || 'Import berhasil!'
    try {
      window.sessionStorage.setItem(SALES_REPORTS_TOAST_KEY, message)
    } catch {
      // Ignore storage failures
    }
    router.replace(REPORTS_PATH)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
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
          <h2 className="text-2xl font-extrabold text-slate-950 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-rbn-red" />
            Import Transaksi Penjualan
          </h2>
          <p className="text-sm text-slate-500">
            Download template, isi data, upload, review, lalu simpan ke sistem.
          </p>
        </div>
      </div>

      {/* Bulk import wizard */}
      <SalesBulkImport onSuccess={handleSuccess} />
    </div>
  )
}
