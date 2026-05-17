'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/format'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh]',
          sizeMap[size]
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel?: string
  confirmClass?: string
  loading?: boolean
  showReason?: boolean
  reason?: string
  onReasonChange?: (r: string) => void
  reasonPlaceholder?: string
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  confirmClass = 'bg-rbn-red hover:bg-rbn-red-dark text-white',
  loading = false,
  showReason = false,
  reason = '',
  onReasonChange,
  reasonPlaceholder = 'Alasan penghapusan (opsional)...',
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-4">{description}</p>
      {showReason && (
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-700 mb-1">Alasan Penghapusan</label>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange?.(e.target.value)}
            className="input-field resize-none text-sm"
            rows={2}
            placeholder={reasonPlaceholder}
          />
        </div>
      )}
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} disabled={loading} className="btn-outline text-sm">
          Batal
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50', confirmClass)}
        >
          {loading ? 'Memproses...' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
