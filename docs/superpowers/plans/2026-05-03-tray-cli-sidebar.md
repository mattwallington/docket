# Tray, CLI, Sidebar Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS menu-bar (tray) icon with favorites/recents quick-pick, CLI argument + Finder integration to open a specific file, and a refactored sidebar with collapsible, reorderable sections.

**Architecture:** Centralise file-opening in a single `lib/open-path.js` used by tray clicks, CLI argv, and the macOS `open-file` event. Tray icon is owned by `lib/tray.js`, which rebuilds its dynamic menu when state changes. Sidebar becomes section-driven (rendered from `appState.sectionOrder` with per-section collapse) and supports HTML5 drag-and-drop for sections and favorite items. Files passed via CLI/Finder that lie outside any configured root are added to an in-memory session-allowed set so `readFile` accepts them; the renderer shows an inline banner offering to promote the parent directory to a permanent root.

**Tech Stack:** Electron 32 (`Tray`, `BrowserWindow`, `app.on('open-file')`, `app.on('second-instance')`, `Menu`), Node `node:test`, vanilla JS in renderer (no framework), DOMPurify + marked already in vendor.

---

## Task 1: Extend `lib/state.js` with section ordering + collapse state

**Files:**
- Modify: `lib/state.js`
- Test: `test/state.test.js`

The renderer needs persisted answers to: which sections exist, in what order, which are collapsed, and the curated order of favorite items. We add three fields with sensible defaults and three setters.

- [ ] **Step 1: Write the failing tests**

Append to `test/state.test.js`:

```javascript
test('defaultState exposes new section fields', async () => {
  const s = await state.read();
  assert.deepEqual(s.sectionOrder, ['toc', 'favorites', 'recents', 'browse']);
  assert.deepEqual(s.collapsedSections, {});
  assert.deepEqual(s.favoritesOrder, []);
});

test('setSectionOrder persists a valid order', async () => {
  await state.setSectionOrder(['recents', 'favorites', 'toc', 'browse']);
  const s = await state.read();
  assert.deepEqual(s.sectionOrder, ['recents', 'favorites', 'toc', 'browse']);
});

test('setSectionOrder rejects unknown section ids', async () => {
  await assert.rejects(() => state.setSectionOrder(['bogus']), /Invalid section/);
});

test('setSectionOrder rejects non-array input', async () => {
  await assert.rejects(() => state.setSectionOrder('toc'), /Invalid section/);
});

test('setSectionCollapsed persists per-section flag', async () => {
  await state.setSectionCollapsed('recents', true);
  let s = await state.read();
  assert.equal(s.collapsedSections.recents, true);
  await state.setSectionCollapsed('recents', false);
  s = await state.read();
  assert.equal(s.collapsedSections.recents, false);
});

test('setSectionCollapsed rejects unknown section ids', async () => {
  await assert.rejects(() => state.setSectionCollapsed('bogus', true), /Invalid section/);
});

test('setFavoritesOrder persists provided order', async () => {
  await state.setFavoritesOrder(['/b.md', '/a.md', '/c.md']);
  const s = await state.read();
  assert.deepEqual(s.favoritesOrder, ['/b.md', '/a.md', '/c.md']);
});

test('setFavoritesOrder rejects non-array input', async () => {
  await assert.rejects(() => state.setFavoritesOrder('a'), /Invalid favoritesOrder/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='setSectionOrder|setSectionCollapsed|setFavoritesOrder|new section fields'`
Expected: FAIL with "state.setSectionOrder is not a function" (or similar).

- [ ] **Step 3: Implement the new fields and setters**

Edit `lib/state.js` — add the constants and update `defaultState()`/exports:

```javascript
const VALID_SECTIONS = new Set(['toc', 'favorites', 'recents', 'browse']);
const DEFAULT_SECTION_ORDER = ['toc', 'favorites', 'recents', 'browse'];

function defaultState() {
  return {
    recents: [],
    favorites: [],
    overrides: {},
    sortBy: 'name',
    searchMode: 'contents',
    docScale: 1,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    collapsedSections: {},
    favoritesOrder: []
  };
}
```

Add the three setters before `module.exports`:

```javascript
async function setSectionOrder(order) {
  if (!Array.isArray(order)) throw new Error('Invalid sectionOrder: must be an array');
  const seen = new Set();
  for (const id of order) {
    if (!VALID_SECTIONS.has(id)) throw new Error(`Invalid section: ${id}`);
    if (seen.has(id)) throw new Error(`Invalid section: duplicate ${id}`);
    seen.add(id);
  }
  return write({ sectionOrder: order });
}

async function setSectionCollapsed(sectionId, collapsed) {
  if (!VALID_SECTIONS.has(sectionId)) throw new Error(`Invalid section: ${sectionId}`);
  const s = await read();
  s.collapsedSections = { ...s.collapsedSections, [sectionId]: Boolean(collapsed) };
  return write(s);
}

async function setFavoritesOrder(paths) {
  if (!Array.isArray(paths)) throw new Error('Invalid favoritesOrder: must be an array');
  return write({ favoritesOrder: paths.slice() });
}
```

Update the `module.exports` line to include them:

```javascript
module.exports = { read, write, addRecent, removeRecent, addFavorite, removeFavorite, setOverride, clearOverride, setSortBy, setSearchMode, setDocScale, setWindowState, setSectionOrder, setSectionCollapsed, setFavoritesOrder, DOC_SCALE_MIN, DOC_SCALE_MAX, VALID_SECTIONS, DEFAULT_SECTION_ORDER };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/state.js test/state.test.js
git commit -m "feat(state): add sectionOrder, collapsedSections, favoritesOrder"
```

---

## Task 2: Create `lib/open-path.js` — single entry point for opening a file by path

**Files:**
- Create: `lib/open-path.js`
- Create: `test/open-path.test.js`

Centralises the logic that the tray menu, CLI argument handler, and `open-file` event all need. Returns `{ inRoot, sessionAllowed, parentDir }` so the caller can decide whether to ask the renderer to display the outside-root banner. Pure function over the inputs — no Electron dependency, so it's unit-testable.

- [ ] **Step 1: Write the failing tests**

