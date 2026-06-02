import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  previewCombined,
  validateDateRange,
  KasirImportError,
} from '@/lib/kasir-import/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Preview gabungan: penjualan + kas keluar (TANPA menyimpan ke DB)
// Body: { start_date, end_date, branch_id? }
// =============================================
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: {
    start_date: string
    end_date:   string
    branch_id?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  try {
    validateDateRange(body.start_date, body.end_date)
  } catch (err) {
    return jsonError(err, 'Tanggal tidak valid.')
  }

  try {
    const result = await previewCombined(supabase, {
      startDate: body.start_date,
      endDate:   body.end_date,
      branchId:  body.branch_id,
    })
    return NextResponse.json({ success: true, result })
  } catch (err) {
    return jsonError(err, 'Gagal mengambil data preview dari sistem kasir.')
  }
}

function jsonError(err: unknown, fallback: string) {
  if (err instanceof KasirImportError) {
    return NextResponse.json(
      { success: false, message: err.message, code: err.code },
      { status: err.status }
    )
  }
  return NextResponse.json(
    { success: false, message: fallback, code: 'unknown_error' },
    { status: 500 }
  )
}
