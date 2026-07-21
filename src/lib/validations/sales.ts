import { z } from 'zod'

const nonNegative = z.coerce.number().min(0, 'Tidak boleh negatif')

export const salesSchema = z.object({
  report_date: z.string().min(1, 'Tanggal wajib diisi'),
  branch_id: z.string().min(1, 'Cabang wajib dipilih'),
  cash: nonNegative.default(0),
  qris_gross: nonNegative.default(0),
  gofood_nett: nonNegative.default(0),
  grabfood_nett: nonNegative.default(0),
  shopeefood_nett: nonNegative.default(0),
  notes: z.string().optional().default(''),
}).refine(
  (data) => {
    const total =
      data.cash + data.qris_gross + data.gofood_nett + data.grabfood_nett + data.shopeefood_nett
    return total > 0
  },
  { message: 'Minimal satu channel harus memiliki nominal', path: ['cash'] }
)

export type SalesFormData = z.infer<typeof salesSchema>
