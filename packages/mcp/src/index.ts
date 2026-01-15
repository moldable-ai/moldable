// Types
export type {
  McpConfig,
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpToolInfo,
  StdioServerConfig,
  HttpServerConfig,
  SseServerConfig,
} from './types.js'

export {
  McpConfigSchema,
  McpServerConfigSchema,
  StdioServerConfigSchema,
  HttpServerConfigSchema,
  SseServerConfigSchema,
} from './types.js'

// Config management
export {
  getDefaultConfigPath,
  loadMcpConfig,
  saveMcpConfig,
  addMcpServer,
  removeMcpServer,
  getMcpServer,
  listMcpServers,
  expandEnvVars,
  expandServerConfig,
} from './config.js'

// Client management
export {
  McpClientManager,
  getDefaultMcpManager,
  resetDefaultMcpManager,
  type McpClientEvent,
  type McpClientEventListener,
} from './client.js'

// Tool conversion
export {
  mcpToolToAiTool,
  createMcpTools,
  getMcpToolDescriptions,
} from './tools.js'

// MCPB Bundle support
export {
  // Types
  type McpbManifest,
  type McpbBundleInfo,
  type UserConfigField,
  type UserConfigValues,
  // Schemas
  McpbManifestSchema,
  // Functions
  parseManifest,
  checkCompatibility,
  expandMcpbVariables,
  generateServerConfig,
  installBundleFromExtracted,
  getMcpbInstallDir,
  getBundleInstallPath,
  isBundleInstalled,
  readInstalledManifest,
  getDefaultUserConfigValues,
  validateUserConfig,
} from './bundle.js'

// Path resolution utilities
export { resolveExecutablePath, getAugmentedPath } from './paths.js'
