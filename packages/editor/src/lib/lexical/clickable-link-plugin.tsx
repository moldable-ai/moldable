'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { $isLinkNode } from '@lexical/link'
import { $findMatchingParent, isHTMLAnchorElement } from '@lexical/utils'
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  getNearestEditorFromDOMNode,
  isDOMNode,
} from 'lexical'

/**
 * Validates if a URL is safe to open externally.
 * Only allows http, https, and mailto protocols.
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    const allowedProtocols = ['http:', 'https:', 'mailto:']
    return allowedProtocols.includes(parsedUrl.protocol)
  } catch {
    return false
  }
}

function findMatchingDOM<T extends Node>(
  startNode: Node,
  predicate: (node: Node) => node is T,
): T | null {
  let node: Node | null = startNode
  while (node != null) {
    if (predicate(node)) {
      return node
    }
    node = node.parentNode
  }
  return null
}

/**
 * Plugin that makes links clickable in the editor.
 * Opens links in a new tab with security checks.
 */
export function ClickableLinkPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!isDOMNode(target)) {
        return
      }
      const nearestEditor = getNearestEditorFromDOMNode(target)

      if (nearestEditor === null) {
        return
      }

      let url: string | null = null
      nearestEditor.update(() => {
        const clickedNode = $getNearestNodeFromDOMNode(target)
        if (clickedNode !== null) {
          const maybeLinkNode = $findMatchingParent(clickedNode, $isElementNode)
          if ($isLinkNode(maybeLinkNode)) {
            url = maybeLinkNode.sanitizeUrl(maybeLinkNode.getURL())
          } else {
            const a = findMatchingDOM(target, isHTMLAnchorElement)
            if (a !== null) {
              url = a.href
            }
          }
        }
      })

      if (url === null || url === '') {
        return
      }

      // Allow user to select link text without following url
      const selection = editor.getEditorState().read($getSelection)
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        event.preventDefault()
        return
      }

      event.preventDefault()

      if (!isUrlSafe(url)) {
        console.warn(`Blocked potentially unsafe URL: ${url}`)
        return
      }

      const isMiddle = event.type === 'auxclick' && event.button === 1
      window.open(
        url,
        isMiddle || event.metaKey || event.ctrlKey ? '_blank' : '_blank',
        'noopener,noreferrer',
      )
    }

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        onClick(event)
      }
    }

    return editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement !== null) {
        prevRootElement.removeEventListener('click', onClick)
        prevRootElement.removeEventListener('mouseup', onMouseUp)
      }
      if (rootElement !== null) {
        rootElement.addEventListener('click', onClick)
        rootElement.addEventListener('mouseup', onMouseUp)
      }
    })
  }, [editor])

  return null
}
