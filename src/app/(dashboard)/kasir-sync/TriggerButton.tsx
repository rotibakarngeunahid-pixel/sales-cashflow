'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, CheckCircle2, AlertCircle, Info } from 'lucide-react'

interface SyncResult {
  success: boolean
  message: string
  newCount?: number
  skippedCount?: number
  skippedPayment?: number
  errors?: string[]
}

export default function KasirSyncTriggerButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)

  async function handleSync() {
    if (loading) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/kasir-sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      setResult({
        success: data.success,
        message: data.message,
        newCount: data.result?.newCount ?? 0,
        skippedCount: data.result?.skippedCount ?? 0,
        skippedPayment: data.result?.skippedPayment ?? 0,
        errors: data.result?.errors ?? [],
      })
    } catch {
      setResult({
        success: false,
        message: 'Gagal terhubung ke server. Periksa koneksi internet.',
      })
    } finally {
      setLoading(false)
      // Selalu refresh data server component — sukses maupun gagal
      // Ini memperbarui riwayat batch, statistik antrian, dll. tanpa reload penuh
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-rbn-red' : ''}`} />
        {loading ? 'Menarik data…' : 'Tarik Sekarang'}
      </button>

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

          {/* Ringkasan detail */}
          {result.success && (
            <div className="mt-1 space-y-0.5 text-right opacity-80">
              {(result.newCount ?? 0) > 0 && (
                <p>✅ {result.newCount} data baru masuk antrian</p>
              )}
              {(result.skippedPayment ?? 0) > 0 && (
                <p>⏭️ {result.skippedPayment} dilewati (bukan Cash/QRIS)</p>
              )}
              {(result.skippedCount ?? 0) > 0 && (
                <p>🔁 {result.skippedCount} sudah ada sebelumnya</p>
              )}
            </div>
          )}

          {/* Error detail */}
          {!result.success && result.errors && result.errors.length > 0 && (
            <div className="mt-1 opacity-80">
              {result.errors.slice(0, 2).map((e, i) => (
                <p key={i} className="truncate max-w-[240px]" title={e}>• {e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
