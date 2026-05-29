import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST — Simpan atau update mapping nama cabang PO → cabang lokal
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let po_name: string
  let branch_id: string
  try {
    const body = await request.json()
    po_name = String(body.po_name ?? '').trim()
    branch_id = String(body.branch_id ?? '').trim()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  if (!po_name) {
    return NextResponse.json({ success: false, message: 'Nama cabang dari sistem PO wajib diisi.' }, { status: 400 })
  }
  if (!branch_id) {
    return NextResponse.json({ success: false, message: 'Pilih cabang di laporan keuangan terlebih dahulu.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('po_branch_mappings')
    .upsert(
      { po_name, branch_id, created_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'po_name' }
    )

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan mapping: ${error.message}` },
      { status: 500 }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'po_branch_mappings',
    record_id: null,
    action: 'po_branch_mapping_saved',
    old_data: null,
    new_data: { po_name, branch_id } as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, message: `Mapping "${po_name}" berhasil disimpan.` })
}

// DELETE — Hapus mapping berdasarkan po_name
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const po_name = new URL(request.url).searchParams.get('po_name')?.trim()
  if (!po_name) {
    return NextResponse.json({ success: false, message: 'po_name wajib diisi.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('po_branch_mappings')
    .delete()
    .eq('po_name', po_name)

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menghapus mapping: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, message: `Mapping "${po_name}" berhasil dihapus.` })
}
