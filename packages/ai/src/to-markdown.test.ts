import { toMarkdown } from './to-markdown'
import { describe, expect, test } from 'vitest'

describe('toMarkdown', () => {
  test('basic conversion', () => {
    const data = {
      title: 'Test Title',
      description: 'Test Description',
    }
    const expected =
      '\n# Title\n\nTest Title\n\n# Description\n\nTest Description'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('with type wrapper', () => {
    const data = {
      title: 'Test Title',
      description: 'Test Description',
    }
    const expected =
      '<begin article>\n\n# Title\n\nTest Title\n\n# Description\n\nTest Description\n</end article>\n'
    expect(toMarkdown(data, { namespace: 'article' })).toBe(expected)
  })

  test('nested structures', () => {
    const data = {
      title: 'Main Article',
      sub_articles: [
        { id: 1, name: 'Sub Article 1', priority: 'high' },
        { id: 2, name: 'Sub Article 2', priority: 'low' },
      ],
      metadata: {
        priority: 'high',
        tags: ['important', 'urgent'],
      },
    }
    const expected =
      '\n# Title\n\nMain Article\n\n' +
      '# Sub Articles\n\n' +
      '<begin sub_articles>\n' +
      '\n# Id\n\n1\n\n' +
      '# Name\n\nSub Article 1\n\n' +
      '# Priority\n\nhigh\n\n' +
      '\n# Id\n\n2\n\n' +
      '# Name\n\nSub Article 2\n\n' +
      '# Priority\n\nlow' +
      '\n</end sub_articles>\n\n' +
      '# Metadata\n\n' +
      '<begin metadata>\n' +
      '\n# Priority\n\nhigh\n\n' +
      '# Tags\n\n  - important\n  - urgent' +
      '\n</end metadata>'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('list conversion', () => {
    const data = [
      { id: 1, title: 'First Item' },
      { id: 2, title: 'Second Item' },
    ]
    const expected =
      '\n# Id\n\n1\n\n' +
      '# Title\n\nFirst Item\n\n' +
      '\n# Id\n\n2\n\n' +
      '# Title\n\nSecond Item'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('array conversion', () => {
    const data = {
      tags: ['important', 'feature', 'urgent'],
      categories: ['frontend', 'backend'],
    }
    const expected =
      '\n# Tags\n\n  - important\n  - feature\n  - urgent\n\n' +
      '# Categories\n\n  - frontend\n  - backend'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('empty array', () => {
    const data = {
      title: 'Test',
      tags: [],
    }
    const expected = '\n# Title\n\nTest\n\n# Tags\n\nNone'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('datetime conversion', () => {
    const dt = new Date('2025-02-24T18:17:33Z')
    const data = {
      title: 'Test',
      created_at: dt,
    }
    const expected =
      '\n# Title\n\nTest\n\n# Created At\n\n2025-02-24T18:17:33.000Z'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('exclude fields', () => {
    const data = {
      title: 'Test Title',
      description: 'Test Description',
      internal_field: 'Should not appear',
    }
    const expected =
      '\n# Title\n\nTest Title\n\n# Description\n\nTest Description'
    expect(toMarkdown(data, { excludeFields: ['internal_field'] })).toBe(
      expected,
    )
  })

  test('handles null values', () => {
    const data = {
      title: 'Test Title',
      description: null,
      summary: 'Test Summary',
    }
    const expected =
      '\n# Title\n\nTest Title\n\n# Description\n\nNone\n\n# Summary\n\nTest Summary'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('empty data', () => {
    const data = {}
    const expected = ''
    expect(toMarkdown(data)).toBe(expected)
  })

  test('snake case conversion', () => {
    const data = {
      test_field_name: 'Test Value',
    }
    const expected = '\n# Test Field Name\n\nTest Value'
    expect(toMarkdown(data)).toBe(expected)
  })

  test('wraps specified fields in tags', () => {
    const data = {
      title: 'Test Title',
      description: '# Some Markdown\n\nWith **formatting**',
      summary: 'Plain text summary',
    }
    const expected =
      '\n# Title\n\nTest Title\n\n' +
      '# Description\n\n' +
      '<begin description>\n' +
      '# Some Markdown\n\n' +
      'With **formatting**\n' +
      '</end description>\n\n' +
      '# Summary\n\nPlain text summary'
    expect(toMarkdown(data, { wrapFields: ['description'] })).toBe(expected)
  })

  test('wraps specified fields in nested objects', () => {
    const data = {
      title: 'Main Article',
      article_details: {
        title: 'Testing 123',
        description: "# Some Markdown\n\n## Yay\n\n- I'm a real boy",
        summary: 'Test summary',
      },
    }
    const expected =
      '<begin document>\n' +
      '\n# Title\n\nMain Article\n\n' +
      '# Article Details\n\n' +
      '<begin article_details>\n' +
      '\n# Title\n\nTesting 123\n\n' +
      '# Description\n\n' +
      '<begin description>\n' +
      '# Some Markdown\n\n' +
      '## Yay\n\n' +
      "- I'm a real boy\n" +
      '</end description>\n\n' +
      '# Summary\n\nTest summary' +
      '\n</end article_details>' +
      '\n</end document>\n'
    expect(
      toMarkdown(data, { namespace: 'document', wrapFields: ['description'] }),
    ).toBe(expected)
  })

  test('only applies namespace at top level', () => {
    const data = {
      title: 'Main Article',
      details: {
        title: 'Sub Article',
        metadata: {
          priority: 'high',
        },
      },
    }
    const expected =
      '<begin document>\n' +
      '\n# Title\n\nMain Article\n\n' +
      '# Details\n\n' +
      '<begin details>\n' +
      '\n# Title\n\nSub Article\n\n' +
      '# Metadata\n\n' +
      '<begin metadata>\n' +
      '\n# Priority\n\nhigh' +
      '\n</end metadata>' +
      '\n</end details>' +
      '\n</end document>\n'
    expect(toMarkdown(data, { namespace: 'document' })).toBe(expected)
  })
})
