Release a new version. Determines the bump type from recent commits, runs
the full checklist, tags, pushes, and creates a GitHub release.

## Steps

1. **Determine bump type** from commits since the last tag:
   - If `$ARGUMENTS` is `major`, `minor`, or `patch`, use that directly.
   - Otherwise, inspect `git log $(git describe --tags --abbrev=0)..HEAD --oneline`:
     - Any commit mentioning "breaking" or "BREAKING CHANGE" -> major
     - Any commit with `feat:` prefix or new tool registrations -> minor
     - Otherwise -> patch

2. **Calculate next version**: parse the latest tag (`git describe --tags --abbrev=0`),
   increment the appropriate component, reset lower components to 0.

3. **Pre-flight checks** (abort on failure):
   - `git status` must show a clean working tree (no uncommitted changes)
   - `git branch --show-current` must be `main`
   - `bun run lint` must pass
   - `bun test` must pass

4. **Version bump**: update the `version` field in both
   `package.json` and `src/index.ts` (the `version` string in the `Server` constructor),
   then commit with message `chore: bump version to <MAJOR>.<MINOR>.<PATCH>`.

5. **Tag and release**:
   - `git tag v<MAJOR>.<MINOR>.<PATCH>`
   - `git push origin main`
   - `git push origin v<MAJOR>.<MINOR>.<PATCH>`
   - `gh release create v<MAJOR>.<MINOR>.<PATCH> --generate-notes`

6. **Report**: print the new version, release URL, and a one-line summary.
