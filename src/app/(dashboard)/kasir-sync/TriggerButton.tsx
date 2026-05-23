'use client'

import { useState } from 'react'
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'

export default function KasirSyncTriggerButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
    newCount?: number
  } | null>(null)

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
        newCount: data.result?.newCount,
      })

      if (data.success) {
        // Reload halaman setelah 2 detik agar data terbaru tampil
        setTimeout(() => window.location.reload(), 2000)
      }
    } catch {
      setResult({ success: false, message: 'Gagal terhubung ke server.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={handleSync}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Menarik data…' : 'Tarik Sekarang'}
      </button>

      {result && (
        <div
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${
            result.success
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          {result.message}
        </div>
      )}
    </div>
  )
}
