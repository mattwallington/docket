# docket

Native macOS markdown docs browser with auto-detected checklist rendering.

Point it at any directory of markdown files. It renders plain markdown for ordinary docs and a progress-bar / phase-card view for files shaped like checklists (frontmatter + `- [ ]` tasks). Live-refreshes when files change on disk.

## Install

**From source** (current):

```sh
git clone https://github.com/<you>/docket.git ~/Development/docket
cd ~/Development/docket
npm install
npm start
```

**Signed DMG**: download the latest from [Releases](https://github.com/mattwallington/docket/releases) (once published).

## First run

On first launch, docket creates `~/.docket/docket.json` and an empty `~/.docket/projects/` directory. Drop markdown files into `~/.docket/projects/` to see them in the sidebar.

To browse another directory (e.g. `~/docs/`), open Preferences (`⌘,`) → Roots → Add root…

## Configuration

All config lives in `~/.docket/`:

- `docket.json` — configured roots, theme preference.
- `state.json` — recents list, per-file view-mode overrides.
- `projects/` — default root; add your own or replace with other roots via Preferences.

## Keyboard

- `⌘F` — focus search
- `⌘,` — open Preferences
- `⌘Q` — quit

## Checklist format

See [`format.md`](format.md) for the checklist markdown convention — frontmatter plus `## Phase` headings plus `- [ ] **ID. Title**` tasks.

## Development

```sh
npm start            # launch dev app
npm test             # run node --test
npm run test:security  # automated IPC security assertions
npm run test:golden    # headless smoke test (launch → open → live refresh)
npm run build:icon     # regenerate assets/icon.icns + icon-dev.icns from SVG
```

## Releasing

Releases are driven by `scripts/release.sh`, ported from repo-radar.

```sh
./scripts/release.sh                # patch bump (0.1.0 → 0.1.1)
./scripts/release.sh --minor        # 0.1.0 → 0.2.0
./scripts/release.sh --major        # 0.1.0 → 1.0.0
./scripts/release.sh --dry-run      # show planned actions, no changes
```

Branch policy:
- `main` → stable channel: `Docket.app`, `appId=com.mattwallington.docket`
- `dev` → pre-release channel: `Docket Dev.app`, `appId=com.mattwallington.docket-dev`, version suffix `-dev.YYYYMMDDHHMM`, distinct icon. Stable and dev installs coexist with independent user data.

What `release.sh` does:
1. Preflight (git clean, gh authed, correct branch)
2. Bump `VERSION` + `package.json.version`
3. Commit + tag `v<version>`
4. `electron-builder` signs + notarizes arm64 and x64 builds
5. Validates the 5 expected artifacts
6. Pushes branch + tag
7. Creates the GitHub release (`--prerelease` on dev) with DMG + ZIP + `latest-mac.yml`

Prerequisites for a real release:
- `gh` CLI authenticated
- Apple Developer ID Application cert in Keychain (`Matthew Wallington (5S875AN2HU)`)
- Env vars set: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID=5S875AN2HU`
- Auto-updates happen in-app via `electron-updater`, which reads `latest-mac.yml` from the latest GitHub release. Dev builds only see dev pre-releases; stable builds only see stable.

## License

MIT
