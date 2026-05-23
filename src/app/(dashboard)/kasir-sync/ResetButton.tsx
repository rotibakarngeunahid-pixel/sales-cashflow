'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react'

interface ResetResult {
  success: boolean
  message: string
  deleted?: number
}

export default function KasirSyncResetButton() {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ResetResult | null>(null)

  async function handleReset() {
    setLoading(true)
    setResult(null)
    setShowConfirm(false)

    try {
      const res = await fetch('/api/kasir-sync/reset', { method: 'DELETE' })
      const data = await res.json()

      setResult({
        success: data.success,
        message: data.message,
        deleted: data.deleted ?? 0,
      })
    } catch {
      setResult({
        success: false,
        message: 'Gagal terhubung ke server.',
      })
    } finally {
      setLoading(false)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 hover:border-red-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-4 h-4" />
        {loading ? 'Mereset…' : 'Reset Antrian'}
      </button>

      {/* Hasil reset */}
      {result && (
        <div
          className={`text-xs font-medium px-3 py-2 rounded-lg border max-w-xs text-right ${
            result.success
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          <div className="flex items-center gap-1.5 justify-end">
            {result.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
        </div>
      )}

      {/* Dialog Konfirmasi */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 rounded-xl flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="font-black text-slate-900 text-base">Reset Antrian Pending?</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Semua data dengan status <strong>Menunggu Konfirmasi</strong> akan dihapus permanen dari antrian.
                  Data yang sudah dikonfirmasi atau ditolak tidak terpengaruh.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
              >
                Batal
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-all"
              >
                Ya, Reset Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
