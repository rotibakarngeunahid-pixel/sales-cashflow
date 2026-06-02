import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/cashflow/beban-transfer — daftar riwayat transfer
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)

  const { data, error } = await supabase
    .from('beban_transfers')
    .select(`
      *,
      from_branch:from_branch_id ( id, name ),
      to_branch:to_branch_id ( id, name ),
      actor:created_by ( full_name, email )
    `)
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// POST /api/cashflow/beban-transfer — buat transfer baru
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { transfer_date, from_branch_id, to_branch_id, amount, description, category_id } = body

  if (!transfer_date || !from_branch_id || !to_branch_id || !amount) {
    return NextResponse.json({ error: 'Tanggal, cabang pengirim, cabang penerima, dan nominal wajib diisi.' }, { status: 400 })
  }
  if (from_branch_id === to_branch_id) {
    return NextResponse.json({ error: 'Cabang pengirim dan penerima tidak boleh sama.' }, { status: 400 })
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'Nominal harus lebih dari 0.' }, { status: 400 })
  }

  // Ambil nama cabang untuk deskripsi otomatis
  const { data: branches, error: branchErr } = await supabase
    .from('branches')
    .select('id, name')
    .in('id', [from_branch_id, to_branch_id])

  if (branchErr || !branches || branches.length < 2) {
    return NextResponse.json({ error: 'Cabang tidak ditemukan.' }, { status: 400 })
  }

  const fromBranch = branches.find((b) => b.id === from_branch_id)!
  const toBranch = branches.find((b) => b.id === to_branch_id)!
  const referenceGroupId = crypto.randomUUID()
  const userId = session.user.id
  const desc = description?.trim() || null

  // Deskripsi transaksi cashflow
  const fromDesc = `Transfer beban ke ${toBranch.name}${desc ? `: ${desc}` : ''}`
  const toDesc = `Transfer beban dari ${fromBranch.name}${desc ? `: ${desc}` : ''}`

  // 1. Catat di beban_transfers
  const { error: logErr } = await supabase
    .from('beban_transfers')
    .insert({
      transfer_date,
      from_branch_id,
      to_branch_id,
      amount,
      description: desc,
      reference_group_id: referenceGroupId,
      created_by: userId,
    })

  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 })

  // 2. Cabang pengirim: cash_in (beban berkurang — koreksi kredit)
  const { error: fromErr } = await supabase
    .from('cashflow_transactions')
    .insert({
      transaction_date: transfer_date,
      branch_id: from_branch_id,
      transaction_type: 'cash_in',
      amount,
      cash_in: amount,
      cash_out: 0,
      description: fromDesc,
      category_id: category_id ?? null,
      source: 'beban_transfer',
      reference_group_id: referenceGroupId,
      source_metadata: { beban_transfer_id: referenceGroupId, role: 'sender' },
      created_by: userId,
    })

  if (fromErr) {
    // Rollback beban_transfers record
    await supabase.from('beban_transfers').delete().eq('reference_group_id', referenceGroupId)
    return NextResponse.json({ error: fromErr.message }, { status: 500 })
  }

  // 3. Cabang penerima: cash_out (beban bertambah)
  const { error: toErr } = await supabase
    .from('cashflow_transactions')
    .insert({
      transaction_date: transfer_date,
      branch_id: to_branch_id,
      transaction_type: 'cash_out',
      amount,
      cash_in: 0,
      cash_out: amount,
      description: toDesc,
      category_id: category_id ?? null,
      source: 'beban_transfer',
      reference_group_id: referenceGroupId,
      source_metadata: { beban_transfer_id: referenceGroupId, role: 'receiver' },
      created_by: userId,
    })

  if (toErr) {
    // Rollback semua
    await supabase.from('cashflow_transactions').delete().eq('reference_group_id', referenceGroupId)
    await supabase.from('beban_transfers').delete().eq('reference_group_id', referenceGroupId)
    return NextResponse.json({ error: toErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, reference_group_id: referenceGroupId })
}

// DELETE /api/cashflow/beban-transfer?id=<beban_transfer_id> — hapus (owner only)
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cek role owner
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Hanya owner yang bisa menghapus transfer.' }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID tidak ditemukan.' }, { status: 400 })

  // Ambil reference_group_id
  const { data: transfer, error: fetchErr } = await supabase
    .from('beban_transfers')
    .select('reference_group_id')
    .eq('id', id)
    .single()

  if (fetchErr || !transfer) {
    return NextResponse.json({ error: 'Transfer tidak ditemukan.' }, { status: 404 })
  }

  const refId = transfer.reference_group_id

  // Hapus cashflow_transactions yang terkait
  const { error: txErr } = await supabase
    .from('cashflow_transactions')
    .delete()
    .eq('reference_group_id', refId)
    .eq('source', 'beban_transfer')

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  // Hapus beban_transfers record
  const { error: delErr } = await supabase
    .from('beban_transfers')
    .delete()
    .eq('id', id)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
