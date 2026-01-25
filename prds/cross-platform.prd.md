# Cross-Platform Support PRD (Desktop)

## Summary

Ensure the Moldable **desktop app** (Tauri + Rust backend + React frontend) runs reliably on **macOS and Windows**, with **Linux as a best-effort**. Focus on:

- Path handling for `~/.moldable` / `%USERPROFILE%\.moldable`
- Bundled runtime discovery (Node + pnpm) and PATH construction
- Process + port management without macOS-only utilities
- Windows-safe command discovery (where vs which)
- Correct resource/sidecar layout for each platform

## Goals

- Desktop app launches, manages apps, and resolves `MOLDABLE_HOME` correctly on macOS + Windows.
- Bundled runtime (Node + pnpm) is discoverable on Windows, not just macOS/Linux.
- Port discovery/cleanup works without `lsof`, `pgrep`, or `kill` on Windows.
- API/tooling that runs inside the desktop app uses platform-aware PATH/command resolution.
- Test coverage updated to be platform-aware, with explicit Windows and Linux test cases.

## Non-Goals

- Full system audio capture parity on Windows/Linux (macOS-only for now).
- Full sandboxing on Windows (unsupported by current sandbox runtime).
- Packaging/signing and installer UX polish (separate PRD).

## Platform Requirements

### Platform Breakdown

#### macOS (primary)

- Full feature parity (including audio capture sidecar).
- Bundled Node + pnpm preferred, system fallback ok.
- Uses macOS process/port tooling for cleanup (lsof/pgrep/kill).

#### Windows (first-class)

- Resolve home path via `%USERPROFILE%` or `%HOMEDRIVE%%HOMEPATH%`.
- Use Windows-native process/port tools (tasklist/netstat/taskkill).
- Ship AI server sidecar **plus** audio-capture **stub** sidecar to satisfy bundling.
- Commands and PATH resolution use `where` + Windows path delimiter.

#### Linux (best-effort)

- Resolve home path via `$HOME`.
- Use Unix process/port tools where available.
- Ship AI server sidecar **plus** audio-capture **stub** sidecar to satisfy bundling.

### Paths + Environment

- `MOLDABLE_HOME` should resolve from:
  1. `HOME` if set
  2. `USERPROFILE`
  3. `HOMEDRIVE` + `HOMEPATH`
- All backend code uses a single path helper (no string concatenation).
- Frontend uses a cross-platform join strategy when composing data paths.
- Tauri filesystem allowlist includes Windows home variables.

### Bundled Runtime

- `download-node-runtime.js` supports Windows (zip download + extraction).
- Runtime discovery prefers bundled Node/pnpm; uses correct binary names (`node.exe`, `pnpm.cmd`).
- PATH construction uses platform delimiter and includes Windows system paths.

### Process + Port Management

- Port availability checks work without `lsof` on Windows.
- Process discovery uses platform-appropriate commands or `sysinfo` on Windows.
- Process tree kill works on Windows (`taskkill /T /F`) and Unix (signals).

### Tooling (AI/MCP)

- PATH augmentation and command discovery use `path.delimiter` and `where` on Windows.
- Executable resolution recognizes Windows absolute paths and `.exe`/`.cmd` suffixes.

## Implementation Plan

1. **Paths & Environment**
   - Add a unified home dir resolver in Rust (`paths.rs`).
   - Replace `HOME`-only usage in Tauri backend with the helper.
   - Update frontend to build data paths without hardcoded `/`.
   - Update Tauri allowlists to include `$USERPROFILE`.

2. **Bundled Runtime**
   - Extend `download-node-runtime.js` for Windows zip extraction.
   - Update runtime detection for Windows binary names and layout.
   - Make PATH building platform-aware in Rust.

3. **Process + Port**
   - Add Windows implementations for:
     - `is_process_running`
     - `get_port_info`, `is_port_available`, `kill_port(_aggressive)`
     - `kill_process_tree`
   - Ensure `cleanup_stale_ai_servers` avoids `pgrep` on Windows.

4. **Shared Node Packages**
   - Update `packages/ai` PATH augmentation and `which` usage.
   - Update `packages/mcp` path resolution and `which` usage.

5. **Sidecars & Bundling**
   - Keep macOS audio capture sidecar (Swift) intact.
   - Add non-macOS audio capture **stub** binary so Windows/Linux bundling succeeds.
   - Ensure Windows sidecars use `.exe` naming and debug copies where needed.

6. **Tests**
   - Add Windows-specific unit tests for path resolution and process/port logic.
   - Make PATH tests platform-aware (delimiter + expected system paths).
   - Guard Unix-only tests with `cfg(unix)`.

## Risks & Mitigations

- **Windows command availability**: Use built-ins (`where`, `taskkill`, `netstat`) with graceful fallback.
- **Resource layout differences**: Prefer a `MOLDABLE_RESOURCE_DIR` override; fallback to `current_exe` search.
- **Path delimiter mismatch**: Normalize via `std::env::join_paths` / `path.delimiter`.

## Test Plan

### Automated

- Rust: `cargo test` on macOS and Windows, with platform-conditional tests enabled.
- JS/TS: unit tests updated to accept platform delimiters and Windows paths.
- Sidecar build scripts: validate stub creation on Windows/Linux (audio-capture).

### Manual sanity

- **macOS**: audio capture availability check + sidecar start/stop (if supported OS).
- **Windows**: launch desktop app and verify it can start a Next.js app under `%USERPROFILE%\\.moldable`.
- **Windows**: verify port conflicts resolve and taskkill cleanup succeeds.
- **Linux (best-effort)**: start app, confirm PATH and sidecar launch.

## Acceptance Criteria

- No hard-coded macOS-only paths remain for core runtime/paths/process/ports.
- Windows build can bundle Node runtime and run app installs without manual PATH edits.
- Port/process cleanup does not rely on `lsof/pgrep/kill` on Windows.
- Test suite passes on macOS; Windows-specific tests compile and validate Windows behaviors.
