import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  FoodWasteImportError,
  defaultAutoSyncRange,
  saveFoodWasteImport,
  validateFoodWasteDateRange,
  writeFoodWasteImportLog,
} from '@/lib/food-waste-import/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 menit (Vercel Pro)

// =============================================
// POST / GET — Sync otomatis food waste dari Sistem Inventori
//
// Bisa dipanggil oleh:
//   1. Vercel Cron Job — HTTP GET + Authorization: Bearer {CRON_SECRET}
//      (Vercel Cron selalu memanggil dengan method GET)
//   2. User manual (owner) — POST + session cookie
//
// Default periode: kemarin s.d. hari ini (WITA). Data baru langsung
// disimpan ke cashflow; nominal yang berubah (mis. harga satuan baru
// diisi admin inventori) otomatis di-update karena nilainya deterministik
// (jumlah terbuang x harga master inventori).
// =============================================

export async function POST(request: Request) {
  return handlePull(request)
}

export async function GET(request: Request) {
  return handlePull(request)
}

async function handlePull(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET

  let triggeredBy = 'manual'
  let userId: string | null = null
  let supabase

  // Cek apakah request dari Vercel Cron
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    triggeredBy = 'scheduler'
    supabase = createServiceClient()
  } else {
    // Validasi user session
    supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Sesi login tidak valid.' },
        { status: 401 }
      )
    }

    // Hanya owner yang bisa trigger sync manual
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'owner') {
      return NextResponse.json(
        { success: false, message: 'Hanya owner yang bisa melakukan sinkronisasi.' },
        { status: 403 }
      )
    }

    userId = user.id
  }

  // Parse body opsional (manual trigger dengan date range)
  let startDate: string
  let endDate: string
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body.date_from === 'string' && typeof body.date_to === 'string') {
      const validated = validateFoodWasteDateRange(body.date_from, body.date_to)
      startDate = validated.startDate
      endDate = validated.endDate
    } else {
      const range = defaultAutoSyncRange()
      startDate = range.startDate
      endDate = range.endDate
    }
  } catch (error) {
    if (error instanceof FoodWasteImportError) {
      return NextResponse.json({ success: false, message: error.message, code: error.code }, { status: error.status })
    }
    const range = defaultAutoSyncRange()
    startDate = range.startDate
    endDate = range.endDate
  }

  const params = { startDate, endDate }

  try {
    const result = await saveFoodWasteImport(supabase, params, userId, {
      autoUpdateChanged: true,
      triggeredBy,
    })

    return NextResponse.json({
      success: true,
      result: { ...result, periodFrom: startDate, periodTo: endDate },
      message: result.message,
    })
  } catch (error) {
    // Tidak ada bahan terbuang pada periode ini — bukan kegagalan.
    if (error instanceof FoodWasteImportError && error.code === 'empty_data') {
      return NextResponse.json({
        success: true,
        result: { created: 0, updated: 0, skipped: 0, branchMissing: 0, missingPriceCount: 0, totalAmount: 0, periodFrom: startDate, periodTo: endDate },
        message: 'Tidak ada bahan terbuang pada periode ini.',
      })
    }

    const message = error instanceof FoodWasteImportError
      ? error.message
      : 'Gagal sinkronisasi food waste.'
    const status = error instanceof FoodWasteImportError ? error.status : 500
    const code = error instanceof FoodWasteImportError ? error.code : 'sync_error'

    await writeFoodWasteImportLog(supabase, params, userId, {
      status: 'failed',
      branchCount: 0,
      totalAmount: 0,
      itemCount: 0,
      missingPriceCount: 0,
      message,
      triggeredBy,
    }).catch(() => undefined)

    return NextResponse.json({ success: false, message, code }, { status })
  }
}
