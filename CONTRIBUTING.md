# Contributing to Project Nomad

## Branch Structure

Project Nomad uses a three-tier release pipeline:

```
feature branches → dev (unstable) → main (stable) → lts
```

| Branch | Purpose | Releases |
|--------|---------|----------|
| `dev` | Active development. All feature branches merge here. | Unstable pre-releases (automatic) |
| `main` | Stable releases. Only `dev` can merge here. | Stable releases (automatic) |
| `lts` | Long-term support. Only `main` can merge here. | LTS patch releases (automatic) |

## How to Contribute

### 1. Open an Issue First

**Features require an issue.** Before starting work on a new feature, open a feature request issue. This is how the automation knows what kind of version bump to apply.

Bug fixes can be submitted without a pre-existing issue, but referencing one is still recommended.

| Issue Type | Label Applied | Version Effect |
|------------|---------------|----------------|
| Bug report | `bug` | Patch bump |
| Feature request | `feature` | Minor bump |
| Simple task | `task` | Patch bump |

### 2. Create a Branch from `dev`

```bash
git checkout dev
git pull origin dev
git checkout -b your-branch-name
```

Name your branch anything descriptive: `fix-map-zoom`, `feature-kml-export`, `issue-42`, etc.

### 3. Make Your Changes and Commit

Reference the issue number in your commit messages:

```bash
git commit -m "fix: correct timezone offset in weather display (#47)"
git commit -m "feat: add KML export to model results (#88)"
```

Commit message prefixes are optional but encouraged:

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Maintenance, tooling |

### 4. Open a Pull Request to `dev`

Push your branch and open a PR targeting `dev`:

```bash
git push origin your-branch-name
```

Then create a PR on GitHub targeting the `dev` branch.

### 5. What Happens After Merge

When your change is merged into `dev`, the **patch** version is bumped and an **unstable pre-release** is automatically built and published to GitHub Releases, tagged with that version (e.g. `v0.13.2`) and marked as a pre-release.

## How Releases Work

### Unstable (dev)

Every merge to `dev` bumps the **patch** version in `frontend/package.json` and publishes a pre-release. The patch digit counts the changes accumulated on the current line: `0.5.13` means thirteen changes since `0.5.0`. These builds are for testing and are not intended for production.

### Stable (main)

When the maintainer is ready to cut a stable release, they open a PR from `dev` to `main`. On merge, the CI automation:

1. Bumps the **minor** version in `frontend/package.json` — a merge to `main` *is* the release,
   so `0.5.13` becomes `0.6.0`. The patch digit resets, and the minor digit identifies the
   released line.
   - Unless the PR is labeled `release:major`, which bumps **major** instead (manual override)
2. Regenerates `CHANGES.md` from git history
3. Creates a git tag and GitHub Release with the built tarball
4. Merges the released version back into `dev`, so development continues from `0.6.1`

The bump level does **not** depend on issue labels. It previously did, which meant a release's
version was decided by how issues happened to be labelled rather than by the release itself (#348).

### LTS (lts)

When a stable release is designated for long-term support, the maintainer merges `main` into `lts`. This always applies a **patch** bump and creates an LTS-tagged release.

## Branch Rules

These rules are enforced by CI:

- **PRs to `main`** must come from `dev` — no other branch is accepted
- **PRs to `lts`** must come from `main` — no other branch is accepted
- **PRs to `dev`** can come from any feature branch

## Summary

1. Open an issue (required for features, recommended for bugs)
2. Branch from `dev`
3. Reference issues in commits (`#NNN`)
4. PR to `dev`
5. Automation handles versioning and releases from there
