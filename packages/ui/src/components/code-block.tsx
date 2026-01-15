'use client'

import { memo, useEffect, useState } from 'react'
import { cn } from '../lib/utils'

// Type definitions for shiki (using generic types to avoid import errors when not installed)
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: { lang: string; themes: { light: string; dark: string } },
  ) => string
  getLoadedLanguages: () => string[]
  loadLanguage: (lang: string) => Promise<void>
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null

async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(
      (shiki) =>
        shiki.createHighlighter({
          themes: ['github-dark', 'github-light'],
          langs: [
            'typescript',
            'javascript',
            'tsx',
            'jsx',
            'json',
            'html',
            'css',
            'bash',
            'shell',
            'python',
            'rust',
            'go',
            'sql',
            'yaml',
            'markdown',
            'diff',
          ],
        }) as Promise<ShikiHighlighter>,
    )
  }
  // highlighterPromise is guaranteed to be set at this point
  return highlighterPromise!
}

type CodeBlockProps = {
  code: string
  language?: string
  className?: string
  theme?: 'light' | 'dark'
}

const NonMemoizedCodeBlock = ({
  code,
  language = 'text',
  className,
}: CodeBlockProps) => {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function highlight() {
      try {
        const highlighter = await getHighlighter()
        if (cancelled) return

        // Normalize language name
        const lang = normalizeLanguage(language)

        // Check if language is supported, fallback to plaintext
        const loadedLangs = highlighter.getLoadedLanguages()
        const supportedLang = loadedLangs.includes(lang) ? lang : 'text'

        // If language wasn't loaded and is supported by shiki, try to load it
        if (!loadedLangs.includes(lang) && lang !== 'text') {
          try {
            await highlighter.loadLanguage(lang)
            if (cancelled) return
          } catch {
            // Language not supported, will use plaintext
          }
        }

        const finalLang = highlighter.getLoadedLanguages().includes(lang)
          ? lang
          : supportedLang

        const html = highlighter.codeToHtml(code, {
          lang: finalLang,
          themes: {
            light: 'github-light',
            dark: 'github-dark',
          },
        })

        if (!cancelled) {
          setHighlightedHtml(html)
        }
      } catch (err) {
        console.error('Shiki highlighting failed:', err)
        if (!cancelled) {
          setError(true)
        }
      }
    }

    highlight()

    return () => {
      cancelled = true
    }
  }, [code, language])

  // Fallback: plain code block
  if (error || !highlightedHtml) {
    return (
      <pre
        className={cn(
          'bg-muted text-foreground overflow-x-auto rounded-lg p-4 font-mono text-sm',
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className={cn(
        'shiki-wrapper overflow-x-auto rounded-lg text-sm',
        '[&_pre]:overflow-x-auto [&_pre]:p-4',
        '[&_code]:bg-transparent',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  )
}

/**
 * Normalize common language aliases to shiki's expected names
 */
function normalizeLanguage(lang: string): string {
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    dockerfile: 'docker',
    plaintext: 'text',
    txt: 'text',
  }
  return aliases[lang.toLowerCase()] ?? lang.toLowerCase()
}

export const CodeBlock = memo(
  NonMemoizedCodeBlock,
  (prevProps, nextProps) =>
    prevProps.code === nextProps.code &&
    prevProps.language === nextProps.language &&
    prevProps.className === nextProps.className,
)
