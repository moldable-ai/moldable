export const DEFAULT_GATEWAY_PORT = 19789
export const DEFAULT_HTTP_PORT = 19790
export const DEFAULT_WEBHOOK_BIND = '127.0.0.1:8088'

export type GatewaySetupId =
  | 'just-me'
  | 'same-wifi'
  | 'travel'
  | 'webhooks'
  | 'telegram'

export const DEFAULT_GATEWAY_SETUP_ID: GatewaySetupId = 'telegram'

export type GatewayBind = 'loopback' | 'lan' | 'custom'
export type PairingPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
export type GroupPolicy = 'allowlist' | 'open'

export interface GatewaySetup {
  id: GatewaySetupId
  title: string
  description: string
  bind: GatewayBind
  publicAccess: boolean
  riskLevel: 'low' | 'medium' | 'high'
  recommended?: boolean
  risks: string[]
  notes?: string
}

export const GATEWAY_SETUPS: GatewaySetup[] = [
  {
    id: 'telegram',
    title: 'Telegram bot',
    description:
      'Moldable polls Telegram for new messages and sends responses back. No public internet exposure. Recommended for most users who want a secure experience.',
    bind: 'loopback',
    publicAccess: false,
    riskLevel: 'low',
    recommended: true,
    risks: [
      'Telegram chats are not end-to-end encrypted.',
      'Group chats can expose the bot to any group member (but each user must be approved via pairing before the bot can respond to them).',
    ],
    notes: 'Recommended to keep require_mention on for group chats.',
  },
  {
    id: 'just-me',
    title: 'Just me, on my laptop',
    description:
      'Local-only access for a single device. No public internet exposure.',
    bind: 'loopback',
    publicAccess: false,
    riskLevel: 'low',
    risks: [
      'If this machine is compromised, the gateway is too.',
      'Messages are stored locally in gateway session logs.',
      'Command execution or nodes can access local files when approved.',
    ],
  },
  {
    id: 'same-wifi',
    title: 'My phone + laptop on the same Wi-Fi',
    description: 'Reachable from your local network only.',
    bind: 'lan',
    publicAccess: false,
    riskLevel: 'medium',
    risks: [
      'Anyone on your LAN with the token can connect.',
      'Shared or untrusted Wi-Fi increases exposure.',
      '(Always use a VPN when connecting to untrusted networks.)',
    ],
  },
  {
    id: 'travel',
    title: 'Access while traveling (tunnel)',
    description: 'Use a tunnel without opening a public port.',
    bind: 'loopback',
    publicAccess: false,
    riskLevel: 'medium',
    risks: [
      'Tunnel provider becomes part of your trust chain (choose a secure one).',
      'Misconfigured tunnels can expose your gateway.',
    ],
    notes: 'Use SSH, Tailscale, or ngrok to expose port 19789.',
  },
  {
    id: 'webhooks',
    title: 'Webhooks (e.g. WhatsApp Cloud)',
    description: 'Expose only a webhook port via a tunnel.',
    bind: 'loopback',
    publicAccess: false,
    riskLevel: 'high',
    risks: [
      'Webhook URLs are public and can be probed or abused.',
      'Protect verify tokens and watch rate limits.',
    ],
    notes: 'Tunnel only the webhook port (default 8088).',
  },
]

export const GATEWAY_FEATURE_FLAGS = {
  whatsapp: false,
}

export function getVisibleGatewaySetups(): GatewaySetup[] {
  return GATEWAY_SETUPS.filter(
    (setup) => setup.id !== 'webhooks' || GATEWAY_FEATURE_FLAGS.whatsapp,
  )
}

export interface GatewayConfig {
  schema_version?: number
  gateway?: {
    mode?: 'local' | 'remote'
    port?: number
    bind?: GatewayBind
    host?: string | null
    profile?: string | null
    public_access?: boolean
    auth?: {
      mode?: 'token' | 'password'
      token?: string | null
      password?: string | null
    }
    http?: {
      bind?: string
      port?: number
      auth_token?: string | null
      max_body_bytes?: number
      rate_limit?: {
        enabled?: boolean
        requests_per_minute?: number
        burst?: number
      }
      endpoints?: {
        openai_chat?: boolean
        openresponses?: boolean
      }
    }
    data_dir?: string | null
  }
  pairing?: {
    dm_policy?: PairingPolicy
    group_policy?: GroupPolicy
  }
  channels?: {
    telegram?: {
      enabled?: boolean
      bot_token?: string | null
      dm_policy?: PairingPolicy | null
      group_policy?: GroupPolicy | null
      allow_from?: string[]
      group_allow_from?: string[]
      groups?: string[]
      group_rules?: Record<string, unknown>
      require_mention?: boolean
    }
    whatsapp?: {
      enabled?: boolean
      dm_policy?: PairingPolicy | null
      group_policy?: GroupPolicy | null
      allow_from?: string[]
      group_allow_from?: string[]
      groups?: string[]
      group_rules?: Record<string, unknown>
      require_mention?: boolean
      cloud?: {
        enabled?: boolean
        verify_token?: string | null
        access_token?: string | null
        phone_number_id?: string | null
        webhook_bind?: string
      }
    }
  }
  ai?: {
    default_adapter?: string | null
    adapters?: Array<{
      type?: 'ai-server' | 'http'
      name?: string
      base_url?: string
      url?: string
      model?: string | null
      reasoning_effort?: string | null
      workspace_id?: string | null
    }>
  }
  agents?: Record<string, unknown>
  routing?: Record<string, unknown>
  plugins?: Record<string, unknown>
  nodes?: {
    require_pairing?: boolean
  }
  exec?: {
    approvals?: {
      mode?: string
    }
  }
}

