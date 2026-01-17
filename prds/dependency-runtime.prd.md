# Dependency Runtime Reliability (Node.js + pnpm)

## Problem

Fresh macOS user accounts (no Node tooling) fail to reach a stable "just works" state:

- Onboarding reports Node installed, but the terminal and subsequent app installs cannot find `node`.
- pnpm install fails with `env: node: No such file or directory`.
- Restarting the app does not repair the mismatch between "installed" status and actual usability.

This breaks first-run onboarding for non-technical users and undermines trust in the toolchain setup.

## Goals

- Make Node.js and pnpm availability deterministic and independent of shell config.
- Ensure dependency checks reflect **actual runnable binaries**, not just files on disk.
- Make onboarding resilient: one button should reliably produce a working runtime.
- Avoid requiring the user to open Terminal or edit shell profiles.
- Respect existing Node installations for developers who manage their own.

## Non-Goals

- Support every package manager (e.g., yarn, bun) out of the box.
- Enforce a single global Node version for advanced users who already manage their own.
- Build a general-purpose system-wide Node installer.

## Current Behavior (Observed)

- Onboarding installs NVM, then installs Node via NVM.
- Dependency checks rely on PATH discovery and version commands.
- pnpm install invokes `npm`, which fails if `node` isn't in the environment PATH.
- GUI-launched processes do not inherit shell setup (`.zshrc`, `.bashrc`), so NVM installs are effectively invisible.

## Root Causes

- **NVM is shell-dependent**: it requires profile initialization to expose `node`/`npm`.
- **GUI app environment** lacks the user's shell PATH configuration.
- Dependency checks and installers don't share a single, guaranteed runtime path.
- The system reports "installed" when a binary exists but is not invokable by app processes.

## Proposed Solution

### 1) Moldable-Managed Runtime (Fallback)

Install and manage Node.js (and pnpm) inside the user's Moldable data directory **only when no working Node is found**:

```
~/.moldable/runtime/
├── node/
│   ├── v22.12.0-arm64/  # extracted Node distribution
│   │   ├── bin/
│   │   │   ├── node
│   │   │   ├── npm
│   │   │   ├── npx
│   │   │   └── pnpm
│   │   └── lib/
│   └── current -> v22.12.0-arm64
└── logs/
```

**Key behavior:**

- Moldable runtime is a **fallback** for users without existing Node, not a replacement.
- All dependency commands run with explicit PATH injection.
- Dependency status is "installed" only if the runtime can execute:
  - `node --version`
  - `pnpm --version`

### 2) Respect Existing Node Installations

**Critical**: Many developers already have Node.js installed via Homebrew, official installer, or a working version manager. Moldable should **detect and use these** rather than forcing its own runtime.

**Onboarding behavior:**

```
On dependency check:
├── Does user have a WORKING Node? (executes `node --version` successfully)
│   ├── YES → Show "Node.js ✓ v22.12.0 (Homebrew)" — no install button
│   │         User proceeds to pnpm check
│   └── NO  → Show "Install Node.js" button
│             └── Installs to ~/.moldable/runtime/
```

The "Install" button should **only appear if no working Node is found**. This respects:

- Homebrew users
- Official .pkg installer users
- Developers with working NVM/fnm/Volta setups
- Corporate environments with managed Node installations

### 3) Node Version Selection

When installing the Moldable-managed runtime, automatically select the **latest LTS version compatible with the user's system**.

**macOS version requirements for Node.js:**

| Node.js Version | Minimum macOS          | Notes                          |
| --------------- | ---------------------- | ------------------------------ |
| Node 18.x LTS   | macOS 10.15 (Catalina) | Maintenance LTS until Apr 2025 |
| Node 20.x LTS   | macOS 10.15 (Catalina) | Active LTS until Oct 2026      |
| Node 22.x LTS   | macOS 11 (Big Sur)     | Active LTS until Apr 2027      |
| Node 24.x       | macOS 11 (Big Sur)     | Current, not yet LTS           |

**Version selection algorithm:**

```
1. Get macOS version via `sw_vers -productVersion`
2. Fetch Node.js release schedule from:
   https://nodejs.org/dist/index.json
3. Filter to LTS versions compatible with detected macOS
4. Select the latest compatible LTS version
5. Download from:
   https://nodejs.org/dist/v{VERSION}/node-v{VERSION}-darwin-{ARCH}.tar.gz
```

**Fallback behavior:**

- If API fetch fails, use a hardcoded known-good LTS version (e.g., v22.12.0)
- Cache the version selection to avoid repeated API calls
- Log the selected version for debugging

### 4) Install Flow (Single Button)

**Install Node runtime:**

1. Detect architecture (arm64 vs x64) via `uname -m`.
2. Detect macOS version via `sw_vers -productVersion`.
3. Determine latest compatible LTS version (see above).
4. Download Node distribution from nodejs.org:
   - `https://nodejs.org/dist/v{VERSION}/node-v{VERSION}-darwin-{ARCH}.tar.gz`
5. Verify checksum (SHA256) from `SHASUMS256.txt`.
6. Extract to `~/.moldable/runtime/node/v{VERSION}-{ARCH}/` (tar `--strip-components=1`).
7. Update `current` symlink.
8. Verify `node --version` using the absolute path.

**Install pnpm:**

Use Corepack bundled with Node:

```bash
~/.moldable/runtime/node/current/bin/corepack enable
~/.moldable/runtime/node/current/bin/corepack prepare pnpm@latest-10 --activate
~/.moldable/runtime/node/current/bin/pnpm --version
```

If Corepack fails or is unavailable, fallback to:

```bash
~/.moldable/runtime/node/current/bin/npm install -g pnpm@latest-10
```

### 5) Path Resolution Priority

