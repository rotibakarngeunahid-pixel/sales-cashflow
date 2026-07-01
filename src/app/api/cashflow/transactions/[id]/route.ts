import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isKurirBawaBahanCategory } from '@/lib/cashflow/auto-split-kurir'
import type { CashflowTransaction, CashflowType } from '@/types/database'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type CategoryRow = {
  id: string
  name: string
  default_type: 'cash_in' | 'cash_out' | 'both'
}

function getSafeErrorStatus(message?: string) {
  if (!message) return 500
  const lower = message.toLowerCase()
  if (
    lower.includes('tidak valid') ||
    lower.includes('wajib') ||
    lower.includes('tidak ditemukan') ||
    lower.includes('minimal') ||
    lower.includes('tidak ada outlet') ||
    lower.includes('kategori') ||
    lower.includes('tidak dapat') ||
    lower.includes('tidak bisa')
  ) {
    return 400
  }
  if (lower.includes('duplicate') || lower.includes('unique')) return 409
  return 500
}

function coerceAmount(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return NaN
}

function validateCategoryType(category: CategoryRow, transactionType: CashflowType) {
  return category.default_type === 'both' || category.default_type === transactionType
}

export async function PATCH(
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

  const { data: existing, error: existingError } = await supabase
    .from('cashflow_transactions')
    .select('*, category:cashflow_categories(id,name)')
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

  const existingTx = existing as CashflowTransaction

  if (existingTx.auto_split_group_id || existingTx.source === 'auto_split_kurir') {
    return NextResponse.json(
      { success: false, message: 'Transaksi ini adalah hasil auto split. Edit transaksi induk untuk mengubah pembagian.' },
      { status: 400 }
    )
  }

  if (existingTx.status !== 'active') {
    return NextResponse.json(
      { success: false, message: 'Hanya transaksi aktif yang dapat diedit.' },
      { status: 400 }
    )
  }

  if (existingTx.source === 'sales' || existingTx.source === 'purchase_order') {
    return NextResponse.json(
      { success: false, message: 'Transaksi otomatis tidak dapat diedit dari halaman cashflow.' },
      { status: 400 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, message: 'Request body tidak valid.' },
      { status: 400 }
    )
  }

  const transactionDate = typeof body.transaction_date === 'string' ? body.transaction_date : ''
  const branchId = typeof body.branch_id === 'string' ? body.branch_id : ''
  const transactionType = body.transaction_type === 'cash_in' || body.transaction_type === 'cash_out'
    ? body.transaction_type
    : ''
  const categoryId = typeof body.category_id === 'string' ? body.category_id : ''
  const description = typeof body.description === 'string' ? body.description : ''
  const amount = coerceAmount(body.amount)
  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? body.idempotency_key.trim()
    : crypto.randomUUID()

  if (!DATE_RE.test(transactionDate)) {
    return NextResponse.json(
      { success: false, message: 'Format tanggal harus YYYY-MM-DD.' },
      { status: 400 }
    )
  }

  if (!branchId || !transactionType || !categoryId) {
    return NextResponse.json(
      { success: false, message: 'Tanggal, cabang, tipe, dan kategori wajib diisi.' },
      { status: 400 }
    )
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { success: false, message: 'Nominal harus lebih dari 0.' },
      { status: 400 }
    )
  }

  const { data: category, error: categoryError } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('id', categoryId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (categoryError) {
    return NextResponse.json(
      { success: false, message: `Gagal memvalidasi kategori: ${categoryError.message}` },
      { status: 500 }
    )
  }

  if (!category) {
    return NextResponse.json(
      { success: false, message: 'Kategori tidak ditemukan atau tidak aktif.' },
      { status: 400 }
    )
  }

  const categoryRow = category as CategoryRow

  if (!validateCategoryType(categoryRow, transactionType as CashflowType)) {
    return NextResponse.json(
      { success: false, message: 'Kategori tidak sesuai dengan tipe transaksi.' },
      { status: 400 }
    )
  }

  if (isKurirBawaBahanCategory(categoryRow.name)) {
    if (transactionType !== 'cash_out') {
      return NextResponse.json(
        { success: false, message: 'Kategori Kurir bawa Bahan hanya bisa dipakai untuk Cash Out.' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(amount)) {
      return NextResponse.json(
        { success: false, message: 'Nominal Kurir bawa Bahan harus berupa Rupiah tanpa desimal.' },
        { status: 400 }
      )
    }

    const { data: groupData, error: groupError } = await supabase.rpc('create_auto_split_kurir_bawa_bahan', {
      p_transaction_date: transactionDate,
      p_original_branch_id: branchId,
      p_category_id: categoryId,
      p_description: description.trim(),
      p_total_amount: amount,
      p_entry_source: 'manual_cashflow',
      p_source_ref: `converted:${id}`,
      p_idempotency_key: idempotencyKey,
      p_source_metadata: {
        created_from: 'cashflow_manual_edit',
        converted_from_transaction_id: id,
      },
      p_child_import_key_prefix: null,
    })

    if (groupError) {
      return NextResponse.json(
        { success: false, message: groupError.message },
        { status: getSafeErrorStatus(groupError.message) }
      )
    }

    const { error: voidOldError } = await supabase
      .from('cashflow_transactions')
      .update({ status: 'void' as const, updated_by: user.id })
      .eq('id', id)

    if (voidOldError) {
      const groupId = typeof groupData === 'object' && groupData !== null && !Array.isArray(groupData)
        ? String((groupData as Record<string, unknown>).group_id || '')
        : ''

      if (groupId) {
        await supabase.rpc('void_auto_split_kurir_bawa_bahan', {
          p_group_id: groupId,
          p_reason: 'Rollback konversi karena transaksi lama gagal divoid.',
        })
      }

      return NextResponse.json(
        { success: false, message: `Gagal void transaksi lama: ${voidOldError.message}` },
        { status: 500 }
      )
    }

    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: id,
      action: 'cashflow_voided',
      old_data: existingTx as unknown as Record<string, unknown>,
      new_data: {
        status: 'void',
        reason: 'converted_to_auto_split_kurir_bawa_bahan',
        auto_split_group: groupData,
      },
      changed_by: user.id,
      changed_at: new Date().toISOString(),
    })

    return NextResponse.json(groupData)
  }

  const isCashIn = transactionType === 'cash_in'
  const payload = {
    transaction_date: transactionDate,
    branch_id: branchId,
    transaction_type: transactionType as CashflowType,
    category_id: categoryId,
    description: description.trim(),
    cash_in: isCashIn ? amount : 0,
    cash_out: isCashIn ? 0 : amount,
    amount,
    updated_by: user.id,
  }

  const { error: updateError } = await supabase
    .from('cashflow_transactions')
    .update(payload)
    .eq('id', id)

  if (updateError) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan transaksi: ${updateError.message}` },
      { status: getSafeErrorStatus(updateError.message) }
    )
  }

  await supabase.from('audit_logs').insert({
    table_name: 'cashflow_transactions',
    record_id: id,
    action: 'cashflow_updated',
    old_data: existingTx as unknown as Record<string, unknown>,
    new_data: payload as unknown as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({
    success: true,
    mode: 'normal',
    transaction_id: id,
    message: 'Transaksi berhasil diperbarui.',
  })
}
