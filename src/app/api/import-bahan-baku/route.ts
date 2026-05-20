import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getImportBahanBakuPreview,
  ImportBahanBakuError,
  validateImportDateRange,
  writeImportLog,
} from '@/lib/import-bahan-baku/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const searchParams = new URL(request.url).searchParams
  let params: { startDate: string; endDate: string; branchId?: string }

  try {
    const { startDate, endDate } = validateImportDateRange(
      searchParams.get('tanggal_mulai'),
      searchParams.get('tanggal_akhir')
    )
    params = {
      startDate,
      endDate,
      branchId: searchParams.get('branch_id') || undefined,
    }
  } catch (error) {
    return jsonError(error, 'Tanggal import belum valid.')
  }

  try {
    const payload = await getImportBahanBakuPreview(supabase, params)
    return NextResponse.json({ success: true, ...payload })
  } catch (error) {
    const response = toErrorResponse(error, 'Gagal menarik data pengeluaran bahan baku.')

    if (response.code !== 'empty_data') {
      await writeImportLog(supabase, params, user.id, {
        status: 'failed',
        branchCount: 0,
        totalAmount: 0,
        message: response.message,
      }).catch(() => undefined)
    }

    return NextResponse.json({ success: false, message: response.message, code: response.code }, { status: response.status })
  }
}

function jsonError(error: unknown, fallback: string) {
  const response = toErrorResponse(error, fallback)
  return NextResponse.json({ success: false, message: response.message, code: response.code }, { status: response.status })
}

function toErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ImportBahanBakuError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
    }
  }

  return {
    message: fallback,
    status: 500,
    code: 'unknown_error',
  }
}
