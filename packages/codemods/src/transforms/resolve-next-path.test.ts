import transform from './resolve-next-path.js'
import jscodeshift from 'jscodeshift'
import { describe, expect, it } from 'vitest'

const j = jscodeshift.withParser('tsx')

function runTransform(source: string, path = 'scripts/moldable-dev.mjs') {
  return transform(
    { source, path },
    { jscodeshift: j, j, stats: () => {}, report: () => {} },
    {},
  )
}

describe('resolve-next-path', () => {
  it('transforms spawn("next", ...) to spawn(nextBin, ...)', () => {
    const input = `import { spawn } from 'node:child_process'
import path from 'node:path'

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--')

const child = spawn(
  'next',
  ['dev', '--turbopack'],
  { stdio: 'inherit' }
)
`

    const output = runTransform(input)

    expect(output).toContain('const nextBin = path.join(')
    expect(output).toContain("process.cwd(), 'node_modules', '.bin', 'next'")
    // Check that spawn uses nextBin (may have newline/indent between spawn( and nextBin)
    expect(output).toMatch(/spawn\(\s*nextBin,/)
    expect(output).not.toMatch(/spawn\(\s*'next',/)
  })

  it('skips already migrated files', () => {
    const input = `import { spawn } from 'node:child_process'
import path from 'node:path'

const forwardedArgs = process.argv.slice(2)
const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next')

const child = spawn(nextBin, ['dev'], { stdio: 'inherit' })
`

    const output = runTransform(input)
    expect(output).toBeNull()
  })

  it('skips non-moldable-dev.mjs files', () => {
    const input = `const child = spawn('next', ['dev'])`
    const output = runTransform(input, 'some-other-file.js')
    expect(output).toBeNull()
  })

  it('skips files without spawn("next", ...)', () => {
    const input = `import { spawn } from 'node:child_process'
const child = spawn('node', ['index.js'])
`
    const output = runTransform(input)
    expect(output).toBeNull()
  })
})
