# Gateway Onboarding + Lifecycle PRD

## Overview

Expose Moldable’s local AI to remote messaging channels (Telegram, WhatsApp Cloud, future channels) through the **Moldable Gateway** running on the user’s machine. The gateway should be **opt‑in**, **safe by default**, and explained in plain language. It must integrate into onboarding and settings, persist a validated gateway config, and start/stop with the desktop app (no background services).

## Goals

- Let users enable remote access during onboarding **only when an API key is configured**.
- Provide **simple, recommended setups** with clear risk explanations (from `moldable-gateway/docs/core/security-and-pairing.md`).
- Generate and persist gateway config at `~/.moldable/gateway/config.json5`.
- Provide a **Gateway** settings panel to edit configuration and restart the gateway.
- Run the gateway as a **sidecar process** (like ai-server) that starts/stops with the desktop app.

## Non‑Goals

- Exposing the gateway on public internet by default.
- Requiring users to install or manage launch agents / services.
- Advanced gateway config editor (full JSON5 editing in UI) — handled later.

## User Experience

### Onboarding (new step)

- **Shown only when a valid API key exists** (health indicates keys are present). If user skips API key entry, do **not** show gateway setup.
- Step appears **after API key** and **before** finishing onboarding.
- Default state: **gateway disabled**.
- “Enable gateway” toggle reveals setup choices.

**Recommended setups (radio cards):**

- Just me, on my laptop
- My phone + laptop on the same Wi‑Fi
- Access while traveling (tunnel)
- Webhooks (e.g. WhatsApp Cloud)
- I use Telegram

For the selected setup:

- Show a concise **risk list** (bullet points).
- Require **explicit acknowledgment** (“I understand the risks”) before enabling.

**Channels (optional):**

- Telegram: bot token + require mention toggle
- WhatsApp Cloud: verify token, access token, phone number ID, webhook bind

On confirm:

- Write gateway config to `~/.moldable/gateway/config.json5`
- Persist shared prefs: `gatewayEnabled`, `gatewaySetupId`
- Start gateway if enabled

### Settings

Add **Gateway** section in Settings dialog:

- Status card (running/stopped + start/stop buttons)
- “Enable gateway on launch” toggle
- Setup selection (same recommended setups + risk callout + acknowledgment)
- Gateway auth token view (copy + rotate)
- Workspace selector (which workspace gateway uses)
- Channel configuration (Telegram/WhatsApp)
- “Save & restart gateway” button
- “Open config file” button

## Configuration

Gateway config is **JSON5** compatible, stored at:

- macOS/Linux: `~/.moldable/gateway/config.json5`

Generated config should include:

- `gateway.auth` token
- `gateway.bind` + `gateway.public_access`
- `pairing.dm_policy` = `pairing`, `pairing.group_policy` = `allowlist`
- `channels.telegram` / `channels.whatsapp` with required fields
- `ai.adapters` with `ai-server` base URL (`http://127.0.0.1:<aiServerPort>`) and workspace ID
- Safe defaults for `nodes.require_pairing` and `exec.approvals.mode = prompt`

## Lifecycle + Sidecar Management

- Gateway runs as a **sidecar** (no LaunchAgent/system service).
- Start/stop is managed by the desktop app:
  - On app launch, **auto‑start only if `gatewayEnabled=true`**.
  - On app exit, **terminate gateway process**.
- Provide Tauri commands for:
  - `get_gateway_config`, `save_gateway_config`
  - `start_gateway`, `stop_gateway`, `restart_gateway`

**Bundling decision:**

- Bundle gateway binary as a sidecar (like ai-server) so it runs only while Moldable runs.
- Do **not** use `launchctl` or background services by default.

## Security Principles

- Gateway **disabled by default**.
- Clear warnings + required acknowledgment for each setup.
- Safe defaults: loopback bind, public access off, token auth, pairing on.
- Encourage tunnels for remote access and webhooks.

## Open Questions

- Should changing workspace auto‑update gateway config (or be manual only)?
- Should we surface gateway audit/security summary in UI?
- Should we support direct JSON5 editing in advanced mode?

## Milestones / Plan

1. Add gateway onboarding step and shared preference storage.
2. Create `settings-gateway.tsx` for editing config + restart.
3. Implement gateway sidecar lifecycle in Tauri (start/stop, cleanup).
4. Bundle gateway binary + add tests and documentation.
