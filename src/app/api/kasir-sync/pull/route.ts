import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pullKasirToQueue } from '@/lib/kasir-sync/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 menit (Vercel Pro)

// =============================================
// POST / GET — Tarik data kasir ke antrian (pull)
//
// Bisa dipanggil oleh:
//   1. Vercel Cron Job — HTTP GET + Authorization: Bearer {CRON_SECRET}
//      (Vercel Cron selalu memanggil dengan method GET)
//   2. User manual (owner) — POST + session cookie
// =============================================

export async function POST(request: Request) {
  return handlePull(request)
}

export async function GET(request: Request) {
  return handlePull(request)
}

async function handlePull(request: Request) {
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

    // Buat pesan yang informatif
    const msgParts: string[] = []
    if (result.newCount > 0) msgParts.push(`${result.newCount} data baru masuk antrian`)
    if (result.skippedPayment > 0) msgParts.push(`${result.skippedPayment} dilewati (bukan Cash/QRIS)`)
    if (result.skippedCount > 0) msgParts.push(`${result.skippedCount} sudah ada`)

    const message =
      result.status === 'failed'
        ? `Sinkronisasi gagal. ${result.errors[0] ?? ''}`
        : msgParts.length > 0
          ? `Selesai: ${msgParts.join(', ')}.`
          : 'Selesai. Tidak ada data baru.'

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
        skippedPayment: result.skippedPayment,
        errors: result.errors.slice(0, 10),
      },
      message,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return NextResponse.json(
      { success: false, message: msg, code: 'sync_error' },
      { status: 500 }
    )
  }
}
