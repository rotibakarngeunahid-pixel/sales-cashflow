import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function getSafeErrorStatus(message?: string) {
  if (!message) return 500
  const lower = message.toLowerCase()
  if (
    lower.includes('tidak valid') ||
    lower.includes('tidak ditemukan') ||
    lower.includes('sesi login')
  ) {
    return 400
  }
  return 500
}

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  const groupId = params.groupId
  if (!groupId) {
    return NextResponse.json(
      { success: false, message: 'ID auto split tidak ditemukan.' },
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

  const { data, error } = await supabase.rpc('void_auto_split_kurir_bawa_bahan', {
    p_group_id: groupId,
    p_reason: reason,
  })

  if (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: getSafeErrorStatus(error.message) }
    )
  }

  return NextResponse.json(data)
}