**For dependency detection** (check in order, stop at first working binary):

1. Homebrew ARM (`/opt/homebrew/bin`) — most common on modern Macs
2. Homebrew Intel (`/usr/local/bin`)
3. System (`/usr/bin`)
4. NVM (`~/.nvm/versions/node/*/bin`) — check latest version directory
5. fnm (`~/.local/share/fnm/aliases/default/bin`)
6. Volta (`~/.volta/bin`)
7. Moldable runtime (`~/.moldable/runtime/node/current/bin`)
8. Shell lookup (`bash -l -c "which node"`) — last resort

**For spawning app processes** (PATH injection):

```rust
let mut path_parts = vec![];

// Only inject Moldable runtime if it exists
if let Some(moldable_bin) = get_moldable_node_bin_dir() {
    path_parts.push(moldable_bin);
}

// Always include system PATH
path_parts.push(std::env::var("PATH").unwrap_or_default());

let path = path_parts.join(":");
```

### 6) Status Shape

```typescript
interface DependencyStatus {
  nodeInstalled: boolean
  nodeVersion: string | null
  nodePath: string | null
  nodeSource:
    | 'moldable'
    | 'homebrew'
    | 'system'
    | 'nvm'
    | 'fnm'
    | 'volta'
    | 'other'
    | null
  pnpmInstalled: boolean
  pnpmVersion: string | null
  pnpmPath: string | null
}
```

The `nodeSource` field enables contextual UI messaging:

- "Node.js ✓ v22.12.0 (Homebrew)" — using existing install
- "Node.js ✓ v22.12.0 (Managed by Moldable)" — using our runtime

### 7) Onboarding UX Updates

**Node card states:**

| State               | Display                         | Action                         |
| ------------------- | ------------------------------- | ------------------------------ |
| Existing Node found | "Node.js ✓ v22.12.0 (Homebrew)" | None needed                    |
| No Node found       | "Node.js required"              | "Install Node.js" button       |
| Installing          | "Installing Node.js..."         | Progress indicator             |
| Install failed      | "Installation failed"           | "Retry" button + error details |

**pnpm card states:**

| State                | Display                  | Action                |
| -------------------- | ------------------------ | --------------------- |
| pnpm found           | "pnpm ✓ v10.x"           | None needed           |
| Node exists, no pnpm | "pnpm required"          | "Install pnpm" button |
| No Node              | "Requires Node.js first" | Disabled state        |

Show actionable, precise errors (e.g., "Download failed: check your internet connection").

## Implementation Notes

- Add `install_node` command that downloads and extracts the official tarball.
- Add `get_macos_version`, `get_node_arch`, `get_compatible_node_version` helpers.
- Update `find_node_path`, `find_npm_path`, `find_pnpm_path` to check system paths first.
- Ensure all pnpm/npm subprocesses use the injected PATH.
- Deprecate NVM-specific install flow in onboarding.
- Remove `install_nvm` and `install_node_via_nvm` commands.

## Alternatives Considered

### A) Continue Using NVM (Status Quo)

Pros:

- Familiar to developers.
- Reuses existing tooling.

Cons:

- Not visible to GUI apps without shell initialization.
- Unreliable for non-technical users.
- "Installed" status is frequently false.

### B) Bundle Node Inside the App Binary

Pros:

- Zero download needed during onboarding.
- Maximum reliability.

Cons:

- Increases app size significantly (~50MB+).
- Harder updates and patching.
- App Store notarization complexity.

### C) Require System Package Manager (Homebrew)

Pros:

- Standard for developers.

Cons:

- Not viable for non-technical users.
- Requires Terminal usage, admin prompts, and knowledge of Homebrew.

### D) Switch to Bun/Deno

Pros:

- Possibly simpler single-binary install.

Cons:

- App ecosystem expects Node.
- Compatibility risks for existing apps.

## Success Metrics

- 95%+ of fresh macOS user accounts reach "Node + pnpm installed" in one run.
- Zero occurrences of "env: node: No such file or directory" during app installs.
- Dependency status matches actual runnable binaries in all reported cases.
- Developers with existing Node see it detected without needing to install anything.

## Rollout Plan

1. Implement system Node detection (Homebrew, etc.) as priority.
2. Implement managed runtime installation + verification.
3. Update onboarding UI with contextual messaging.
4. Instrument logging for install steps and failures.
5. Test on clean macOS accounts (arm64 + x64) AND accounts with existing Node.

## Risks and Mitigations

- **Network failures during download**: show retry and offline guidance.
- **Checksum mismatch**: block install, show error, log details.
- **Permission issues**: ensure all installs target `~/.moldable/`.
- **Old macOS versions**: gracefully fall back to older compatible Node LTS.
- **Existing broken NVM setup**: detect as "not working" and offer Moldable runtime.

## Open Questions

- ~~Which Node version should be pinned (latest LTS vs current)?~~ → Use latest compatible LTS.
- ~~Should we allow opt-out for advanced users?~~ → Yes, by detecting their existing setup.
- Do we need a "repair runtime" button in settings?
- How should runtime updates be surfaced (manual button vs prompt)?
- Should uninstall remove `~/.moldable/runtime` or leave it behind?

## Testing Plan

- Verify detection of Homebrew Node on arm64 and x64 Macs.
- Verify detection of official .pkg installed Node.
- Verify NVM-installed Node is detected (when shell is properly configured).
- Runtime install on fresh macOS accounts (arm64 + x64).
- Verify `node --version` and `pnpm --version` execute from app process.
- Install a sample app and confirm pnpm install + dev start work.
- Edge cases: offline install, partial download, disk full, corrupted runtime, permission denied.
- macOS version compatibility: test on Catalina (10.15), Big Sur (11), and current.
