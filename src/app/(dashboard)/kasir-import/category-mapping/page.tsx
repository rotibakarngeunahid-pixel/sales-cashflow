'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { CashflowCategory, KasirCategoryMapping, CategoryMappingMatchType, Profile } from '@/types/database'
import { CATEGORY_MAPPING_MATCH_TYPE_LABELS } from '@/lib/kasir-import/shared'
import Modal, { ConfirmModal } from '@/components/ui/Modal'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateTime } from '@/lib/utils/format'

type CategoryOption = Pick<CashflowCategory, 'id' | 'name' | 'default_type'>

const MATCH_TYPE_STYLES: Record<CategoryMappingMatchType, string> = {
  exact: 'bg-blue-50 text-blue-700',
  contains: 'bg-violet-50 text-violet-700',
}

interface FormState {
  kasir_category: string
  match_type: CategoryMappingMatchType
  local_category_id: string
}

const emptyForm: FormState = { kasir_category: '', match_type: 'exact', local_category_id: '' }

export default function CategoryMappingPage() {
  const [mappings, setMappings] = useState<KasirCategoryMapping[]>([])
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([])
  const [loading, setLoading] = useState(true)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<KasirCategoryMapping | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<KasirCategoryMapping | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [{ data: mappingRows }, { data: categoryRows }] = await Promise.all([
      supabase
        .from('kasir_category_mappings')
        .select('*, local_category:cashflow_categories(id,name,default_type)')
        .order('updated_at', { ascending: false }),
      supabase
        .from('cashflow_categories')
        .select('id,name,default_type')
        .in('default_type', ['cash_out', 'both'])
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name'),
    ])

    setMappings((mappingRows || []) as unknown as KasirCategoryMapping[])
    setCategoryOptions(categoryRows || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
        setCurrentProfile(data)
      }
    }
    loadProfile()
  }, [])

  function openAdd() {
    setEditTarget(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(mapping: KasirCategoryMapping) {
    setEditTarget(mapping)
    setForm({
      kasir_category: mapping.kasir_category,
      match_type: mapping.match_type,
      local_category_id: mapping.local_category_id,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const kasir_category = form.kasir_category.trim()
    if (!kasir_category) { setFormError('Teks dari sistem kasir wajib diisi.'); return }
    if (!form.local_category_id) { setFormError('Pilih kategori cashflow tujuan.'); return }

    setSaving(true)
    setFormError(null)
    const supabase = createClient()

    if (editTarget) {
      const { error } = await supabase
        .from('kasir_category_mappings')
        .update({
          kasir_category,
          match_type: form.match_type,
          local_category_id: form.local_category_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editTarget.id)

      if (error) {
        setFormError(
          error.code === '23505'
            ? 'Sudah ada pemetaan lain dengan teks & tipe pencocokan yang sama.'
            : `Gagal menyimpan: ${error.message}`
        )
        setSaving(false)
        return
      }

      await supabase.from('audit_logs').insert({
        table_name: 'kasir_category_mappings',
        record_id: editTarget.id,
        action: 'kasir_category_mapping_updated',
        old_data: editTarget as unknown as Record<string, unknown>,
        new_data: { kasir_category, match_type: form.match_type, local_category_id: form.local_category_id } as Record<string, unknown>,
        changed_by: currentProfile?.id ?? null,
        changed_at: new Date().toISOString(),
      })
    } else {
      const { data: created, error } = await supabase
        .from('kasir_category_mappings')
        .insert({
          kasir_category,
          match_type: form.match_type,
          local_category_id: form.local_category_id,
          created_by: currentProfile?.id ?? null,
        })
        .select()
        .single()

      if (error) {
        setFormError(
          error.code === '23505'
            ? 'Pemetaan dengan teks & tipe pencocokan ini sudah ada. Edit yang sudah ada, jangan buat baru.'
            : `Gagal menyimpan: ${error.message}`
        )
        setSaving(false)
        return
      }

      if (created) {
        await supabase.from('audit_logs').insert({
          table_name: 'kasir_category_mappings',
          record_id: created.id,
          action: 'kasir_category_mapping_created',
          old_data: null,
          new_data: created as unknown as Record<string, unknown>,
          changed_by: currentProfile?.id ?? null,
          changed_at: new Date().toISOString(),
        })
      }
    }

    setSaving(false)
    setModalOpen(false)
    await load()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    const supabase = createClient()

    const { error } = await supabase.from('kasir_category_mappings').delete().eq('id', deleteTarget.id)
    if (!error) {
      await supabase.from('audit_logs').insert({
        table_name: 'kasir_category_mappings',
        record_id: deleteTarget.id,
        action: 'kasir_category_mapping_deleted',
        old_data: deleteTarget as unknown as Record<string, unknown>,
        new_data: null,
        changed_by: currentProfile?.id ?? null,
        changed_at: new Date().toISOString(),
      })
    }

    setSaving(false)
    setDeleteTarget(null)
    await load()
  }

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Integrasi</p>
          <h2 className="text-xl font-bold text-gray-900">Pemetaan Kategori Kas Keluar POS</h2>
          <p className="text-sm text-gray-500">{mappings.length} pemetaan tersimpan</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" /> Tambah Pemetaan
        </button>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 flex items-start gap-2">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <p>
          Saat import data dari sistem kasir, kategori/keterangan kas keluar (mis. &quot;Balikin uang roti canai yang di cancel&quot;)
          dicocokkan ke pemetaan di bawah ini terlebih dahulu sebelum jatuh ke pencocokan otomatis berbasis nama kategori.
          <strong> Persis sama</strong> mencocokkan teks kasir apa adanya (toleran huruf besar/kecil &amp; spasi).
          <strong> Mengandung kata/frasa</strong> mencocokkan kalau teks kasir memuat kata/frasa tersebut di mana saja —
          cocok untuk pola berulang seperti &quot;Maxim&quot;, &quot;Gojek&quot;, atau &quot;bensin&quot;.
        </p>
      </div>

      <div className="card overflow-hidden">
        {mappings.length === 0 ? (
          <EmptyState
            title="Belum ada pemetaan kategori"
            description="Tambahkan pemetaan supaya kategori kas keluar dari POS otomatis terarah ke kategori cashflow yang benar."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Teks dari Kasir</th>
                  <th className="table-header">Tipe Cocok</th>
                  <th className="table-header">Kategori Tujuan</th>
                  <th className="table-header">Terakhir Diubah</th>
                  <th className="table-header text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium">
                      <span className="font-mono text-xs bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-800">
                        {mapping.kasir_category}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${MATCH_TYPE_STYLES[mapping.match_type]}`}>
                        {CATEGORY_MAPPING_MATCH_TYPE_LABELS[mapping.match_type]}
                      </span>
                    </td>
                    <td className="table-cell">
                      {mapping.local_category?.name || <span className="text-slate-300 italic">Kategori tidak ditemukan</span>}
                    </td>
                    <td className="table-cell text-gray-500 text-xs">{formatDateTime(mapping.updated_at)}</td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(mapping)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(mapping)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal tambah/edit */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Pemetaan Kategori' : 'Tambah Pemetaan Kategori'} size="sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teks Kategori/Keterangan dari Kasir <span className="text-red-500">*</span>
            </label>
            <input
              value={form.kasir_category}
              onChange={(e) => setForm((f) => ({ ...f, kasir_category: e.target.value }))}
              className="input-field"
              placeholder='mis. "Bayar Maxim pergi dan pulang"'
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipe Pencocokan <span className="text-red-500">*</span></label>
            <select
              value={form.match_type}
              onChange={(e) => setForm((f) => ({ ...f, match_type: e.target.value as CategoryMappingMatchType }))}
              className="input-field"
            >
              <option value="exact">Persis sama</option>
              <option value="contains">Mengandung kata/frasa</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kategori Cashflow Tujuan <span className="text-red-500">*</span></label>
            <select
              value={form.local_category_id}
              onChange={(e) => setForm((f) => ({ ...f, local_category_id: e.target.value }))}
              className="input-field"
            >
              <option value="">Pilih kategori...</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-outline text-sm">Batal</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? 'Menyimpan...' : editTarget ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={saving}
        title="Hapus Pemetaan Kategori"
        description={`Yakin ingin menghapus pemetaan "${deleteTarget?.kasir_category}"? Import berikutnya tidak akan otomatis terpetakan lagi untuk teks ini.`}
        confirmLabel="Hapus"
        confirmClass="bg-red-600 hover:bg-red-700 text-white"
      />
    </div>
  )
}
