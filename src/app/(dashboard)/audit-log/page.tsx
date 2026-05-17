'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuditLog } from '@/types/database'
import { formatDateTime } from '@/lib/utils/format'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectFilter, DateRangeFilter } from '@/components/ui/FilterBar'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Eye } from 'lucide-react'
import Modal from '@/components/ui/Modal'

const actionLabels: Record<string, string> = {
  sales_created: 'Sales Dibuat',
  sales_updated: 'Sales Diperbarui',
  sales_posted: 'Sales Diposting',
  sales_voided: 'Sales Divoid',
  cashflow_created: 'Cashflow Dibuat',
  cashflow_updated: 'Cashflow Diperbarui',
  cashflow_voided: 'Cashflow Divoid',
  category_created: 'Kategori Dibuat',
  category_updated: 'Kategori Diperbarui',
  category_activated: 'Kategori Diaktifkan',
  category_deactivated: 'Kategori Dinonaktifkan',
  branch_created: 'Cabang Dibuat',
  branch_updated: 'Cabang Diperbarui',
  branch_activated: 'Cabang Diaktifkan',
  branch_deactivated: 'Cabang Dinonaktifkan',
}

const actionColors: Record<string, string> = {
  sales_created: 'bg-blue-100 text-blue-700',
  sales_updated: 'bg-yellow-100 text-yellow-700',
  sales_posted: 'bg-green-100 text-green-700',
  sales_voided: 'bg-red-100 text-red-700',
  cashflow_created: 'bg-blue-100 text-blue-700',
  cashflow_updated: 'bg-yellow-100 text-yellow-700',
  cashflow_voided: 'bg-red-100 text-red-700',
  category_created: 'bg-blue-100 text-blue-700',
  category_updated: 'bg-yellow-100 text-yellow-700',
  category_deactivated: 'bg-red-100 text-red-700',
  branch_created: 'bg-blue-100 text-blue-700',
  branch_updated: 'bg-yellow-100 text-yellow-700',
  branch_deactivated: 'bg-red-100 text-red-700',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<(AuditLog & { changer?: { full_name: string | null; email: string | null } })[]>([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null)

  const today = new Date()
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('audit_logs')
      .select('*, changer:profiles(full_name, email)')
      .gte('changed_at', `${startDate}T00:00:00`)
      .lte('changed_at', `${endDate}T23:59:59`)
      .order('changed_at', { ascending: false })
      .limit(500)

    if (filterAction) query = query.eq('action', filterAction)

    const { data } = await query
    setLogs(data || [])
    setLoading(false)
  }, [startDate, endDate, filterAction])

  useEffect(() => { load() }, [load])

  const uniqueActions = Array.from(new Set(logs.map((l) => l.action)))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Audit Log</h2>
        <p className="text-sm text-gray-500">{logs.length} entri ditemukan</p>
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
        <SelectFilter
          value={filterAction}
          onChange={setFilterAction}
          placeholder="Semua Aksi"
          options={uniqueActions.map((a) => ({ value: a, label: actionLabels[a] || a }))}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? <PageLoading /> : logs.length === 0 ? (
          <EmptyState title="Tidak ada log" description="Belum ada aktivitas tercatat." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Waktu</th>
                  <th className="table-header">Aksi</th>
                  <th className="table-header">Tabel</th>
                  <th className="table-header">Diubah Oleh</th>
                  <th className="table-header text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell text-xs text-gray-500">{formatDateTime(log.changed_at)}</td>
                    <td className="table-cell">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        {actionLabels[log.action] || log.action}
                      </span>
                    </td>
                    <td className="table-cell text-gray-500 text-xs font-mono">{log.table_name}</td>
                    <td className="table-cell">
                      <p className="text-sm font-medium">{log.changer?.full_name || '—'}</p>
                      <p className="text-xs text-gray-400">{log.changer?.email}</p>
                    </td>
                    <td className="table-cell">
                      <div className="flex justify-end">
                        <button
                          onClick={() => setDetailLog(log)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailLog && (
        <Modal isOpen={!!detailLog} onClose={() => setDetailLog(null)} title="Detail Audit Log" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Aksi</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[detailLog.action] || 'bg-gray-100 text-gray-700'}`}>
                  {actionLabels[detailLog.action] || detailLog.action}
                </span>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Tabel</p>
                <p className="font-mono text-xs">{detailLog.table_name}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Record ID</p>
                <p className="font-mono text-xs truncate">{detailLog.record_id || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Waktu</p>
                <p className="text-xs">{formatDateTime(detailLog.changed_at)}</p>
              </div>
            </div>

            {detailLog.old_data && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Data Sebelumnya:</p>
                <pre className="text-xs bg-red-50 border border-red-100 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                  {JSON.stringify(detailLog.old_data, null, 2)}
                </pre>
              </div>
            )}

            {detailLog.new_data && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Data Baru:</p>
                <pre className="text-xs bg-green-50 border border-green-100 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                  {JSON.stringify(detailLog.new_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
