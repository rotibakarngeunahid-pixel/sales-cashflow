'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { salesSchema, type SalesFormData } from '@/lib/validations/sales'
import { calculateSales } from '@/lib/utils/calculations'
import { formatRupiah, toDateInputValue } from '@/lib/utils/format'
import type { Branch, SalesReport } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, ChevronUp, Info, CheckCircle2, Send } from 'lucide-react'

interface SalesFormProps {
  initialData?: SalesReport | null
  onSuccess: (message?: string) => void
  onCancel: () => void
}

interface NumericInputProps {
  label: string
  name: keyof SalesFormData
  register: ReturnType<typeof useForm<SalesFormData>>['register']
  error?: string
  hint?: string
  readOnly?: boolean
}

function NumericInput({ label, name, register, error, hint, readOnly }: NumericInputProps) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        step="1"
        min="0"
        readOnly={readOnly}
        {...register(name)}
        className={`input-field text-sm font-semibold text-rupiah ${readOnly ? 'bg-slate-50 text-slate-500' : ''}`}
        placeholder="0"
      />
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  )
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  badge,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-white hover:border-slate-300 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-800">{title}</span>
        {badge && (
          <span className="text-xs bg-rbn-orange/10 text-rbn-orange px-2 py-0.5 rounded-full font-bold text-rupiah">
            {badge}
          </span>
        )}
      </div>
      {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
    </button>
  )
}

