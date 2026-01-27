# PRD: Gateway Onboarding UX Issues

**Status:** Draft
**Created:** 2026-01-27
**Component:** `desktop/src/components/onboarding-gateway.tsx` and related gateway infrastructure

## Overview

The gateway onboarding experience has significant usability issues that make it confusing and frustrating for users to set up remote access (Telegram integration). This document tracks all identified issues for remediation.

---

## Issues

### M. Remove Non-Telegram Gateway Options

**Severity:** High
**Location:** `onboarding-gateway.tsx`, `gateway-config.ts`

**Problem:** The UI shows multiple "Recommended setups":

- Telegram bot (recommended)
- Just me, on my laptop
- My phone + laptop on the same Wi-Fi
- Access while traveling (tunnel)

These options add complexity and confusion. Moldable's primary use case is Telegram-based remote access.

**Expected:** Remove all options except Telegram. The onboarding should be a single-path flow: enable gateway → configure Telegram → done. Other setups can be added later when they're fully supported and tested.

---

### A. UI Blocks During Gateway Enable (No Progress Indicator)

**Severity:** High
**Location:** `onboarding-gateway.tsx`

**Problem:** Enabling the gateway toggle appears to block the UI with no visual feedback or progress indicator. Users have no idea if anything is happening.

**Expected:** Show a loading spinner, progress bar, or status message while the gateway is being configured/started.

---

### B. Scroll Bug After Expansion

**Severity:** Medium
**Location:** `onboarding-gateway.tsx`

**Problem:** Once the gateway toggle is enabled and the view expands to show additional options, users cannot scroll all the way to the top. The scroll stops even though there's more content above the fold.

**Expected:** Full scrolling should work regardless of expanded state.

---

### C. Channel Configuration Should Be Inline

**Severity:** High
**Location:** `onboarding-gateway.tsx`

**Problem:** Selecting "Telegram bot" from the "Recommended setups" list should show the Telegram configuration inline (like a mini-drawer/fold expanding from the bottom of that row). Instead, it's shown as a separate "Channels" section below.

**Expected:** When user selects a setup option (e.g., "Telegram bot"), expand the configuration inline within that selection card.

---

### D. Redundant Channel Toggle

**Severity:** High
**Location:** `onboarding-gateway.tsx`

**Problem:** After selecting "Telegram bot" from recommended setups, the user still has to separately enable the "Telegram" channel toggle in the Channels section. This is redundant and confusing.

**Expected:** Selecting "Telegram bot" setup should automatically enable Telegram channel. The current two-step process makes no sense.

---

### E. Triple Confirmation Pattern

**Severity:** Critical
**Location:** `onboarding-gateway.tsx`

**Problem:** Users must:

1. Toggle "Gateway (optional)" switch ON
2. Toggle "Telegram" channel switch ON
3. Click "Enable gateway" button

This is three separate enable actions for what should be one flow.

**Expected:** Single clear flow: select setup type → configure credentials → confirm. One primary action button.

---

### F. No Running Status After Setup

**Severity:** High
**Location:** `onboarding-gateway.tsx`, gateway settings

**Problem:** After completing setup (even when `moldable-gateway` is visibly running in Activity Monitor), there's no status indicator showing the gateway is operational. The view should validate that everything is working.

**Expected:** Show gateway status (running/stopped), connection health, last activity timestamp.

---

### G. Pairing Requests Not Surfaced in App

**Severity:** Critical
**Location:** Main app layout, gateway integration

**Problem:** When a user sends a message to the Telegram bot and receives a pairing request, the Moldable app doesn't:

1. Show any notification about the pending pairing request
2. Tell the user they need to approve it in the app
3. Surface the pairing request prominently

The Telegram message just says `Pairing request: use moldable-gateway gateway pair approve telegram 131910 to approve.` - this is a CLI command, not consumer-friendly.

**Expected:**

- System notification or in-app popover when pairing request arrives
- Clear UI to approve/deny pairing requests (similar to Apple auth prompts)
- Telegram bot message should say "Open Moldable to approve this device" not show CLI commands

---

### H. Settings Shows Disabled When Gateway Is Running

**Severity:** Critical
**Location:** Gateway settings panel

