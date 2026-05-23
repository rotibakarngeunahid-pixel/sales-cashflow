import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Simpan mapping nama cabang kasir → cabang lokal
// Sekaligus update semua item pending dengan cabang yang sama
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!['owner', 'admin'].includes(profile?.role ?? '')) {
    return NextResponse.json(
      { success: false, message: 'Tidak punya akses untuk mengatur mapping.' },
      { status: 403 }
    )
  }

  let kasir_name: string
  let branch_id: string
  try {
    const body = await request.json()
    kasir_name = body.kasir_name?.trim()
    branch_id = body.branch_id?.trim()
  } catch {
    return NextResponse.json(
      { success: false, message: 'Request body tidak valid.' },
      { status: 400 }
    )
  }

  if (!kasir_name || !branch_id) {
    return NextResponse.json(
      { success: false, message: 'kasir_name dan branch_id wajib diisi.' },
      { status: 400 }
    )
  }

  // Simpan atau update mapping
  const { error: mapErr } = await supabase
    .from('kasir_branch_mappings')
    .upsert(
      { kasir_name, branch_id, created_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'kasir_name' }
    )

  if (mapErr) {
    return NextResponse.json(
      { success: false, message: `Gagal simpan mapping: ${mapErr.message}` },
      { status: 500 }
    )
  }

  // Update semua item pending dengan nama cabang yang sama
  const { data: updated, error: updateErr } = await supabase
    .from('kasir_sync_queue')
    .update({ branch_id })
    .eq('cabang', kasir_name)
    .eq('status', 'pending')
    .select('id')

  if (updateErr) {
    // Mapping sudah tersimpan, tapi update item gagal — informasikan tapi jangan error
    return NextResponse.json({
      success: true,
      updated: 0,
      message: `Mapping disimpan. Gagal update item antrian: ${updateErr.message}`,
    })
  }

  const count = updated?.length ?? 0
  return NextResponse.json({
    success: true,
    updated: count,
    message: count > 0
      ? `Mapping disimpan. ${count} item antrian diperbarui.`
      : 'Mapping disimpan.',
  })
}
