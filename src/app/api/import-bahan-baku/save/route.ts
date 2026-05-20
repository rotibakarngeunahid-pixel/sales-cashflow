import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ImportBahanBakuError,
  saveImportBahanBaku,
  validateImportDateRange,
  writeImportLog,
} from '@/lib/import-bahan-baku/server'
import type { ImportBahanBakuDecision } from '@/lib/import-bahan-baku/shared'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, message: 'Data request import tidak valid.', code: 'invalid_request' },
      { status: 400 }
    )
  }

  const record = isRecord(body) ? body : {}
  let params: { startDate: string; endDate: string; branchId?: string }

  try {
    const { startDate, endDate } = validateImportDateRange(
      typeof record.tanggal_mulai === 'string' ? record.tanggal_mulai : null,
      typeof record.tanggal_akhir === 'string' ? record.tanggal_akhir : null
    )

    params = {
      startDate,
      endDate,
      branchId: typeof record.branch_id === 'string' ? record.branch_id : undefined,
    }
  } catch (error) {
    return jsonError(error, 'Tanggal import belum valid.')
  }

  const decisions = isRecord(record.decisions)
    ? Object.fromEntries(
      Object.entries(record.decisions).filter(([, value]) => value === 'ignore' || value === 'update')
    ) as Record<string, ImportBahanBakuDecision>
    : {}

  try {
    const result = await saveImportBahanBaku(supabase, params, user.id, decisions)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    const response = toErrorResponse(error, 'Gagal menyimpan data ke laporan keuangan.')

    await writeImportLog(supabase, params, user.id, {
      status: 'failed',
      branchCount: 0,
      totalAmount: 0,
      message: response.message,
    }).catch(() => undefined)

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
