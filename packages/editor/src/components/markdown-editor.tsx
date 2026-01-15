'use client'

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { useCallback, useRef } from 'react'
import { cn } from '@moldable-ai/ui'
import { LINK_MATCHERS } from '../lib/lexical/auto-link-config'
import { ClickableLinkPlugin } from '../lib/lexical/clickable-link-plugin'
import { editorTheme } from '../lib/lexical/editor-theme'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  markdownTransformers,
} from '../lib/lexical/markdown-transformers'
import { SyncPlugin } from '../lib/lexical/sync-plugin'
import { FloatingToolbar } from './floating-toolbar'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { HorizontalRuleNode } from '@lexical/extension'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $createParagraphNode, $getRoot, EditorState } from 'lexical'

// ============================================================================
// Editor Component
// ============================================================================

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  contentClassName?: string
  minHeight?: string
  maxHeight?: string
  hideMarkdownHint?: boolean
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  disabled = false,
  autoFocus = false,
  className,
  contentClassName,
  minHeight = '150px',
  maxHeight = '50vh',
  hideMarkdownHint = false,
}: MarkdownEditorProps) {
  const initialValueRef = useRef(value)

  const initialConfig = {
    namespace: 'MarkdownEditor',
    editorState: () => {
      const root = $getRoot()
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
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      AutoLinkNode,
      LinkNode,
      HorizontalRuleNode,
    ],
    onError: (error: Error) => {
      console.error('MarkdownEditor error:', error)
    },
    theme: editorTheme,
    editable: !disabled,
  }

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        // Use shouldPreserveNewLines: true to preserve empty paragraphs as extra newlines
        const markdown = $convertToMarkdownString({
          transformers: markdownTransformers,
          shouldPreserveNewLines: true,
        })
        // Only call onChange if the value actually changed
        if (markdown !== initialValueRef.current) {
          initialValueRef.current = markdown
          onChange(markdown)
        }
      })
    },
    [onChange],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        className={cn('relative h-full', className)}
        data-lexical-editor-container
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={cn(
                'prose prose-sm caret-primary dark:prose-invert max-w-none resize-none overflow-auto bg-transparent outline-none',
                disabled && 'cursor-not-allowed opacity-50',
                contentClassName,
              )}
              style={{ minHeight, maxHeight }}
              aria-placeholder={placeholder}
              data-lexical-editor="true"
              placeholder={
                <div className="text-muted-foreground pointer-events-none absolute left-0 top-1 text-sm opacity-75">
                  {placeholder}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        {autoFocus && <AutoFocusPlugin />}
        <ListPlugin />
        <CheckListPlugin />
        <TabIndentationPlugin />
        <LinkPlugin />
        <AutoLinkPlugin matchers={LINK_MATCHERS} />
        <ClickableLinkPlugin />
        <FloatingToolbar />
        <MarkdownShortcutPlugin transformers={markdownTransformers} />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        <SyncPlugin value={value} initialValueRef={initialValueRef} />
        {!hideMarkdownHint && (
          <div className="mt-1 flex justify-end">
            <span className="text-muted-foreground/60 text-xs">
              Markdown supported
            </span>
          </div>
        )}
      </div>
    </LexicalComposer>
  )
}