export type GatewayAiAdapter = NonNullable<
  NonNullable<GatewayConfig['ai']>['adapters']
>[number]

export interface GatewayFormState {
  bind: GatewayBind
  publicAccess: boolean
  authToken: string
  httpAuthToken: string
  gatewayPort: number
  httpPort: number
  workspaceId: string | null
  pairingDmPolicy: PairingPolicy
  pairingGroupPolicy: GroupPolicy
  telegramEnabled: boolean
  telegramBotToken: string
  telegramRequireMention: boolean
  whatsappEnabled: boolean
  whatsappVerifyToken: string
  whatsappAccessToken: string
  whatsappPhoneNumberId: string
  whatsappWebhookBind: string
}

export function getGatewaySetup(id: GatewaySetupId): GatewaySetup {
  return GATEWAY_SETUPS.find((setup) => setup.id === id) || GATEWAY_SETUPS[0]
}

export function generateToken(bytes: number = 32): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint8Array(bytes)
    crypto.getRandomValues(buffer)
    return Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Fallback for environments without crypto (should be rare)
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('')
}

export function createDefaultGatewayFormState(options: {
  setupId?: GatewaySetupId
  workspaceId?: string | null
  authToken?: string
}): GatewayFormState {
  const setup = getGatewaySetup(options.setupId ?? DEFAULT_GATEWAY_SETUP_ID)
  const authToken = options.authToken ?? generateToken()

  return {
    bind: setup.bind,
    publicAccess: setup.publicAccess,
    authToken,
    httpAuthToken: authToken,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    httpPort: DEFAULT_HTTP_PORT,
    workspaceId: options.workspaceId ?? null,
    pairingDmPolicy: 'pairing',
    pairingGroupPolicy: 'allowlist',
    telegramEnabled: false,
    telegramBotToken: '',
    telegramRequireMention: true,
    whatsappEnabled: false,
    whatsappVerifyToken: '',
    whatsappAccessToken: '',
    whatsappPhoneNumberId: '',
    whatsappWebhookBind: DEFAULT_WEBHOOK_BIND,
  }
}

export function gatewayConfigToFormState(
  config: GatewayConfig | null,
  options: {
    setupId?: GatewaySetupId
    workspaceId?: string | null
  },
): GatewayFormState {
  const authToken = config?.gateway?.auth?.token || generateToken()
  const setup = getGatewaySetup(options.setupId ?? DEFAULT_GATEWAY_SETUP_ID)

  return {
    bind: config?.gateway?.bind ?? setup.bind,
    publicAccess: config?.gateway?.public_access ?? setup.publicAccess,
    authToken,
    httpAuthToken: config?.gateway?.http?.auth_token ?? authToken,
    gatewayPort: config?.gateway?.port ?? DEFAULT_GATEWAY_PORT,
    httpPort: config?.gateway?.http?.port ?? DEFAULT_HTTP_PORT,
    workspaceId:
      config?.ai?.adapters?.find(
        (adapter) =>
          adapter?.type === 'ai-server' || adapter?.name === 'ai-server',
      )?.workspace_id ??
      options.workspaceId ??
      null,
    pairingDmPolicy: config?.pairing?.dm_policy ?? 'pairing',
    pairingGroupPolicy: config?.pairing?.group_policy ?? 'allowlist',
    telegramEnabled: config?.channels?.telegram?.enabled ?? false,
    telegramBotToken: config?.channels?.telegram?.bot_token ?? '',
    telegramRequireMention: config?.channels?.telegram?.require_mention ?? true,
    whatsappEnabled: config?.channels?.whatsapp?.enabled ?? false,
    whatsappVerifyToken: config?.channels?.whatsapp?.cloud?.verify_token ?? '',
    whatsappAccessToken: config?.channels?.whatsapp?.cloud?.access_token ?? '',
    whatsappPhoneNumberId:
      config?.channels?.whatsapp?.cloud?.phone_number_id ?? '',
    whatsappWebhookBind:
      config?.channels?.whatsapp?.cloud?.webhook_bind ?? DEFAULT_WEBHOOK_BIND,
  }
}

