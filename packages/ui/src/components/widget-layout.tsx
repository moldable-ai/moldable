'use client'

import { useEffect } from 'react'

interface WidgetLayoutProps {
  children: React.ReactNode
}

/**
 * Shared layout wrapper for widget views.
 * Applies styles to hide scrollbars and prevent overflow.
 */
export function WidgetLayout({ children }: WidgetLayoutProps) {
  useEffect(() => {
    // Apply widget styles to html/body
    const style = document.createElement('style')
    style.id = 'moldable-widget-styles'
    style.textContent = `
      html, body { 
        overflow: hidden !important; 
        height: 100%;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar { 
        display: none; 
      }
    `
    document.head.appendChild(style)

    return () => {
      style.remove()
    }
  }, [])

  return <div className="h-screen overflow-hidden">{children}</div>
}
