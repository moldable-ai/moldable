import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type CodexCliCredential = {
  access: string
  refresh: string
  expires: number
  accountId?: string
  source: 'keychain' | 'file'
}

type CachedValue<T> = {
  value: T | null
  readAt: number
  cacheKey: string
}

const CODEX_CLI_AUTH_FILENAME = 'auth.json'
const CODEX_KEYCHAIN_SERVICE = 'Codex Auth'
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000

let codexCliCache: CachedValue<CodexCliCredential> | null = null

function resolveCodexHomePath(): string {
  const configured = process.env.CODEX_HOME
  const base = configured?.trim()
    ? configured.startsWith('~')
      ? path.join(homedir(), configured.slice(1))
      : configured
    : path.join(homedir(), '.codex')

  try {
    return fs.realpathSync.native(base)
  } catch {
    return base
  }
}

function resolveCodexCliAuthPath(): string {
  return path.join(resolveCodexHomePath(), CODEX_CLI_AUTH_FILENAME)
}

function computeCodexKeychainAccount(codexHome: string): string {
  const hash = createHash('sha256').update(codexHome).digest('hex')
  return `cli|${hash.slice(0, 16)}`
}

function readCodexKeychainCredentials(): CodexCliCredential | null {
  if (process.platform !== 'darwin') return null

  const codexHome = resolveCodexHomePath()
  const account = computeCodexKeychainAccount(codexHome)

  try {
    const secret = execSync(
      `security find-generic-password -s "${CODEX_KEYCHAIN_SERVICE}" -a "${account}" -w`,
      {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim()

    const parsed = JSON.parse(secret) as Record<string, unknown>
    const tokens = parsed.tokens as Record<string, unknown> | undefined
    const accessToken = tokens?.access_token
    const refreshToken = tokens?.refresh_token

    if (typeof accessToken !== 'string' || !accessToken) return null
    if (typeof refreshToken !== 'string' || !refreshToken) return null

    const lastRefreshRaw = parsed.last_refresh
    const lastRefresh =
      typeof lastRefreshRaw === 'string' || typeof lastRefreshRaw === 'number'
        ? new Date(lastRefreshRaw).getTime()
        : Date.now()
    const expires = Number.isFinite(lastRefresh)
      ? lastRefresh + DEFAULT_TOKEN_TTL_MS
      : Date.now() + DEFAULT_TOKEN_TTL_MS

    const accountId =
      typeof tokens?.account_id === 'string' ? tokens.account_id : undefined

    return {
      access: accessToken,
      refresh: refreshToken,
      expires,
      accountId,
      source: 'keychain',
    }
  } catch {
    return null
  }
}

function readCodexFileCredentials(): CodexCliCredential | null {
  const authPath = resolveCodexCliAuthPath()
  let raw: string

  try {
    raw = fs.readFileSync(authPath, 'utf8')
  } catch {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const tokens = parsed.tokens as Record<string, unknown> | undefined
  if (!tokens || typeof tokens !== 'object') return null

  const accessToken = tokens.access_token
  const refreshToken = tokens.refresh_token

  if (typeof accessToken !== 'string' || !accessToken) return null
  if (typeof refreshToken !== 'string' || !refreshToken) return null

  let expires: number
  try {
    const stat = fs.statSync(authPath)
    expires = stat.mtimeMs + DEFAULT_TOKEN_TTL_MS
  } catch {
    expires = Date.now() + DEFAULT_TOKEN_TTL_MS
  }

  return {
    access: accessToken,
    refresh: refreshToken,
    expires,
    accountId:
      typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    source: 'file',
  }
}

export function readCodexCliCredentials(): CodexCliCredential | null {
  return readCodexKeychainCredentials() ?? readCodexFileCredentials()
}

export function readCodexCliCredentialsCached(options?: {
  ttlMs?: number
}): CodexCliCredential | null {
  const ttlMs = options?.ttlMs ?? 0
  const now = Date.now()
  const cacheKey = `${process.platform}|${resolveCodexCliAuthPath()}`

  if (
    ttlMs > 0 &&
    codexCliCache &&
    codexCliCache.cacheKey === cacheKey &&
    now - codexCliCache.readAt < ttlMs
  ) {
    return codexCliCache.value
  }

  const value = readCodexCliCredentials()
  if (ttlMs > 0) {
    codexCliCache = { value, readAt: now, cacheKey }
  }

  return value
}

export function resetCodexCliCacheForTest(): void {
  codexCliCache = null
}
