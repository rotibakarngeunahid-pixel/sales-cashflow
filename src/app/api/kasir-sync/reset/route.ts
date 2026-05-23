import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// =============================================
// DELETE — Hapus semua item pending dari antrian
// Dipakai untuk bersihkan data lama sebelum filter dipasang
// Hanya owner yang bisa melakukan ini
//
// Menggunakan RPC function `reset_kasir_sync_queue_pending()` dengan
// SECURITY DEFINER agar bypass RLS tanpa butuh service role key.
// Jalankan SQL berikut di Supabase SQL Editor sebelum pakai endpoint ini:
//
//   CREATE OR REPLACE FUNCTION reset_kasir_sync_queue_pending()
//   RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
//   DECLARE deleted_count integer; user_role text;
//   BEGIN
//     SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
//     IF user_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
//     DELETE FROM kasir_sync_queue WHERE status = 'pending';
//     GET DIAGNOSTICS deleted_count = ROW_COUNT;
//     UPDATE kasir_sync_batches SET status = 'failed', error_message = 'Direset manual oleh owner' WHERE status = 'running';
//     RETURN json_build_object('deleted', deleted_count);
//   END; $$;
// =============================================

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Sesi login tidak valid.' },
      { status: 401 }
    )
  }

  // Panggil RPC function — validasi owner dilakukan di dalam function (SECURITY DEFINER)
  const { data, error } = await supabase.rpc('reset_kasir_sync_queue_pending')

  if (error) {
    const msg = error.message.includes('Unauthorized')
      ? 'Hanya owner yang bisa mereset antrian.'
      : `Gagal reset antrian: ${error.message}`
    return NextResponse.json(
      { success: false, message: msg },
      { status: error.message.includes('Unauthorized') ? 403 : 500 }
    )
  }

  const deleted = (data as { deleted: number } | null)?.deleted ?? 0

  return NextResponse.json({
    success: true,
    deleted,
    message: `${deleted} item pending berhasil dihapus dari antrian.`,
  })
}
