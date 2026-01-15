import type { HmrContext, Plugin } from 'vite'

/**
 * Vite plugin that intercepts HMR updates and sends a custom event
 * instead of auto-reloading, allowing the app to show a notification
 * and let the user decide when to reload.
 */
export function manualReloadPlugin(): Plugin {
  return {
    name: 'manual-reload',

    // Intercept HMR updates
    handleHotUpdate(ctx: HmrContext) {
      const { server, file } = ctx

      // Get relative path for nicer display
      const relativePath = file.replace(ctx.server.config.root + '/', '')

      // Send custom event to client instead of applying HMR
      server.ws.send({
        type: 'custom',
        event: 'moldable:update-available',
        data: {
          file: relativePath,
          timestamp: Date.now(),
        },
      })

      // Return empty array to prevent default HMR behavior
      // This stops Vite from auto-updating modules
      return []
    },
  }
}
