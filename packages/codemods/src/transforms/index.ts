/**
 * Registry of all available transforms
 */

export const TRANSFORMS = {
  'resolve-next-path': {
    name: 'resolve-next-path',
    description:
      'Fix moldable-dev.mjs to use resolved path for next binary instead of relying on PATH',
    version: 1,
    // Which files this transform should run on (glob pattern relative to app root)
    files: ['scripts/moldable-dev.mjs'],
  },
} as const

export type TransformName = keyof typeof TRANSFORMS
