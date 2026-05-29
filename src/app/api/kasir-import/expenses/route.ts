import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GONE_MESSAGE = 'Endpoint ini sudah digantikan. Gunakan POST /api/kasir-import/combined untuk import penjualan dan kas keluar sekaligus.'

export async function GET()  { return gone() }
export async function POST() { return gone() }

function gone() {
  return NextResponse.json(
    { success: false, message: GONE_MESSAGE, code: 'endpoint_replaced' },
    { status: 410 }
  )
}