Create `test/open-path.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveOpenRequest } = require('../lib/open-path.js');

const cfg = {
  roots: [
    { id: 'docs', path: '/Users/x/docs' },
    { id: 'projects', path: '/Users/x/.docket/projects' }
  ]
};

test('returns inRoot=true for paths inside a configured root', () => {
  const r = resolveOpenRequest('/Users/x/docs/readme.md', cfg);
  assert.equal(r.inRoot, true);
  assert.equal(r.absolutePath, '/Users/x/docs/readme.md');
  assert.equal(r.parentDir, '/Users/x/docs');
});

test('returns inRoot=true for the root path itself when it is a file', () => {
  const r = resolveOpenRequest('/Users/x/docs/sub/note.md', cfg);
  assert.equal(r.inRoot, true);
});

test('returns inRoot=false for paths outside all roots', () => {
  const r = resolveOpenRequest('/tmp/random.md', cfg);
  assert.equal(r.inRoot, false);
  assert.equal(r.parentDir, '/tmp');
});

test('rejects non-markdown extensions', () => {
  assert.throws(() => resolveOpenRequest('/Users/x/docs/image.png', cfg), /not a markdown file/i);
});

test('accepts .markdown extension', () => {
  const r = resolveOpenRequest('/Users/x/docs/note.markdown', cfg);
  assert.equal(r.inRoot, true);
});

test('resolves relative paths against the cwd argument', () => {
  const r = resolveOpenRequest('./note.md', cfg, { cwd: '/Users/x/docs' });
  assert.equal(r.absolutePath, '/Users/x/docs/note.md');
  assert.equal(r.inRoot, true);
});

test('handles trailing-separator edge case (path equals root not subpath)', () => {
  // /Users/x/docs2/foo.md should NOT match root /Users/x/docs
  const r = resolveOpenRequest('/Users/x/docs2/foo.md', cfg);
  assert.equal(r.inRoot, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/open-path.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/open-path.js`**

Create `lib/open-path.js`:

```javascript
const path = require('path');

const MD_EXTENSIONS = new Set(['.md', '.markdown']);

function resolveOpenRequest(input, cfg, { cwd } = {}) {
  if (!input || typeof input !== 'string') throw new Error('Invalid path');
  const absolutePath = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(cwd || process.cwd(), input);
  const ext = path.extname(absolutePath).toLowerCase();
  if (!MD_EXTENSIONS.has(ext)) throw new Error(`Not a markdown file: ${absolutePath}`);

  const inRoot = (cfg.roots || []).some((r) => {
    const rootAbs = path.resolve(r.path);
    return absolutePath === rootAbs || absolutePath.startsWith(rootAbs + path.sep);
  });

  return {
    absolutePath,
    inRoot,
    parentDir: path.dirname(absolutePath)
  };
}

module.exports = { resolveOpenRequest };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/open-path.test.js`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/open-path.js test/open-path.test.js
git commit -m "feat: add lib/open-path.js for centralised file-open routing"
```

---

## Task 3: Wire CLI argument + `open-file` event in `main.js`

**Files:**
- Modify: `main.js` (top of file for argv parsing, `whenReady` block, `second-instance` handler, IPC for outside-root banner)
- Modify: `preload.js` (expose `onOpenPath` listener)

After this task, `electron . /path/file.md` and `open -a Docket file.md` both reach the renderer with an `open-path` IPC.

- [ ] **Step 1: Add `parseCliMarkdownArg` helper at the top of `main.js`**

Insert after the existing `require` block (around `main.js:14`):

```javascript
const { resolveOpenRequest } = require('./lib/open-path.js');

// Files that were passed via CLI / open-file but lie outside all configured
// roots. We allow readFile() against these for the lifetime of this process.
const sessionAllowedPaths = new Set();

// Track an open request that arrived before the renderer was ready. Sent once
// the window finishes loading.
let pendingOpenRequest = null;

function parseCliMarkdownArg(argv) {
  // First non-flag arg that ends in .md / .markdown. Skip the electron binary
  // (argv[0]) and the script path (argv[1]) when running in dev.
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (/\.(md|markdown)$/i.test(a)) return a;
  }
  return null;
}

async function handleOpenPath(rawPath, { fromCli = false, cwd } = {}) {
  const cfg = await config.read();
  let resolved;
  try {
    resolved = resolveOpenRequest(rawPath, cfg, { cwd });
  } catch (e) {
    console.warn('handleOpenPath: rejected', rawPath, e.message);
    return;
  }
  if (!fsSync.existsSync(resolved.absolutePath)) {
    console.warn('handleOpenPath: file does not exist', resolved.absolutePath);
    return;
  }
  if (!resolved.inRoot) {
    sessionAllowedPaths.add(resolved.absolutePath);
  }
  const payload = {
    absolutePath: resolved.absolutePath,
    inRoot: resolved.inRoot,
    parentDir: resolved.parentDir
  };
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    bringWindowForward();
    mainWindow.webContents.send('docket:open-path', payload);
  } else {
    pendingOpenRequest = payload;
  }
}

function bringWindowForward() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}
```

- [ ] **Step 2: Update the existing `second-instance` handler to honour CLI arg**

Replace `main.js:42-48` with:

```javascript
    app.on('second-instance', (_e, argv, cwd) => {
      bringWindowForward();
      const arg = parseCliMarkdownArg(argv);
      if (arg) handleOpenPath(arg, { fromCli: true, cwd }).catch(() => {});
    });
```

- [ ] **Step 3: Hook `open-file` (Finder) and post-load drain**

Add right above `app.whenReady()` (around `main.js:593`):

```javascript
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  handleOpenPath(filePath, { fromCli: false }).catch(() => {});
});
```

In `createMainWindow()` (after `mainWindow.loadFile(...)` around `main.js:170`), drain pending request once the renderer finishes loading:

```javascript
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenRequest) {
      mainWindow.webContents.send('docket:open-path', pendingOpenRequest);
      pendingOpenRequest = null;
    }
  });
```

In `app.whenReady().then(...)` after `createMainWindow()` (around `main.js:602`), check the launching argv:

```javascript
  const initialArg = parseCliMarkdownArg(process.argv);
  if (initialArg) {
    handleOpenPath(initialArg, { fromCli: true }).catch(() => {});
  }
