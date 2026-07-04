import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST — Simpan atau update mapping nama cabang Inventori → cabang lokal
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let inventori_name: string
  let branch_id: string
  try {
    const body = await request.json()
    inventori_name = String(body.inventori_name ?? '').trim()
    branch_id = String(body.branch_id ?? '').trim()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  if (!inventori_name) {
    return NextResponse.json({ success: false, message: 'Nama cabang dari sistem inventori wajib diisi.' }, { status: 400 })
  }
  if (!branch_id) {
    return NextResponse.json({ success: false, message: 'Pilih cabang di laporan keuangan terlebih dahulu.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('inventori_branch_mappings')
    .upsert(
      { inventori_name, branch_id, created_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'inventori_name' }
    )

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan mapping: ${error.message}` },
      { status: 500 }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'inventori_branch_mappings',
    record_id: null,
    action: 'inventori_branch_mapping_saved',
    old_data: null,
    new_data: { inventori_name, branch_id } as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, message: `Mapping "${inventori_name}" berhasil disimpan.` })
}

// DELETE — Hapus mapping berdasarkan inventori_name
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const inventori_name = new URL(request.url).searchParams.get('inventori_name')?.trim()
  if (!inventori_name) {
    return NextResponse.json({ success: false, message: 'inventori_name wajib diisi.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('inventori_branch_mappings')
    .delete()
    .eq('inventori_name', inventori_name)

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menghapus mapping: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, message: `Mapping "${inventori_name}" berhasil dihapus.` })
}
