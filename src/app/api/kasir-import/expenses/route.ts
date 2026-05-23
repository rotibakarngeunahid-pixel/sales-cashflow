import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getExpensesPreview,
  importExpenses,
  validateDateRange,
  KasirImportError,
} from '@/lib/kasir-import/server'
import type { KasirExpenseMappingConfig } from '@/lib/kasir-import/shared'

export const dynamic = 'force-dynamic'

// =============================================
// GET — Preview kas keluar sebelum import
// =============================================
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const sp = new URL(request.url).searchParams
  const startDate = sp.get('start_date') || ''
  const endDate = sp.get('end_date') || ''
  const branchId = sp.get('branch_id') || undefined

  try {
    validateDateRange(startDate, endDate)
  } catch (err) {
    return jsonError(err, 'Tanggal tidak valid.')
  }

  try {
    const payload = await getExpensesPreview(supabase, { startDate, endDate, branchId })
    return NextResponse.json({ success: true, ...payload })
  } catch (err) {
    return jsonError(err, 'Gagal menarik data kas keluar dari sistem kasir.')
  }
}

// =============================================
// POST — Import kas keluar
// =============================================
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: {
    start_date: string
    end_date: string
    branch_id?: string
    mappings?: Record<string, KasirExpenseMappingConfig>
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
    const result = await importExpenses(supabase, {
      startDate: body.start_date,
      endDate: body.end_date,
      branchId: body.branch_id,
      mappings: body.mappings,
      userId: user.id,
    })
    return NextResponse.json({ success: result.success, result })
  } catch (err) {
    return jsonError(err, 'Gagal mengimport data kas keluar.')
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