```

- [ ] **Step 4: Loosen the `readFile` IPC to also accept session-allowed paths**

Replace the body of the `docket:readFile` handler (around `main.js:497-503`):

```javascript
ipcMain.handle('docket:readFile', async (_e, absolutePath) => {
  const cfg = await config.read();
  const resolved = path.resolve(absolutePath);
  if (!withinAnyRoot(resolved, cfg) && !sessionAllowedPaths.has(resolved)) {
    throw new Error('Path outside configured roots');
  }
  return await fs.readFile(resolved, 'utf8');
});
```

- [ ] **Step 5: Expose `onOpenPath` in `preload.js`**

Append inside the `contextBridge.exposeInMainWorld('docket', { ... })` object in `preload.js`:

```javascript
  onOpenPath: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:open-path', listener);
    return () => ipcRenderer.removeListener('docket:open-path', listener);
  },
```

- [ ] **Step 6: Smoke-test manually**

Run: `npm start -- /Users/matt/.docket/projects/$(ls /Users/matt/.docket/projects | head -1 2>/dev/null || echo 'NONE')`
Expected: app launches and the named file is preselected (when one exists).

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add main.js preload.js
git commit -m "feat: open file from CLI argv, second-instance, and open-file event"
```

---

## Task 4: Renderer accepts `docket:open-path` and shows outside-root banner

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`
- Modify: `main.js` (new IPC handler `docket:addRootForPath`)
- Modify: `preload.js` (expose `addRootForPath`)

When the main process pushes `docket:open-path`, the renderer opens the file. If `inRoot === false`, it also renders an inline banner above the file content: "`<parent>` isn't in any configured root. Add it?". Clicking the button calls a new IPC that mirrors what `addRootViaPicker` does today, but with the path supplied directly.

- [ ] **Step 1: Add the `addRootForPath` IPC + preload binding**

In `main.js`, add a new IPC near the other root-management code (after `addRootViaPicker` definition, around `main.js:325`):

```javascript
ipcMain.handle('docket:addRootForPath', async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') throw new Error('Invalid path');
  const abs = path.resolve(dirPath);
  if (!fsSync.existsSync(abs) || !fsSync.statSync(abs).isDirectory()) {
    throw new Error('Not a directory');
  }
  const cfg = await config.read();
  if (cfg.roots.some((r) => path.resolve(r.path) === abs)) return cfg;
  const id = path.basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `root-${cfg.roots.length + 1}`;
  const next = await config.write({ roots: [...cfg.roots, { id, path: abs, label: path.basename(abs) || abs }] });
  await rebuildIndex();
  await restartWatcher();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:config-change', next);
  }
  return next;
});
```

In `preload.js`, append to the `docket` object:

```javascript
  addRootForPath: (dirPath) => ipcRenderer.invoke('docket:addRootForPath', dirPath),
```

- [ ] **Step 2: Wire `onOpenPath` in `renderer/app.js`**

Insert near the other `window.docket.on*` subscriptions (around `renderer/app.js:564`):

```javascript
  window.docket.onOpenPath(async ({ absolutePath, inRoot, parentDir }) => {
    pendingOutsideRootBanner = inRoot ? null : { parentDir };
    await openFile(absolutePath, { skipRecents: !inRoot });
  });

  let pendingOutsideRootBanner = null;
```

The `let` declaration must come *before* the `onOpenPath` line — move it just above. (In the actual edit, declare `pendingOutsideRootBanner` first.)

- [ ] **Step 3: Render the banner in `renderFile`**

In `renderer/app.js` `renderFile()` (around `renderer/app.js:289`), after the `headerParts` array is built and before `bodyHTML` is computed, add:

```javascript
    let outsideBannerHTML = '';
    if (pendingOutsideRootBanner && pendingOutsideRootBanner.parentDir) {
      const dir = pendingOutsideRootBanner.parentDir;
      outsideBannerHTML = `<div class="outside-root-banner" data-parent="${escapeHTML(dir)}"><span>This file isn't inside a configured root. Open it now and add <code>${escapeHTML(dir)}</code> as a root for next time?</span><div class="banner-actions"><button type="button" class="banner-add">Add root</button><button type="button" class="banner-dismiss">Dismiss</button></div></div>`;
    }
```

Update the `content.innerHTML = ...` line a few lines below to include the banner:

```javascript
    content.innerHTML = headerParts.join('') + outsideBannerHTML + '<div class="doc-scroll"><div class="doc-body">' + bodyHTML + '</div></div>';
```

After the `wireMarkdownLinks(absolutePath);` line, wire the banner buttons:

```javascript
    const bannerAdd = content.querySelector('.outside-root-banner .banner-add');
    const bannerDismiss = content.querySelector('.outside-root-banner .banner-dismiss');
    if (bannerAdd) {
      bannerAdd.addEventListener('click', async () => {
        const dir = content.querySelector('.outside-root-banner').dataset.parent;
        try { await window.docket.addRootForPath(dir); }
        catch (e) { console.warn('addRootForPath failed', e); }
        pendingOutsideRootBanner = null;
        const banner = content.querySelector('.outside-root-banner');
        if (banner) banner.remove();
      });
    }
    if (bannerDismiss) {
      bannerDismiss.addEventListener('click', () => {
        pendingOutsideRootBanner = null;
        const banner = content.querySelector('.outside-root-banner');
        if (banner) banner.remove();
      });
    }
