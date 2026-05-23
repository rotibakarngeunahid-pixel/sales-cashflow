import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { confirmQueueItems } from '@/lib/kasir-sync/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Konfirmasi item dari antrian
// Body: { ids: string[] }
// =============================================

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  let ids: string[]
  try {
    const body = await request.json()
    ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : []
  } catch {
    return NextResponse.json(
      { success: false, message: 'Request body tidak valid.' },
      { status: 400 }
    )
  }

  if (ids.length === 0) {
    return NextResponse.json(
      { success: false, message: 'Tidak ada ID yang dikirimkan.' },
      { status: 400 }
    )
  }

  if (ids.length > 100) {
    return NextResponse.json(
      { success: false, message: 'Maksimal 100 item per konfirmasi.' },
      { status: 400 }
    )
  }

  try {
    const result = await confirmQueueItems(supabase, ids, user.id)

    return NextResponse.json({
      success: result.failed === 0,
      confirmed: result.confirmed,
      failed: result.failed,
      errors: result.errors,
      message:
        result.failed === 0
          ? `${result.confirmed} transaksi berhasil dikonfirmasi.`
          : `${result.confirmed} berhasil, ${result.failed} gagal.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    )
  }
}
