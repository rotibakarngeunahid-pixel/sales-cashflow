import { z } from 'zod'

export const cashflowSchema = z.object({
  transaction_date: z.string().min(1, 'Tanggal wajib diisi'),
  branch_id: z.string().min(1, 'Cabang wajib dipilih'),
  transaction_type: z.enum(['cash_in', 'cash_out'], {
    required_error: 'Tipe transaksi wajib dipilih',
  }),
  category_id: z.string().min(1, 'Kategori wajib dipilih'),
  description: z.string().optional().default(''),
  amount: z.coerce.number().positive('Nominal harus lebih dari 0'),
})

export type CashflowFormData = z.infer<typeof cashflowSchema>

export const categorySchema = z.object({
  name: z.string().min(1, 'Nama kategori wajib diisi').max(100),
  default_type: z.enum(['cash_in', 'cash_out', 'both'], {
    required_error: 'Tipe default wajib dipilih',
  }),
  description: z.string().optional().default(''),
})

export type CategoryFormData = z.infer<typeof categorySchema>
