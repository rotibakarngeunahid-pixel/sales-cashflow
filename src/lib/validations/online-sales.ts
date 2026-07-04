import { z } from 'zod'

const nonNegative = z.coerce.number().min(0, 'Tidak boleh negatif')

export const onlineSalesDeductionSchema = z.object({
  deduction_type: z.enum(['commission', 'promo', 'other']),
  label: z.string().optional().default(''),
  amount: nonNegative.default(0),
}).refine(
  (data) => data.deduction_type !== 'other' || data.label.trim().length > 0,
  { message: 'Label wajib diisi untuk potongan jenis "Biaya Lain"', path: ['label'] }
)

export const onlineSalesReportSchema = z.object({
  report_date: z.string().min(1, 'Tanggal wajib diisi'),
  branch_id: z.string().min(1, 'Cabang wajib dipilih'),
  platform: z.enum(['gofood', 'grabfood', 'shopeefood']),
  gross_amount: nonNegative.default(0),
  deductions: z.array(onlineSalesDeductionSchema).default([]),
  nett_input_mode: z.enum(['calculated', 'manual']).default('calculated'),
  manual_nett_amount: nonNegative.optional(),
  notes: z.string().optional().default(''),
}).refine(
  (data) => data.nett_input_mode !== 'manual' || data.manual_nett_amount !== undefined,
  { message: 'Nett manual wajib diisi', path: ['manual_nett_amount'] }
)

export type OnlineSalesReportFormData = z.infer<typeof onlineSalesReportSchema>
export type OnlineSalesDeductionFormData = z.infer<typeof onlineSalesDeductionSchema>
