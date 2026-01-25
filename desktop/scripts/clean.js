#!/usr/bin/env node
import { rmSync } from 'fs'
import { join } from 'path'
import process from 'process'

const targets = ['dist', '.turbo', join('src-tauri', 'target')]

for (const target of targets) {
  rmSync(join(process.cwd(), target), { recursive: true, force: true })
}
