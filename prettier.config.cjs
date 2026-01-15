const path = require('node:path')

/** @type {import('prettier').Config} */
module.exports = {
  semi: false,
  trailingComma: 'all',
  singleQuote: true,
  endOfLine: 'lf',
  plugins: [
    require.resolve('@trivago/prettier-plugin-sort-imports'),
    require.resolve('prettier-plugin-tailwindcss'),
  ],
  tailwindStylesheet: path.resolve(
    __dirname,
    'packages/ui/src/styles/index.css',
  ),
  importOrder: [
    'react',
    '^react-.*$',
    '^next',
    '^next-.*$',
    '^next/.*$',
    '^@moldable-ai/.*$',
    '^.*/lib/.*$',
    '^.*/hooks/.*$',
    '^.*/components/.*$',
    '^[./]',
    '.*',
  ],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
}
