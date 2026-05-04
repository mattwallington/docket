# CLAUDE.md — docket project guidance

Project-specific guidance for Claude Code sessions in this repo. Conventions in `~/.claude/rules/` still apply globally.

## Releasing — stream live progress

`./scripts/release.sh` takes **5–15 minutes** end to end. Always run it in the background (`run_in_background: true`) AND stream progress to the user as it happens. Don't leave them waiting in silence.

### Expected steps (~9 milestones)

| # | Step | Typical time |
|---|---|---|
| 1 | Preflight | ~1s |
| 2 | Version calculation | <1s |
| 3 | Update versions (npm install + write files) | 5–10s |
| 4 | Commit + tag | <1s |
| 5 | Build — package x64 | 5–10s |
| 6 | Build — sign x64 | 5–10s |
| 7 | **Build — notarize x64** | **2–5 min** ← long pole |
| 8 | Build — DMG/zip x64 | 10–30s |
| 9 | Build — package arm64 | 5–10s |
| 10 | Build — sign arm64 | 5–10s |
| 11 | **Build — notarize arm64** | **2–5 min** ← long pole |
| 12 | Build — DMG/zip arm64 | 10–30s |
| 13 | Locate artifacts | <1s |
| 14 | Push branch + tag | 5–30s |
| 15 | GitHub release (upload ~600MB) | 30–120s |

The two notarization rounds dominate. Communicate which one is in flight so the user knows what's left.

### How to report progress

`release.sh` separates streams:

- **stdout** — only emits `STATUS:<id>[:<detail>]` markers, one per line, intended for tooling
- **stderr** — colored, human-readable output (the `── Preflight ──` headers, `[info]/[ok]/[warn]` lines, electron-builder output, etc.)

When you run the script via the Bash tool with `run_in_background: true`, the output file captures both streams interleaved. **Use the Monitor tool** with a regex matching the stdout markers:

```
Monitor: tail -F <output-file>
Match pattern: ^STATUS:
```

The marker vocabulary (in order):

| `STATUS:` line | Meaning |
|---|---|
| `STATUS:start` | Script started |
| `STATUS:preflight` | Checking prereqs (gh auth, branch, clean tree) |
| `STATUS:version_calc` | Computing the new version |
| `STATUS:version:<v>` | Resolved new version (e.g. `STATUS:version:0.1.7`) |
| `STATUS:update_versions` | Writing VERSION + bumping package.json + npm install |
| `STATUS:commit_tag` | Committing the bump + tagging |
| `STATUS:build_start` | electron-builder starting (long pole begins) |
| `STATUS:notarize_done:x64` | x64 notarization completed (first ~3-5 min over) |
| `STATUS:notarize_done:arm64` | arm64 notarization completed (second ~3-5 min over) |
| `STATUS:build_complete` | Both archs signed, notarized, packaged |
| `STATUS:locate_artifacts` | Verifying expected DMG/ZIP/yml files exist |
| `STATUS:push` | Pushing branch + tag to origin |
| `STATUS:github_release` | Uploading artifacts to GitHub release (~30-120s) |
| `STATUS:done:v<v>` | Release published |
| `STATUS:error:<msg>` | Aborted with the given message |

Report each transition to the user as `Step <name> — <human description>` so they can see how far along it is. Notarization is the long pole — keep them updated especially during those.

When the script is run interactively (no Bash tool), the user sees the colored stderr output directly. The stdout markers go nowhere by default (or can be redirected: `./scripts/release.sh > /tmp/release.status`).

### Network / build failures

`hdiutil resize: Resource temporarily unavailable (35)` is a known transient failure during the arm64 DMG step. If it happens, recover by:

1. `git reset --hard <prev-commit>` to drop the version-bump commit (the script committed before the build failed)
2. `git tag -d v<new-version>` to drop the local tag
3. `rm -rf dist/`
4. Re-run `./scripts/release.sh`

The artifacts that DID get built and signed are wasted, but the script will rebuild from scratch.

If the failure is in the **push** step (SSH timeout, network blip), don't reset — the artifacts are valid. Recover by:

1. `git push origin main` (retry the branch push)
2. `git push origin v<version>` (retry the tag push)
3. `gh release create v<version> --title "Docket v<version>" --generate-notes <artifact files...>` (skip the script's own gh-release step)

## Other notes

- `docs/superpowers/` is gitignored. LLM-agent planning artifacts go there and don't ship to the public repo.
- Test suites: `npm test` (unit), `npm run test:security` (IPC sandbox), `npm run test:golden` (E2E renderer), `npm run test:cli` (CLI argv smoke). All four should pass before merging anything.
