import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// =============================================
// POST — Buat user baru (owner only)
//
// Dulu user dibuat lewat supabase.auth.signUp() dari browser, yang
// MENGGANTI sesi owner dengan sesi user baru. Endpoint ini memakai
// service role di server sehingga sesi owner tidak terganggu.
// =============================================

const USERNAME_RE = /^[a-zA-Z0-9_]+$/

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, message: 'Sesi login tidak valid.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    return NextResponse.json({ success: false, message: 'Hanya owner yang bisa menambah user.' }, { status: 403 })
  }

  let body: {
    email?: string
    password?: string
    username?: string
    full_name?: string
    role?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Request body tidak valid.' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const username = String(body.username ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? '').trim()
  const role = body.role === 'owner' ? 'owner' : 'admin'

  if (!email || !email.includes('@')) {
    return NextResponse.json({ success: false, message: 'Email tidak valid.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ success: false, message: 'Password minimal 8 karakter.' }, { status: 400 })
  }
  if (username.length < 2 || username.length > 30 || !USERNAME_RE.test(username)) {
    return NextResponse.json(
      { success: false, message: 'Username 2-30 karakter, hanya huruf, angka, dan underscore.' },
      { status: 400 }
    )
  }
  if (!fullName) {
    return NextResponse.json({ success: false, message: 'Nama lengkap wajib diisi.' }, { status: 400 })
  }

  let service: ReturnType<typeof createServiceClient>
  try {
    service = createServiceClient()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Service role key tidak dikonfigurasi.'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }

  // Pastikan username belum dipakai
  const { data: usernameTaken } = await service
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (usernameTaken) {
    return NextResponse.json({ success: false, message: `Username "${username}" sudah dipakai.` }, { status: 400 })
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  })

  if (createError || !created.user) {
    return NextResponse.json(
      { success: false, message: createError?.message || 'Gagal membuat user baru.' },
      { status: 500 }
    )
  }

  // Lengkapi profil (baris profile dibuat oleh trigger saat user dibuat)
  const { error: profileError } = await service
    .from('profiles')
    .upsert(
      {
        id: created.user.id,
        email,
        full_name: fullName,
        username,
        role,
        is_active: true,
      },
      { onConflict: 'id' }
    )

  if (profileError) {
    return NextResponse.json(
      {
        success: false,
        message: `User dibuat, tetapi gagal menyimpan profil: ${profileError.message}`,
      },
      { status: 500 }
    )
  }

  await service.from('audit_logs').insert({
    table_name: 'profiles',
    record_id: created.user.id,
    action: 'user_created',
    old_data: null,
    new_data: { email, username, full_name: fullName, role } as Record<string, unknown>,
    changed_by: user.id,
    changed_at: new Date().toISOString(),
  })

  return NextResponse.json({ success: true, message: `User "${fullName}" berhasil dibuat.` })
}
