# App Install and Startup Reliability Hardening

## Problem

App installs and startup recovery are not fully robust. Several edge cases can leave apps in a stalled state, fail to clean up orphaned Next processes, or introduce security and data corruption risks. This is unacceptable for mission critical usage where startup must always recover.

## Goals

- Make app install and startup flows deterministic, safe, and recoverable.
- Prevent app stalls caused by orphaned processes, stale locks, or partial installs.
- Eliminate race conditions in install, start, and config updates.
- Ensure logs are always emitted for failures and recovery actions.
- Maintain backward compatibility with existing app layouts and configs.

## Non-Goals

- Redesign the entire app registry or workspace model.
- Change app frameworks or packaging requirements.
- Implement a full multi-process supervisor beyond current lifecycle management.

## Current Behavior (Observed)

- Registry downloads and extracts directly into `~/.moldable/shared/apps/{app-id}`.
- Process cleanup kills PIDs listed in `.moldable.instances.json` without verifying they still belong to the app.
- Startup lock handling can kill a live process if the preferred port is not responding yet.
- Port selection for new app registration only considers config, not OS port availability.
- Config and install state files are read/modify/written without locks or atomic swaps.

## Critical Failure Modes

1. Zip extraction path traversal (zip slip) can write outside the app directory.
2. PID reuse can lead to killing unrelated processes during orphan cleanup.
3. Concurrent install/start can run `pnpm install` twice and spawn multiple processes.
4. Partial extraction leaves a broken app that is treated as "already downloaded."
5. Startup lock logic can kill a valid app while it is booting or listening on a different port.
6. Port assignment can select a port already in use by another process.
7. Registry fetch/install can hang indefinitely due to missing HTTP timeouts.
8. Temp extraction directory collisions can occur on concurrent installs.
9. Config and install state files can be corrupted or lose updates under concurrent writes.
10. Malformed `.moldable.instances.json` fails silently, so cleanup is skipped without logs.

## Requirements

### Safety and Security

- Never write files outside the target app directory during install.
- Never kill a process unless it is verified to belong to the target app.

### Robustness

- All installs must be atomic: either a fully valid app is present, or nothing changes.
- Startup must recover from orphaned processes and stale locks every time.
- Concurrency must not cause duplicate processes or corrupted configs.

### Observability

- Every cleanup action and failure must be logged and surfaced to app logs.
- Failed cleanup must explicitly note what was left running and why.

## Proposed Fixes

### 1) Harden Zip Extraction

- Use `zip::read::ZipFile::enclosed_name()` to reject unsafe paths.
- Reject absolute paths and `..` segments.
- Ensure every extracted path remains within `app_dir` (canonicalize and check prefix).
- Extract into a staging directory, then atomically move into `app_dir`.
- If extraction fails, delete staging and leave existing app untouched.

Target file: `desktop/src-tauri/src/registry.rs`

### 2) Atomic Install Staging

- Download and extract into `~/.moldable/cache/install-staging/{app-id}-{random}`.
- Verify:
  - `package.json` exists
  - `moldable.json` if present is parseable
  - expected app path exists after extraction
- Move staging to `shared/apps/{app-id}` via atomic rename:
  - If `app_dir` exists, rename it to a backup temp location, move staging in, then remove backup.
  - If rename fails, restore the previous version.

Target file: `desktop/src-tauri/src/registry.rs`

### 3) Per-App Install and Start Locks

- Add an in-memory `Mutex<HashMap<AppId, Mutex>>` or `tokio::sync::Mutex` to serialize:
  - install per app
  - start per app
- Use a file lock if installs can happen across processes (future-proof).

Target files:

- `desktop/src-tauri/src/registry.rs`
- `desktop/src-tauri/src/process.rs`

### 4) PID Ownership Verification

- Before killing a PID from `.moldable.instances.json`, confirm:
  - process command line contains the app path, or
  - parent chain includes the app launcher, or
  - PID matches `.next/dev/lock` and command line includes app path.
- If verification fails, log and skip kill.
- If PID appears reused, treat as untrusted and do not kill.

Target file: `desktop/src-tauri/src/process.rs`

### 5) Smarter Next Lock Handling

- Treat a running PID with matching app path as a valid instance even if the preferred port is not responding yet.
- Attempt to discover the actual port from `.moldable.instances.json` or probe for responding ports recorded there.
- Only kill when:
  - PID is orphaned, or
  - PID does not match the app path, or
  - lock belongs to a stale instance and no port responds.

Target file: `desktop/src-tauri/src/process.rs`

### 6) Real Port Availability Checks

- Replace `find_available_port` logic with a real OS-level port check:
  - use `ports::is_port_available` or `ports::find_free_port`
  - avoid selecting ports already in use by other processes

Target file: `desktop/src-tauri/src/apps.rs`

### 7) Timeouts for Registry Network Calls

- Use a `reqwest::Client` with timeouts:
  - connect timeout: 5s
  - request timeout: 15s
- Surface timeout errors in install state.

Target file: `desktop/src-tauri/src/registry.rs`

### 8) Unique Temp Directories

- Use `tempfile::Builder` to create a unique extraction directory.
- Avoid deterministic `temp_dir/app-id` naming.

Target file: `desktop/src-tauri/src/registry.rs`

### 9) Atomic Config and Install State Writes

- Write to a temp file and `rename` into place (atomic swap).
- Add a simple file lock around config and install state updates to avoid clobbering.
- Cap install history length (for example, 50 entries) to avoid unbounded growth.

Target files:

- `desktop/src-tauri/src/apps.rs`
- `desktop/src-tauri/src/install_state.rs`

### 10) Explicit Logging for Invalid Instance Files

- If `.moldable.instances.json` fails to parse, log a warning and record a log line for the app.
- Keep the file for inspection; do not silently ignore.

Target file: `desktop/src-tauri/src/process.rs`

## Acceptance Criteria

- Registry installs never write outside the app directory.
- Concurrent installs of the same app are serialized and do not corrupt the app.
- Startup cleanup never kills unrelated processes.
- Apps recover from orphaned Next processes without manual intervention.
- App logs show cleanup actions and any failures.
- Config updates are atomic and never partially written.
- Port selection avoids ports already in use.
- Registry fetch and download always timeout with actionable errors.

## Test Plan

### Unit Tests

- Zip extraction rejects `../` and absolute paths.
- PID verification rejects a process without app path in command line.
- Lock handling returns running status for live PID even when port is not yet responding.
- Config write uses atomic rename and preserves data under concurrent writes.

### Integration Tests

- Simulate orphaned Next process with stale lock and verify cleanup on startup.
- Simulate concurrent install requests for same app and ensure only one install runs.
- Simulate partial extraction and verify atomic recovery.

## Observability

- Add log lines for:
  - start of cleanup
  - processes killed, skipped, or failed to kill
  - invalid instance file parse
  - install staging and atomic swap steps
- Ensure app logs include cleanup messages for visibility in UI.
