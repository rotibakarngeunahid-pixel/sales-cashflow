import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CashflowTransaction } from '@/types/database'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  const id = params.id
  if (!id) {
    return NextResponse.json(
      { success: false, message: 'ID transaksi tidak ditemukan.' },
      { status: 400 }
    )
  }

  let reason: string | null = null
  try {
    const body = await request.json().catch(() => ({}))
    reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  } catch {
    reason = null
  }

  const { data: existing, error: existingError } = await supabase
    .from('cashflow_transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json(
      { success: false, message: existingError.message },
      { status: 500 }
    )
  }

  if (!existing) {
    return NextResponse.json(
      { success: false, message: 'Transaksi tidak ditemukan.' },
      { status: 404 }
    )
  }

  const tx = existing as CashflowTransaction

  if (tx.auto_split_group_id || tx.source === 'auto_split_kurir') {
    return NextResponse.json(
      {
        success: false,
        message: 'Transaksi ini adalah hasil auto split. Void transaksi induk untuk membatalkan semua pembagian.',
        auto_split_group_id: tx.auto_split_group_id,
      },
      { status: 400 }
    )
  }

  if (tx.status !== 'active') {
    return NextResponse.json(
      { success: false, message: 'Hanya transaksi aktif yang dapat divoid.' },
      { status: 400 }
    )
  }

  if (tx.source === 'sales' || tx.source === 'purchase_order') {
    return NextResponse.json(
      { success: false, message: 'Transaksi otomatis tidak dapat divoid dari halaman cashflow.' },
      { status: 400 }
    )
  }

  const { error: voidError } = await supabase
    .from('cashflow_transactions')
    .update({ status: 'void' as const, updated_by: user.id })
    .eq('id', id)

  if (voidError) {
    return NextResponse.json(
      { success: false, message: `Gagal void transaksi: ${voidError.message}` },
      { status: 500 }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'cashflow_transactions',
    record_id: id,
    action: 'cashflow_voided',
    old_data: tx as unknown as Record<string, unknown>,
    new_data: { status: 'void', reason },
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({
    success: true,
    message: 'Transaksi berhasil divoid.',
  })
}