**Problem:** The gateway settings page shows "Enable remote access to this Moldable instance" as OFF/disabled, even when the gateway process is actively running (confirmed in Activity Monitor).

**Expected:** Settings should reflect actual gateway state. If process is running, toggle should be ON.

---

### I. Pairing Requests Not Displayed in Settings

**Severity:** Critical
**Location:** Gateway settings panel

**Problem:** The gateway settings "Pairing requests" section shows "Start the gateway to manage pairing requests" even when:

1. Gateway is running
2. There's an actual pairing request on disk

**Expected:** Pairing requests should be fetched and displayed regardless of perceived gateway state.

---

### J. Security Warnings Require Manual CLI Fix

**Severity:** Critical
**Location:** Gateway startup, `gateway.rs`

**Problem:** Gateway logs show security warnings that tell users to run manual CLI commands:

```
fix: Run `chmod 700 /Users/robot/.moldable/gateway` or `moldable gateway audit --fix`.
fix: Run `chmod 600 /Users/robot/.moldable/gateway/config.json5` or `moldable gateway audit --fix`.
```

A consumer should never need to open Terminal.

**Expected:** Gateway should **auto-heal** on startup. It already has `--fix` flag in audit - this should be the default behavior when running in desktop mode:

1. Gateway starts, detects permission issues
2. Gateway automatically fixes them (it has the capability)
3. Gateway continues startup
4. User sees seamless "Starting gateway..." → "Gateway running"

No user intervention. No desktop involvement needed. Gateway just fixes itself.

---

### K. Gateway Health Check Failures

**Severity:** Critical
**Location:** `sidecar.rs`, gateway startup

**Problem:** Gateway repeatedly fails health checks and enters restart loop:

```
[Gateway] health check timed out on port 19790
[Gateway] Failed to restart: Gateway failed to start on http port 19790
[Gateway] Restarting in 6855ms
```

The gateway starts on WS port 19789 but HTTP health check on 19790 fails.

**Expected:** Health check should succeed if gateway is operational. Need to investigate why HTTP port isn't starting.

---

### L. No Status Feedback When Restarting Gateway in Settings

**Severity:** Medium
**Location:** Gateway settings panel

**Problem:** When using buttons in settings to restart the gateway, no status/progress is shown.

**Expected:** Show "Restarting...", then "Running" or error message.

---

## Summary

| ID  | Issue                               | Severity |
| --- | ----------------------------------- | -------- |
| M   | Remove non-Telegram gateway options | High     |
| A   | No progress indicator when enabling | High     |
| B   | Scroll bug after expansion          | Medium   |
| C   | Channel config should be inline     | High     |
| D   | Redundant channel toggle            | High     |
| E   | Triple confirmation pattern         | Critical |
| F   | No running status after setup       | High     |
| G   | Pairing requests not surfaced       | Critical |
| H   | Settings shows wrong state          | Critical |
| I   | Pairing requests not displayed      | Critical |
| J   | Auto-fix permission issues (no CLI) | Critical |
| K   | Health check failures               | Critical |
| L   | No restart status feedback          | Medium   |

**Critical issues:** 6
**High issues:** 5
**Medium issues:** 2

---

## Ideal User Experience

### Happy Path: First-Time Telegram Setup

**Note:** Gateway is already running in "Private" mode (loopback only). User is enabling Telegram channel.

**Channel Expansion UX:** Like `resource-mapping-item.tsx` from apx-frontend:

- Uses `HeightReveal` component for smooth expand/collapse
- Expanded content has `mx-4 -mt-2 rounded-b-xl` for inset effect
- Content appears "tucked under" the parent row
- This pattern supports future channels (WhatsApp, etc.) - each channel row can expand independently

