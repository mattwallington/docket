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

## Menu bar

Docket installs a menu-bar (tray) icon. Click it to:

- *Show Docket* — bring the window forward (works after closing/hiding).
- Pick from your *Favorites* and *Recents* — opens the file in the window directly.
- *Quit Docket*.

## Open a specific file

```sh
docket /path/to/file.md          # from a packaged install
npm start -- /path/to/file.md    # from source
open -a Docket /path/to/file.md  # from Finder / macOS
```

If the file isn't inside a configured root, Docket opens it for the current session and offers to add the parent directory as a root.

## Sidebar

Sections (Favorites, Recents, Pinned READMEs, file browser) render as collapsible cards. Drag a card by its header to reorder; drag a favourite within its card to curate the order. Order and collapse state persist in `~/.docket/state.json`.

## Tabs

Files open in tabs at the top of the window. Click a file in the sidebar to open it as a new tab; if it's already open, docket switches to its tab. Drag a tab to reorder. Click `×` to close. Right-click a tab for `Add to Favorites`, `Close`, `Close Others`, `Reveal in Finder`. Open tabs persist across launches.

The favorite star (★) shows in the tab when the file is favorited; otherwise the tab is bare. Toggle via the right-click menu or the `☆ Favorite` button in the status bar.

## Status bar

The bottom row shows the active file's path, creation time, and last-modified time. The right side has a view-mode dropdown (`Auto` / `Checklist` / `Markdown`) that's saved per file, plus the favorite toggle. When an update is available, a green pill appears in the status bar — click it to download, click again to restart.

## Task instructions + voice playback

Indented bullets under any task in a checklist file are now treated as detailed instructions. They render collapsed by default. Click the task row to slide them open. Click the play button (▶) to have docket read them aloud — pause / resume on subsequent clicks. The currently-spoken word is highlighted as it's read. Voice quality follows your macOS system voices (System Settings → Accessibility → Spoken Content lets you install premium voices like Ava, Evan, Samantha).

## Checklist format

See [`format.md`](format.md) for the checklist markdown convention — frontmatter plus `## Phase` headings plus `- [ ] **ID. Title**` tasks.

## Development

```sh
npm start            # launch dev app
npm test             # run node --test
npm run test:security  # automated IPC security assertions
npm run test:golden    # headless smoke test (launch → open → live refresh)
npm run test:cli       # CLI argv smoke test (no crash within 10s)
npm run build:icon     # regenerate assets/icon.icns + icon-dev.icns from SVG
```

## Releasing

Releases are driven by `scripts/release.sh`.

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
