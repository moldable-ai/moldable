import {
  $createParagraphNode,
  $isParagraphNode,
  $isTextNode,
  ElementNode,
  LexicalNode,
  RangeSelection,
} from 'lexical'

/**
 * Splits nodes at the selection boundaries to ensure block-level formatting
 * (like headings) only affects the selected portion, not entire blocks.
 *
 * @param selection The range selection to split nodes for
 */
export function $splitNodesAtSelectionBoundaries(
  selection: RangeSelection,
): void {
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()

  // Get the top-level element nodes
  const anchorElement =
    anchorNode.getKey() === 'root'
      ? anchorNode
      : anchorNode.getTopLevelElementOrThrow()
  const focusElement =
    focusNode.getKey() === 'root'
      ? focusNode
      : focusNode.getTopLevelElementOrThrow()

  const anchorOffset = selection.anchor.offset
  const focusOffset = selection.focus.offset

  // Split paragraph at anchor (start of selection) if needed
  // We need to split if there's content before the selection start
  if ($isParagraphNode(anchorElement) && $isTextNode(anchorNode)) {
    const shouldSplitAtAnchor =
      anchorOffset > 0 ||
      (anchorOffset === 0 && anchorElement.getFirstChild() !== anchorNode)

    if (shouldSplitAtAnchor) {
      // If anchor and focus are in the same text node, we need to handle the focus offset
      // after splitting because splitText will modify the original node
      const anchorAndFocusInSameNode =
        anchorNode === focusNode && $isTextNode(anchorNode)
      const originalFocusOffset = focusOffset

      const splitNode = $splitParagraphAtTextOffset(
        anchorElement,
        anchorNode,
        anchorOffset,
      )

      // After splitting at anchor, the focus node might have moved to a new paragraph
      // Re-evaluate the focus element and node
      let updatedFocusNode = selection.focus.getNode()
      let updatedFocusOffset = selection.focus.offset

      // If anchor and focus were in the same node, we need to adjust the focus
      // because splitText creates a new node for text after the split point
      if (
        anchorAndFocusInSameNode &&
        anchorOffset < originalFocusOffset &&
        splitNode &&
        $isTextNode(splitNode)
      ) {
        // The focus is now in the split node (the new node created by splitText)
        // Calculate the adjusted offset
        const adjustedOffset = originalFocusOffset - anchorOffset
        const splitNodeText = splitNode.getTextContent()
        if (adjustedOffset >= 0 && adjustedOffset <= splitNodeText.length) {
          updatedFocusNode = splitNode
          updatedFocusOffset = adjustedOffset
          // Update the selection to point to the correct node
          selection.focus.set(
            updatedFocusNode.getKey(),
            updatedFocusOffset,
            'text',
          )
        }
      }

      const updatedFocusElement =
        updatedFocusNode.getKey() === 'root'
          ? updatedFocusNode
          : updatedFocusNode.getTopLevelElementOrThrow()

      // Now split at focus using the updated references
      if (
        $isParagraphNode(updatedFocusElement) &&
        $isTextNode(updatedFocusNode)
      ) {
        const focusTextNodeSize = updatedFocusNode.getTextContentSize()
        const paragraphChildren = updatedFocusElement.getChildren()
        const focusNodeIndex = paragraphChildren.indexOf(updatedFocusNode)
        const isFocusAtEndOfTextNode = updatedFocusOffset === focusTextNodeSize
        const hasNodesAfterFocus = focusNodeIndex < paragraphChildren.length - 1

        const shouldSplitAtFocus =
          updatedFocusOffset < focusTextNodeSize ||
          (isFocusAtEndOfTextNode && hasNodesAfterFocus)

        if (shouldSplitAtFocus) {
          // Split at focus - this will move content after focus to a new paragraph
          // The selected text (from 0 to updatedFocusOffset) remains in updatedFocusNode
          $splitParagraphAtTextOffset(
            updatedFocusElement,
            updatedFocusNode,
            updatedFocusOffset,
          )

          // After splitting at focus, updatedFocusNode contains text from 0 to updatedFocusOffset
          // This is the selected text - update the selection to point to it
          if (anchorAndFocusInSameNode && $isTextNode(updatedFocusNode)) {
            selection.anchor.set(updatedFocusNode.getKey(), 0, 'text')
            selection.focus.set(
              updatedFocusNode.getKey(),
              updatedFocusOffset,
              'text',
            )
          }
        } else if (anchorAndFocusInSameNode && $isTextNode(updatedFocusNode)) {
          // No split at focus needed - selection already points to the right node
          // Just ensure anchor is at the start
          selection.anchor.set(updatedFocusNode.getKey(), 0, 'text')
          selection.focus.set(
            updatedFocusNode.getKey(),
            updatedFocusOffset,
            'text',
          )
        }
      }
      return
    }
  }

  // If anchor and focus are in different elements, split both
  if (anchorElement !== focusElement) {
    if ($isParagraphNode(focusElement)) {
      // Check if we need to split at focus
      // We need to split if:
      // 1. The focus offset is not at the end of the text node, OR
      // 2. The focus node is not the last child of the paragraph (there's content after it)
      const focusTextNodeSize = $isTextNode(focusNode)
        ? focusNode.getTextContentSize()
        : 0
      const isFocusAtEndOfTextNode = focusOffset === focusTextNodeSize
      const isFocusLastChild = focusElement.getLastChild() === focusNode
      const shouldSplitAtFocus =
        focusOffset < focusTextNodeSize ||
        (isFocusAtEndOfTextNode && !isFocusLastChild)

      if (
        shouldSplitAtFocus &&
        focusOffset <= focusElement.getTextContentSize()
      ) {
        $splitParagraphAtTextOffset(focusElement, focusNode, focusOffset)
      }
    }
  } else {
    // Same element and we didn't split at anchor - we need to split at focus
    if ($isParagraphNode(focusElement) && $isTextNode(focusNode)) {
      // Check if we need to split at focus
      // We split if there's content after the focus point
      const focusTextNodeSize = focusNode.getTextContentSize()
      const paragraphChildren = focusElement.getChildren()
      const focusNodeIndex = paragraphChildren.indexOf(focusNode)
      const isFocusAtEndOfTextNode = focusOffset === focusTextNodeSize
      const hasNodesAfterFocus = focusNodeIndex < paragraphChildren.length - 1

      const shouldSplitAtFocus =
        focusOffset < focusTextNodeSize ||
        (isFocusAtEndOfTextNode && hasNodesAfterFocus)

      if (shouldSplitAtFocus) {
        $splitParagraphAtTextOffset(focusElement, focusNode, focusOffset)
      }
    }
  }
}

