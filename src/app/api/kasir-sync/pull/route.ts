import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pullKasirToQueue } from '@/lib/kasir-sync/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 menit (Vercel Pro)

// =============================================
// POST — Tarik data kasir ke antrian (pull)
//
// Bisa dipanggil oleh:
//   1. Vercel Cron Job — Authorization: Bearer {CRON_SECRET}
//   2. User manual (owner) — session cookie
// =============================================

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET

  let triggeredBy = 'manual'
  let supabase

  // Cek apakah request dari Vercel Cron
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    triggeredBy = 'scheduler'
    supabase = createServiceClient()
  } else {
    // Validasi user session
    supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Sesi login tidak valid.' },
        { status: 401 }
      )
    }

    // Hanya owner yang bisa trigger manual sync
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'owner') {
      return NextResponse.json(
        { success: false, message: 'Hanya owner yang bisa melakukan sinkronisasi.' },
        { status: 403 }
      )
    }

    triggeredBy = user.id
  }

  // Cek apakah ada sync yang sedang berjalan
  const { data: runningBatch } = await supabase
    .from('kasir_sync_batches')
    .select('id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (runningBatch) {
    const startedMinutesAgo =
      (Date.now() - new Date(runningBatch.started_at).getTime()) / 60000
    // Jika sync berjalan > 10 menit, asumsikan stuck dan lanjutkan
    if (startedMinutesAgo < 10) {
      return NextResponse.json(
        {
          success: false,
          message: 'Sinkronisasi sedang berjalan. Mohon tunggu sebentar.',
          code: 'sync_in_progress',
        },
        { status: 409 }
      )
    }
  }

  // Parse body opsional (untuk manual trigger dengan date range)
  let dateFrom: string | undefined
  let dateTo: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    dateFrom = body.date_from || undefined
    dateTo = body.date_to || undefined
  } catch { /* body kosong ok */ }

  try {
    const result = await pullKasirToQueue(supabase as ReturnType<typeof createServiceClient>, {
      triggeredBy,
      dateFrom,
      dateTo,
    })

    return NextResponse.json({
      success: result.status !== 'failed',
      result: {
        batchId: result.batchId,
        status: result.status,
        periodFrom: result.periodFrom,
        periodTo: result.periodTo,
        totalPulled: result.totalPulled,
        newCount: result.newCount,
        skippedCount: result.skippedCount,
        errors: result.errors.slice(0, 10),
      },
      message:
        result.status === 'completed'
          ? `Sinkronisasi selesai. ${result.newCount} data baru masuk ke antrian.`
          : result.status === 'partial'
            ? `Sinkronisasi sebagian berhasil. ${result.newCount} data baru, ${result.errors.length} error.`
            : 'Sinkronisasi gagal.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return NextResponse.json(
      { success: false, message: msg, code: 'sync_error' },
      { status: 500 }
    )
  }
}
