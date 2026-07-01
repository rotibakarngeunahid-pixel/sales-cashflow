export const KURIR_BAWA_BAHAN_CATEGORY_NAME = 'Kurir bawa Bahan'
export const AUTO_SPLIT_KURIR_SOURCE = 'auto_split_kurir' as const
export const AUTO_SPLIT_KURIR_SOURCE_LABEL = 'Auto Split Kurir bawa Bahan'

export type AutoSplitBranch = {
  id: string
  name: string
}

export type AutoSplitAllocation = {
  branch_id: string
  branch_name: string
  order: number
  amount: number
}

export function normalizeStrictCategoryName(name?: string | null): string {
  return (name || '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim()
}

export function isKurirBawaBahanCategory(name?: string | null): boolean {
  return normalizeStrictCategoryName(name) === 'kurir bawa bahan'
}

export function sortAutoSplitBranches<T extends AutoSplitBranch>(branches: T[]): T[] {
  return [...branches].sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    return byName !== 0 ? byName : a.id.localeCompare(b.id)
  })
}

export function distributeAutoSplitAmount(totalAmount: number, branches: AutoSplitBranch[]): AutoSplitAllocation[] {
  const sortedBranches = sortAutoSplitBranches(branches)
  const branchCount = sortedBranches.length

  if (branchCount === 0) return []

  const base = Math.floor(totalAmount / branchCount)
  const remainder = totalAmount - base * branchCount

  return sortedBranches.map((branch, index) => ({
    branch_id: branch.id,
    branch_name: branch.name,
    order: index + 1,
    amount: base + (index < remainder ? 1 : 0),
  }))
}

export function getAutoSplitPreviewError(totalAmount: number, branchCount: number): string | null {
  if (branchCount === 0) {
    return 'Tidak ada outlet aktif. Aktifkan minimal 1 outlet sebelum menyimpan Kurir bawa Bahan.'
  }

  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return 'Nominal harus lebih dari 0 dan berupa Rupiah tanpa desimal.'
  }

  if (totalAmount < branchCount) {
    return `Nominal Kurir bawa Bahan minimal Rp${branchCount.toLocaleString('id-ID')} karena ada ${branchCount} outlet aktif.`
  }

  return null
}
