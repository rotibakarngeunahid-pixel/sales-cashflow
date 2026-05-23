import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// =============================================
// DELETE — Hapus semua item pending dari antrian
// Dipakai untuk bersihkan data lama sebelum filter dipasang
// Hanya owner yang bisa melakukan ini
//
// CATATAN: Autentikasi pakai createClient() (session user),
// tapi operasi delete pakai createServiceClient() (bypass RLS)
// karena migration tidak mendefinisikan policy DELETE.
// =============================================

export async function DELETE() {
  // 1. Validasi sesi — gunakan user client
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    return NextResponse.json(
      { success: false, message: 'Hanya owner yang bisa mereset antrian.' },
      { status: 403 }
    )
  }

  // 2. Eksekusi delete — gunakan service client (bypass RLS)
  const supabase = createServiceClient()

  // Hapus semua item pending dari queue
  const { count: deletedQueue, error: queueErr } = await supabase
    .from('kasir_sync_queue')
    .delete({ count: 'exact' })
    .eq('status', 'pending')

  if (queueErr) {
    return NextResponse.json(
      { success: false, message: `Gagal reset antrian: ${queueErr.message}` },
      { status: 500 }
    )
  }

  // Tandai batch yang stuck 'running' sebagai failed
  await supabase
    .from('kasir_sync_batches')
    .update({ status: 'failed', error_message: 'Direset manual oleh owner' })
    .eq('status', 'running')

  return NextResponse.json({
    success: true,
    deleted: deletedQueue ?? 0,
    message: `${deletedQueue ?? 0} item pending berhasil dihapus dari antrian.`,
  })
}
