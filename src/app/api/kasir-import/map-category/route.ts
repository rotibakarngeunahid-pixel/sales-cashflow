import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CategoryMappingMatchType } from '@/types/database'

export const dynamic = 'force-dynamic'

const VALID_MATCH_TYPES: CategoryMappingMatchType[] = ['exact', 'contains']

// POST — Simpan atau update pemetaan kategori/keterangan kas keluar kasir -> kategori cashflow lokal
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let kasir_category: string
  let local_category_id: string
  let match_type: CategoryMappingMatchType
  try {
    const body = await request.json()
    kasir_category    = String(body.kasir_category ?? '').trim()
    local_category_id = String(body.local_category_id ?? '').trim()
    match_type         = (body.match_type === 'contains' ? 'contains' : 'exact') as CategoryMappingMatchType
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  if (!kasir_category) {
    return NextResponse.json({ success: false, message: 'Teks kategori dari sistem kasir wajib diisi.' }, { status: 400 })
  }
  if (!local_category_id) {
    return NextResponse.json({ success: false, message: 'Pilih kategori cashflow tujuan terlebih dahulu.' }, { status: 400 })
  }
  if (!VALID_MATCH_TYPES.includes(match_type)) {
    return NextResponse.json({ success: false, message: 'Tipe pencocokan tidak valid.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('kasir_category_mappings')
    .upsert(
      { kasir_category, match_type, local_category_id, created_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'kasir_category,match_type' }
    )

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan pemetaan kategori: ${error.message}` },
      { status: 500 }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'kasir_category_mappings',
    record_id: null,
    action: 'kasir_category_mapping_saved',
    old_data: null,
    new_data: { kasir_category, match_type, local_category_id } as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, message: `Pemetaan kategori "${kasir_category}" berhasil disimpan.` })
}

// DELETE — Hapus pemetaan berdasarkan id
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ success: false, message: 'id wajib diisi.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('kasir_category_mappings')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menghapus pemetaan: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, message: 'Pemetaan kategori berhasil dihapus.' })
}
