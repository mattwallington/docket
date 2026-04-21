# docket — Electron app design

**Status:** Approved for implementation
**Date:** 2026-04-20
**Author:** Matt Wallington (with Claude)

## Purpose

Convert docket from a containerized Python web-service + static SPA into a native macOS Electron app that browses arbitrary user-configured markdown directories. Core use cases:

1. Browse and read any markdown file in `~/.docket/projects/` (default root) or user-added roots like `~/docs/`.
2. Auto-detect checklist-shaped files and render them with the existing progress-bar / phase-card / task-chip UI.
3. Live refresh as files change on disk (no manual polling).
4. Ship as a signed + notarized `.dmg` with auto-updates, mirroring the repo-radar release pipeline.

## Out of scope for v1

- Editing files (later phases).
- Tabs / multi-file panes.
- Cross-platform builds (macOS only).
- Cloud sync or multi-machine state.

## Stack

Vanilla Electron + plain HTML/CSS/JS renderer. No bundler, no framework. Dependencies:

- `electron` — runtime
- `electron-builder` — packaging + sign/notarize
- `electron-updater` — auto-update client
- `chokidar` — file watching in the main process
- `marked` — markdown → HTML (bundled from `node_modules`, not CDN)
- `dompurify` — HTML sanitizer
- `@vscode/ripgrep` — prebuilt `rg` binaries for content search
- `write-file-atomic` — atomic file writes (used in Phase 3)

Rationale: the existing `web/app.js` is ~370 lines of vanilla renderer code that already implements the checklist parser, sidebar, collapsibles, and markdown rendering. Porting it to Electron is a two-file add (main.js, preload.js) and swapping two `fetch()` calls for IPC. A framework (React/Vite) would be strictly overhead for a ~2-screen app.

## Architecture

```
docket/                                 # repo root
├── VERSION                             # plain version string, bumped by release.sh
├── package.json                        # electron-builder config lives here
├── main.js                             # main process: window, config, IPC, chokidar
├── preload.js                          # contextBridge IPC surface
├── renderer/
│   ├── index.html                      # main window
│   ├── app.js                          # ported from web/app.js, IPC-driven
│   ├── styles.css                      # dark theme (unchanged)
│   ├── settings.html                   # preferences window
│   └── settings.js
├── lib/
│   └── parser.js                       # checklist parser (extracted for testing)
├── entitlements.plist                  # Phase 2
├── assets/
│   ├── icon.icns                       # stable
│   └── icon-dev.icns                   # dev channel
├── scripts/
│   ├── release.sh                      # ported from repo-radar
│   └── create-installer.js             # packages zips for release
└── docs/
    ├── superpowers/specs/              # design docs
    └── ...
```

User data (all in `~/.docket/` — visible, backup-able):

```
~/.docket/
├── docket.json                         # config: roots, theme
├── state.json                          # recents, per-file view overrides
└── projects/                           # default root, seeded empty
```

Hidden in Electron `userData` (`~/Library/Application Support/docket/`):

- Window size / position (Chromium auto-managed)
- Collapsed phase IDs (localStorage, renderer-scoped)
- electron-updater scratch dir

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the BrowserWindow.
- All filesystem and native access exposed via `contextBridge.exposeInMainWorld('docket', {...})` in `preload.js`.
- IPC is promise-based: `ipcMain.handle` / `ipcRenderer.invoke`.
- Content-Security-Policy meta tag in `index.html`: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';`. No remote origins. `unsafe-inline` is required because `marked` output is injected as HTML; DOMPurify sanitizes everything before injection.
- `entitlements.plist` grants only what Electron needs for hardened runtime + user-selected file reads (no sandbox — docket reads user-chosen paths).

## IPC surface (preload.js → renderer)

