'use client'

import {
  Bold,
  ChevronDown,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@moldable-ai/ui'
import {
  type FloatingToolbarState,
  useFloatingToolbar,
} from '../lib/lexical/floating-toolbar-plugin'

export function FloatingToolbar() {
  const [anchorElem] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  )

  if (!anchorElem) return null

  return <FloatingToolbarPortal anchorElem={anchorElem} />
}

function FloatingToolbarPortal({ anchorElem }: { anchorElem: HTMLElement }) {
  const state = useFloatingToolbar()
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || !state.position) {
      return
    }

    toolbar.style.opacity = '1'
    toolbar.style.transform = `translate(${state.position.left}px, ${state.position.top}px)`
  }, [state.position])

  // Handle keyboard shortcuts (undo/redo) when toolbar or its children have focus
  useEffect(() => {
    if (!state.isVisible) return

    const toolbar = toolbarRef.current
    if (!toolbar) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if the active element is within the toolbar
      const activeElement = document.activeElement
      if (!activeElement || !toolbar.contains(activeElement)) {
        return
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const isUndo =
        (isMac ? event.metaKey : event.ctrlKey) &&
        event.key === 'z' &&
        !event.shiftKey
      const isRedo =
        (isMac ? event.metaKey : event.ctrlKey) &&
        ((event.key === 'z' && event.shiftKey) || event.key === 'y')

      if (isUndo || isRedo) {
        event.preventDefault()
        event.stopPropagation()

        // Focus the editor root element so keyboard shortcuts work
        const rootElement = state.editor.getRootElement()
        if (rootElement) {
          rootElement.focus()

          // Dispatch the keyboard event to the editor
          // The HistoryPlugin will handle it automatically
          // We preserve all modifier keys and key properties
          const keyboardEvent = new KeyboardEvent('keydown', {
            key: event.key,
            code: event.code,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            bubbles: true,
            cancelable: true,
          })

          // Use setTimeout to ensure focus has settled before dispatching
          setTimeout(() => {
            rootElement.dispatchEvent(keyboardEvent)
          }, 0)
        }
      }
    }

    // Use capture phase to catch the event before it bubbles
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [state.isVisible, state.editor])

  if (!state.isVisible) {
    return null
  }

  return createPortal(
    <FloatingToolbarUI state={state} ref={toolbarRef} />,
    anchorElem,
  )
}

type FloatingToolbarUIProps = {
  state: FloatingToolbarState
}

const FloatingToolbarUI = React.forwardRef<
  HTMLDivElement,
  FloatingToolbarUIProps
>(({ state }, ref) => {
  const {
    isBold,
    isItalic,
    isUnderline,
    isStrikethrough,
    isCode,
    blockType,
    onBold,
    onItalic,
    onUnderline,
    onStrikethrough,
    onCode,
    onParagraph,
    onHeading,
    onBulletList,
    onNumberedList,
    onCheckList,
    onQuote,
    onCodeBlock,
    onClearFormatting,
  } = state

  const getBlockTypeIcon = () => {
    switch (blockType) {
      case 'h1':
        return <Heading1 className="size-4" />
      case 'h2':
        return <Heading2 className="size-4" />
      case 'h3':
        return <Heading3 className="size-4" />
      case 'bullet':
        return <List className="size-4" />
      case 'number':
        return <ListOrdered className="size-4" />
      case 'check':
        return <ListChecks className="size-4" />
      case 'quote':
        return <Quote className="size-4" />
      case 'code':
        return <Code className="size-4" />
      default:
        return <Type className="size-4" />
    }
  }

  return (
    <div
      ref={ref}
      className="bg-popover fixed left-0 top-0 z-50 flex items-center gap-0.5 rounded-lg border p-1 opacity-0 shadow-md transition-opacity"
      style={{ transform: 'translate(0, 12px)' }}
    >
      {/* Text Type Dropdown */}
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
                {getBlockTypeIcon()}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Text styles</p>
          </TooltipContent>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={onParagraph}
              className={cn(blockType === 'paragraph' && 'relative')}
            >
              {blockType === 'paragraph' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Type className="size-4" />
              <span className="text-muted-foreground ml-2">Text</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onHeading('h1')}
              className={cn(blockType === 'h1' && 'relative')}
            >
              {blockType === 'h1' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Heading1 className="size-4" />
              <span className="text-muted-foreground ml-2">Heading 1</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onHeading('h2')}
              className={cn(blockType === 'h2' && 'relative')}
            >
              {blockType === 'h2' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Heading2 className="size-4" />
              <span className="text-muted-foreground ml-2">Heading 2</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onHeading('h3')}
              className={cn(blockType === 'h3' && 'relative')}
            >
              {blockType === 'h3' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Heading3 className="size-4" />
              <span className="text-muted-foreground ml-2">Heading 3</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onBulletList}
              className={cn(blockType === 'bullet' && 'relative')}
            >
              {blockType === 'bullet' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <List className="size-4" />
              <span className="text-muted-foreground ml-2">Bullet list</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onNumberedList}
              className={cn(blockType === 'number' && 'relative')}
            >
              {blockType === 'number' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <ListOrdered className="size-4" />
              <span className="text-muted-foreground ml-2">Numbered list</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onCheckList}
              className={cn(blockType === 'check' && 'relative')}
            >
              {blockType === 'check' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <ListChecks className="size-4" />
              <span className="text-muted-foreground ml-2">Checklist</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onQuote}
              className={cn(blockType === 'quote' && 'relative')}
            >
              {blockType === 'quote' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Quote className="size-4" />
              <span className="text-muted-foreground ml-2">Block quote</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onCodeBlock}
              className={cn(blockType === 'code' && 'relative')}
            >
              {blockType === 'code' && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Code className="size-4" />
              <span className="text-muted-foreground ml-2">Code block</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>

      <div className="bg-border mx-0.5 h-5 w-px" />

      {/* Bold */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'size-7 p-0',
              isBold && 'bg-accent text-accent-foreground',
            )}
            onClick={onBold}
          >
            <Bold className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Bold</p>
        </TooltipContent>
      </Tooltip>

      {/* Italic */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'size-7 p-0',
              isItalic && 'bg-accent text-accent-foreground',
            )}
            onClick={onItalic}
          >
            <Italic className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Italic</p>
        </TooltipContent>
      </Tooltip>

      {/* Underline Dropdown */}
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 px-2',
                  (isUnderline || isStrikethrough || isCode) &&
                    'bg-accent text-accent-foreground',
                )}
              >
                <Underline className="size-4" />
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>More formatting</p>
          </TooltipContent>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={onUnderline}
              className={cn(isUnderline && 'relative')}
            >
              {isUnderline && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Underline className="size-4" />
              <span className="text-muted-foreground ml-2">Underline</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onStrikethrough}
              className={cn(isStrikethrough && 'relative')}
            >
              {isStrikethrough && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Strikethrough className="size-4" />
              <span className="text-muted-foreground ml-2">Strikethrough</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onCode}
              className={cn(isCode && 'relative')}
            >
              {isCode && (
                <div className="bg-primary absolute -left-1 top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-r-sm" />
              )}
              <Code className="size-4" />
              <span className="text-muted-foreground ml-2">Inline code</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>

      <div className="bg-border mx-0.5 h-5 w-px" />

      {/* Clear Formatting */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={onClearFormatting}
          >
            <Eraser className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Clear formatting</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
})

FloatingToolbarUI.displayName = 'FloatingToolbarUI'