```
┌─────────────────────────────────────────────────────────────────┐
│  Initial State: Gateway Running (Private Mode)                  │
│  ─────────────────────────────────────────────────────────────  │
│  • Gateway is already running (started with app)                │
│  • Mode: Private (no channels active, loopback only)            │
│  • Shows available channels: Telegram row                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: User clicks Telegram row to expand                     │
│  ─────────────────────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Telegram                                          [ ] ──│──► Toggle OFF initially
│  │ Connect via Telegram bot                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│    ╲─────────────────────────────────────────────────────╱      │
│     │  Config expands from bottom (like resource-mapping) │      │
│     │  • Instructions to create bot via @BotFather        │      │
│     │  • Input field for bot token                        │      │
│     │  • "After enabling, send /start to your bot"        │      │
│     │  • Toggle: "Enable Telegram" → enables when ON      │      │
│    ╱─────────────────────────────────────────────────────╲      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: User toggles "Enable Telegram" ON                      │
│  ─────────────────────────────────────────────────────────────  │
│  • Config saved, gateway hot-reloads                            │
│  • UI shows status: "Telegram active"                           │
│  • "Send /start to your bot to initiate pairing"                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: User messages bot on Telegram                          │
│  ─────────────────────────────────────────────────────────────  │
│  User sends: /start                                             │
│  Bot replies: "To pair this chat with Moldable, approve the     │
│               request in the Moldable app on your computer."    │
│  (NOT a CLI command!)                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: Desktop app shows pairing modal (layout-level)         │
│  ─────────────────────────────────────────────────────────────  │
│  • Popover/modal appears automatically (like macOS auth)        │
│  • Shows: "Telegram user @username wants to pair"               │
│  • Shows pairing code: 131910                                   │
│  • Two buttons: [Approve] [Deny]                                │
│  • Works regardless of what screen user is on                   │
│  • **PERSISTENT** - Cannot be dismissed by clicking outside     │
│  • Only closes via: Approve, Deny, or Cancel                    │
│  • Cancel = reject pairing AND disable Telegram channel         │
│  • Also shows macOS system notification (if app minimized)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 6: User approves, bot confirms                            │
│  ─────────────────────────────────────────────────────────────  │
│  • User clicks [Approve]                                        │
│  • Desktop shows "Paired successfully!"                         │
│  • Bot sends: "Hello! You're now connected to Moldable.         │
│               Send me a message anytime."                       │
│  • Onboarding complete                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Key UX Principles

1. **One action per step** - No triple-toggle nonsense
2. **Inline expansion** - Config appears where you select, not in separate section
3. **Real-time feedback** - Always show what's happening (starting, running, waiting)
4. **Push notifications** - Pairing requests surface automatically, user doesn't hunt for them
5. **Human-readable messages** - Bot never shows CLI commands to users
6. **Layout-level modals** - Critical actions (pairing) interrupt regardless of current view

---

## Gateway Changes Required (`~/moldable-gateway`)

**Priority: IMMEDIATE** - Desktop UX depends on gateway supporting these capabilities.

### Architecture Philosophy

The gateway should be a **first-class citizen** for desktop app integration while remaining **loosely coupled** so others can use it for their own services.

**Always-On, Config-Driven:**

- Gateway is **always running** (started with Moldable), even when "disabled"
- **Security note:** "Always on" is ONLY for loopback mode (127.0.0.1) - desktop + bundled gateway communicate locally only. No external exposure when channels are disabled.
- When disabled: all access locked down, no channels active, mode is "Private"
- Config changes unlock capabilities (enable Telegram polling, etc.)
- Leverages existing config-watching + auto-restart behavior
- "Enable Telegram" in UI = write config that enables Telegram channel, gateway hot-reloads

**Gateway Modes:**

- **Private** - Gateway running, no channels active, loopback only (desktop ↔ gateway)
- **Telegram** - Telegram polling enabled, accepting paired users
- _(Future: WhatsApp, other channels)_

This means:

- **UI/UX-first APIs** - Design for app integration, not CLI power users
- **Self-healing** - Gateway fixes its own issues (permissions, etc.) without requiring the host app to intervene
- **Event-driven** - Push events to connected clients (pairing requests, status changes) rather than requiring polling
- **Human-readable responses** - Bot messages, error messages, etc. should be consumer-friendly, not developer-friendly (but **configurable** for CLI users)
- **Stateless host assumption** - Don't assume the desktop app knows anything; gateway is the source of truth
- **Config as the API** - Desktop writes config, gateway reacts; minimal RPC needed

**Auto-Fix Mode:**

- Gateway should have a mode (flag or config) where it auto-fixes non-critical issues on restart without prompting
- Desktop invokes with this mode enabled
- CLI users can opt-in or run `audit --fix` manually

### 1. WebSocket Events for Pairing Requests

The gateway must push pairing request events to the desktop app via WebSocket so the app can show the approval modal in real-time.

```typescript
// Event the desktop needs to receive
{
  type: "pairing_request",
  channel: "telegram",
  sender_id: "123456789",
  sender_name: "@username",
  code: "131910",
  timestamp: "2026-01-27T12:35:00Z"
}
```

**Current state:** Unknown - need to verify if gateway already emits these events or if desktop just polls.

### 2. Human-Friendly Bot Messages

The Telegram bot's pairing response must NOT include CLI commands. Change from:

```
Pairing request: use moldable-gateway gateway pair approve telegram 131910 to approve.
```

To:

```
To connect this chat with Moldable, approve the pairing request in the Moldable app on your computer.

