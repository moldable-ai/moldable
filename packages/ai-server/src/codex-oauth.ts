import fs from 'node:fs'
import path from 'node:path'

type IdTokenClaims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

export type CodexOAuthTokens = {
  access: string
  refresh: string
  expires: number
  accountId?: string
}

type CodexOAuthCacheFile = {
  access_token: string
  refresh_token: string
  expires_at: number
  account_id?: string
  updated_at?: string
}

type CodexTokenResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

const CODEX_OAUTH_CACHE_FILENAME = 'codex-oauth.json'
const CODEX_OAUTH_ISSUER = 'https://auth.openai.com'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60

function resolveCodexOAuthCachePath(moldableHome: string): string {
  return path.join(moldableHome, 'shared', CODEX_OAUTH_CACHE_FILENAME)
}

function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = parts[1]
    if (!payload) return undefined
    const json = Buffer.from(payload, 'base64url').toString()
    return JSON.parse(json) as IdTokenClaims
  } catch {
    return undefined
  }
}

function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

function extractAccountIdFromTokens(
  tokens: CodexTokenResponse,
): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

export function readCodexOAuthCache(
  moldableHome: string,
): CodexOAuthTokens | null {
  const cachePath = resolveCodexOAuthCachePath(moldableHome)
  let raw: string

  try {
    raw = fs.readFileSync(cachePath, 'utf8')
  } catch {
    return null
  }

  let parsed: CodexOAuthCacheFile
  try {
    parsed = JSON.parse(raw) as CodexOAuthCacheFile
  } catch {
    return null
  }

  if (!parsed?.access_token || !parsed?.refresh_token) return null
  if (typeof parsed.access_token !== 'string') return null
  if (typeof parsed.refresh_token !== 'string') return null
  if (typeof parsed.expires_at !== 'number') return null

  return {
    access: parsed.access_token,
    refresh: parsed.refresh_token,
    expires: parsed.expires_at,
    accountId:
      typeof parsed.account_id === 'string' ? parsed.account_id : undefined,
  }
}

export function writeCodexOAuthCache(
  moldableHome: string,
  tokens: CodexOAuthTokens,
): void {
  const cachePath = resolveCodexOAuthCachePath(moldableHome)
  const dir = path.dirname(cachePath)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // Ignore directory errors; we'll handle write failure below.
  }

  const payload: CodexOAuthCacheFile = {
    access_token: tokens.access,
    refresh_token: tokens.refresh,
    expires_at: tokens.expires,
    account_id: tokens.accountId,
    updated_at: new Date().toISOString(),
  }

  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export async function refreshCodexAccessToken(
  refreshToken: string,
): Promise<CodexOAuthTokens> {
  const response = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Codex OAuth refresh failed (${response.status}): ${text || response.statusText}`,
    )
  }

  const data = (await response.json()) as CodexTokenResponse
  const access = data.access_token
  if (!access || typeof access !== 'string') {
    throw new Error('Codex OAuth refresh returned no access token')
  }

  const expiresIn =
    typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in
      : DEFAULT_EXPIRES_IN_SECONDS
  const refresh =
    typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : refreshToken
  const accountId = extractAccountIdFromTokens(data)

  return {
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000,
    accountId,
  }
}
