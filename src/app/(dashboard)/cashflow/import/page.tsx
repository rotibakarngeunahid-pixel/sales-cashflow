'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, FileSpreadsheet } from 'lucide-react'
import CashflowBulkImport from '@/components/cashflow/CashflowBulkImport'

const CASHFLOW_PATH = '/cashflow'
const CASHFLOW_TOAST_KEY = 'cashflowToast'

export default function CashflowImportPage() {
  const router = useRouter()

  function handleSuccess(message?: string) {
    try {
      window.sessionStorage.setItem(CASHFLOW_TOAST_KEY, message || 'Import cashflow berhasil.')
    } catch {
      // Navigation must still continue when sessionStorage is unavailable.
    }
    router.replace(CASHFLOW_PATH)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(CASHFLOW_PATH)}
          className="rounded-lg border border-transparent p-2 text-slate-500 transition-colors hover:border-slate-200 hover:bg-white"
          aria-label="Kembali ke cashflow"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <p className="page-kicker">Cashflow</p>
          <h2 className="flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <FileSpreadsheet className="h-6 w-6 text-rbn-red" />
            Import Transaksi Cashflow
          </h2>
          <p className="text-sm text-slate-500">
            Download template, isi transaksi kas, upload, review, lalu simpan ke cashflow.
          </p>
        </div>
      </div>

      <CashflowBulkImport onSuccess={handleSuccess} />
    </div>
  )
}
