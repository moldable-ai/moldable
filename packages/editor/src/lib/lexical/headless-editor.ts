import { editorTheme } from './editor-theme'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { HorizontalRuleNode } from '@lexical/extension'
import { createHeadlessEditor } from '@lexical/headless'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'

/**
 * Creates a headless Lexical editor for server-side operations.
 * Use this for translation, content extraction, etc.
 */
export function createMoldableHeadlessEditor() {
  return createHeadlessEditor({
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
    theme: editorTheme,
    onError: (error: Error) => {
      throw error
    },
  })
}