Your pairing code is: 131910
```

**Location:** Telegram channel handler in gateway

### 3. Pairing Approval via API

Desktop needs an API endpoint to approve/deny pairing requests (not just CLI):

```
POST /api/pair/approve
{
  "channel": "telegram",
  "code": "131910"
}

POST /api/pair/deny
{
  "channel": "telegram",
  "code": "131910"
}
```

**Current state:** May exist on HTTP port 19790 - but that port isn't starting (Issue K).

### 4. Health Check / HTTP Port Fix

The HTTP API on port 19790 must start successfully. This is blocking:

- Pairing approval API
- Health checks
- Status polling

**Investigation needed:** Why does WS port 19789 start but HTTP 19790 doesn't?

### 5. Auto-Heal on Startup

Gateway should automatically fix common issues on startup when running in desktop/daemon mode:

```bash
# Current: gateway starts, warns, user must run CLI
moldable-gateway gateway run --config ...
# [WARN] permissions too open, run `moldable gateway audit --fix`

# Expected: gateway auto-heals
moldable-gateway gateway run --config ... --auto-fix
# [INFO] fixed permissions on /Users/robot/.moldable/gateway (755 → 700)
# [INFO] fixed permissions on config.json5 (644 → 600)
# [INFO] gateway listening on 127.0.0.1:19789
```

Desktop invokes gateway with `--auto-fix` flag (or this is default behavior for `run` command). Gateway handles its own issues. Desktop just needs to know "started successfully" or "failed to start" with a user-friendly error message.

### 6. Welcome Message After Pairing

After successful pairing, gateway should send a welcome message to the user:

```
Hello! You're now connected to Moldable. Send me a message anytime.
```

---

## Implementation Order

### Phase 1: Fix Critical Infrastructure (Gateway-side)

1. **K: HTTP port 19790 not starting** - Blocks everything else
2. **J: Auto-heal on startup** - Gateway fixes its own permission issues with `--auto-fix` or by default
3. **Gateway: Pairing approval API** - HTTP endpoint for desktop to approve/deny

### Phase 2: Simplify to Telegram-Only

4. **M: Remove non-Telegram options** - Delete setup picker, delete channels section
5. **C/D/E: Single-path Telegram flow** - Toggle on → see Telegram config → save

### Phase 3: Real-Time Pairing Flow

6. **Gateway: WebSocket pairing events** - Push to desktop
7. **G: Layout-level pairing modal** - Desktop receives and shows modal automatically
8. **Gateway: Human-friendly bot messages** - "Approve in Moldable app" not CLI commands
9. **Gateway: Welcome message after pairing** - Confirm success to user

### Phase 4: Status & Feedback

10. **A/F: Progress indicators and status** - Visual feedback throughout
11. **H/I: Settings state sync** - Reflect actual gateway state, show pairing requests

### Phase 5: Polish

12. **B: Scroll bug** - CSS fix
13. **L: Restart feedback** - Loading states

---

## Open Questions

1. Does the gateway already emit WebSocket events for pairing requests, or does desktop poll?
2. What's causing HTTP port 19790 to fail while WS port 19789 succeeds?
3. Should we support system notifications (Tauri) in addition to in-app modals for pairing?
4. ~~Do we want to auto-approve pairing for "Just me, on my laptop" setup (localhost only)?~~ N/A - Telegram only for now
