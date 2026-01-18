import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function getArgValue(flagA, flagB) {
  const idxA = process.argv.indexOf(flagA)
  if (idxA !== -1 && process.argv[idxA + 1]) return process.argv[idxA + 1]
  if (flagB) {
    const idxB = process.argv.indexOf(flagB)
    if (idxB !== -1 && process.argv[idxB + 1]) return process.argv[idxB + 1]
  }
  return null
}

const port =
  getArgValue('-p', '--port') ??
  process.env.MOLDABLE_PORT ??
  process.env.PORT ??
  null
const hasHostname =
  process.argv.includes('--hostname') || process.argv.includes('-H')

const extraArgs = []
if (!hasHostname) {
  extraArgs.push('--hostname', '127.0.0.1')
}

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--')

const instancesFile = path.join(process.cwd(), '.moldable.instances.json')
let myPid = null

async function readInstances() {
  try {
    const content = await fs.readFile(instancesFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

async function writeInstances(instances) {
  await fs.writeFile(instancesFile, JSON.stringify(instances, null, 2), 'utf8')
}

async function registerInstance(pid, port) {
  const instances = await readInstances()
  instances.push({
    pid,
    port: port ? Number(port) : null,
    startedAt: new Date().toISOString(),
  })
  await writeInstances(instances)
}

async function unregisterInstance(pid) {
  const instances = await readInstances()
  const filtered = instances.filter((i) => i.pid !== pid)
  if (filtered.length === 0) {
    await fs.unlink(instancesFile).catch(() => {})
  } else {
    await writeInstances(filtered)
  }
}

async function cleanup() {
  if (myPid) {
    await unregisterInstance(myPid).catch(() => {})
  }
}

process.on('exit', () => {
  if (myPid) {
    try {
      const content = fsSync.readFileSync(instancesFile, 'utf8')
      const instances = JSON.parse(content)
      const filtered = instances.filter((i) => i.pid !== myPid)
      if (filtered.length === 0) {
        fsSync.unlinkSync(instancesFile)
      } else {
        fsSync.writeFileSync(instancesFile, JSON.stringify(filtered, null, 2))
      }
    } catch {
      // Ignore cleanup errors on exit
    }
  }
})
process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})
process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(143)
})

const child = spawn(
  'next',
  ['dev', '--turbopack', ...forwardedArgs, ...extraArgs],
  {
    env: {
      ...process.env,
      MOLDABLE_APP_ID: '__APP_ID__',
      ...(port ? { MOLDABLE_PORT: port, PORT: port } : {}),
    },
    stdio: 'inherit',
  },
)

if (child.pid) {
  myPid = child.pid
  await registerInstance(child.pid, port)
}

child.on('exit', async (code, signal) => {
  await cleanup()
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
