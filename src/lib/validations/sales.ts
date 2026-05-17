import { z } from 'zod'

const nonNegative = z.coerce.number().min(0, 'Tidak boleh negatif')

export const salesSchema = z.object({
  report_date: z.string().min(1, 'Tanggal wajib diisi'),
  branch_id: z.string().min(1, 'Cabang wajib dipilih'),
  cash: nonNegative.default(0),
  qris: nonNegative.default(0),
  gofood_gross: nonNegative.default(0),
  gofood_promo: nonNegative.default(0),
  gofood_commission: nonNegative.default(0),
  gofood_nett: nonNegative.default(0),
  grabfood_gross: nonNegative.default(0),
  grabfood_promo: nonNegative.default(0),
  grabfood_commission: nonNegative.default(0),
  grabfood_ads: nonNegative.default(0),
  grabfood_nett: nonNegative.default(0),
  shopeefood_gross: nonNegative.default(0),
  shopeefood_promo: nonNegative.default(0),
  shopeefood_commission: nonNegative.default(0),
  shopeefood_nett: nonNegative.default(0),
  notes: z.string().optional().default(''),
}).refine(
  (data) => {
    const total =
      data.cash + data.qris + data.gofood_gross + data.grabfood_gross + data.shopeefood_gross
    return total > 0
  },
  { message: 'Minimal satu channel harus memiliki nominal', path: ['cash'] }
)

export type SalesFormData = z.infer<typeof salesSchema>
