# Contributing

Thanks for your interest in improving `paidmcp-client`.

## How to contribute

1. Open an issue first for non-trivial changes.
2. Keep PRs small and focused.
3. Add or update docs when behavior changes.
4. Run local checks before opening a PR:

```bash
npm run check
npm run format:check
```

## Pull request checklist

- Clear title and summary
- Linked issue (if applicable)
- Tests/checks pass locally
- No secrets or private endpoints committed

## Releasing (maintainers)

Releases are automatic. To ship a new version, bump `version` in `package.json` and merge to `main`:

```bash
npm version minor --no-git-tag-version
```

The `Release` workflow then runs the checks, publishes to npm with provenance, and creates the `vX.Y.Z` tag and GitHub Release on that commit. Versions with a suffix (`1.2.0-beta.1`) are published under the npm `next` tag and marked as pre-releases.

Every step skips work that is already done, so a failed release can simply be re-run. To add a missing tag or GitHub Release for an older version, run the workflow manually (Actions → Release → Run workflow) with `ref` set to that version's commit. The workflow needs the `NPM_TOKEN` repository secret.

## Scope

This is a solo-maintained project, so review/merge timing can vary. Thanks for the patience.
