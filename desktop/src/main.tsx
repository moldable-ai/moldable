import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@moldable-ai/ui'
import { App } from './app'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
