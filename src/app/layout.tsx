import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Roti Bakar Ngeunah - Sales & Cashflow',
  description: 'Sistem internal manajemen penjualan dan arus kas Roti Bakar Ngeunah',
  icons: {
    icon: [
      {
        url: '/rbngeunahicon.webp',
        type: 'image/webp',
      },
    ],
    shortcut: '/rbngeunahicon.webp',
    apple: '/rbngeunahicon.webp',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