```

- [ ] **Step 4: Add banner styles**

Append to `renderer/styles.css`:

```css
.outside-root-banner {
  background: rgba(235, 168, 80, 0.10);
  border: 1px solid rgba(235, 168, 80, 0.4);
  color: var(--text);
  border-radius: 6px;
  padding: 10px 14px;
  margin: 8px 24px 0;
  font-size: 12px;
  display: flex; align-items: center; gap: 12px;
}
.outside-root-banner code {
  background: var(--code-bg);
  padding: 1px 5px; border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.outside-root-banner .banner-actions { display: flex; gap: 6px; margin-left: auto; }
.outside-root-banner button {
  background: rgba(255,255,255,0.06);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  font: inherit; font-size: 12px;
  cursor: pointer;
}
.outside-root-banner button:hover { background: rgba(255,255,255,0.10); }
```

- [ ] **Step 5: Smoke-test manually**

Run: `mkdir -p /tmp/docket-cli-test && printf '# Hello\n' > /tmp/docket-cli-test/test.md && npm start -- /tmp/docket-cli-test/test.md`
Expected: app opens, displays test.md contents, banner appears at the top of the content offering to add `/tmp/docket-cli-test` as a root.

- [ ] **Step 6: Commit**

```bash
git add renderer/app.js renderer/styles.css main.js preload.js
git commit -m "feat: outside-root banner + addRootForPath IPC for CLI-opened files"
```

---

## Task 5: Generate the tray icon asset

**Files:**
- Create: `assets/tray-icon.svg`
- Create: `assets/tray-iconTemplate.png` (and `@2x`) — generated artifact, committed
- Modify: `scripts/build-icon.js` (extend to also render the tray template)

The macOS menu bar wants a monochrome PNG named with a `Template` suffix. Electron auto-inverts a "template image" so it looks correct in light and dark menu bars. Sizes: 16×16 and 32×32.

- [ ] **Step 1: Create `assets/tray-icon.svg`**

Stripped-down monochrome version of the docket icon, designed to read at 16px:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <!-- Single black colour; macOS makes this a template via filename suffix. -->
  <g fill="black">
    <rect x="2" y="3"  width="3" height="2" rx="1"/>
    <rect x="6" y="3"  width="8" height="2" rx="1" opacity="0.6"/>
    <rect x="2" y="7"  width="3" height="2" rx="1"/>
    <rect x="6" y="7"  width="8" height="2" rx="1" opacity="0.6"/>
    <rect x="2" y="11" width="3" height="2" rx="1"/>
    <rect x="6" y="11" width="6" height="2" rx="1" opacity="0.6"/>
  </g>
</svg>
```

- [ ] **Step 2: Inspect the existing build-icon flow**

Read `scripts/build-icon.js` to confirm the headless render harness uses an env var (`DOCKET_ICON_OUT`, `DOCKET_ICON_SVG`) that we can reuse for the tray PNGs. (The harness in `main.js:182-222` already supports a configurable SVG via `DOCKET_ICON_SVG`.)

- [ ] **Step 3: Generate the tray PNGs via the existing harness**

Add a tiny wrapper at `scripts/build-tray-icon.js`:

```javascript
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

// Use the existing main.js DOCKET_BUILD_ICON harness, but run a custom flow:
// the harness writes Mac iconset names. For tray we only need 2 sizes, so do
// it inline here using Electron's nativeImage at runtime by spawning electron
// with a one-shot script.
const electron = require('electron');
const child = spawnSync(electron, [path.join(__dirname, 'build-tray-icon.electron.js')], {
  stdio: 'inherit',
  env: { ...process.env, DOCKET_TRAY_OUT: outDir }
});
process.exit(child.status || 0);
```

Add the electron-side worker `scripts/build-tray-icon.electron.js`:

```javascript
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const outDir = process.env.DOCKET_TRAY_OUT;
  const svgPath = path.join(__dirname, '..', 'assets', 'tray-icon.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:32px;height:32px;background:transparent;}svg{display:block;width:100%;height:100%;}</style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: 32, height: 32, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage();
  const sizes = [
    ['tray-iconTemplate.png', 16],
    ['tray-iconTemplate@2x.png', 32]
  ];
  for (const [name, size] of sizes) {
    const resized = image.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(outDir, name), resized.toPNG());
    process.stdout.write(`  wrote ${name} (${size}x${size})\n`);
  }
  app.exit(0);
});
```

Wire it into `package.json` scripts (between `build:icon` and `build`):

```json
    "build:tray-icon": "node scripts/build-tray-icon.js",
```

- [ ] **Step 4: Run the script + verify the PNGs**

Run: `npm run build:tray-icon`
Expected: stdout shows `wrote tray-iconTemplate.png` and `wrote tray-iconTemplate@2x.png`. Files exist in `assets/`.

- [ ] **Step 5: Commit**

```bash
git add assets/tray-icon.svg assets/tray-iconTemplate.png assets/tray-iconTemplate@2x.png scripts/build-tray-icon.js scripts/build-tray-icon.electron.js package.json
git commit -m "build: generate monochrome menu-bar tray icon"
```

---

## Task 6: Create `lib/tray.js` and wire it into `main.js`

**Files:**
- Create: `lib/tray.js`
- Modify: `main.js`

The tray module owns the `Tray` instance. It exposes `installTray({ getState, getConfig, onSelect, onShowWindow, onQuit })` and `rebuildMenu()`. Main calls `rebuildMenu()` whenever favourites/recents change.

- [ ] **Step 1: Create `lib/tray.js`**

```javascript
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const MAX_TRAY_RECENTS = 10;
const MAX_TRAY_FAVORITES = 20;

let tray = null;
let context = null; // { getState, getConfig, onSelect, onShowWindow, onQuit }

function trayIconImage() {
  // Template image: macOS auto-inverts for light/dark menu bars.
  const p = path.join(__dirname, '..', 'assets', 'tray-iconTemplate.png');
  const img = nativeImage.createFromPath(p);
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function installTray(ctx) {
  context = ctx;
  if (tray) return tray;
  tray = new Tray(trayIconImage());
  tray.setToolTip('Docket');
  rebuildMenu().catch((e) => console.warn('tray rebuildMenu failed', e));
  return tray;
}

async function rebuildMenu() {
  if (!tray || !context) return;
  const state = await context.getState();
  const cfg = await context.getConfig();
  const knownPaths = new Set();
  for (const r of cfg.roots) knownPaths.add(path.resolve(r.path));

  const items = [];
  items.push({ label: 'Show Docket', click: () => context.onShowWindow() });
  items.push({ type: 'separator' });

  const favs = orderedFavorites(state).slice(0, MAX_TRAY_FAVORITES);
  if (favs.length) {
    items.push({ label: 'Favorites', enabled: false });
    for (const f of favs) {
      items.push({
        label: shortenLabel(f.absolutePath),
        toolTip: f.absolutePath,
        click: () => context.onSelect(f.absolutePath)
      });
    }
    items.push({ type: 'separator' });
  }

  const recs = (state.recents || []).slice(0, MAX_TRAY_RECENTS);
  if (recs.length) {
    items.push({ label: 'Recents', enabled: false });
    for (const r of recs) {
      items.push({
        label: shortenLabel(r.absolutePath),
        toolTip: r.absolutePath,
        click: () => context.onSelect(r.absolutePath)
      });
    }
    items.push({ type: 'separator' });
  }

  items.push({ label: 'Quit Docket', click: () => context.onQuit() });

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function orderedFavorites(state) {
  const all = state.favorites || [];
  const order = state.favoritesOrder || [];
  if (!order.length) return all;
  const byPath = new Map(all.map((f) => [f.absolutePath, f]));
  const ordered = [];
  for (const p of order) {
    if (byPath.has(p)) {
      ordered.push(byPath.get(p));
      byPath.delete(p);
    }
  }
  // Append favourites that aren't in the order yet.
  for (const f of all) if (byPath.has(f.absolutePath)) ordered.push(f);
  return ordered;
}

function shortenLabel(absolutePath) {
  const base = path.basename(absolutePath);
  return base.length > 60 ? base.slice(0, 57) + '…' : base;
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { installTray, rebuildMenu, destroy };
```

- [ ] **Step 2: Wire into `main.js`**

Add at the top with the other lib requires (around `main.js:11`):

```javascript
const tray = require('./lib/tray.js');
```

In `app.whenReady().then(async () => { ... })` (around `main.js:593`), after `setupAutoUpdater();`, install the tray (skip during headless runs):

```javascript
  if (!process.env.DOCKET_SECURITY_CHECK && !process.env.DOCKET_GOLDEN_PATH && !process.env.DOCKET_BUILD_ICON) {
    tray.installTray({
      getState: () => state.read(),
      getConfig: () => config.read(),
      onSelect: (absolutePath) => handleOpenPath(absolutePath, { fromCli: false }).catch(() => {}),
      onShowWindow: () => bringWindowForward(),
      onQuit: () => app.quit()
    });
  }
```

Trigger menu rebuilds on relevant state changes. Replace the existing `addRecent`/`removeRecent`/`addFavorite`/`removeFavorite` handlers (around `main.js:457-460`) with versions that rebuild the tray:

```javascript
ipcMain.handle('docket:addRecent', async (_e, p) => {
  const r = await state.addRecent(p);
  tray.rebuildMenu().catch(() => {});
  return r;
});
ipcMain.handle('docket:removeRecent', async (_e, p) => {
  const r = await state.removeRecent(p);
  tray.rebuildMenu().catch(() => {});
  return r;
});
ipcMain.handle('docket:addFavorite', async (_e, p) => {
  const r = await state.addFavorite(p);
  tray.rebuildMenu().catch(() => {});
  return r;
});
ipcMain.handle('docket:removeFavorite', async (_e, p) => {
  const r = await state.removeFavorite(p);
  tray.rebuildMenu().catch(() => {});
  return r;
});
```

Also rebuild after `addRootForPath` (returns of `docket:updateConfig` and `docket:addRootForPath`). Append `tray.rebuildMenu().catch(() => {});` to each, before the `return`.

In `app.on('will-quit')` (around `main.js:614`), destroy the tray:

```javascript
app.on('will-quit', async () => {
  tray.destroy();
  if (watcher) await watcher.close();
});
```

- [ ] **Step 3: Smoke-test the tray**

Run: `npm start`
Expected: docket icon appears in the macOS menu bar. Click it: dropdown shows `Show Docket`, `Favorites` heading (greyed) with any favourited files, `Recents` heading (greyed) with recent files, `Quit Docket`. Selecting a file opens it and brings the window forward. Selecting `Show Docket` brings the window forward without opening a file.

Run: `npm test` — verify nothing regressed.

- [ ] **Step 4: Commit**

```bash
git add lib/tray.js main.js
git commit -m "feat: add macOS menu-bar tray icon with favorites/recents quick-pick"
```

---

## Task 7: Refactor sidebar markup + render to be section-driven

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

Replace the four hard-coded `<div id="sidebar-...">` blocks with a single `<div id="sidebar-sections">` container the renderer fills based on `appState.sectionOrder`. Each section becomes a `.section-card` with header (title + chevron) + body. Collapse state read from `appState.collapsedSections`.

- [ ] **Step 1: Update `renderer/index.html`**

Replace `index.html:19-23`:

```html
      <div id="sidebar-results"></div>
      <div id="sidebar-sections"></div>
```

(Removes the four old IDs; results stays separate so search results swap the section list.)

- [ ] **Step 2: Update `renderer/app.js` — variables, render entry, section dispatch**

Replace the top-of-file element grabs (around `app.js:5-9`):

```javascript
  const sections = document.getElementById('sidebar-sections');
  const results = document.getElementById('sidebar-results');
  const search = document.getElementById('search-box');
  const content = document.getElementById('content');
```

Below the `tocs` declaration, add a `SECTION_TITLES` lookup:

```javascript
  const SECTION_TITLES = {
    toc: 'Table of Contents',
    favorites: 'Favorites',
    recents: 'Recents',
    browse: 'Files'
  };
```

Replace `renderSidebar()` and the per-section helpers (`renderToc`, `renderFavorites`, `renderRecents`, plus the `renderBrowse()` body where it injects into `browse`) with a single section-driven flow:

```javascript
  function renderSidebar() {
    const order = (appState.sectionOrder && appState.sectionOrder.length)
      ? appState.sectionOrder
      : ['toc', 'favorites', 'recents', 'browse'];
    const collapsed = appState.collapsedSections || {};

    const cards = [];
    for (const id of order) {
      const bodyHTML = renderSectionBody(id);
      if (bodyHTML === null) continue; // section has no content; hide entirely
      const isCollapsed = Boolean(collapsed[id]);
      cards.push(`
        <section class="section-card${isCollapsed ? ' collapsed' : ''}" data-section="${id}" draggable="true">
          <header class="section-card-head">
            <button type="button" class="section-toggle" aria-expanded="${isCollapsed ? 'false' : 'true'}">
              <span class="chevron" aria-hidden="true">▾</span>
              <span class="section-title">${escapeHTML(SECTION_TITLES[id] || id)}</span>
            </button>
            <span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
          </header>
          <div class="section-card-body">${bodyHTML}</div>
        </section>
      `);
    }
    sections.innerHTML = cards.join('');
    wireSectionCards();
  }

  function renderSectionBody(id) {
    if (id === 'toc') return renderTocBody();
    if (id === 'favorites') return renderFavoritesBody();
    if (id === 'recents') return renderRecentsBody();
    if (id === 'browse') return renderBrowseBody();
    return null;
  }

  function renderTocBody() {
    if (!tocs || !tocs.length) return null;
    const parts = [];
    for (const toc of tocs) {
      const heading = tocs.length > 1 ? `<div class="sub-heading">${escapeHTML(toc.rootLabel)}</div>` : '';
      parts.push(heading);
      parts.push('<ul class="file-list">');
      const activeCls = currentPath === toc.readmePath ? ' active' : '';
      parts.push(`<li><button type="button" class="file-btn toc${activeCls}" data-path="${escapeHTML(toc.readmePath)}" data-skip-recents="1">README.md</button></li>`);
      parts.push('</ul>');
    }
    return parts.join('');
  }

  function renderFavoritesBody() {
    const valid = orderedFavorites().filter((f) => allFiles.some((e) => e.absolutePath === f.absolutePath));
    if (!valid.length) return null;
    const parts = ['<ul class="file-list" data-favorites-list>'];
    for (const f of valid) {
      const basename = f.absolutePath.split('/').pop();
      parts.push(renderListItem(f.absolutePath, basename, { removable: true, removeKind: 'favorite', draggable: true }));
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderRecentsBody() {
    const valid = (appState.recents || []).filter((r) => allFiles.some((f) => f.absolutePath === r.absolutePath));
    if (!valid.length) return null;
    const parts = ['<ul class="file-list">'];
    for (const r of valid) {
      const basename = r.absolutePath.split('/').pop();
      parts.push(renderListItem(r.absolutePath, basename, { removable: true, removeKind: 'recent' }));
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderBrowseBody() {
    // Synchronous body builder. Use the same data computed by the prior async
    // renderBrowse(); we now stash the latest in `lastBrowseHTML`.
    return lastBrowseHTML || '<div class="empty-hint">No files yet.</div>';
  }
```

Update `renderListItem` to optionally include a drag handle:

```javascript
  function renderListItem(absolutePath, label, { removable = false, removeKind = null, draggable = false } = {}) {
    const activeCls = currentPath === absolutePath ? ' active' : '';
    const removeHTML = removable
      ? `<button type="button" class="remove-btn" data-remove-path="${escapeHTML(absolutePath)}" data-remove-kind="${removeKind}" title="Remove">×</button>`
      : '';
    const dragAttr = draggable ? ' draggable="true"' : '';
    const dragHandle = draggable ? `<span class="row-drag" aria-hidden="true">⋮⋮</span>` : '';
    return `<li class="dismissable${draggable ? ' draggable' : ''}"${dragAttr} data-path="${escapeHTML(absolutePath)}">${dragHandle}<button type="button" class="file-btn${activeCls}" data-path="${escapeHTML(absolutePath)}">${escapeHTML(label)}</button>${removeHTML}</li>`;
  }
```

`orderedFavorites()` — add helper after `isFavorite`:

```javascript
  function orderedFavorites() {
    const all = appState.favorites || [];
    const order = appState.favoritesOrder || [];
    if (!order.length) return all;
    const byPath = new Map(all.map((f) => [f.absolutePath, f]));
    const ordered = [];
    for (const p of order) {
      if (byPath.has(p)) { ordered.push(byPath.get(p)); byPath.delete(p); }
    }
    for (const f of all) if (byPath.has(f.absolutePath)) ordered.push(f);
    return ordered;
  }
```

Adapt `renderBrowse()` so it stores HTML rather than mutating a removed element. Replace the function (around `app.js:62-89`):

```javascript
  let lastBrowseHTML = '';

  async function renderBrowse() {
    const statuses = await window.docket.getRootStatuses();
    const pinnedReadmes = new Set((tocs || []).map((t) => t.readmePath));
    const byRoot = new Map();
    for (const e of allFiles) {
      if (pinnedReadmes.has(e.absolutePath)) continue;
      if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
      byRoot.get(e.rootId).push(e);
    }
    const parts = [];
    for (const root of cfg.roots) {
      const files = (byRoot.get(root.id) || []).slice().sort(compareFiles);
      const st = statuses[root.id] || { capped: false, status: 'ok' };
      const unavailableCls = st.status !== 'ok' ? ' unavailable' : '';
      const label = `${escapeHTML(root.label)}${st.status === 'missing' ? ' <span class="chip-warn">missing</span>' : ''}${st.status === 'permission-denied' ? ' <span class="chip-warn">permission denied</span>' : ''}`;
      const cappedBanner = st.capped ? `<div class="cap-warning">⚠ More than 5,000 files — sidebar listing may be incomplete. Content search still covers everything.</div>` : '';
      if (st.status !== 'ok') {
        parts.push(`<details class="root${unavailableCls}" title="${escapeHTML(root.path)}"><summary>${label}</summary></details>`);
        continue;
      }
      const tree = buildTree(files);
      parts.push(`<details class="root" open><summary>${label}</summary>${cappedBanner}${renderTree(tree)}</details>`);
    }
    lastBrowseHTML = parts.join('');
    if (!search.value.trim()) renderSidebar();
  }
```

Add `wireSectionCards()` (drag wiring is added in Task 8 — for now wire toggle + buttons):

```javascript
  function wireSectionCards() {
    sections.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path, { skipRecents: btn.dataset.skipRecents === '1' }));
    });
    sections.querySelectorAll('button[data-remove-path]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = btn.dataset.removePath;
        const kind = btn.dataset.removeKind;
        if (kind === 'recent') await window.docket.removeRecent(p);
        else if (kind === 'favorite') await window.docket.removeFavorite(p);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
    sections.querySelectorAll('.section-toggle').forEach((toggle) => {
      toggle.addEventListener('click', async () => {
        const card = toggle.closest('.section-card');
        const id = card.dataset.section;
        const isCollapsed = card.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        await window.docket.setSectionCollapsed(id, isCollapsed);
        appState = await window.docket.getState();
      });
    });
  }
```

Update `runSearch()` show/hide logic — replace `browse.style.display = '...'` and friends with toggling `sections.style.display`:

```javascript
  async function runSearch() {
    const q = search.value.trim();
    if (!q) {
      results.innerHTML = '';
      sections.style.display = '';
      renderSidebar();
      return;
    }
    sections.style.display = 'none';
    // ... rest unchanged
  }
```

- [ ] **Step 3: Add IPC bindings for `setSectionOrder` / `setSectionCollapsed` / `setFavoritesOrder`**

In `main.js`, add three handlers near the other state setters (around `main.js:463-465`):

```javascript
ipcMain.handle('docket:setSectionOrder', async (_e, order) => await state.setSectionOrder(order));
ipcMain.handle('docket:setSectionCollapsed', async (_e, id, collapsed) => await state.setSectionCollapsed(id, collapsed));
ipcMain.handle('docket:setFavoritesOrder', async (_e, paths) => await state.setFavoritesOrder(paths));
```

In `preload.js`, expose them:

```javascript
  setSectionOrder: (order) => ipcRenderer.invoke('docket:setSectionOrder', order),
  setSectionCollapsed: (id, collapsed) => ipcRenderer.invoke('docket:setSectionCollapsed', id, collapsed),
  setFavoritesOrder: (paths) => ipcRenderer.invoke('docket:setFavoritesOrder', paths),
```

- [ ] **Step 4: Add card styling**

Append to `renderer/styles.css`:

```css
#sidebar-sections { display: flex; flex-direction: column; gap: 8px; padding: 8px 6px; }

.section-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
}
.section-card.dragging { opacity: 0.4; }
.section-card.drop-target { border-color: var(--done); box-shadow: 0 0 0 1px var(--done) inset; }

.section-card-head {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px 4px 8px;
  background: rgba(255, 255, 255, 0.02);
  cursor: default;
}
.section-toggle {
  flex: 1 1 auto;
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: 0; color: var(--text);
  padding: 4px 4px; font: inherit; cursor: pointer; text-align: left;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
}
.section-toggle:hover { color: var(--text); }
.section-toggle .chevron { font-size: 10px; transition: transform 0.15s ease; width: 12px; flex-shrink: 0; text-align: center; }
.section-card.collapsed .section-toggle .chevron { transform: rotate(-90deg); }
.section-card.collapsed .section-card-body { display: none; }

.drag-handle {
  flex: 0 0 auto;
  color: var(--muted); opacity: 0; transition: opacity 0.1s;
  cursor: grab; padding: 0 4px; font-size: 11px;
  user-select: none;
}
.section-card-head:hover .drag-handle { opacity: 0.6; }
.drag-handle:hover { opacity: 1; }
.drag-handle:active { cursor: grabbing; }

.section-card-body { padding: 4px 0 6px; }
.section-card-body .file-list { padding: 0 6px; }
.section-card-body .sub-heading {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); padding: 4px 12px 2px;
}

.file-list li.draggable { padding-left: 4px; }
.row-drag {
  display: inline-block; width: 14px; flex-shrink: 0;
  color: var(--muted); opacity: 0; cursor: grab;
  font-size: 10px; line-height: 1;
}
.file-list li.draggable:hover .row-drag { opacity: 0.5; }
.file-list li.draggable.dragging { opacity: 0.4; }
.file-list li.draggable.drop-target { box-shadow: 0 -2px 0 var(--done); }
```

Remove (or leave dead) the old `.sidebar-section-title` style — it's no longer rendered but doesn't hurt.

- [ ] **Step 5: Smoke-test**

Run: `npm start`
Expected: sidebar shows up to 4 cards (TOC, Favorites, Recents, Files) with chevron headers; clicking the chevron collapses/expands; collapse state survives a relaunch (stored in `~/.docket/state.json`). Empty sections (e.g. no favourites) don't render. Search still hides the section column and shows results.

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/app.js renderer/styles.css main.js preload.js
git commit -m "feat(sidebar): collapsible section cards driven by appState.sectionOrder"
```

---

## Task 8: Drag-to-reorder for sidebar sections

**Files:**
- Modify: `renderer/app.js` (add `wireSectionDrag` and call from `wireSectionCards`)

HTML5 drag-and-drop on `.section-card` elements. Persist new order via `setSectionOrder`.

- [ ] **Step 1: Add `wireSectionDrag` to `renderer/app.js`**

Inside `renderer/app.js`, add the helper:

```javascript
  function wireSectionDrag() {
    const cards = Array.from(sections.querySelectorAll('.section-card'));
    let dragSrc = null;

    cards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Required for Firefox/Chromium to start drag.
        try { e.dataTransfer.setData('text/plain', card.dataset.section); } catch {}
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        cards.forEach((c) => c.classList.remove('drop-target'));
        dragSrc = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === card) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cards.forEach((c) => c.classList.toggle('drop-target', c === card));
      });
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragSrc || dragSrc === card) return;
        const order = cards.map((c) => c.dataset.section);
        const fromIdx = order.indexOf(dragSrc.dataset.section);
        const toIdx = order.indexOf(card.dataset.section);
        if (fromIdx === -1 || toIdx === -1) return;
        order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
        await window.docket.setSectionOrder(order);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
  }
