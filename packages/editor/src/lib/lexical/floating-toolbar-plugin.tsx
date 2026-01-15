'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useCallback, useEffect, useState } from 'react'
import { $splitNodesAtSelectionBoundaries } from './split-node-at-selection'
import { $createCodeNode } from '@lexical/code'
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
} from '@lexical/list'
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
} from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  LexicalEditor,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode as createParagraphNode,
} from 'lexical'

export type FloatingToolbarState = {
  isVisible: boolean
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrikethrough: boolean
  isCode: boolean
  blockType: string
  editor: LexicalEditor
  position: { top: number; left: number } | null
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onStrikethrough: () => void
  onCode: () => void
  onParagraph: () => void
  onHeading: (size: 'h1' | 'h2' | 'h3') => void
  onBulletList: () => void
  onNumberedList: () => void
  onCheckList: () => void
  onQuote: () => void
  onCodeBlock: () => void
  onClearFormatting: () => void
}

export function useFloatingToolbar(): FloatingToolbarState {
  const [editor] = useLexicalComposerContext()
  const [isVisible, setIsVisible] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [blockType, setBlockType] = useState('paragraph')
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()

    // Hide toolbar if editor is not editable (read-only mode)
    if (!editor.isEditable()) {
      setIsVisible(false)
      setPosition(null)
      return
    }

    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode()
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow()
      const elementKey = element.getKey()
      const elementDOM = editor.getElementByKey(elementKey)

      // Check if selection is empty (no text selected)
      const isCollapsed = selection.isCollapsed()

      if (elementDOM !== null && !isCollapsed) {
        setIsVisible(true)

        // Update text format states
        setIsBold(selection.hasFormat('bold'))
        setIsItalic(selection.hasFormat('italic'))
        setIsUnderline(selection.hasFormat('underline'))
        setIsStrikethrough(selection.hasFormat('strikethrough'))
        setIsCode(selection.hasFormat('code'))

        // Update block type
        if ($isHeadingNode(element)) {
          const tag = element.getTag()
          setBlockType(tag)
        } else if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType(anchorNode, ListNode)
          const type = parentList
            ? parentList.getListType()
            : element.getListType()
          if (type === 'number') {
            setBlockType('number')
          } else if (type === 'check') {
            setBlockType('check')
          } else {
            setBlockType('bullet')
          }
        } else {
          const type = element.getType()
          if (type === 'quote') {
            setBlockType('quote')
          } else if (type === 'code') {
            setBlockType('code')
          } else {
            setBlockType('paragraph')
          }
        }

        // Calculate position from native selection
        const nativeSelection = window.getSelection()
        const rootElement = editor.getRootElement()

        if (
          nativeSelection !== null &&
          nativeSelection.rangeCount > 0 &&
          rootElement !== null
        ) {
          const range = nativeSelection.getRangeAt(0)
          const rect = range.getBoundingClientRect()

          if (rect.width > 0 || rect.height > 0) {
            // Use fixed positioning relative to viewport
            // Position at start (left) and bottom of selection
            setPosition({
              top: rect.bottom,
              left: rect.left,
            })
          }
        }
      } else {
        setIsVisible(false)
        setPosition(null)
      }
    } else {
      setIsVisible(false)
      setPosition(null)
    }
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar()
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, updateToolbar])

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
  }

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
  }

  const formatUnderline = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')
  }

  const formatStrikethrough = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
  }

  const formatCode = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
  }

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => createParagraphNode())
      }
    })
  }

  const formatHeading = (headingSize: 'h1' | 'h2' | 'h3') => {
    if (blockType !== headingSize) {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          // Split nodes at selection boundaries to ensure we only convert
          // the selected portion, not entire blocks
          $splitNodesAtSelectionBoundaries(selection)

          // Get the updated selection after splitting
          const updatedSelection = $getSelection()
          if ($isRangeSelection(updatedSelection)) {
            // Now apply the heading style - this will only affect blocks
            // that are within or intersect with the selection
            $setBlocksType(updatedSelection, () =>
              $createHeadingNode(headingSize),
            )
          }
        }
      })
    }
  }

  const formatBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
  }

  const formatNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
  }

  const formatCheckList = () => {
    editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
  }

  const formatQuote = () => {
    if (blockType !== 'quote') {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode())
        }
      })
    }
  }

  const formatCodeBlock = () => {
    if (blockType !== 'code') {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createCodeNode())
        }
      })
    }
  }

  const clearFormatting = () => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        // Convert to paragraph if it's a heading, quote, or code block
        const shouldConvertToParagraph =
          blockType !== 'paragraph' &&
          blockType !== 'bullet' &&
          blockType !== 'number'

        if (shouldConvertToParagraph) {
          $setBlocksType(selection, () => createParagraphNode())
        }
      }
    })

    // Dispatch format commands outside the update block
    // Toggle off any active formats
    if (isBold) editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
    if (isItalic) editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
    if (isUnderline) editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')
    if (isStrikethrough)
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
    if (isCode) editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
  }

  return {
    isVisible,
    isBold,
    isItalic,
    isUnderline,
    isStrikethrough,
    isCode,
    blockType,
    editor,
    position,
    onBold: formatBold,
    onItalic: formatItalic,
    onUnderline: formatUnderline,
    onStrikethrough: formatStrikethrough,
    onCode: formatCode,
    onParagraph: formatParagraph,
    onHeading: formatHeading,
    onBulletList: formatBulletList,
    onNumberedList: formatNumberedList,
    onCheckList: formatCheckList,
    onQuote: formatQuote,
    onCodeBlock: formatCodeBlock,
    onClearFormatting: clearFormatting,
  }
}