export default function SalesForm({ initialData, onSuccess, onCancel }: SalesFormProps) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGofood, setShowGofood] = useState(true)
  const [showGrabfood, setShowGrabfood] = useState(true)
  const [showShopeefood, setShowShopeefood] = useState(true)
  const [calcs, setCalcs] = useState<ReturnType<typeof calculateSales> | null>(null)

  // Tracks which button the user clicked: 'draft' or 'submitted'
  const submitIntentRef = useRef<'draft' | 'submitted'>('draft')

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SalesFormData>({
    resolver: zodResolver(salesSchema),
    defaultValues: {
      report_date: initialData?.report_date || toDateInputValue(),
      branch_id: initialData?.branch_id || '',
      cash: initialData?.cash || 0,
      qris: initialData?.qris || 0,
      gofood_gross: initialData?.gofood_gross || 0,
      gofood_promo: initialData?.gofood_promo || 0,
      gofood_commission: initialData?.gofood_commission || 0,
      gofood_nett: initialData?.gofood_nett || 0,
      grabfood_gross: initialData?.grabfood_gross || 0,
      grabfood_promo: initialData?.grabfood_promo || 0,
      grabfood_commission: initialData?.grabfood_commission || 0,
      grabfood_ads: initialData?.grabfood_ads || 0,
      grabfood_nett: initialData?.grabfood_nett || 0,
      shopeefood_gross: initialData?.shopeefood_gross || 0,
      shopeefood_promo: initialData?.shopeefood_promo || 0,
      shopeefood_commission: initialData?.shopeefood_commission || 0,
      shopeefood_nett: initialData?.shopeefood_nett || 0,
      notes: initialData?.notes || '',
    },
  })

  const watchedValues = watch()

  useEffect(() => {
    const result = calculateSales({
      cash: Number(watchedValues.cash) || 0,
      qris: Number(watchedValues.qris) || 0,
      gofood_gross: Number(watchedValues.gofood_gross) || 0,
      gofood_promo: Number(watchedValues.gofood_promo) || 0,
      gofood_commission: Number(watchedValues.gofood_commission) || 0,
      gofood_nett: Number(watchedValues.gofood_nett) || 0,
      grabfood_gross: Number(watchedValues.grabfood_gross) || 0,
      grabfood_promo: Number(watchedValues.grabfood_promo) || 0,
      grabfood_commission: Number(watchedValues.grabfood_commission) || 0,
      grabfood_ads: Number(watchedValues.grabfood_ads) || 0,
      grabfood_nett: Number(watchedValues.grabfood_nett) || 0,
      shopeefood_gross: Number(watchedValues.shopeefood_gross) || 0,
      shopeefood_promo: Number(watchedValues.shopeefood_promo) || 0,
      shopeefood_commission: Number(watchedValues.shopeefood_commission) || 0,
      shopeefood_nett: Number(watchedValues.shopeefood_nett) || 0,
    })
    setCalcs(result)
  }, [watchedValues])

  useEffect(() => {
    async function loadBranches() {
      const supabase = createClient()
      const { data } = await supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')
      setBranches(data || [])
    }
    loadBranches()
  }, [])

  async function onSubmit(data: SalesFormData) {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const computed = calculateSales({
      cash: Number(data.cash),
      qris: Number(data.qris),
      gofood_gross: Number(data.gofood_gross),
      gofood_promo: Number(data.gofood_promo),
      gofood_commission: Number(data.gofood_commission),
      gofood_nett: Number(data.gofood_nett),
      grabfood_gross: Number(data.grabfood_gross),
      grabfood_promo: Number(data.grabfood_promo),
      grabfood_commission: Number(data.grabfood_commission),
      grabfood_ads: Number(data.grabfood_ads),
      grabfood_nett: Number(data.grabfood_nett),
      shopeefood_gross: Number(data.shopeefood_gross),
      shopeefood_promo: Number(data.shopeefood_promo),
      shopeefood_commission: Number(data.shopeefood_commission),
      shopeefood_nett: Number(data.shopeefood_nett),
    })

    const payload = {
      ...data,
      cash: Number(data.cash),
      qris: Number(data.qris),
      gofood_gross: Number(data.gofood_gross),
      gofood_promo: Number(data.gofood_promo),
      gofood_commission: Number(data.gofood_commission),
      gofood_nett: Number(data.gofood_nett),
      grabfood_gross: Number(data.grabfood_gross),
      grabfood_promo: Number(data.grabfood_promo),
      grabfood_commission: Number(data.grabfood_commission),
      grabfood_ads: Number(data.grabfood_ads),
      grabfood_nett: Number(data.grabfood_nett),
      shopeefood_gross: Number(data.shopeefood_gross),
      shopeefood_promo: Number(data.shopeefood_promo),
      shopeefood_commission: Number(data.shopeefood_commission),
      shopeefood_nett: Number(data.shopeefood_nett),
      ...computed,
      updated_by: user?.id ?? null,
    }

    if (initialData) {
      // When editing: keep the current status unless it's a draft/submitted being submitted
      let newStatus = initialData.status
      if (initialData.status === 'draft' && submitIntentRef.current === 'submitted') {
        newStatus = 'submitted'
      } else if (initialData.status === 'submitted' && submitIntentRef.current === 'draft') {
        newStatus = 'draft'
      }

      const { error: updateError } = await supabase
        .from('sales_reports')
        .update({ ...payload, status: newStatus })
        .eq('id', initialData.id)

      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }

      await supabase.from('audit_logs').insert({
        table_name: 'sales_reports',
        record_id: initialData.id,
        action: 'sales_updated',
        old_data: initialData as unknown as Record<string, unknown>,
        new_data: { ...payload, status: newStatus } as unknown as Record<string, unknown>,
        changed_by: user?.id ?? null,
        changed_at: new Date().toISOString(),
      })

      setSaving(false)
      const isDraftToSubmit = initialData.status === 'draft' && newStatus === 'submitted'
      const isSubmitToDraft = initialData.status === 'submitted' && newStatus === 'draft'
      const msg = isDraftToSubmit
        ? 'Laporan berhasil disubmit!'
        : isSubmitToDraft
        ? 'Laporan dikembalikan ke Draft.'
        : 'Perubahan berhasil disimpan.'
      onSuccess(msg)
    } else {
      const statusToCreate = submitIntentRef.current === 'submitted' ? 'submitted' : 'draft'

      const { data: newSale, error: insertError } = await supabase
        .from('sales_reports')
        .insert({ ...payload, status: statusToCreate, created_by: user?.id ?? null })
        .select()
        .single()

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }

      if (newSale) {
        await supabase.from('audit_logs').insert({
          table_name: 'sales_reports',
          record_id: newSale.id,
          action: 'sales_created',
          old_data: null,
          new_data: newSale as unknown as Record<string, unknown>,
          changed_by: user?.id ?? null,
          changed_at: new Date().toISOString(),
        })
      }

      setSaving(false)
      const msg = statusToCreate === 'submitted'
        ? 'Penjualan berhasil disubmit!'
        : 'Draft berhasil disimpan.'
      onSuccess(msg)
    }
  }

  // Determines which button labels to show based on existing data status
  const isEditingPosted = initialData?.status === 'posted'
  const isEditingVoid = initialData?.status === 'void'
  const isEditingSubmitted = initialData?.status === 'submitted'
  const showDraftAndSubmitButtons = !initialData || initialData.status === 'draft'
  const showSubmittedButtons = isEditingSubmitted

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Basic info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">
            Tanggal <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            {...register('report_date')}
            className="input-field"
          />
          {errors.report_date && (
            <p className="text-xs text-red-500 mt-1">{errors.report_date.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">
            Cabang <span className="text-red-500">*</span>
          </label>
          <select {...register('branch_id')} className="input-field">
            <option value="">Pilih cabang...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {errors.branch_id && (
            <p className="text-xs text-red-500 mt-1">{errors.branch_id.message}</p>
          )}
        </div>
      </div>

      {/* Offline Sales */}
      <div>
        <h3 className="text-sm font-bold text-slate-950 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rbn-red"></span>
          Penjualan Offline
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <NumericInput label="Cash" name="cash" register={register} error={errors.cash?.message} />
          <NumericInput label="QRIS" name="qris" register={register} error={errors.qris?.message} />
        </div>
        {calcs && (
          <p className="text-xs text-slate-500 mt-2">
            Total Offline: <span className="font-bold text-slate-800 text-rupiah">{formatRupiah(calcs.total_offline)}</span>
          </p>
        )}
      </div>

      {/* GoFood */}
      <div>
        <SectionHeader
          title="GoFood"
          expanded={showGofood}
          onToggle={() => setShowGofood(!showGofood)}
          badge={calcs && Number(watchedValues.gofood_nett) > 0 ? formatRupiah(Number(watchedValues.gofood_nett) || 0) : undefined}
        />
        {showGofood && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <NumericInput label="Gross Sales" name="gofood_gross" register={register} />
            <NumericInput label="Promo/Diskon" name="gofood_promo" register={register} />
            <NumericInput label="Komisi/Platform Fee" name="gofood_commission" register={register} />
            <NumericInput label="Nett Sales" name="gofood_nett" register={register} />
          </div>
        )}
      </div>

      {/* GrabFood */}
      <div>
        <SectionHeader
          title="GrabFood"
          expanded={showGrabfood}
          onToggle={() => setShowGrabfood(!showGrabfood)}
          badge={calcs && Number(watchedValues.grabfood_nett) > 0 ? formatRupiah(Number(watchedValues.grabfood_nett) || 0) : undefined}
        />
        {showGrabfood && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <NumericInput label="Gross Sales" name="grabfood_gross" register={register} />
            <NumericInput label="Promo/Diskon" name="grabfood_promo" register={register} />
            <NumericInput label="Komisi/Platform Fee" name="grabfood_commission" register={register} />
            <NumericInput label="Ads" name="grabfood_ads" register={register} />
            <NumericInput label="Nett Sales" name="grabfood_nett" register={register} />
          </div>
        )}
      </div>

      {/* ShopeeFood */}
      <div>
        <SectionHeader
          title="ShopeeFood"
          expanded={showShopeefood}
          onToggle={() => setShowShopeefood(!showShopeefood)}
          badge={calcs && Number(watchedValues.shopeefood_nett) > 0 ? formatRupiah(Number(watchedValues.shopeefood_nett) || 0) : undefined}
        />
        {showShopeefood && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <NumericInput label="Gross Sales" name="shopeefood_gross" register={register} />
            <NumericInput label="Promo/Diskon" name="shopeefood_promo" register={register} />
            <NumericInput label="Komisi/Platform Fee" name="shopeefood_commission" register={register} />
            <NumericInput label="Nett Sales" name="shopeefood_nett" register={register} />
          </div>
        )}
      </div>

      {/* Summary */}
      {calcs && (
        <div className="bg-gradient-to-r from-rbn-red/5 to-rbn-orange/5 border border-rbn-orange/20 rounded-lg p-4">
          <h3 className="text-sm font-bold text-slate-950 mb-3 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-rbn-orange" />
            Ringkasan Perhitungan
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-500 text-xs">Total Offline</p>
              <p className="font-semibold text-rupiah">{formatRupiah(calcs.total_offline)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Total Online Gross</p>
              <p className="font-semibold text-rupiah">{formatRupiah(calcs.total_online_gross)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Total Online Nett</p>
              <p className="font-semibold text-rupiah">{formatRupiah(calcs.total_online_nett)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Total Potongan Online</p>
              <p className="font-semibold text-red-600 text-rupiah">
                -{formatRupiah(calcs.total_online_deduction)}
                {calcs.online_deduction_percentage > 0 && (
                  <span className="text-xs font-normal ml-1">({calcs.online_deduction_percentage.toFixed(1)}%)</span>
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-rbn-orange/20">
            <p className="text-xs text-slate-500">Grand Total Nett Sales</p>
            <p className="text-2xl font-bold text-rbn-red text-rupiah">{formatRupiah(calcs.grand_total_nett_sales)}</p>
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Catatan (opsional)</label>
        <textarea
          {...register('notes')}
          className="input-field resize-none"
          rows={2}
          placeholder="Catatan tambahan..."
        />
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end pt-3 border-t border-slate-200">
        <button
          type="button"
          onClick={onCancel}
          className="btn-outline text-sm order-last sm:order-first"
        >
          Batal
        </button>

        {/* Posted/Void: only save changes (preserves status) */}
        {(isEditingPosted || isEditingVoid) && (
          <button
            type="button"
            disabled={saving}
            onClick={() => { submitIntentRef.current = 'draft'; handleSubmit(onSubmit)() }}
            className="btn-primary text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        )}

        {/* Submitted: can revert to draft or resave as submitted */}
        {showSubmittedButtons && (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => { submitIntentRef.current = 'draft'; handleSubmit(onSubmit)() }}
              className="btn-outline text-sm"
            >
              {saving ? 'Menyimpan...' : 'Kembalikan ke Draft'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { submitIntentRef.current = 'submitted'; handleSubmit(onSubmit)() }}
              className="btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </>
        )}

        {/* New or Draft: can save as draft or submit */}
        {showDraftAndSubmitButtons && (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => { submitIntentRef.current = 'draft'; handleSubmit(onSubmit)() }}
              className="btn-outline text-sm"
            >
              {saving ? 'Menyimpan...' : initialData ? 'Simpan Draft' : 'Simpan Draft'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { submitIntentRef.current = 'submitted'; handleSubmit(onSubmit)() }}
              className="btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Memproses...' : 'Submit Penjualan'}
            </button>
          </>
        )}
      </div>
    </form>
  )
}
