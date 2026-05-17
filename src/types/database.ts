export type UserRole = 'owner' | 'admin'
export type SalesStatus = 'draft' | 'posted' | 'void'
export type CashflowType = 'cash_in' | 'cash_out'
export type CashflowSource = 'manual' | 'sales'
export type CashflowStatus = 'active' | 'void'
export type CategoryDefaultType = 'cash_in' | 'cash_out' | 'both'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  username: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Branch {
  id: string
  name: string
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CashflowCategory {
  id: string
  name: string
  default_type: CategoryDefaultType
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesReport {
  id: string
  report_date: string
  branch_id: string
  branch?: Branch
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
  total_offline: number
  total_online_gross: number
  total_online_nett: number
  total_online_deduction: number
  grand_total_nett_sales: number
  online_deduction_percentage: number
  status: SalesStatus
  notes: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  creator?: Profile
  updater?: Profile
}

export interface CashflowTransaction {
  id: string
  transaction_date: string
  branch_id: string
  branch?: Branch
  transaction_type: CashflowType
  category_id: string | null
  category?: CashflowCategory
  description: string | null
  cash_in: number
  cash_out: number
  amount: number
  source: CashflowSource
  source_id: string | null
  status: CashflowStatus
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  table_name: string
  record_id: string | null
  action: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_by: string | null
  changed_at: string
  changer?: Profile
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
      }
      branches: {
        Row: Branch
        Insert: Omit<Branch, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Branch, 'id' | 'created_at' | 'updated_at'>>
      }
      cashflow_categories: {
        Row: CashflowCategory
        Insert: Omit<CashflowCategory, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CashflowCategory, 'id' | 'created_at' | 'updated_at'>>
      }
      sales_reports: {
        Row: SalesReport
        Insert: Omit<SalesReport, 'id' | 'created_at' | 'updated_at' | 'branch' | 'creator' | 'updater'>
        Update: Partial<Omit<SalesReport, 'id' | 'created_at' | 'updated_at' | 'branch' | 'creator' | 'updater'>>
      }
      cashflow_transactions: {
        Row: CashflowTransaction
        Insert: Omit<CashflowTransaction, 'id' | 'created_at' | 'updated_at' | 'branch' | 'category'>
        Update: Partial<Omit<CashflowTransaction, 'id' | 'created_at' | 'updated_at' | 'branch' | 'category'>>
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, 'id' | 'changer'>
        Update: never
      }
    }
    Functions: {
      get_email_by_username: {
        Args: { p_username: string }
        Returns: string | null
      }
    }
  }
}