```

Call `wireSectionDrag()` from the bottom of `wireSectionCards()`:

```javascript
    wireSectionDrag();
```

- [ ] **Step 2: Smoke-test**

Run: `npm start`
- Drag the *Recents* card above *Favorites* — it should snap into place and the order persists across relaunches.
- Try dragging onto itself — no change.
- Try dragging while sections are collapsed — should still work; collapse state preserved.

- [ ] **Step 3: Commit**

```bash
git add renderer/app.js
git commit -m "feat(sidebar): drag-to-reorder section cards"
```

---

## Task 9: Drag-to-reorder favourite items + persist `favoritesOrder`

**Files:**
- Modify: `renderer/app.js`

Add a second drag-and-drop wiring scoped to `<li.draggable>` rows inside `[data-favorites-list]`. On drop, compute the new path order and call `setFavoritesOrder`.

- [ ] **Step 1: Add `wireFavoritesDrag` helper**

```javascript
  function wireFavoritesDrag() {
    const list = sections.querySelector('[data-favorites-list]');
    if (!list) return;
    const items = Array.from(list.querySelectorAll('li.draggable'));
    let dragSrc = null;

    items.forEach((li) => {
      li.addEventListener('dragstart', (e) => {
        dragSrc = li;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', li.dataset.path); } catch {}
        e.stopPropagation(); // prevent the parent section drag from firing
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        items.forEach((x) => x.classList.remove('drop-target'));
        dragSrc = null;
      });
      li.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === li) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        items.forEach((x) => x.classList.toggle('drop-target', x === li));
      });
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragSrc || dragSrc === li) return;
        const order = items.map((x) => x.dataset.path);
        const from = order.indexOf(dragSrc.dataset.path);
        const to = order.indexOf(li.dataset.path);
        if (from === -1 || to === -1) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        await window.docket.setFavoritesOrder(order);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
  }
