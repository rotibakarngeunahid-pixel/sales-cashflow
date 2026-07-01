import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isKurirBawaBahanCategory } from '@/lib/cashflow/auto-split-kurir'
import type { CashflowType } from '@/types/database'

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
    lower.includes('kategori')
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

function parseBody(body: Record<string, unknown>) {
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
    : null

  return {
    transactionDate,
    branchId,
    transactionType,
    categoryId,
    description,
    amount,
    idempotencyKey,
  }
}

function validateCategoryType(category: CategoryRow, transactionType: CashflowType) {
  return category.default_type === 'both' || category.default_type === transactionType
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  let parsed: ReturnType<typeof parseBody>

  try {
    const body = await request.json()
    parsed = parseBody(body as Record<string, unknown>)
  } catch {
    return NextResponse.json(
      { success: false, message: 'Request body tidak valid.' },
      { status: 400 }
    )
  }

  const {
    transactionDate,
    branchId,
    transactionType,
    categoryId,
    description,
    amount,
    idempotencyKey,
  } = parsed

  if (!DATE_RE.test(transactionDate)) {
    return NextResponse.json(
      { success: false, message: 'Format tanggal harus YYYY-MM-DD.' },
      { status: 400 }
    )
  }

  if (!branchId) {
    return NextResponse.json(
      { success: false, message: 'Cabang wajib dipilih.' },
      { status: 400 }
    )
  }

  if (!transactionType) {
    return NextResponse.json(
      { success: false, message: 'Tipe transaksi wajib dipilih.' },
      { status: 400 }
    )
  }

  if (!categoryId) {
    return NextResponse.json(
      { success: false, message: 'Kategori wajib dipilih.' },
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

  const isAutoSplitCategory = isKurirBawaBahanCategory(categoryRow.name)

  if (isAutoSplitCategory) {
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

    const { data, error } = await supabase.rpc('create_auto_split_kurir_bawa_bahan', {
      p_transaction_date: transactionDate,
      p_original_branch_id: branchId,
      p_category_id: categoryId,
      p_description: description.trim(),
      p_total_amount: amount,
      p_entry_source: 'manual_cashflow',
      p_source_ref: null,
      p_idempotency_key: idempotencyKey,
      p_source_metadata: {
        created_from: 'cashflow_manual_form',
      },
      p_child_import_key_prefix: null,
    })

    if (error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: getSafeErrorStatus(error.message) }
      )
    }

    return NextResponse.json(data)
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
    source: 'manual' as const,
    status: 'active' as const,
    created_by: user.id,
    updated_by: user.id,
  }

  const { data: newTx, error: insertError } = await supabase
    .from('cashflow_transactions')
    .insert(payload)
    .select()
    .single()

  if (insertError) {
    return NextResponse.json(
      { success: false, message: `Gagal menambah transaksi: ${insertError.message}` },
      { status: getSafeErrorStatus(insertError.message) }
    )
  }

  if (newTx) {
    await supabase.from('audit_logs').insert({
      table_name: 'cashflow_transactions',
      record_id: newTx.id,
      action: 'cashflow_created',
      old_data: null,
      new_data: newTx as unknown as Record<string, unknown>,
      changed_by: user.id,
      changed_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({
    success: true,
    mode: 'normal',
    transaction_id: newTx?.id,
    message: 'Transaksi cashflow berhasil ditambahkan.',
  })
}
