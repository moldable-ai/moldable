/**
 * Options for converting data to markdown
 */
type ToMarkdownOptions = {
  /**
   * Namespace to wrap the markdown in (e.g. 'data' -> <begin data>...<end data>)
   * Only applied at the top level
   */
  namespace?: string
  /**
   * Fields to exclude from the output
   */
  excludeFields?: string[]
  /**
   * Fields to wrap in begin/end tags (e.g. fields containing markdown)
   */
  wrapFields?: string[]
}

/**
 * Converts an object or array to markdown format.
 * - Handles nested structures recursively
 * - Formats dates as ISO strings
 * - Converts snake_case to Title Case
 * - Shows 'None' for null/undefined/empty values
 * - Supports field exclusion
 * - Can wrap specific fields in begin/end tags to preserve markdown content
 *
 * Examples:
 * ```ts
 * // Object with markdown content
 * toMarkdown({
 *   title: "Main Article",
 *   description: "## Header\n\n- List item",
 * }, { wrapFields: ['description'] })
 * // Output:
 * // # Title
 * // Main Article
 * // # Description
 * // <begin description>
 * // ## Header
 * //
 * // - List item
 * // </end description>
 *
 * // Object with array of primitives
 * toMarkdown({
 *   tags: ["important"]
 * })
 * // Output:
 * // # Tags
 * //   - important

 * ```
 */
export const toMarkdown = (
  data: unknown,
  options: ToMarkdownOptions = {},
  isTopLevel: boolean = true,
): string => {
  if (!data) return ''

  const { namespace, excludeFields = [], wrapFields = [] } = options

  const formatValue = (value: unknown, key?: string): string => {
    if (value === null || value === undefined) return 'None'
    if (value instanceof Date) return value.toISOString()

    if (Array.isArray(value)) {
      if (value.length === 0) return 'None'

      // Format array of objects
      if (value.every((item) => typeof item === 'object' && item !== null)) {
        return `<begin ${key}>\n${toMarkdown(value, { ...options, namespace: undefined }, false)}\n</end ${key}>`
      }

      // Format array of primitives
      return value.map((item) => `  - ${item}`).join('\n')
    }
    if (typeof value === 'object') {
      // Recursively convert nested objects
      const nestedMarkdown = toMarkdown(
        value,
        { ...options, namespace: undefined },
        false,
      )
      return `<begin ${key}>\n${nestedMarkdown}\n</end ${key}>`
    }

    // If this field should be wrapped in tags, preserve the content
    if (key && wrapFields.includes(key)) {
      return `<begin ${key}>\n${value}\n</end ${key}>`
    }

    return String(value) || 'None'
  }

  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          // Convert each object in the array using toMarkdown
          const lines = Object.entries(item)
            .filter(([k]) => !excludeFields.includes(k))
            .map(([k, v]) => `\n# ${toTitleCase(k)}\n\n${formatValue(v, k)}`)
            .join('\n')
          return lines
        }
        return `- ${item}`
      })
      .join('\n\n')
  }

  const lines = Object.entries(data)
    .filter(([key]) => !excludeFields.includes(key))
    .map(([key, value]) => {
      const formattedValue = formatValue(value, key)
      return `\n# ${toTitleCase(key)}\n\n${formattedValue}`
    })
    .filter(Boolean)
    .join('\n')

  if (!lines) return ''
  if (!isTopLevel || !namespace) return lines
  return `<begin ${namespace}>\n${lines}\n</end ${namespace}>\n`
}

const toTitleCase = (str: string): string => {
  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
