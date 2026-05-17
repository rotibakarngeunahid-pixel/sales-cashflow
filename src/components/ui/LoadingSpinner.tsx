export function LoadingSpinner({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <span
      className={`${className} border-2 border-rbn-red border-t-transparent rounded-full animate-spin inline-block`}
    />
  )
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <LoadingSpinner className="w-8 h-8 mx-auto mb-3" />
        <p className="text-sm text-gray-500">Memuat data...</p>
      </div>
    </div>
  )
}
