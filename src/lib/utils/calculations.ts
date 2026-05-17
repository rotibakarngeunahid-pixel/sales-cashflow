export interface SalesCalculationInput {
  cash: number
  qris: number
  gofood_gross: number
  gofood_promo: number
  gofood_commission: number
  gofood_nett: number
  grabfood_gross: number
  grabfood_promo: number
  grabfood_commission: number
  grabfood_ads: number
  grabfood_nett: number
  shopeefood_gross: number
  shopeefood_promo: number
  shopeefood_commission: number
  shopeefood_nett: number
}

export interface SalesCalculationResult {
  total_offline: number
  total_online_gross: number
  total_online_nett: number
  total_online_deduction: number
  grand_total_nett_sales: number
  online_deduction_percentage: number
}

export function calculateSales(input: SalesCalculationInput): SalesCalculationResult {
  const total_offline = (input.cash || 0) + (input.qris || 0)
  const total_online_gross =
    (input.gofood_gross || 0) + (input.grabfood_gross || 0) + (input.shopeefood_gross || 0)
  const total_online_nett =
    (input.gofood_nett || 0) + (input.grabfood_nett || 0) + (input.shopeefood_nett || 0)
  const total_online_deduction = total_online_gross - total_online_nett
  const grand_total_nett_sales = total_offline + total_online_nett
  const online_deduction_percentage =
    total_online_gross > 0 ? (total_online_deduction / total_online_gross) * 100 : 0

  return {
    total_offline,
    total_online_gross,
    total_online_nett,
    total_online_deduction,
    grand_total_nett_sales,
    online_deduction_percentage,
  }
}
