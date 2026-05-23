import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rejectQueueItems } from '@/lib/kasir-sync/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Tolak item dari antrian
// Body: { ids: string[], reason?: string }
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
  let reason: string | undefined
  try {
    const body = await request.json()
    ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : []
    reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined
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

  try {
    const result = await rejectQueueItems(supabase, ids, user.id, reason)

    return NextResponse.json({
      success: result.errors.length === 0,
      rejected: result.rejected,
      errors: result.errors,
      message: `${result.rejected} item ditolak.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    )
  }
}
