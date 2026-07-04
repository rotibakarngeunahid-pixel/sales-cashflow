import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  loadPendingOnlineSalesGroups,
  assignBranchToUnmatchedDetections,
  OnlineSalesError,
} from '@/lib/online-sales/server'

export const dynamic = 'force-dynamic'

// =============================================
// GET — grup transaksi online yang terdeteksi tapi belum dilengkapi
// Query: ?start_date=&end_date=
// =============================================
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('start_date') || undefined
  const endDate   = searchParams.get('end_date') || undefined

  try {
    const groups = await loadPendingOnlineSalesGroups(supabase, { startDate, endDate })
    return NextResponse.json({ success: true, groups })
  } catch (err) {
    if (err instanceof OnlineSalesError) {
      return NextResponse.json({ success: false, message: err.message }, { status: err.status })
    }
    return NextResponse.json({ success: false, message: 'Gagal memuat transaksi online.' }, { status: 500 })
  }
}

// =============================================
// PATCH — set cabang untuk transaksi yang belum cocok (branch_name_raw -> branch_id)
// Body: { branch_name_raw, branch_id }
// =============================================
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: { branch_name_raw?: string; branch_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  const branchNameRaw = (body.branch_name_raw || '').trim()
  const branchId = (body.branch_id || '').trim()
  if (!branchNameRaw || !branchId) {
    return NextResponse.json({ success: false, message: 'Nama cabang dan cabang tujuan wajib diisi.' }, { status: 400 })
  }

  try {
    const updated = await assignBranchToUnmatchedDetections(supabase, branchNameRaw, branchId)
    return NextResponse.json({ success: true, updated })
  } catch (err) {
    if (err instanceof OnlineSalesError) {
      return NextResponse.json({ success: false, message: err.message }, { status: err.status })
    }
    return NextResponse.json({ success: false, message: 'Gagal mengubah cabang.' }, { status: 500 })
  }
}
