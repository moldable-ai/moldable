// Components
export { MarkdownEditor } from './components/markdown-editor'
export { FloatingToolbar } from './components/floating-toolbar'

// Lexical utilities (for advanced use cases)
export {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  markdownTransformers,
  HR,
} from './lib/lexical/markdown-transformers'
export { editorTheme } from './lib/lexical/editor-theme'
export {
  LINK_MATCHERS,
  URL_REGEX,
  EMAIL_REGEX,
} from './lib/lexical/auto-link-config'
export {
  useFloatingToolbar,
  type FloatingToolbarState,
} from './lib/lexical/floating-toolbar-plugin'
export { SyncPlugin } from './lib/lexical/sync-plugin'
export {
  ClickableLinkPlugin,
  isUrlSafe,
} from './lib/lexical/clickable-link-plugin'

// Headless editor for server-side operations
export { createMoldableHeadlessEditor } from './lib/lexical/headless-editor'