/**
 * Splits a paragraph node at a specific text offset.
 * Creates a new paragraph node and moves the content after the offset to it.
 *
 * @param paragraph The paragraph element to split
 * @param textNode The text node containing the offset
 * @param offset The text offset at which to split
 * @returns The first text node in the new paragraph (the split node), or null if no split occurred
 */
function $splitParagraphAtTextOffset(
  paragraph: ElementNode,
  textNode: LexicalNode,
  offset: number,
): LexicalNode | null {
  if (!$isParagraphNode(paragraph)) {
    return null
  }

  if (!$isTextNode(textNode)) {
    return null
  }

  const children = paragraph.getChildren()
  const textNodeIndex = children.indexOf(textNode)
  if (textNodeIndex === -1) {
    return null
  }

  const textNodeSize = textNode.getTextContentSize()

  // If offset is 0 and text node is not the first child, split before the text node
  if (offset === 0 && textNodeIndex > 0) {
    const newParagraph = $createParagraphNode()
    // Move this text node and all subsequent nodes to the new paragraph
    for (let i = textNodeIndex; i < children.length; i++) {
      const node = children[i]
      if (node) {
        node.remove()
        newParagraph.append(node)
      }
    }
    paragraph.insertAfter(newParagraph)
    // Return the first text node in the new paragraph
    const newParagraphChildren = newParagraph.getChildren()
    return newParagraphChildren.find((node) => $isTextNode(node)) || null
  }

  // If offset is at the end of the text node, we need to split after the text node
  if (offset === textNodeSize) {
    // Check if there are nodes after this text node
    if (textNodeIndex < children.length - 1) {
      const newParagraph = $createParagraphNode()
      // Move all nodes after the text node to the new paragraph
      for (let i = textNodeIndex + 1; i < children.length; i++) {
        const node = children[i]
        if (node) {
          node.remove()
          newParagraph.append(node)
        }
      }
      paragraph.insertAfter(newParagraph)
      // Return the first text node in the new paragraph
      const newParagraphChildren = newParagraph.getChildren()
      return newParagraphChildren.find((node) => $isTextNode(node)) || null
    }
    return null
  }

  // Split the text node if offset is within the text node
  if (offset > 0 && offset < textNodeSize) {
    const splitNodes = textNode.splitText(offset)
    if (splitNodes.length === 0) {
      return null
    }

    // The split node is the first node in splitNodes (the part after the split)
    const splitTextNode = splitNodes[0]
    if (!splitTextNode) {
      return null
    }

    // Create a new paragraph and move all nodes after the split point to it
    const newParagraph = $createParagraphNode()

    // Get all nodes from the paragraph that should move to the new paragraph
    const nodesToMove: LexicalNode[] = []
    const updatedChildren = paragraph.getChildren()

    // Find the first node that should be moved (the split text node)
    for (let i = 0; i < updatedChildren.length; i++) {
      const child = updatedChildren[i]
      if (child === splitTextNode) {
        // Found the split point - move this node and all subsequent nodes
        for (let j = i; j < updatedChildren.length; j++) {
          const nodeToMove = updatedChildren[j]
          if (nodeToMove) {
            nodesToMove.push(nodeToMove)
          }
        }
        break
      }
    }

    // Move nodes to the new paragraph
    if (nodesToMove.length > 0) {
      nodesToMove.forEach((node) => {
        node.remove()
        newParagraph.append(node)
      })

      // Insert the new paragraph after the original paragraph
      paragraph.insertAfter(newParagraph)
      return splitTextNode
    }
  }

  return null
}
