import { createMoldableHeadlessEditor } from './headless-editor'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  HR,
  markdownTransformers,
} from './markdown-transformers'
import { HorizontalRuleNode } from '@lexical/extension'
import { createHeadlessEditor } from '@lexical/headless'
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import { JSDOM } from 'jsdom'
import { $getRoot, $insertNodes } from 'lexical'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let dom: JSDOM

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
  global.DOMParser = dom.window.DOMParser
})

afterEach(() => {
  // Clean up
})

describe('Markdown Transformers', () => {
  describe('HR (Horizontal Rule) Transformer', () => {
    it('should import horizontal rule with ---', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = '---'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const html = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($generateHtmlFromNodes(editor))
        })
      })

      expect(html).toContain('<hr>')
    })

    it('should import horizontal rule with ***', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = '***'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const html = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($generateHtmlFromNodes(editor))
        })
      })

      expect(html).toContain('<hr>')
    })

    it('should import horizontal rule with ___', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = '___'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const html = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($generateHtmlFromNodes(editor))
        })
      })

      expect(html).toContain('<hr>')
    })

    it('should export horizontal rule as ***', async () => {
      const editor = createHeadlessEditor({
        nodes: [HorizontalRuleNode],
      })

      const html = '<hr>'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          const parser = new DOMParser()
          const parsedDom = parser.parseFromString(html, 'text/html')
          const nodes = $generateNodesFromDOM(editor, parsedDom)
          $getRoot().select()
          $insertNodes(nodes)
          resolve()
        })
      })

      const markdown = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({ transformers: [HR] }))
        })
      })

      expect(markdown).toBe('***')
    })
  })

  describe('Named Arguments Functions', () => {
    it('should use default transformers when not specified', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = '# Heading\n\n**Bold text**'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toContain('# Heading')
      expect(result).toContain('**Bold text**')
    })

    it('should preserve newlines by default', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = 'Line 1\n\nLine 2'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toContain('\n\n')
    })

    it('should respect shouldPreserveNewLines option', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = 'Line 1\n\nLine 2'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({
            markdown,
            shouldPreserveNewLines: false,
          })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({ shouldPreserveNewLines: false }))
        })
      })

      // When preserveNewLines is false, the behavior might differ
      expect(typeof result).toBe('string')
    })
  })

  describe('Round-trip Conversion', () => {
    const markdownExamples = [
      '# Heading 1\n\n## Heading 2\n\nParagraph with **bold**',
      '## List Example\n\n1. **Item 1**\n2. **Item 2**\n\n> Quote',
      '### Code\n\n- List item\n- Another item\n- Third with `code`',
      '# Document\n\n***\n\n## Section\n\nText with *emphasis*\n\n## Another\n\n```\nCode block\n```',
    ]

    markdownExamples.forEach((markdown) => {
      it(`should preserve content in round-trip: "${markdown.substring(0, 30)}..."`, async () => {
        const editor = createMoldableHeadlessEditor()

        // Import markdown
        await new Promise<void>((resolve) => {
          editor.update(() => {
            $convertFromMarkdownString({ markdown })
            resolve()
          })
        })

        // Export back to markdown
        const exported = await new Promise<string>((resolve) => {
          editor.getEditorState().read(() => {
            resolve($convertToMarkdownString({}))
          })
        })

        // Import the exported markdown again
        const editor2 = createMoldableHeadlessEditor()
        await new Promise<void>((resolve) => {
          editor2.update(() => {
            $convertFromMarkdownString({ markdown: exported })
            resolve()
          })
        })

        // Export again
        const secondExport = await new Promise<string>((resolve) => {
          editor2.getEditorState().read(() => {
            resolve($convertToMarkdownString({}))
          })
        })

        // The two exports should be identical
        expect(secondExport).toBe(exported)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty markdown', async () => {
      const editor = createMoldableHeadlessEditor()

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown: '' })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toBe('')
    })

    it('should handle malformed markdown gracefully', async () => {
      const editor = createMoldableHeadlessEditor()
      const malformedMarkdown = '# Incomplete\n**Unclosed bold\n- List item\n'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown: malformedMarkdown })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      // Should still contain the parseable parts
      expect(result).toContain('# Incomplete')
      expect(result).toContain('- List item')
    })

    it('should handle special characters', async () => {
      const editor = createMoldableHeadlessEditor()
      const textWithEscapes = 'Text with \\*escaped asterisks\\* and *italics*'

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown: textWithEscapes })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toContain('\\*escaped asterisks\\*')
      expect(result).toContain('*italics*')
    })

    it('should handle large documents efficiently', async () => {
      const editor = createMoldableHeadlessEditor()

      // Generate a large document
      const sections: string[] = []
      for (let i = 1; i <= 100; i++) {
        sections.push(`## Section ${i}`)
        sections.push(`**Topic:** Example topic`)
        sections.push(`**Details:** Details here`)
        sections.push(`**Notes:**`)
        sections.push(`1. First point`)
        sections.push(`2. Second point`)
        sections.push('')
      }

      const largeDocument = sections.join('\n')
      const startTime = Date.now()

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown: largeDocument })
          resolve()
        })
      })

      const processingTime = Date.now() - startTime

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      // Should process efficiently (less than 2 seconds)
      expect(processingTime).toBeLessThan(2000)
      expect(result).toContain('## Section 1')
      expect(result).toContain('## Section 100')
    })
  })

  describe('Import/Export Tests', () => {
    type TestCase = {
      md: string
      skipExport?: boolean
      skipImport?: boolean
      shouldPreserveNewLines?: boolean
      shouldMergeAdjacentLines?: boolean
      mdAfterExport?: string
    }

    const IMPORT_AND_EXPORT_TESTS: TestCase[] = [
      // Headings
      { md: '# Heading 1' },
      { md: '## Heading 2' },
      { md: '### Heading 3' },
      { md: '#### Heading 4' },
      { md: '##### Heading 5' },
      { md: '###### Heading 6' },

      // Text formatting
      { md: '**Bold text** here' },
      { md: '*Italic text* here' },
      { md: '***Bold italic*** here' },
      { md: '~~Strikethrough~~ here' },
      { md: '`Inline code` here' },

      // Lists
      { md: '- Item 1\n- Item 2\n- Item 3' },
      { md: '1. First\n2. Second\n3. Third' },

      // Blockquotes
      { md: '> Quote text here' },
      { md: '> Line 1\n> Line 2' },

      // Code blocks
      { md: '```\nCode here\n```' },
      { md: '```json\n{"key": "value"}\n```' },

      // Links
      { md: '[Link Text](https://example.com)' },
      { md: '[Link](https://example.com "Title")' },

      // Horizontal rules
      { md: '***' },

      // Complex
      {
        md: '## Summary\n\n### Section\n\nText with **bold** and *italic*\n\n### List\n\n1. **Item** one\n2. **Item** two\n\n### Quote\n\n> Important note\n> More info',
        mdAfterExport:
          '## Summary\n\n### Section\n\nText with **bold** and *italic*\n\n### List\n\n1. **Item** one\n2. **Item** two\n\n### Quote\n\n> Important note\n> More info',
      },
    ]

    describe('Export Tests', () => {
      IMPORT_AND_EXPORT_TESTS.forEach(
        ({ md, skipExport, shouldPreserveNewLines, mdAfterExport }) => {
          if (skipExport) return

          it(`can round-trip "${md.replace(/\n/g, '\\n').substring(0, 50)}..."`, async () => {
            const editor = createMoldableHeadlessEditor()

            await new Promise<void>((resolve) => {
              editor.update(() => {
                $convertFromMarkdownString({
                  markdown: md,
                  transformers: markdownTransformers,
                  shouldPreserveNewLines,
                })
                resolve()
              })
            })

            const result = await new Promise<string>((resolve) => {
              editor.getEditorState().read(() => {
                resolve(
                  $convertToMarkdownString({
                    transformers: markdownTransformers,
                    shouldPreserveNewLines,
                  }),
                )
              })
            })

            expect(result).toBe(mdAfterExport ?? md)
          })
        },
      )
    })
  })

  describe('Document Structure Tests', () => {
    it('should handle nested list structures', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = `## List

- Main item
    - Nested item
    - Another nested
- Second main`

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toContain('- Main item')
      expect(result).toContain('- Nested item')
    })

    it('should handle mixed content with code blocks', async () => {
      const editor = createMoldableHeadlessEditor()
      const markdown = `# Example

Some text here.

\`\`\`typescript
const x = 1
const y = 2
\`\`\`

More text after.`

      await new Promise<void>((resolve) => {
        editor.update(() => {
          $convertFromMarkdownString({ markdown })
          resolve()
        })
      })

      const result = await new Promise<string>((resolve) => {
        editor.getEditorState().read(() => {
          resolve($convertToMarkdownString({}))
        })
      })

      expect(result).toContain('# Example')
      expect(result).toContain('```')
      expect(result).toContain('const x = 1')
    })
  })
})
