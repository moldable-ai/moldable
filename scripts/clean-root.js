#!/usr/bin/env node
import { rmSync } from 'fs'
import { join } from 'path'

const targets = ['.turbo', join('node_modules', '.cache')]

for (const target of targets) {
  rmSync(join(process.cwd(), target), { recursive: true, force: true })
}
