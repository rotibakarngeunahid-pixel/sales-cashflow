import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  importCombined,
  validateDateRange,
  KasirImportError,
} from '@/lib/kasir-import/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Import gabungan: penjualan + kas keluar sekaligus
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
    excluded_expense_keys?: string[]
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
    const result = await importCombined(supabase, {
      startDate:            body.start_date,
      endDate:              body.end_date,
      branchId:             body.branch_id,
      userId:               user.id,
      excludedExpenseKeys:  body.excluded_expense_keys,
    })
    return NextResponse.json({ success: result.success, result })
  } catch (err) {
    return jsonError(err, 'Gagal menjalankan import dari sistem kasir.')
  }
}

// =============================================
// Helpers
// =============================================
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