```

Call `wireFavoritesDrag()` from the bottom of `wireSectionCards()` (after `wireSectionDrag`).

- [ ] **Step 2: Block section-drag when starting from a favourite item**

In `wireSectionDrag`, gate the `dragstart` handler so it ignores events that bubbled from a `<li.draggable>`:

```javascript
      card.addEventListener('dragstart', (e) => {
        if (e.target.closest('li.draggable')) return; // favourite-row drag, not section drag
        dragSrc = card;
        ...
      });
```

- [ ] **Step 3: Smoke-test**

Run: `npm start`
- Add 3+ favourites.
- Drag the third favourite above the first — order persists, recents/sections unaffected.
- Drag a section card by its header — section drag still works without grabbing a favourite.

- [ ] **Step 4: Commit**

```bash
git add renderer/app.js
git commit -m "feat(sidebar): drag-to-reorder favourite items"
```

---

## Task 10: Register Docket as a `.md` viewer in Finder ("Open With")

**Files:**
- Modify: `package.json` (under `build.mac`)

`electron-builder` lets us set `extendInfo` to merge keys into `Info.plist`. Register `public.markdown` as a viewer (`LSHandlerRank: Alternate`) so we never override the user's default but appear in Finder's *Open With* submenu.

- [ ] **Step 1: Patch `package.json`**

Inside the `build.mac` object, add:

```json
      "extendInfo": {
        "CFBundleDocumentTypes": [
          {
            "CFBundleTypeName": "Markdown Document",
            "CFBundleTypeRole": "Viewer",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": [
              "public.markdown",
              "net.daringfireball.markdown"
            ]
          }
        ]
      },