```js
window.docket = {
  getConfig(): Promise<Config>,
  updateConfig(partial): Promise<Config>,         // writes ~/.docket/docket.json
  listFiles(rootId): Promise<FileEntry[]>,        // recursive, .md only
  readFile(absolutePath): Promise<string>,
  searchFilenames(query): Promise<FileEntry[]>,   // in-memory substring match
  searchContent(query): Promise<SearchHit[]>,     // spawns ripgrep
  cancelSearch(): void,
  getState(): Promise<AppState>,                  // recents, overrides
  updateState(partial): Promise<AppState>,
  onFileChange(cb): () => void,                   // unsubscriber
  onConfigChange(cb): () => void,
  openSettingsWindow(): void,
  getVersion(): Promise<{ version, channel, buildDate }>,
  checkForUpdates(): Promise<void>,               // Phase 2
}
```

Types:

```ts
type Config = { roots: Root[], theme?: 'light' | 'dark' | 'system' }
type Root = { id: string, path: string, label: string }
type FileEntry = { rootId: string, absolutePath: string, relativePath: string, mtime: number, size: number }
type SearchHit = { absolutePath: string, line: number, snippet: string }
type AppState = {
  recents: { absolutePath: string, openedAt: number }[],
  overrides: Record<string /* absolutePath */, 'checklist' | 'markdown'>
}
```

## Data flow

### Startup

1. Main process reads `~/.docket/docket.json`. If missing, seeds default `{ roots: [{ id: 'projects', path: '~/.docket/projects', label: 'Projects' }] }` and `mkdir -p ~/.docket/projects/`.
2. Main process builds the in-memory **filename index**: walk each root recursively, include `.md` only, skip `.git/`, `node_modules/`, dotdirs, `.DS_Store`. Emit `FileEntry[]` per root.
3. Main process starts `chokidar.watch(roots.map(r => r.path), { ignored: ..., ignoreInitial: true })`. On `add` / `change` / `unlink`, update the in-memory index and `webContents.send('file-change', {...})` to the renderer.
4. Renderer calls `getConfig()`, `getState()`, `listFiles(rootId)` to populate the sidebar. If `state.json` has a last-opened path that still exists, opens it.

### File selection

1. User clicks a file in the sidebar (recents, search, or browse tree).
2. Renderer calls `window.docket.readFile(absolutePath)`.
3. Renderer parses frontmatter + body, decides view mode (auto-detect OR per-file override), renders.
4. Renderer calls `updateState({ recents: ... })` with the new file at the top.

### Live refresh

1. Chokidar fires `change` for a file in any watched root.
2. Main sends `file-change` to renderer.
3. Renderer: update sidebar index, and if the active file was the one that changed, silently refetch + rerender (preserve scroll + collapsed-state).

### Search

- **Filename search** — renderer filters the in-memory list by case-insensitive substring match on both the basename and the full `relativePath`. Basename matches rank higher than path-segment matches. Instant.
- **Content search** — renderer calls `window.docket.searchContent(query)` (debounced 150ms). Main process spawns `rg --json -i --max-count 5 -e "<query>" <root-paths>`. Streams JSON lines, accumulates hits, returns top 50. Next call cancels any in-flight `rg`.
- Results UI: two sections — "Files" (filename/path match) and "In content" (body match with line + snippet). Click a content hit → opens the file, scrolls to the line (Phase 5 scrolls; Phase 1 just opens).

## Rendering

Based on the existing `web/app.js` (which is renamed to `renderer/app.js` in Phase 1). Adjustments:

- Port the parser to `lib/parser.js` so it's testable without a DOM.
- **View mode decision**:
  1. Per-file override in `state.overrides[path]` wins if present.
  2. Else if frontmatter contains `name`, `description`, `project`/`repo`, or `status` → checklist.
  3. Else if body contains `- [ ]` or `- [x]` anywhere → checklist.
  4. Else plain markdown.
- **Checklist view** — existing render (progress bar, phase cards with collapsible state, task chips with done/pending/blocked styling). Blocked rules from `format.md` apply unchanged.
- **Plain markdown view** — `marked.parse(body)` through `DOMPurify.sanitize()`. No checklist affordances.
- **Per-file toggle** — header shows a small "View as: [checklist ▾]" / "[markdown ▾]" control. Changing it updates `state.overrides[path]`.

