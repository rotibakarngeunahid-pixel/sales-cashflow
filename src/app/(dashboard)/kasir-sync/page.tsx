import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RefreshCw, ClipboardCheck, AlertCircle, CheckCircle2, XCircle, Clock, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/format'
import KasirSyncTriggerButton from './TriggerButton'
import KasirSyncResetButton from './ResetButton'

export const dynamic = 'force-dynamic'

// =============================================
// Halaman Overview — Sinkronisasi Kasir
// =============================================

export default async function KasirSyncPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Ambil statistik queue secara paralel (count murni — tidak terkena limit 1000 baris)
  const [pendingPenjualanResult, pendingKasKeluarResult, confirmedResult, rejectedResult, recentBatchesResult, lastBatchResult] =
    await Promise.all([
      supabase
        .from('kasir_sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('item_type', 'penjualan'),
      supabase
        .from('kasir_sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('item_type', 'kas_keluar'),
      supabase
        .from('kasir_sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed'),
      supabase
        .from('kasir_sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'rejected'),
      supabase
        .from('kasir_sync_batches')
        .select('id, started_at, completed_at, status, period_from, period_to, total_pulled, new_count, skipped_count, error_message, triggered_by')
        .order('started_at', { ascending: false })
        .limit(10),
      supabase
        .from('kasir_sync_batches')
        .select('completed_at, period_to, status')
        .in('status', ['completed', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const pendingPenjualan = pendingPenjualanResult.count ?? 0
  const pendingKasKeluar = pendingKasKeluarResult.count ?? 0
  const pendingCount = pendingPenjualan + pendingKasKeluar
  const confirmedCount = confirmedResult.count ?? 0
  const rejectedCount = rejectedResult.count ?? 0
  const recentBatches = recentBatchesResult.data ?? []
  const lastSync = lastBatchResult.data

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isOwner = profile?.role === 'owner'

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-rbn-red" />
            Sinkronisasi Kasir
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Data ditarik otomatis setiap hari dari sistem kasir. Tinjau dan konfirmasi sebelum masuk ke cashflow.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isOwner && <KasirSyncResetButton />}
          {isOwner && <KasirSyncTriggerButton />}
          <a
            href="/kasir-sync/review"
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
              pendingCount > 0
                ? 'bg-gradient-to-r from-rbn-red to-rbn-orange text-white shadow-md hover:shadow-lg'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            )}
          >
            <ClipboardCheck className="w-4 h-4" />
            Tinjau Antrian
            {pendingCount > 0 && (
              <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-black">
                {pendingCount}
              </span>
            )}
            <ChevronRight className="w-3.5 h-3.5 opacity-70" />
          </a>
        </div>
      </div>

      {/* Last Sync Info */}
      {lastSync && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="text-emerald-800">
            Sinkronisasi terakhir:{' '}
            <strong>
              {new Date(lastSync.completed_at!).toLocaleString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Makassar',
              })} WITA
            </strong>
            {lastSync.period_to && (
              <> &mdash; data hingga <strong>{formatDate(lastSync.period_to)}</strong></>
            )}
          </span>
        </div>
      )}

      {!lastSync && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800">
            Belum ada sinkronisasi. Klik <strong>Tarik Sekarang</strong> untuk mulai.
          </span>
        </div>
      )}

      {/* Statistik Antrian */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Menunggu Konfirmasi"
          value={pendingCount}
          sub={pendingCount > 0 ? `${pendingPenjualan} penjualan, ${pendingKasKeluar} kas keluar` : undefined}
          icon={<Clock className="w-5 h-5" />}
          color="amber"
          href={pendingCount > 0 ? '/kasir-sync/review?status=pending' : undefined}
        />
        <StatCard
          label="Dikonfirmasi"
          value={confirmedCount}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
          href={confirmedCount > 0 ? '/kasir-sync/review?status=confirmed' : undefined}
        />
        <StatCard
          label="Ditolak"
          value={rejectedCount}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
          href={rejectedCount > 0 ? '/kasir-sync/review?status=rejected' : undefined}
        />
      </div>

      {/* Riwayat Batch */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-bold text-slate-900">Riwayat Sinkronisasi</h2>
        </div>

        {recentBatches.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            Belum ada riwayat sinkronisasi.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-semibold">Waktu</th>
                  <th className="text-left px-4 py-3 font-semibold">Periode</th>
                  <th className="text-right px-4 py-3 font-semibold">Ditarik</th>
                  <th className="text-right px-4 py-3 font-semibold">Baru</th>
                  <th className="text-left px-4 py-3 font-semibold">Pemicu</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentBatches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {new Date(batch.started_at).toLocaleString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Makassar',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {batch.period_from && batch.period_to
                        ? `${formatDate(batch.period_from)} – ${formatDate(batch.period_to)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                      {batch.total_pulled.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">
                      +{batch.new_count.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {batch.triggered_by === 'scheduler'
                        ? '🤖 Otomatis'
                        : batch.triggered_by === 'manual'
                          ? '👤 Manual'
                          : '👤 Manual'}
                    </td>
                    <td className="px-4 py-3">
                      <BatchStatusBadge status={batch.status} />
                      {batch.error_message && (
                        <p className="text-xs text-red-500 mt-0.5 max-w-xs truncate" title={batch.error_message}>
                          {batch.error_message}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600 space-y-1">
        <p className="font-semibold text-slate-800 mb-2">ℹ️ Cara kerja sinkronisasi</p>
        <p>• Data ditarik otomatis dari sistem kasir setiap hari pukul <strong>06:00 WITA</strong>.</p>
        <p>• Data yang ditarik masuk ke <strong>antrian</strong> dengan status &ldquo;Menunggu Konfirmasi&rdquo;.</p>
        <p>• Setelah dikonfirmasi, data masuk ke cashflow dan <strong>tidak bisa diubah</strong>.</p>
        <p>• Data yang sudah pernah diimport manual akan otomatis terhubung (tidak duplikat).</p>
        <p>• Owner bisa trigger sinkronisasi manual kapan saja lewat tombol <strong>Tarik Sekarang</strong>.</p>
      </div>
    </div>
  )
}

// =============================================
// Sub-Components
// =============================================

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
  href,
}: {
  label: string
  value: number
  sub?: string
  icon: React.ReactNode
  color: 'amber' | 'emerald' | 'red'
  href?: string
}) {
  const colorMap = {
    amber: {
      bg: 'bg-amber-50 border-amber-200',
      icon: 'text-amber-600 bg-amber-100',
      value: 'text-amber-700',
    },
    emerald: {
      bg: 'bg-emerald-50 border-emerald-200',
      icon: 'text-emerald-600 bg-emerald-100',
      value: 'text-emerald-700',
    },
    red: {
      bg: 'bg-red-50 border-red-200',
      icon: 'text-red-600 bg-red-100',
      value: 'text-red-700',
    },
  }

  const c = colorMap[color]
  const inner = (
    <div className={cn('rounded-2xl border p-4 flex items-start gap-4', c.bg)}>
      <div className={cn('p-2 rounded-xl flex-shrink-0', c.icon)}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
        <p className={cn('text-3xl font-black mt-1', c.value)}>
          {value.toLocaleString('id-ID')}
        </p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )

  if (href) {
    return <a href={href} className="block hover:opacity-90 transition-opacity">{inner}</a>
  }
  return inner
}

function BatchStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    running: { label: 'Berjalan…', className: 'bg-blue-100 text-blue-700' },
    completed: { label: 'Selesai', className: 'bg-emerald-100 text-emerald-700' },
    partial: { label: 'Sebagian', className: 'bg-amber-100 text-amber-700' },
    failed: { label: 'Gagal', className: 'bg-red-100 text-red-700' },
  }
  const s = map[status] ?? { label: status, className: 'bg-slate-100 text-slate-600' }
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-bold', s.className)}>
      {s.label}
    </span>
  )
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}
