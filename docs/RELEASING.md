# Releasing opencode-token-norm

Distribution: the public npm package `opencode-token-norm`, plus a GitHub release created from `CHANGELOG.md`.

Automation lives in [`.github/workflows/release.yml`](../.github/workflows/release.yml). Pushing a `v*` tag runs: tag/version guard, `npm ci`, `npm run build`, `npm publish` via npm Trusted Publishing (OIDC, provenance auto-generated), then `gh release create` with the matching changelog section as notes.

## npm authentication

The workflow uses Trusted Publishing; there is no `NPM_TOKEN` secret.

- Publisher binding: `salitaba/opencode-token-norm`, workflow file `release.yml`, permissions `publish, stage publish`.
- The workflow filename is part of the binding. Renaming `release.yml` breaks publishing.
- Configure or inspect with `npm trust list opencode-token-norm` or `npm trust github opencode-token-norm --file release.yml --repo salitaba/opencode-token-norm --allow-publish` (requires browser 2FA).
- `--allow-publish` matters: trusted publishers created after 2026-09-03 default to stage-only, which makes `npm publish` fail. `npm trust list` must show `publish` in permissions.

## Pre-release checks

- [ ] Feature/fix work is merged to `main` and `git status` is clean.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes and `dist/` is regenerated (it is gitignored; CI builds it).
- [ ] Version bumped in `package.json` and `package-lock.json`: `npm version <major|minor|patch> --no-git-tag-version`.
- [ ] `CHANGELOG.md` has a new `## [x.y.z] - YYYY-MM-DD` section, newest first, and updated compare links.
- [ ] The changelog heading exactly matches `## [x.y.z]`; the workflow awk-extracts that section for the release notes and fails if empty.
- [ ] No version references elsewhere (README, docs/promo.md) are left stale.
- [ ] If plugin behavior changed, the live dev copy at `~/.config/opencode/plugins/handoff.js` is synced after `npm run build` (it is not updated by npm).
- [ ] Changes are committed and pushed to `main` before tagging.

## Release steps

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
gh run list --workflow release.yml --limit 1
gh run watch <run-id> --exit-status
```

## Post-release verification

```bash
npm view opencode-token-norm version
gh release view vX.Y.Z
```

Confirm the npm page shows the new version with the provenance badge, and the GitHub release notes match the changelog section.

## Failure recovery

- Tag pushed, workflow failed before `npm publish` succeeded: fix the problem, then delete and re-push the same tag (`git tag -d vX.Y.Z`, `git push origin :refs/tags/vX.Y.Z`, re-tag). Reusing the version is safe because nothing was published.
- `npm publish` already succeeded: never reuse the version. Bump a patch, add a new changelog entry, and tag again.
- `ENEEDAUTH` during publish: verify the trusted publisher fields are exact (repo, `release.yml`), that `id-token: write` is in the workflow, and that the runner is GitHub-hosted. Self-hosted runners are not supported.
