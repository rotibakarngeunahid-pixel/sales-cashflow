import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getOnlineSalesReportWithDeductions,
  setOnlineSalesReportStatus,
  OnlineSalesError,
} from '@/lib/online-sales/server'

export const dynamic = 'force-dynamic'

// =============================================
// GET — detail laporan + rincian potongan (untuk form edit)
// =============================================
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  try {
    const report = await getOnlineSalesReportWithDeductions(supabase, params.id)
    return NextResponse.json({ success: true, report })
  } catch (err) {
    return jsonError(err, 'Gagal memuat detail laporan.')
  }
}

// =============================================
// PATCH — transisi status (posted / void)
// Body: { status: 'posted' | 'void' }
// =============================================
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  if (body.status !== 'posted' && body.status !== 'void') {
    return NextResponse.json({ success: false, message: 'Status tidak valid.' }, { status: 400 })
  }

  try {
    await setOnlineSalesReportStatus(supabase, params.id, body.status, user.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return jsonError(err, 'Gagal mengubah status laporan.')
  }
}

function jsonError(err: unknown, fallback: string) {
  if (err instanceof OnlineSalesError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status })
  }
  return NextResponse.json({ success: false, message: fallback }, { status: 500 })
}
