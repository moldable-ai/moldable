# Changesets

This folder contains "changesets" - markdown files that describe package changes.

## Adding a Changeset

When you make changes to a package that should be released, run:

```bash
pnpm changeset
```

This will prompt you to:

1. Select which packages have changed
2. Choose the bump type (major/minor/patch)
3. Write a summary of the changes

## Releasing

Releases are automated via GitHub Actions. When changesets are merged to main:

1. A "Version Packages" PR is created/updated
2. When that PR is merged, packages are published to npm

## Manual Release (if needed)

```bash
pnpm changeset version  # Update versions based on changesets
pnpm changeset publish  # Publish to npm
```
