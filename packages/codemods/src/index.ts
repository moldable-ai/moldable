/**
 * @moldable-ai/codemods
 *
 * Codemods for Moldable app migrations.
 * Similar to @next/codemod, these transform app code when
 * upgrading to newer versions of Moldable.
 */

export { run, runOnApp } from './runner.js'
export { TRANSFORMS, type TransformName } from './transforms/index.js'
