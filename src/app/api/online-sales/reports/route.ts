import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  listOnlineSalesReports,
  saveOnlineSalesReport,
  OnlineSalesError,
  type SaveOnlineSalesReportParams,
} from '@/lib/online-sales/server'
import { onlineSalesReportSchema } from '@/lib/validations/online-sales'
import type { OnlinePlatform, OnlineSalesStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

// =============================================
// GET — daftar laporan penjualan online (histori & rekap)
// Query: ?branch_id=&platform=&status=&start_date=&end_date=
// =============================================
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  try {
    const reports = await listOnlineSalesReports(supabase, {
      branchId:  searchParams.get('branch_id') || undefined,
      platform:  (searchParams.get('platform') as OnlinePlatform) || undefined,
      status:    (searchParams.get('status') as OnlineSalesStatus) || undefined,
      startDate: searchParams.get('start_date') || undefined,
      endDate:   searchParams.get('end_date') || undefined,
    })
    return NextResponse.json({ success: true, reports })
  } catch (err) {
    return jsonError(err, 'Gagal memuat laporan penjualan online.')
  }
}

// =============================================
// POST — simpan/lengkapi rekonsiliasi (draft atau langsung posted)
// =============================================
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  const parsed = onlineSalesReportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.errors[0]?.message ?? 'Data tidak valid.' },
      { status: 400 }
    )
  }

  const data = parsed.data
  const statusInput = (body as { status?: string }).status
  const status: 'draft' | 'posted' = statusInput === 'posted' ? 'posted' : 'draft'

  const params: SaveOnlineSalesReportParams = {
    reportDate: data.report_date,
    branchId: data.branch_id,
    platform: data.platform,
    grossAmount: data.gross_amount,
    deductions: data.deductions.map((d) => ({
      deductionType: d.deduction_type,
      label: d.label,
      amount: d.amount,
    })),
    nettInputMode: data.nett_input_mode,
    manualNettAmount: data.manual_nett_amount,
    notes: data.notes,
    status,
    userId: user.id,
  }

  try {
    const result = await saveOnlineSalesReport(supabase, params)
    return NextResponse.json({ success: true, id: result.id })
  } catch (err) {
    return jsonError(err, 'Gagal menyimpan rekonsiliasi penjualan online.')
  }
}

function jsonError(err: unknown, fallback: string) {
  if (err instanceof OnlineSalesError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status })
  }
  return NextResponse.json({ success: false, message: fallback }, { status: 500 })
}
