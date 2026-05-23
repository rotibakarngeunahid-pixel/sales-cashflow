export type UserRole = 'owner' | 'admin'
export type KasirSyncBatchStatus = 'running' | 'completed' | 'failed' | 'partial'
export type KasirSyncItemStatus = 'pending' | 'confirmed' | 'rejected'
export type KasirSyncItemType = 'penjualan' | 'kas_keluar'
export type SalesStatus = 'draft' | 'submitted' | 'posted' | 'void'
export type CashflowType = 'cash_in' | 'cash_out'
export type CashflowSource = 'manual' | 'sales' | 'purchase_order' | 'kasir_sales' | 'kasir_expenses'

export type KasirImportType = 'sales' | 'expenses'
export type KasirImportStatus = 'success' | 'failed' | 'partial'
export type KasirPaymentMethod = 'Tunai' | 'QRIS' | 'Tunai+QRIS'
export type CashflowStatus = 'active' | 'void'
export type CategoryDefaultType = 'cash_in' | 'cash_out' | 'both'
export type RawMaterialImportStatus = 'success' | 'failed'

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
  qris_gross: number
  qris_mdr: number
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
  import_key: string | null
  source_label: string | null
  source_metadata: Record<string, unknown>
  reference_group_id: string | null
  status: CashflowStatus
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface KasirImportLog {
  id: string
  import_type: KasirImportType
  imported_at: string
  period_start: string
  period_end: string
  branch_id: string | null
  branch_filter: string | null
  payment_method_filter: string | null
  total_found: number
  total_success: number
  total_failed: number
  total_skipped: number
  total_amount: number
  status: KasirImportStatus
  message: string | null
  error_details: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  actor?: Pick<Profile, 'full_name' | 'email'> | null
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

export interface KasirSyncBatch {
  id: string
  started_at: string
  completed_at: string | null
  status: KasirSyncBatchStatus
  period_from: string | null
  period_to: string | null
  total_pulled: number
  new_count: number
  skipped_count: number
  error_message: string | null
  triggered_by: string
  created_at: string
}

export interface KasirSyncQueueItem {
  id: string
  batch_id: string | null
  item_type: KasirSyncItemType
  kasir_id: string
  tanggal: string
  waktu: string
  cabang: string
  branch_id: string | null
  // penjualan
  total_penjualan: number | null
  subtotal: number | null
  diskon: number | null
  metode_pembayaran: string | null
  kasir_name: string | null
  // kas keluar
  kategori: string | null
  nominal: number | null
  keterangan: string | null
  dicatat_oleh: string | null
  // workflow
  status: KasirSyncItemStatus
  confirmed_at: string | null
  confirmed_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  reject_reason: string | null
  cashflow_transaction_id: string | null
  raw_data: Record<string, unknown> | null
  pulled_at: string
}

export interface RawMaterialImportLog {
  id: string
  imported_at: string
  period_start: string
  period_end: string
  branch_count: number
  total_amount: number
  status: RawMaterialImportStatus
  message: string | null
  created_by: string | null
  created_at: string
  actor?: Pick<Profile, 'full_name' | 'email'> | null
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
          qris_gross: number
          qris_mdr: number
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
          qris_gross?: number
          qris_mdr?: number
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
          qris_gross?: number
          qris_mdr?: number
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
          import_key: string | null
          source_label: string | null
          source_metadata: Record<string, unknown>
          reference_group_id: string | null
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
          import_key?: string | null
          source_label?: string | null
          source_metadata?: Record<string, unknown>
          reference_group_id?: string | null
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
          import_key?: string | null
          source_label?: string | null
          source_metadata?: Record<string, unknown>
          reference_group_id?: string | null
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
      raw_material_import_logs: {
        Row: {
          id: string
          imported_at: string
          period_start: string
          period_end: string
          branch_count: number
          total_amount: number
          status: RawMaterialImportStatus
          message: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          imported_at?: string
          period_start: string
          period_end: string
          branch_count?: number
          total_amount?: number
          status: RawMaterialImportStatus
          message?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'raw_material_import_logs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      kasir_import_logs: {
        Row: {
          id: string
          import_type: KasirImportType
          imported_at: string
          period_start: string
          period_end: string
          branch_id: string | null
          branch_filter: string | null
          payment_method_filter: string | null
          total_found: number
          total_success: number
          total_failed: number
          total_skipped: number
          total_amount: number
          status: KasirImportStatus
          message: string | null
          error_details: Record<string, unknown> | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          import_type: KasirImportType
          period_start: string
          period_end: string
          branch_id?: string | null
          branch_filter?: string | null
          payment_method_filter?: string | null
          total_found?: number
          total_success?: number
          total_failed?: number
          total_skipped?: number
          total_amount?: number
          status: KasirImportStatus
          message?: string | null
          error_details?: Record<string, unknown> | null
          created_by?: string | null
          imported_at?: string
          created_at?: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'kasir_import_logs_created_by_fkey'
            columns: ['created_by']
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
      kasir_sync_batches: {
        Row: {
          id: string
          started_at: string
          completed_at: string | null
          status: KasirSyncBatchStatus
          period_from: string | null
          period_to: string | null
          total_pulled: number
          new_count: number
          skipped_count: number
          error_message: string | null
          triggered_by: string
          created_at: string
        }
        Insert: {
          status?: KasirSyncBatchStatus
          period_from?: string | null
          period_to?: string | null
          total_pulled?: number
          new_count?: number
          skipped_count?: number
          error_message?: string | null
          triggered_by?: string
        }
        Update: {
          status?: KasirSyncBatchStatus
          completed_at?: string | null
          total_pulled?: number
          new_count?: number
          skipped_count?: number
          error_message?: string | null
        }
        Relationships: []
      }
      kasir_sync_queue: {
        Row: {
          id: string
          batch_id: string | null
          item_type: KasirSyncItemType
          kasir_id: string
          tanggal: string
          waktu: string
          cabang: string
          branch_id: string | null
          total_penjualan: number | null
          subtotal: number | null
          diskon: number | null
          metode_pembayaran: string | null
          kasir_name: string | null
          kategori: string | null
          nominal: number | null
          keterangan: string | null
          dicatat_oleh: string | null
          status: KasirSyncItemStatus
          confirmed_at: string | null
          confirmed_by: string | null
          rejected_at: string | null
          rejected_by: string | null
          reject_reason: string | null
          cashflow_transaction_id: string | null
          raw_data: Record<string, unknown> | null
          pulled_at: string
        }
        Insert: {
          batch_id?: string | null
          item_type: KasirSyncItemType
          kasir_id: string
          tanggal: string
          waktu?: string
          cabang: string
          branch_id?: string | null
          total_penjualan?: number | null
          subtotal?: number | null
          diskon?: number | null
          metode_pembayaran?: string | null
          kasir_name?: string | null
          kategori?: string | null
          nominal?: number | null
          keterangan?: string | null
          dicatat_oleh?: string | null
          status?: KasirSyncItemStatus
          raw_data?: Record<string, unknown> | null
        }
        Update: {
          status?: KasirSyncItemStatus
          confirmed_at?: string | null
          confirmed_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          reject_reason?: string | null
          cashflow_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kasir_sync_queue_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
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
