import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'transforms/index': 'src/transforms/index.ts',
    'transforms/resolve-next-path': 'src/transforms/resolve-next-path.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['jscodeshift'],
})
