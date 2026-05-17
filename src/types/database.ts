export type UserRole = 'owner' | 'admin'
export type SalesStatus = 'draft' | 'submitted' | 'posted' | 'void'
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
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface CashflowCategory {
  id: string
  name: string
  default_type: CategoryDefaultType
  description: string | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SalesReport {
  id: string
  report_date: string
  branch_id: string
  branch?: Pick<Branch, 'id' | 'name'> | null
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
  branch?: Pick<Branch, 'id' | 'name'> | null
  transaction_type: CashflowType
  category_id: string | null
  category?: Pick<CashflowCategory, 'id' | 'name'> | null
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
  changer?: Pick<Profile, 'full_name' | 'email'> | null
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          email: string | null
          username: string | null
          role: UserRole
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          email?: string | null
          username?: string | null
          role?: UserRole
          is_active?: boolean
        }
        Update: {
          full_name?: string | null
          email?: string | null
          username?: string | null
          role?: UserRole
          is_active?: boolean
        }
        Relationships: []
      }
      branches: {
        Row: {
          id: string
          name: string
          address: string | null
          is_active: boolean
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          address?: string | null
          is_active?: boolean
          deleted_at?: string | null
        }
        Update: {
          name?: string
          address?: string | null
          is_active?: boolean
          deleted_at?: string | null
        }
        Relationships: []
      }
      cashflow_categories: {
        Row: {
          id: string
          name: string
          default_type: CategoryDefaultType
          description: string | null
          is_active: boolean
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          default_type: CategoryDefaultType
          description?: string | null
          is_active?: boolean
          deleted_at?: string | null
        }
        Update: {
          name?: string
          default_type?: CategoryDefaultType
          description?: string | null
          is_active?: boolean
          deleted_at?: string | null
        }
        Relationships: []
      }
      sales_reports: {
        Row: {
          id: string
          report_date: string
          branch_id: string
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
        }
        Insert: {
          report_date: string
          branch_id: string
          cash?: number
          qris?: number
          gofood_gross?: number
          gofood_promo?: number
          gofood_commission?: number
          gofood_nett?: number
          grabfood_gross?: number
          grabfood_promo?: number
          grabfood_commission?: number
          grabfood_ads?: number
          grabfood_nett?: number
          shopeefood_gross?: number
          shopeefood_promo?: number
          shopeefood_commission?: number
          shopeefood_nett?: number
          total_offline?: number
          total_online_gross?: number
          total_online_nett?: number
          total_online_deduction?: number
          grand_total_nett_sales?: number
          online_deduction_percentage?: number
          status?: SalesStatus
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          report_date?: string
          branch_id?: string
          cash?: number
          qris?: number
          gofood_gross?: number
          gofood_promo?: number
          gofood_commission?: number
          gofood_nett?: number
          grabfood_gross?: number
          grabfood_promo?: number
          grabfood_commission?: number
          grabfood_ads?: number
          grabfood_nett?: number
          shopeefood_gross?: number
          shopeefood_promo?: number
          shopeefood_commission?: number
          shopeefood_nett?: number
          total_offline?: number
          total_online_gross?: number
          total_online_nett?: number
          total_online_deduction?: number
          grand_total_nett_sales?: number
          online_deduction_percentage?: number
          status?: SalesStatus
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sales_reports_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sales_reports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sales_reports_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      cashflow_transactions: {
        Row: {
          id: string
          transaction_date: string
          branch_id: string
          transaction_type: CashflowType
          category_id: string | null
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
        Insert: {
          transaction_date: string
          branch_id: string
          transaction_type: CashflowType
          amount: number
          category_id?: string | null
          description?: string | null
          cash_in?: number
          cash_out?: number
          source?: CashflowSource
          source_id?: string | null
          status?: CashflowStatus
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          transaction_date?: string
          branch_id?: string
          transaction_type?: CashflowType
          category_id?: string | null
          description?: string | null
          cash_in?: number
          cash_out?: number
          amount?: number
          source?: CashflowSource
          source_id?: string | null
          status?: CashflowStatus
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cashflow_transactions_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cashflow_transactions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'cashflow_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cashflow_transactions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cashflow_transactions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      audit_logs: {
        Row: {
          id: string
          table_name: string
          record_id: string | null
          action: string
          old_data: Record<string, unknown> | null
          new_data: Record<string, unknown> | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          table_name: string
          action: string
          changed_at: string
          record_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          changed_by?: string | null
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'audit_logs_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_email_by_username: {
        Args: { p_username: string }
        Returns: string | null
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
