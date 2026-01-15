'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  markdownTransformers,
} from './markdown-transformers'
import { $createParagraphNode, $getRoot } from 'lexical'

interface SyncPluginProps {
  value: string
  initialValueRef: React.MutableRefObject<string>
}

/**
 * Plugin that syncs external value changes with the editor.
 * Handles cases where the value prop changes from outside the editor.
 */
export function SyncPlugin({ value, initialValueRef }: SyncPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Skip if this is the initial render or if value matches what we have
    if (value === initialValueRef.current) {
      return
    }

    // Check if the current editor content matches the incoming value
    let currentMarkdown = ''
    editor.read(() => {
      currentMarkdown = $convertToMarkdownString({
        transformers: markdownTransformers,
      })
    })

    // Only update if the value is actually different
    if (currentMarkdown !== value) {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        if (value) {
          $convertFromMarkdownString({
            markdown: value,
            transformers: markdownTransformers,
            node: root,
            shouldPreserveNewLines: true,
          })
        } else {
          root.append($createParagraphNode())
        }
      })
      initialValueRef.current = value
    }
  }, [editor, value, initialValueRef])

  return null
}
