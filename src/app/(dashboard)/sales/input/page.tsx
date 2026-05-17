'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, ArrowLeft } from 'lucide-react'
import SalesForm from '@/components/sales/SalesForm'

export default function SalesInputPage() {
  const router = useRouter()

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/sales/reports')}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Input Penjualan Harian</h2>
          <p className="text-sm text-gray-500">Tambah laporan penjualan baru</p>
        </div>
      </div>

      {/* Form Card */}
      <div className="card p-5">
        <SalesForm
          onSuccess={() => router.push('/sales/reports')}
          onCancel={() => router.push('/sales/reports')}
        />
      </div>
    </div>
  )
}
