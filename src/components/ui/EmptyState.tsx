import { FileX } from 'lucide-react'

interface EmptyStateProps {
  title?: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({
  title = 'Tidak ada data',
  description = 'Belum ada data yang tersedia.',
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
        <FileX className="w-7 h-7 text-slate-400" />
      </div>
      <h3 className="text-base font-bold text-slate-950 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>
      {action}
    </div>
  )
}
