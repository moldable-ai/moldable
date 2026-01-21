/**
 * Codemod 001: resolve-next-path
 *
 * Fixes moldable-dev.mjs to use a resolved path for the `next` binary
 * instead of relying on PATH containing node_modules/.bin.
 * Also adds a guard to check the binary exists before spawning.
 *
 * Before:
 *   spawn('next', ['dev', ...])
 *
 * After:
 *   const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next')
 *   if (!fsSync.existsSync(nextBin)) { ... exit with clear error ... }
 *   spawn(nextBin, ['dev', ...])
 */

export const id = '001-resolve-next-path'
export const description =
  'Fix moldable-dev.mjs to use resolved path for next binary with existence check'

/**
 * Files to transform (relative to app root)
 */
export const files = ['scripts/moldable-dev.mjs']

/**
 * Check if this codemod should run on the given file content
 */
export function shouldTransform(content) {
  // Skip if already has the existence check
  if (content.includes('fsSync.existsSync(nextBin)')) {
    return false
  }
  // Run if using bare 'next' command OR has nextBin but no guard
  if (
    content.includes("spawn('next',") ||
    content.includes("spawn(\n  'next',")
  ) {
    return true
  }
  // Also run if has nextBin definition but missing the guard
  if (
    content.includes('const nextBin = path.join(') &&
    !content.includes('fsSync.existsSync(nextBin)')
  ) {
    return true
  }
  return false
}

/**
 * Transform the file content
 */
export function transform(content) {
  let result = content

  const nextBinDecl =
    "// Resolve the path to `next` binary - can't rely on PATH including node_modules/.bin\nconst nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next')"

  const nextBinGuard = `
// Check that next binary exists before trying to spawn
if (!fsSync.existsSync(nextBin)) {
  console.error(\`Error: next binary not found at \${nextBin}\`)
  console.error('Run "pnpm install" to install dependencies.')
  process.exit(1)
}`

  // Check if nextBin declaration already exists
  const hasNextBin = result.includes('const nextBin = path.join(')
  const hasGuard = result.includes('fsSync.existsSync(nextBin)')

  if (!hasNextBin) {
    // Need to add nextBin declaration
    const anchor =
      "const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--')"
    const anchorIndex = result.indexOf(anchor)

    if (anchorIndex === -1) {
      // Try alternative anchor
      const altAnchor = 'const forwardedArgs = process.argv.slice(2)'
      const altIndex = result.indexOf(altAnchor)
      if (altIndex === -1) {
        throw new Error('Could not find anchor point for nextBin declaration')
      }
      const lineEnd = result.indexOf('\n', altIndex)
      result =
        result.slice(0, lineEnd) +
        '\n\n' +
        nextBinDecl +
        nextBinGuard +
        result.slice(lineEnd)
    } else {
      const insertPos = anchorIndex + anchor.length
      result =
        result.slice(0, insertPos) +
        '\n\n' +
        nextBinDecl +
        nextBinGuard +
        result.slice(insertPos)
    }
  } else if (!hasGuard) {
    // Has nextBin but missing guard - add guard after nextBin declaration
    const nextBinLine =
      "const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next')"
    const nextBinIndex = result.indexOf(nextBinLine)
    if (nextBinIndex !== -1) {
      const insertPos = nextBinIndex + nextBinLine.length
      result =
        result.slice(0, insertPos) + nextBinGuard + result.slice(insertPos)
    }
  }

  // Replace spawn('next', with spawn(nextBin,
  result = result.replace(/spawn\(\n\s*'next',/g, 'spawn(\n  nextBin,')
  result = result.replace(/spawn\('next',/g, 'spawn(nextBin,')

  return result
}