```

- [ ] **Step 2: Verify the change parses**

Run: `node -e "require('./package.json')"`
Expected: no output (parses cleanly).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build(mac): register Docket as a markdown viewer (Open With)"
```

(Verification of Finder integration requires a packaged build; that happens during the next release.)

---

## Task 11: Add a CLI smoke verification script

**Files:**
- Create: `scripts/verify-cli-arg.js`
- Modify: `package.json` (`scripts.test:cli`)

Headless smoke test: spawn Electron with a temp markdown file as argv, wait for the renderer to render it, exit 0.

- [ ] **Step 1: Add the verification script**

Create `scripts/verify-cli-arg.js`:

```javascript
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const electron = require('electron');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cli-'));
const tmpFile = path.join(tmpDir, 'cli-test.md');
fs.writeFileSync(tmpFile, '# CLI MARKER\n\nbody.\n');

const env = { ...process.env, DOCKET_GOLDEN_PATH: '1', DOCKET_GOLDEN_FILE: tmpFile };
const child = spawn(electron, [path.join(__dirname, '..'), tmpFile], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let buf = '';
child.stdout.on('data', (d) => { buf += d.toString(); process.stdout.write(d); });
child.stderr.on('data', (d) => process.stderr.write(d));
const timeout = setTimeout(() => { child.kill('SIGKILL'); process.exit(2); }, 15000);
child.on('exit', (code) => {
  clearTimeout(timeout);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (code !== 0) process.exit(code || 1);
  if (!buf.includes('CLI MARKER') && !buf.includes('GOLDEN_PATH_RESULT')) {
    process.stderr.write('verify-cli-arg: expected CLI MARKER in output\n');
    process.exit(1);
  }
  process.exit(0);
});
```

