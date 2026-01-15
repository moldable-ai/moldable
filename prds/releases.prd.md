# Releases

Moldable has two release tracks: **npm packages** and the **desktop app**.

## NPM Packages

Uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing `@moldable-ai/*` packages.

### Adding a Changeset

```bash
pnpm changeset
```

Select affected packages, bump type (patch/minor/major), and describe the change.

### Release Flow

1. Push to `main` with changesets
2. GitHub Action creates a "Version Packages" PR
3. Merge the PR to publish to npm

## Desktop App

Uses git tags to trigger GitHub Actions builds. Release notes are maintained manually in `desktop/CHANGELOG.md`.

### Writing Release Notes

Before releasing, update `desktop/CHANGELOG.md`:

```markdown
## [Unreleased]

- Added onboarding flow for new users
- Fixed webview crash when loading apps
- Improved chat panel performance
```

The release script will move these notes under the new version heading.

### Release Commands

```bash
# Bump patch version (0.1.0 -> 0.1.1)
pnpm release:desktop patch

# Bump minor version (0.1.0 -> 0.2.0)
pnpm release:desktop minor

# Bump major version (0.1.0 -> 1.0.0)
pnpm release:desktop major

# Set specific version
pnpm release:desktop 1.0.0

# Preview without changes
pnpm release:desktop minor --dry-run
```

### What Happens

1. Script checks for release notes in `desktop/CHANGELOG.md` under `[Unreleased]`
2. Moves unreleased notes under the new version heading
3. Bumps version in `desktop/package.json`, `tauri.conf.json`, and `Cargo.toml`
4. Commits with message `release: desktop vX.Y.Z`
5. Creates annotated tag `desktop-vX.Y.Z`
6. Pushes to trigger the release workflow
7. GitHub Release is created with notes from the changelog

### Build Artifacts

The workflow builds for:

- macOS Apple Silicon (aarch64)
- macOS Intel (x86_64)

Artifacts are uploaded to GitHub Releases as `.dmg` installers.

### Manual Workflow Dispatch

You can also trigger a release manually from GitHub Actions:

1. Go to Actions → Release Desktop
2. Click "Run workflow"
3. Enter version and whether to create as draft

## Linking from Marketing Site

```
# Latest release page
https://github.com/moldable-ai/moldable/releases/latest

# Direct download (replace version)
https://github.com/moldable-ai/moldable/releases/download/desktop-v0.2.0/Moldable_0.2.0_aarch64.dmg
```

## Code Signing (Future)

The desktop workflow has placeholders for Apple code signing. Add these secrets when ready:

- `APPLE_CERTIFICATE` - Base64 encoded .p12
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` - For notarization
