import type { Metadata } from 'next'
import Script from 'next/script'
import { ThemeProvider, WorkspaceProvider, themeScript } from '@moldable-ai/ui'
import { QueryProvider } from '@/lib/query-provider'
import './globals.css'

export const metadata: Metadata = {
  title: '__APP_NAME__',
  description: '__APP_DESCRIPTION__',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Script id="theme-script" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <ThemeProvider>
          <WorkspaceProvider>
            <QueryProvider>{children}</QueryProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