function updateAiAdapters(
  adapters: GatewayAiAdapter[] | undefined,
  aiServerPort: number,
  workspaceId: string | null,
): GatewayAiAdapter[] {
  const next = Array.isArray(adapters) ? [...adapters] : []
  const baseUrl = `http://127.0.0.1:${aiServerPort}`

  const index = next.findIndex((adapter) => adapter?.name === 'ai-server')
  const aiServerAdapter: GatewayAiAdapter = {
    type: 'ai-server',
    name: 'ai-server',
    base_url: baseUrl,
    model: null,
    reasoning_effort: 'medium',
    workspace_id: workspaceId ?? null,
  }

  if (index >= 0) {
    next[index] = { ...next[index], ...aiServerAdapter }
  } else {
    next.push(aiServerAdapter)
  }

  return next
}

export function mergeGatewayConfig(
  existing: GatewayConfig | null,
  state: GatewayFormState,
  aiServerPort: number,
): GatewayConfig {
  const base: GatewayConfig = existing ? { ...existing } : {}
  const authToken = state.authToken || generateToken()

  return {
    ...base,
    schema_version: base.schema_version ?? 2,
    gateway: {
      ...base.gateway,
      mode: 'local',
      port: state.gatewayPort,
      bind: state.bind,
      host: state.bind === 'custom' ? (base.gateway?.host ?? null) : null,
      profile: base.gateway?.profile ?? null,
      public_access: state.publicAccess,
      auth: {
        mode: 'token',
        token: authToken,
        password: null,
      },
      http: {
        ...base.gateway?.http,
        bind: base.gateway?.http?.bind ?? '127.0.0.1',
        port: state.httpPort,
        auth_token: state.httpAuthToken || authToken,
        max_body_bytes: base.gateway?.http?.max_body_bytes ?? 1048576,
        rate_limit: {
          enabled: base.gateway?.http?.rate_limit?.enabled ?? true,
          requests_per_minute:
            base.gateway?.http?.rate_limit?.requests_per_minute ?? 120,
          burst: base.gateway?.http?.rate_limit?.burst ?? 30,
        },
        endpoints: {
          openai_chat: base.gateway?.http?.endpoints?.openai_chat ?? false,
          openresponses: base.gateway?.http?.endpoints?.openresponses ?? false,
        },
      },
      data_dir: base.gateway?.data_dir ?? null,
    },
    pairing: {
      ...base.pairing,
      dm_policy: state.pairingDmPolicy,
      group_policy: state.pairingGroupPolicy,
    },
    channels: {
      ...base.channels,
      telegram: {
        ...base.channels?.telegram,
        enabled: state.telegramEnabled,
        bot_token: state.telegramBotToken || null,
        allow_from: base.channels?.telegram?.allow_from ?? [],
        group_allow_from: base.channels?.telegram?.group_allow_from ?? [],
        groups: base.channels?.telegram?.groups ?? [],
        group_rules: base.channels?.telegram?.group_rules ?? {},
        require_mention: state.telegramRequireMention,
      },
      whatsapp: {
        ...base.channels?.whatsapp,
        enabled: state.whatsappEnabled,
        allow_from: base.channels?.whatsapp?.allow_from ?? [],
        group_allow_from: base.channels?.whatsapp?.group_allow_from ?? [],
        groups: base.channels?.whatsapp?.groups ?? [],
        group_rules: base.channels?.whatsapp?.group_rules ?? {},
        require_mention: base.channels?.whatsapp?.require_mention ?? true,
        cloud: {
          ...base.channels?.whatsapp?.cloud,
          enabled: state.whatsappEnabled,
          verify_token: state.whatsappVerifyToken || null,
          access_token: state.whatsappAccessToken || null,
          phone_number_id: state.whatsappPhoneNumberId || null,
          webhook_bind: state.whatsappWebhookBind || DEFAULT_WEBHOOK_BIND,
        },
      },
    },
    ai: {
      ...base.ai,
      default_adapter: base.ai?.default_adapter ?? 'ai-server',
      adapters: updateAiAdapters(
        base.ai?.adapters,
        aiServerPort,
        state.workspaceId,
      ),
    },
    nodes: {
      ...base.nodes,
      require_pairing: base.nodes?.require_pairing ?? true,
    },
    exec: {
      ...base.exec,
      approvals: {
        mode: base.exec?.approvals?.mode ?? 'prompt',
      },
    },
  }
}

export function applySetupToState(
  setupId: GatewaySetupId,
  state: GatewayFormState,
): GatewayFormState {
  const setup = getGatewaySetup(setupId)
  return {
    ...state,
    bind: setup.bind,
    publicAccess: setup.publicAccess,
  }
}
