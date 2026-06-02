import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST — Simpan atau update mapping nama cabang kasir → cabang lokal
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let kasir_name: string
  let branch_id: string
  try {
    const body = await request.json()
    kasir_name = String(body.kasir_name ?? '').trim()
    branch_id  = String(body.branch_id  ?? '').trim()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  if (!kasir_name) {
    return NextResponse.json({ success: false, message: 'Nama cabang dari sistem kasir wajib diisi.' }, { status: 400 })
  }
  if (!branch_id) {
    return NextResponse.json({ success: false, message: 'Pilih cabang di laporan keuangan terlebih dahulu.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('kasir_branch_mappings')
    .upsert(
      { kasir_name, branch_id, created_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'kasir_name' }
    )

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan mapping: ${error.message}` },
      { status: 500 }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'kasir_branch_mappings',
    record_id: null,
    action: 'kasir_branch_mapping_saved',
    old_data: null,
    new_data: { kasir_name, branch_id } as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, message: `Mapping "${kasir_name}" berhasil disimpan.` })
}

// DELETE — Hapus mapping berdasarkan kasir_name
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const kasir_name = new URL(request.url).searchParams.get('kasir_name')?.trim()
  if (!kasir_name) {
    return NextResponse.json({ success: false, message: 'kasir_name wajib diisi.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('kasir_branch_mappings')
    .delete()
    .eq('kasir_name', kasir_name)

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menghapus mapping: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, message: `Mapping "${kasir_name}" berhasil dihapus.` })
}
