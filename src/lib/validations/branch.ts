import { z } from 'zod'

export const branchSchema = z.object({
  name: z.string().min(1, 'Nama cabang wajib diisi').max(100),
  address: z.string().optional().default(''),
})

export type BranchFormData = z.infer<typeof branchSchema>