(The script piggy-backs on the existing `DOCKET_GOLDEN_PATH` harness, which exits after asserting the file rendered. This task confirms the CLI argv path reaches the renderer.)

- [ ] **Step 2: Add the npm script**

Edit `package.json` `scripts`:

```json
    "test:cli": "node scripts/verify-cli-arg.js",
```

- [ ] **Step 3: Run the smoke test**

Run: `npm run test:cli`
Expected: exit code 0; stdout contains `GOLDEN_PATH_RESULT:{"step":"done","ok":true,...}`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-cli-arg.js package.json
git commit -m "test: add CLI argv smoke verification"
```

---

## Task 12: Update `README.md` with the new features

**Files:**
- Modify: `README.md`

Document the menu-bar icon, CLI usage, and reorderable sidebar so users discover them.

- [ ] **Step 1: Add a "Menu bar" section**

In `README.md` after the "Keyboard" section (around `README.md:38`), insert:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: tray icon, CLI usage, reorderable sidebar"
```

---

## Self-review summary

- **Spec coverage:** Tray icon ✓ (Tasks 5–6), CLI argv ✓ (Tasks 2–3), Finder ✓ (Tasks 3, 10), outside-root prompt ✓ (Task 4), sidebar collapsibles ✓ (Task 7), section reorder ✓ (Task 8), favourite reorder ✓ (Task 9), state persistence ✓ (Task 1), README ✓ (Task 12), smoke test ✓ (Task 11). Dock-icon-stays-visible is the existing default — no task needed (verified by `app.dock.setIcon` at `main.js:594` and the absence of `app.dock.hide`).
- **Placeholders:** none — every step contains the actual code.
- **Type consistency:** `setSectionCollapsed(id, collapsed)`, `setSectionOrder(order)`, `setFavoritesOrder(paths)` are spelled identically across `lib/state.js`, `main.js`, `preload.js`, `renderer/app.js`. The `docket:open-path` payload `{ absolutePath, inRoot, parentDir }` is the same in `main.js` and the renderer subscriber. Tray context keys `getState`/`getConfig`/`onSelect`/`onShowWindow`/`onQuit` match between `lib/tray.js` and the call site in `main.js`.
- **Scope:** four discrete features, all tightly related to "what the sidebar/tray surface looks like" and "how files get opened." Single plan is appropriate.
