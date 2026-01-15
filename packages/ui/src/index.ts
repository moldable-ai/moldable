// Export utilities
export { cn } from './lib/utils'

// Export theme
export { ThemeProvider, useTheme, themeScript, type Theme } from './lib/theme'

// Export workspace
export {
  WorkspaceProvider,
  useWorkspace,
  WORKSPACE_HEADER,
} from './lib/workspace'

// Export commands
export {
  useMoldableCommands,
  useMoldableCommand,
  isInMoldable,
  sendToMoldable,
  type AppCommand,
  type CommandAction,
  type CommandsResponse,
  type CommandMessage,
} from './lib/commands'

// Export UI components
export * from './components/ui'

// Export hooks
export { useIsMobile } from './hooks/use-mobile'

// Export Markdown
export { Markdown } from './components/markdown'

// Export CodeBlock
export { CodeBlock } from './components/code-block'

// Export WidgetLayout
export { WidgetLayout } from './components/widget-layout'

// Export chat components
export * from './components/chat'
