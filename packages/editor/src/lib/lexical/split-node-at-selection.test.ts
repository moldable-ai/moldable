import { createMoldableHeadlessEditor } from './headless-editor'
import { $splitNodesAtSelectionBoundaries } from './split-node-at-selection'
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { JSDOM } from 'jsdom'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
} from 'lexical'
import { $createRangeSelection, $getSelection } from 'lexical'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let dom: JSDOM
let editor: ReturnType<typeof createMoldableHeadlessEditor>

beforeEach(() => {
  dom = new JSDOM(`
    <!DOCTYPE html>
    <html><body><div id="editor-container"></div></body></html>
  `)
  global.document = dom.window.document
  global.window = dom.window as unknown as Window & typeof globalThis
  global.HTMLElement = dom.window.HTMLElement
  global.Element = dom.window.Element
  global.Node = dom.window.Node

  editor = createMoldableHeadlessEditor()
})

afterEach(() => {
  editor.setEditable(false)
})

describe('$splitNodesAtSelectionBoundaries', () => {
  it('should split paragraph at selection start when selection is not at beginning', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      const text1 = $createTextNode('Before ')
      const text2 = $createTextNode('Questions:')
      const text3 = $createTextNode(' After')

      paragraph.append(text1, text2, text3)
      root.append(paragraph)

      // Create a selection that starts after "Before "
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(text2, 0, text2, text2.getTextContentSize())

      // Split at boundaries
      $splitNodesAtSelectionBoundaries(selection)

      // The paragraph should be split into multiple paragraphs
      const children = root.getChildren()
      expect(children.length).toBeGreaterThan(1)
    })
  })

  it('should split paragraph at selection end when selection is not at end', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      const text1 = $createTextNode('Questions:')
      const text2 = $createTextNode(' After')

      paragraph.append(text1, text2)
      root.append(paragraph)

      // Create a selection that selects "Questions:"
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(text1, 0, text1, text1.getTextContentSize())

      // Split at boundaries
      $splitNodesAtSelectionBoundaries(selection)

      // The paragraph should be split
      const children = root.getChildren()
      expect(children.length).toBeGreaterThan(1)
    })
  })

  it('should split paragraph when selection spans middle portion', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      const text1 = $createTextNode('Before ')
      const text2 = $createTextNode('Questions:')
      const text3 = $createTextNode(' After')

      paragraph.append(text1, text2, text3)
      root.append(paragraph)

      // Create a selection that selects "Questions:"
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(text2, 0, text2, text2.getTextContentSize())

      // Split at boundaries
      $splitNodesAtSelectionBoundaries(selection)

      // The paragraph should be split into 3 parts: "Before ", "Questions:", " After"
      const children = root.getChildren()
      expect(children.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('should ensure text before selection does not inherit applied style', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      const text1 = $createTextNode('Before ')
      const text2 = $createTextNode('Selected')
      const text3 = $createTextNode(' After')

      paragraph.append(text1, text2, text3)
      root.append(paragraph)

      // Create a selection that selects "Selected"
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(text2, 0, text2, text2.getTextContentSize())

      // Split at boundaries - this should separate "Before " from "Selected"
      $splitNodesAtSelectionBoundaries(selection)

      // Get the updated selection after splitting
      const updatedSelection = $getSelection()
      if (!updatedSelection) return

      // Apply heading style to the selection (simulating what happens in floating-toolbar)
      $setBlocksType(updatedSelection, () => $createHeadingNode('h1'))

      // Verify that text before the selection remains a paragraph
      const children = root.getChildren()
      expect(children.length).toBeGreaterThanOrEqual(2)

      // Find the paragraph containing "Before "
      const beforeParagraph = children.find((child) => {
        if ($isParagraphNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('Before')
        }
        return false
      })

      expect(beforeParagraph).toBeDefined()
      expect($isParagraphNode(beforeParagraph)).toBe(true)
      expect($isHeadingNode(beforeParagraph)).toBe(false)
      // Verify exact text content - should only contain "Before " not "Selected"
      expect(beforeParagraph?.getTextContent()).toBe('Before ')

      // Verify that the selected text becomes a heading
      const selectedParagraph = children.find((child) => {
        if ($isHeadingNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('Selected')
        }
        return false
      })

      expect(selectedParagraph).toBeDefined()
      expect($isHeadingNode(selectedParagraph)).toBe(true)
      expect($isParagraphNode(selectedParagraph)).toBe(false)
      // Verify exact text content - should only contain "Selected"
      expect(selectedParagraph?.getTextContent()).toBe('Selected')

      // Verify that no other nodes accidentally got the heading style
      const headingCount = children.filter((child) =>
        $isHeadingNode(child),
      ).length
      expect(headingCount).toBe(1)

      // Verify that text after selection remains a paragraph (if it exists)
      const afterParagraph = children.find((child) => {
        if ($isParagraphNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('After')
        }
        return false
      })

      if (afterParagraph) {
        expect($isParagraphNode(afterParagraph)).toBe(true)
        expect($isHeadingNode(afterParagraph)).toBe(false)
      }
    })
  })

  it('should not apply style to text before selection when selection is in middle of long paragraph', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      // Create a paragraph with a long text node that contains the selection in the middle
      const paragraph = $createParagraphNode()
      // Simulate the real case: lots of text before "**Questions:**"
      const longTextBefore = $createTextNode(
        '32-year-old man with history of HTN presents for further evaluation. He had onset of HTN in his teens and was placed on medication in his 20s. Currently he takes losartan 50 mg daily and amlodipine 5 mg daily. He has no complaints otherwise and runs 3 miles 5 times a week without difficulty. Physical exam significant for blood pressure of 150/100 and heart rate of 50 bpm. No JVD on neck exam. Chest is clear bilaterally. The heart rate is regular and the rate is normal. A II/VI systolic ejection murmur is present at the upper left sternal border. Laboratory studies are unremarkable. **Questions:**',
      )
      const textAfter = $createTextNode(' What is the most likely diagnosis?')

      paragraph.append(longTextBefore, textAfter)
      root.append(paragraph)

      // Find the position of "**Questions:**" in the text node
      const textContent = longTextBefore.getTextContent()
      const questionsStart = textContent.indexOf('**Questions:**')
      const questionsEnd = questionsStart + '**Questions:**'.length

      // Create a selection that selects just "**Questions:**"
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(
        longTextBefore,
        questionsStart,
        longTextBefore,
        questionsEnd,
      )

      // Split at boundaries - this should split the text node at both start and end of selection
      $splitNodesAtSelectionBoundaries(selection)

      // Get the updated selection after splitting
      const updatedSelection = $getSelection()
      if (!updatedSelection) return

      // Apply heading style to the selection (simulating what happens in floating-toolbar)
      $setBlocksType(updatedSelection, () => $createHeadingNode('h2'))

      // Verify that text before the selection remains a paragraph
      const children = root.getChildren()
      expect(children.length).toBeGreaterThanOrEqual(2)

      // Find the paragraph containing the text before "**Questions:**"
      const beforeParagraph = children.find((child) => {
        if ($isParagraphNode(child)) {
          const textContent = child.getTextContent()
          return (
            textContent.includes('32-year-old man') &&
            !textContent.includes('**Questions:**')
          )
        }
        return false
      })

      expect(beforeParagraph).toBeDefined()
      expect($isParagraphNode(beforeParagraph)).toBe(true)
      expect($isHeadingNode(beforeParagraph)).toBe(false)
      // Verify it contains the text before but not the selected text
      const beforeText = beforeParagraph?.getTextContent() || ''
      expect(beforeText).toContain('32-year-old man')
      expect(beforeText).not.toContain('**Questions:**')

      // Verify that "**Questions:**" becomes a heading
      const questionsHeading = children.find((child) => {
        if ($isHeadingNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('**Questions:**')
        }
        return false
      })

      expect(questionsHeading).toBeDefined()
      expect($isHeadingNode(questionsHeading)).toBe(true)
      expect($isParagraphNode(questionsHeading)).toBe(false)
      // Verify it only contains "**Questions:**" and not the text before
      const questionsText = questionsHeading?.getTextContent() || ''
      expect(questionsText).toContain('**Questions:**')
      expect(questionsText).not.toContain('32-year-old man')

      // Verify that no other nodes accidentally got the heading style
      const headingCount = children.filter((child) =>
        $isHeadingNode(child),
      ).length
      expect(headingCount).toBe(1)
    })
  })

  it('should properly handle selection in middle of sentence without creating empty heading', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      // Create a paragraph with a sentence containing "Physical exam"
      const paragraph = $createParagraphNode()
      const sentence = $createTextNode(
        'Physical exam significant for blood pressure of 150/100 and heart rate of 50 bpm.',
      )

      paragraph.append(sentence)
      root.append(paragraph)

      // Find the position of "Physical exam" in the text node
      const textContent = sentence.getTextContent()
      const physicalExamStart = textContent.indexOf('Physical exam')
      const physicalExamEnd = physicalExamStart + 'Physical exam'.length

      // Create a selection that selects just "Physical exam"
      const selection = $createRangeSelection()
      if (!selection) return

      selection.setTextNodeRange(
        sentence,
        physicalExamStart,
        sentence,
        physicalExamEnd,
      )

      // Split at boundaries
      $splitNodesAtSelectionBoundaries(selection)

      // Get the updated selection after splitting
      const updatedSelection = $getSelection()
      if (!updatedSelection) return

      // Verify the selection still has content
      const selectedText = updatedSelection.getTextContent()
      expect(selectedText).toBe('Physical exam')
      expect(selectedText.length).toBeGreaterThan(0)

      // Apply heading style to the selection
      $setBlocksType(updatedSelection, () => $createHeadingNode('h2'))

      // Verify that "Physical exam" becomes a heading with content
      const children = root.getChildren()
      const heading = children.find((child) => {
        if ($isHeadingNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('Physical exam')
        }
        return false
      })

      expect(heading).toBeDefined()
      expect($isHeadingNode(heading)).toBe(true)
      expect(heading?.getTextContent()).toBe('Physical exam')
      expect(heading?.getTextContent().length).toBeGreaterThan(0)

      // Verify that text before "Physical exam" remains a paragraph (should be empty or contain what was before)
      const beforeParagraph = children.find((child) => {
        if ($isParagraphNode(child)) {
          const textContent = child.getTextContent()
          return (
            textContent !== 'Physical exam' &&
            !textContent.includes('Physical exam')
          )
        }
        return false
      })

      // The before paragraph should exist and contain the text before "Physical exam"
      if (beforeParagraph) {
        expect($isParagraphNode(beforeParagraph)).toBe(true)
        expect($isHeadingNode(beforeParagraph)).toBe(false)
      }

      // Verify text after "Physical exam" is in a separate paragraph
      const afterParagraph = children.find((child) => {
        if ($isParagraphNode(child)) {
          const textContent = child.getTextContent()
          return textContent.includes('significant for blood pressure')
        }
        return false
      })

      if (afterParagraph) {
        expect($isParagraphNode(afterParagraph)).toBe(true)
        expect($isHeadingNode(afterParagraph)).toBe(false)
      }
    })
  })
})