## Sidebar

Top-down layout:

1. **Search box** — `⌘F` focuses. Typing populates two collapsible result sections (Files + In content). Clearing the box restores Recents + Browse.
2. **Recents** — last ≤10 opened files, most-recent first. Click to open. Pin (later phase) sticks at the top.
3. **Browse** — collapsible, one section per root. Each root is `<details>` with the root label; contents are nested folders (also `<details>`) with alphabetized files. Main returns a flat `FileEntry[]` per root via `listFiles(rootId)`; the renderer groups entries by directory path segments into a tree at render time.

If a root has > 5000 files, its entry in "Browse" shows a warning ribbon and filename-only indexing (content search still works via ripgrep directly, no index needed there).

## Settings window

Separate `BrowserWindow` (~500×400), opened via `⌘,` or menu → Preferences. Three panes in a left rail:

1. **Roots** — ordered list of `{label, path}` rows with "remove" buttons. "Add root…" opens a native folder picker and writes to `docket.json`. Label defaults to basename, editable in-place.
2. **Appearance** — theme: System / Light / Dark (System default).
3. **About** — version, channel, build date (from `build-info.json`), "Check for updates now" button (Phase 2).

Main window listens via `onConfigChange` and refreshes the sidebar.

## Error boundaries

| Scenario | Behavior |
|---|---|
| Bad frontmatter (malformed YAML, missing close `---`) | Skip frontmatter, render body; amber "⚠ invalid frontmatter" chip in header. |
| File deleted while open | Active pane: "This file was moved or deleted." Sidebar entry disappears. |
| File changed externally | Silent rerender; preserve scroll + collapsed state. |
| Root directory missing / permission denied | Root greyed in sidebar with "unavailable" tooltip; files hidden from recents / search. |
| File read fails (I/O) | Error in pane with "Retry" button. |
| Root has > 5000 files | Filename index skipped; sidebar warning banner; content search still works via rg. |

No crashes, no silent failures, no stuck states.

## Phasing

### Phase 1 — v1 Viewer

**Goal:** Runs on Matt's two Macs via `npm start`. Unsigned `.app` available if wanted. No release pipeline yet.

Included:
- Electron skeleton (main.js, preload.js) with security model above.
- Config + state at `~/.docket/docket.json` / `~/.docket/state.json`; first-run seeding.
- `lib/parser.js` (extracted from existing `web/app.js`).
- Renderer ported: IPC instead of `fetch()`, bundled marked + DOMPurify, per-file view toggle, error chips.
- Sidebar: search box (filenames instant + ripgrep content debounced), recents, browse tree per root.
- Chokidar live refresh.
- Settings window (Roots + Appearance + About — About shows version from `package.json`, no updater yet).

Delete during this phase: `docker-compose.yml`, `Dockerfile`, `install.sh`, and the entire `docket/` Python package directory.

Rename: `web/` → `renderer/`.

Keep + update: `format.md` (paths), `README.md` (full rewrite for Electron), `agent-rule.md` (new default path `~/.docket/projects/`).

**Tests:**
- Manual golden path: launch → sidebar populates → click file → renders → edit externally → updates in <1s.
- First-run seeding: start with no `~/.docket/` → launch docket → `docket.json` + `state.json` + empty `projects/` dir all created; "Projects" root visible in sidebar.
- `lib/parser.js` unit tests (run via `node --test`, no framework): frontmatter parse, H2 phases, `[ ]`/`[x]` detection, blocked rules (note contains "blocked" / "E2E pending", section name contains "blocked"), view-mode auto-detection.
- IPC security check: verify `window.electronRequire` and `window.process` are undefined in renderer DevTools; renderer cannot read paths outside configured roots via IPC (out-of-root `readFile` calls rejected in main).
- Content search: type a query string present in a file body → a "In content" result appears with the correct file + line + snippet.
- Settings round-trip: add root, confirm `docket.json` updated, restart, root persists; remove root, confirm it disappears from sidebar.
- Error boundaries: rename active file externally → pane shows moved/deleted message; corrupt YAML frontmatter → amber chip; unreadable permission → graceful error.

