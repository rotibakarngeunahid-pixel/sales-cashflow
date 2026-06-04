import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Simpan pengeluaran bersama (split ke beberapa cabang)
// Membuat satu cashflow_transaction per cabang,
// semua dikelompokkan dengan reference_group_id yang sama.
// =============================================

interface Allocation {
  branch_id: string
  amount: number
}

function normalizeCategoryName(name?: string | null) {
  return (name || '').trim().toLowerCase()
}

function isCourierCategoryName(name?: string | null) {
  const normalized = normalizeCategoryName(name)
  return normalized === 'kurir' || normalized === 'beban kurir' || normalized.includes('kurir')
}

function isCourierExpenseCategory(category: { name: string; default_type: string }) {
  return (category.default_type === 'cash_out' || category.default_type === 'both')
    && isCourierCategoryName(category.name)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  let date: string
  let description: string
  let category_id: string | null
  let allocations: Allocation[]

  try {
    const body = await request.json()
    date = body.date
    description = body.description?.trim()
    category_id = body.category_id || null
    allocations = body.allocations ?? []
  } catch {
    return NextResponse.json(
      { success: false, message: 'Request body tidak valid.' },
      { status: 400 }
    )
  }

  // Validasi
  if (!date || !description) {
    return NextResponse.json(
      { success: false, message: 'Tanggal dan deskripsi wajib diisi.' },
      { status: 400 }
    )
  }
  if (!Array.isArray(allocations) || allocations.length < 1) {
    return NextResponse.json(
      { success: false, message: 'Pilih minimal 1 cabang.' },
      { status: 400 }
    )
  }
  if (allocations.some((a) => !a.branch_id || a.amount <= 0)) {
    return NextResponse.json(
      { success: false, message: 'Setiap cabang harus memiliki nominal > 0.' },
      { status: 400 }
    )
  }
  if (!category_id) {
    return NextResponse.json(
      { success: false, message: 'Kategori Beban Kurir wajib dipilih.' },
      { status: 400 }
    )
  }

  const { data: category, error: categoryError } = await supabase
    .from('cashflow_categories')
    .select('id,name,default_type')
    .eq('id', category_id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (categoryError) {
    return NextResponse.json(
      { success: false, message: `Gagal memvalidasi kategori: ${categoryError.message}` },
      { status: 500 }
    )
  }

  if (!category || !isCourierExpenseCategory(category)) {
    return NextResponse.json(
      { success: false, message: 'Hanya Beban Kurir yang bisa dibagi ke cabang.' },
      { status: 400 }
    )
  }

  // Buat reference_group_id untuk mengelompokkan semua split ini
  const groupId = crypto.randomUUID()
  const totalAmount = allocations.reduce((sum, a) => sum + a.amount, 0)

  // Buat satu transaksi per cabang
  const rows = allocations.map((a) => ({
    transaction_date: date,
    branch_id: a.branch_id,
    transaction_type: 'cash_out' as const,
    category_id,
    description: allocations.length > 1
      ? `${description} (split ${allocations.length} cabang)`
      : description,
    cash_in: 0,
    cash_out: a.amount,
    amount: a.amount,
    source: 'manual' as const,
    reference_group_id: groupId,
    status: 'active' as const,
    created_by: user.id,
    updated_by: user.id,
  }))

  const { data: inserted, error } = await supabase
    .from('cashflow_transactions')
    .insert(rows)
    .select('id')

  if (error) {
    return NextResponse.json(
      { success: false, message: `Gagal menyimpan: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    count: inserted?.length ?? 0,
    total: totalAmount,
    reference_group_id: groupId,
    message: `${inserted?.length ?? 0} transaksi berhasil dibuat dari ${allocations.length} cabang.`,
  })
}
