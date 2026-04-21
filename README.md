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

**Signed DMG**: coming in Phase 2.

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
npm start        # launch dev app
npm test         # run node --test
```

## License

MIT