**Ship gate:** open app, pick file, see it render, edit externally, updates — without crashes.

### Phase 2 — Release pipeline

**Goal:** Install via signed `.dmg` without Gatekeeper warning; auto-updates happen in-app. Mirrors repo-radar.

Included:
- `entitlements.plist`: `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, `network.client`, `files.user-selected.read-write`.
- electron-builder config in `package.json`:
  - `mac.identity`: `"Matthew Wallington (5S875AN2HU)"`
  - `mac.hardenedRuntime: true`
  - `mac.gatekeeperAssess: false`
  - `mac.notarize: { teamId: "5S875AN2HU" }`
  - `publish: { provider: 'github', owner: 'mattwallington', repo: 'docket' }`
  - Targets: `dir`, `dmg`, `zip` for both `arm64` and `x64`.
- `VERSION` file (plain `0.1.0` to start). `release.sh` keeps `package.json.version` and `package-lock.json` in sync.
- `build-info.json` emitted by `release.sh` pre-build: `{version, channel, buildDate, buildTimestamp}`.
- **Dev/stable coexistence** — on `dev` branch, `release.sh` temporarily rewrites `package.json` to set `appId: com.mattwallington.docket-dev`, `productName: "Docket Dev"`, `icon: assets/icon-dev.icns`. Version gets `-dev.YYYYMMDDHHMM` suffix. Reverted after build.
- Single-instance lock keyed by `appId`.
- `electron-updater` setup in main.js: `autoDownload = false`, `autoInstallOnAppQuit = false`; dev channel sets `allowPrerelease = true`. Dialog flow: "Update available → Download / Later" → "Ready → Restart Now / Later" → `quitAndInstall()`. Check at startup+5s, then every 4h.
- `release.sh` ported from repo-radar verbatim except names — `--patch`/`--minor`/`--major`/`--dry-run`, branch preflight, VERSION bump, commit + tag, build arm64 + x64, create GitHub release with DMG + ZIP + `latest-mac.yml` attached, `--prerelease` on dev. Prerequisites on any machine doing releases: `gh` CLI authenticated, Apple Developer cert in Keychain, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars set for notarization.

**Tests:**
- `./release.sh --dry-run` on both `main` and `dev`.
- `codesign --verify --deep --strict --verbose=2 "Docket.app"` → exit 0.
- `stapler validate "Docket.app"` → "The validate action worked!"
- Fresh download → double-click DMG → drag to Applications → launch without right-click. No Gatekeeper warning on either arch.
- Auto-update round-trip: install `0.1.0`, push `0.1.1` release, trigger "Check for updates", confirm dialog, download, restart → app is `0.1.1`.
- Same round-trip on dev channel with `-dev.*` versions.
- Channel isolation: stable install never gets prompted for a dev pre-release; dev install gets both.
- Dev + stable installed side-by-side, both launch, distinct icons + menubar identity, independent `userData` dirs.

**Ship gate:** `./release.sh` on main → 1 min later a GitHub release exists → installed docket auto-prompts for update.

### Phase 3 — Checkbox toggling

**Goal:** Click a task in checklist view to toggle `[ ]` ↔ `[x]` without opening an editor.

Included:
- Click handler on task icon/row in checklist view; no effect in plain markdown view.
- `toggleTaskLine(fileText, taskIdent)` in `lib/parser.js`: pure function, takes current file contents + task identity (phase name + title, to disambiguate duplicates), returns new file contents with just that checkbox flipped.
- Atomic write via `write-file-atomic` (temp file + fsync + rename).
- **External-edit protection** — before writing, main compares current on-disk mtime + short content hash to the value at last successful load. If mismatch, abort + toast: "File changed externally. Reload and try again." Safer than merging.
- **Self-write suppression** — chokidar `change` events within 500ms of a self-initiated write are ignored (prevents rerender flicker).
- `state.overrides[path] === 'markdown'` → read-only (toggle UI disabled).

**Tests:**
- Golden: click pending task → file on disk flips to `[x]` → UI updates.
- External concurrent edit: open file → edit externally → try toggle → abort + toast; original external edit preserved.
- Rapid toggling: click 5× quickly → final state is correct (no torn writes).
- Idempotency: toggle `[x] → [ ] → [x]` → byte-diff around the line is identical to start.
- Unit tests for `toggleTaskLine`: nested phases, duplicate titles across phases, notes, trailing whitespace, Windows CRLF.

**Ship gate:** toggle a box, file updates, no clobbering.

### Phase 4 — WYSIWYG markdown editor

**Goal:** Edit mode for any markdown file.

Included:
- **Library selection** — upfront evaluation with round-trip tests against ~20 files from `~/docs/`. Selection criterion: open each file → save without edits → `diff` must be empty for all. First library to pass wins. Candidates, ranked by expected fit:
  1. **Milkdown** — ProseMirror-based, plugin-driven, designed for markdown fidelity. First choice.
  2. **Lexical** — Meta's, flexible; more DIY for markdown round-trip.
  3. **TipTap** — great UX but HTML-native; markdown round-trip via plugin, potential drift.
  4. **MDXEditor** — batteries-included but heaviest; requires React, which would otherwise be a new dependency for docket.
- "Edit / View" toggle in header, per file. Default is View.
- Frontmatter parsed + stripped, edited body only, re-concatenated on save.
- Unsaved-changes guard on file-switch and window-close.
- External edit while editor open: toast with Reload / Keep editing options; Keep editing then Save hits the same mtime-guard as Phase 3.

**Tests:**
- Fidelity round-trip: open 20 files from `~/docs/`, save unchanged, diff each → no change.
- Frontmatter preservation: edit body, save, frontmatter block byte-identical.
- Unsaved-change guard: dirty file, try to switch → prompt blocks.
- External edit race: Phase 3 scenario with editor mode instead.
- Large file: 500KB markdown doc loads and saves without UI lag.

**Ship gate:** open any file, flip to Edit, modify, save, reopen — content survives the round-trip cleanly.

### Phase 5 — Parking lot

Prioritize later; not designed in detail yet:

- Tabs (`⌘T`, `⌘W`).
- Reorder roots in settings.
- Pin files (sticky above Recents).
- Export to PDF.
- Syntax highlighting for fenced code blocks (highlight.js).
- Git status indicators on files in git repos.
- Content-search result → jumps to the line in the opened file.

## Testing strategy summary

| Phase | Automated | Manual |
|---|---|---|
| 1 | `lib/parser.js` unit tests; IPC security assertions | Golden path; external-edit refresh; settings round-trip; error boundaries |
| 2 | `release.sh --dry-run`; `codesign --verify`; `stapler validate` | Fresh DMG install on clean Mac; update round-trip on stable + dev; dev/stable coexistence |
| 3 | `toggleTaskLine` unit tests; atomic-write concurrency tests | Toggle flow; concurrent-edit abort toast; rapid-click integrity |
| 4 | Round-trip diff on 20 `~/docs/` samples | Edit/View toggle; unsaved-change guard; external-edit race; large file |

## Open questions

None. All decisions made during brainstorming.

## References

- repo-radar's Electron + sign/notarize + electron-updater setup: `~/Development/Reperio/repos/repo-radar/menubar/package.json`, `release.sh`, `entitlements.plist`, `main.js`.
- Existing docket SPA logic to port: `~/Development/docket/web/app.js`, `styles.css`, `index.html`.
- Checklist format spec: `~/Development/docket/format.md`.
