import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Magazzino Olio',
  description: 'Inventario olio multi-magazzino',
  icons: { icon: '/logo-olio-nece.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className={`${inter.className} bg-gradient-to-b from-slate-50 to-slate-100 min-h-screen text-slate-800`}>
        {children}
      </body>
    </html>
  )
}
