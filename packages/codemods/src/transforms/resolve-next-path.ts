/**
 * Codemod: resolve-next-path
 *
 * Fixes moldable-dev.mjs to use a resolved path for the `next` binary
 * instead of relying on PATH containing node_modules/.bin
 *
 * Before:
 * ```js
 * const child = spawn('next', ['dev', ...])
 * ```
 *
 * After:
 * ```js
 * const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next')
 * const child = spawn(nextBin, ['dev', ...])
 * ```
 */
import type { API, FileInfo, Options } from 'jscodeshift'

export const parser = 'tsx'

export default function transformer(
  file: FileInfo,
  api: API,
  _options: Options,
): string | null {
  const j = api.jscodeshift

  // Only process moldable-dev.mjs files
  if (!file.path.endsWith('moldable-dev.mjs')) {
    return null
  }

  const root = j(file.source)

  // Check if already transformed (has nextBin variable)
  const existingNextBin = root.find(j.VariableDeclarator, {
    id: { name: 'nextBin' },
  })
  if (existingNextBin.length > 0) {
    return null // Already migrated
  }

  // Find spawn calls with 'next' as first argument
  const spawnCalls = root.find(j.CallExpression, {
    callee: { name: 'spawn' },
    arguments: (args: unknown[]) =>
      args.length > 0 &&
      (args[0] as { type: string; value?: string }).type === 'StringLiteral' &&
      (args[0] as { value: string }).value === 'next',
  })

  if (spawnCalls.length === 0) {
    return null // No spawn('next', ...) calls found
  }

  // Find the forwardedArgs declaration to insert after it
  const forwardedArgsDecl = root.find(j.VariableDeclaration, {
    declarations: (decls: unknown[]) =>
      decls.some(
        (d) => (d as { id: { name?: string } }).id?.name === 'forwardedArgs',
      ),
  })

  if (forwardedArgsDecl.length === 0) {
    // Fallback: insert at the top after imports
    const lastImport = root.find(j.ImportDeclaration).at(-1)
    if (lastImport.length > 0) {
      lastImport.insertAfter(
        j.variableDeclaration('const', [
          j.variableDeclarator(
            j.identifier('nextBin'),
            j.callExpression(
              j.memberExpression(j.identifier('path'), j.identifier('join')),
              [
                j.callExpression(
                  j.memberExpression(
                    j.identifier('process'),
                    j.identifier('cwd'),
                  ),
                  [],
                ),
                j.stringLiteral('node_modules'),
                j.stringLiteral('.bin'),
                j.stringLiteral('next'),
              ],
            ),
          ),
        ]),
      )
    }
  } else {
    // Insert after forwardedArgs declaration
    forwardedArgsDecl.insertAfter(
      // Add a comment explaining why
      j.variableDeclaration('const', [
        j.variableDeclarator(
          j.identifier('nextBin'),
          j.callExpression(
            j.memberExpression(j.identifier('path'), j.identifier('join')),
            [
              j.callExpression(
                j.memberExpression(
                  j.identifier('process'),
                  j.identifier('cwd'),
                ),
                [],
              ),
              j.stringLiteral('node_modules'),
              j.stringLiteral('.bin'),
              j.stringLiteral('next'),
            ],
          ),
        ),
      ]),
    )
  }

  // Replace spawn('next', ...) with spawn(nextBin, ...)
  spawnCalls.forEach((path) => {
    const args = path.node.arguments
    if (args.length > 0) {
      args[0] = j.identifier('nextBin')
    }
  })

  return root.toSource({ quote: 'single' })
}
