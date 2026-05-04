const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const chokidar = require('chokidar');

app.setName('Docket');

const config = require('./lib/config.js');
const state = require('./lib/state.js');
const { walkRoot } = require('./lib/files.js');
const { searchContent, cancelSearch } = require('./lib/search.js');
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

let mainWindow = null;
let watcher = null;
let fileIndex = new Map();  // rootId -> FileEntry[]
let rootStatuses = new Map(); // rootId -> { capped, status }
let currentActivePath = null;
let cachedState = null;      // snapshot of state.json at startup (window placement)

// ---- Build info (populated by release.sh at build time) ----
const BUILD_INFO = (() => {
  try {
    const p = path.join(__dirname, 'build-info.json');
    if (fsSync.existsSync(p)) return JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch {}
  return { version: require('./package.json').version, channel: 'stable', buildDate: null };
})();
const IS_DEV_BUILD = BUILD_INFO.channel === 'dev';

// ---- Single-instance lock (keyed per channel so dev+stable coexist) ----
const SKIP_INSTANCE_LOCK = process.env.DOCKET_SECURITY_CHECK === '1'
  || process.env.DOCKET_GOLDEN_PATH === '1'
  || process.env.DOCKET_BUILD_ICON === '1';

if (!SKIP_INSTANCE_LOCK) {
  const gotLock = app.requestSingleInstanceLock({ channel: IS_DEV_BUILD ? 'dev' : 'stable' });
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_e, argv, cwd) => {
      bringWindowForward();
      const arg = parseCliMarkdownArg(argv);
      if (arg) handleOpenPath(arg, { fromCli: true, cwd }).catch(() => {});
    });
  }
}

function withinAnyRoot(absolutePath, cfg) {
  const resolved = path.resolve(absolutePath);
  return cfg.roots.some((r) => {
    const rootAbs = path.resolve(r.path);
    return resolved === rootAbs || resolved.startsWith(rootAbs + path.sep);
  });
}

async function rebuildIndex() {
  const cfg = await config.read();
  fileIndex = new Map();
  rootStatuses = new Map();
  for (const root of cfg.roots) {
    const result = await walkRoot(root);
    fileIndex.set(root.id, result.entries);
    rootStatuses.set(root.id, { capped: result.capped, status: result.status });
  }
  return cfg;
}

async function restartWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  const cfg = await config.read();
  const paths = cfg.roots.map((r) => r.path).filter((p) => p);
  if (paths.length === 0) return;
  watcher = chokidar.watch(paths, {
    ignored: (p) => {
      const name = path.basename(p);
      return name.startsWith('.') || name === 'node_modules';
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  });
  watcher.on('add', (p) => onFsEvent('add', p));
  watcher.on('change', (p) => onFsEvent('change', p));
  watcher.on('unlink', (p) => onFsEvent('unlink', p));
}

async function onFsEvent(type, absolutePath) {
  if (!absolutePath.endsWith('.md')) return;
  await rebuildIndex();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:file-change', { type, absolutePath });
  }
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function resolveInitialWindowPlacement(savedWindowState) {
  // Defaults: centered on primary display, 1200x800.
  const fallback = { width: 1200, height: 800 };
  if (!savedWindowState) return fallback;
  const { x, y, width, height, displayId, displayBounds } = savedWindowState;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return fallback;
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId);
  if (!target) return fallback; // monitor gone
  if (!sameBounds(target.bounds, displayBounds)) return fallback; // monitor rearranged
  // Verify the saved rect actually overlaps the display's work area — guards
  // against edge cases like a resolution change keeping bounds but moving
  // the dock.
  const rect = { x, y, width, height };
  const visible = Math.max(0, Math.min(rect.x + rect.width, target.bounds.x + target.bounds.width) - Math.max(rect.x, target.bounds.x))
                * Math.max(0, Math.min(rect.y + rect.height, target.bounds.y + target.bounds.height) - Math.max(rect.y, target.bounds.y));
  if (visible < (rect.width * rect.height) * 0.5) return fallback;
  return { x, y, width, height };
}

let saveWindowStateTimer = null;
function scheduleSaveWindowState(win) {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => saveWindowState(win), 500);
}

async function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  const display = screen.getDisplayMatching({ x, y, width, height });
  const ws = { x, y, width, height, displayId: display.id, displayBounds: display.bounds };
  try { await state.setWindowState(ws); } catch {}
}

function createMainWindow() {
  const securityCheck = process.env.DOCKET_SECURITY_CHECK === '1';
  const goldenPath = process.env.DOCKET_GOLDEN_PATH === '1';
  const buildIcon = process.env.DOCKET_BUILD_ICON === '1';
  if (buildIcon) { runBuildIconAndExit(); return; }
  const headless = securityCheck || goldenPath;

  let placement = { width: 1200, height: 800 };
  if (!headless) {
    // Pull last-saved window state synchronously from whatever state.read
    // already cached during app.whenReady. Fall back to defaults.
    placement = resolveInitialWindowPlacement(cachedState && cachedState.windowState);
  }

  mainWindow = new BrowserWindow({
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0b0f19',
    show: !headless,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenRequest) {
      mainWindow.webContents.send('docket:open-path', pendingOpenRequest);
      pendingOpenRequest = null;
    }
  });

  if (!headless) {
    mainWindow.on('move', () => scheduleSaveWindowState(mainWindow));
    mainWindow.on('resize', () => scheduleSaveWindowState(mainWindow));
    mainWindow.on('close', () => { saveWindowState(mainWindow); });
  }

  if (securityCheck) runSecurityCheckAndExit();
  if (goldenPath) runGoldenPathAndExit();
}

async function runBuildIconAndExit() {
  try {
    const outDir = process.env.DOCKET_ICON_OUT;
    if (!outDir) throw new Error('DOCKET_ICON_OUT not set');
    const svgName = process.env.DOCKET_ICON_SVG || 'icon.svg';
    const svgPath = path.join(__dirname, 'assets', svgName);
    const svg = fsSync.readFileSync(svgPath, 'utf8');
    const html = '<!doctype html><html><head><style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent;}svg{display:block;width:100%;height:100%;}</style></head><body>' + svg + '</body></html>';

    const win = new BrowserWindow({
      width: 1024, height: 1024, show: false, transparent: true, frame: false,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage();
    const sizes = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ];
    for (const [name, size] of sizes) {
      const resized = image.resize({ width: size, height: size, quality: 'best' });
      fsSync.writeFileSync(path.join(outDir, name), resized.toPNG());
      process.stdout.write('  wrote ' + name + ' (' + size + 'x' + size + ')\n');
    }
    win.close();
    app.exit(0);
  } catch (e) {
    process.stderr.write('ICON_BUILD_ERROR: ' + (e && e.stack || e) + '\n');
    app.exit(1);
  }
}

async function runGoldenPathAndExit() {
  const targetPath = process.env.DOCKET_GOLDEN_FILE;
  if (!targetPath) {
    process.stdout.write('GOLDEN_PATH_ERROR:DOCKET_GOLDEN_FILE not set\n');
    app.exit(2);
    return;
  }
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      // Wait for initial render (listAllFiles + renderBrowse run on startup)
      await new Promise((r) => setTimeout(r, 400));

      const step1 = await mainWindow.webContents.executeJavaScript(`(async () => {
        const files = await window.docket.listAllFiles();
        return { fileCount: files.length, paths: files.map((f) => f.absolutePath) };
      })()`);
      if (step1.fileCount === 0) {
        process.stdout.write('GOLDEN_PATH_RESULT:' + JSON.stringify({ step: 'list', ok: false, step1 }) + '\n');
        return app.exit(1);
      }

      const step2 = await mainWindow.webContents.executeJavaScript(`(async () => {
        const btn = document.querySelector('button[data-path=' + JSON.stringify(${JSON.stringify(targetPath)}) + ']');
        if (!btn) return { clicked: false };
        btn.click();
        await new Promise((r) => setTimeout(r, 200));
        return { clicked: true, contentHTML: document.getElementById('content').innerHTML };
      })()`);
      if (!step2.clicked || !step2.contentHTML.includes('INITIAL_MARKER')) {
        process.stdout.write('GOLDEN_PATH_RESULT:' + JSON.stringify({ step: 'open', ok: false, step2: { clicked: step2.clicked, hasMarker: step2.contentHTML?.includes('INITIAL_MARKER') } }) + '\n');
        return app.exit(1);
      }

      // Trigger external edit
      await fs.writeFile(targetPath, '# Golden Path\n\nUPDATED_MARKER body.\n');

      // Poll for rerender (budget 1500ms)
      let sawUpdate = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const html = await mainWindow.webContents.executeJavaScript(`document.getElementById('content').innerHTML`);
        if (html.includes('UPDATED_MARKER')) { sawUpdate = true; break; }
      }

      const result = { step: 'done', ok: sawUpdate, fileCount: step1.fileCount };
      process.stdout.write('GOLDEN_PATH_RESULT:' + JSON.stringify(result) + '\n');
      app.exit(sawUpdate ? 0 : 1);
    } catch (e) {
      process.stdout.write('GOLDEN_PATH_ERROR:' + String(e && e.stack || e) + '\n');
      app.exit(2);
    }
  });
}

function runSecurityCheckAndExit() {
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const r = {
          requireUndefined: typeof require === 'undefined',
          processUndefined: typeof process === 'undefined',
          globalUndefined: typeof global === 'undefined',
          etcPasswdRejected: false,
          etcPasswdError: null,
          traversalRejected: false,
          traversalError: null
        };
        try { await window.docket.readFile('/etc/passwd'); }
        catch (e) { r.etcPasswdRejected = true; r.etcPasswdError = String(e && e.message || e); }
        try { await window.docket.readFile('/tmp/../etc/passwd'); }
        catch (e) { r.traversalRejected = true; r.traversalError = String(e && e.message || e); }
        return r;
      })()`);
      process.stdout.write('SECURITY_CHECK_RESULT:' + JSON.stringify(result) + '\n');
      const pass = result.requireUndefined && result.processUndefined && result.globalUndefined && result.etcPasswdRejected && result.traversalRejected;
      app.exit(pass ? 0 : 1);
    } catch (e) {
      process.stdout.write('SECURITY_CHECK_ERROR:' + String(e) + '\n');
      app.exit(2);
    }
  });
}

async function addRootViaPicker() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Add Root'
  });
  if (result.canceled || !result.filePaths.length) return;
  const pickedPath = result.filePaths[0];
  const cfg = await config.read();
  if (cfg.roots.some((r) => path.resolve(r.path) === path.resolve(pickedPath))) return;
  const id = path.basename(pickedPath).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `root-${cfg.roots.length + 1}`;
  const next = await config.write({ roots: [...cfg.roots, { id, path: pickedPath, label: path.basename(pickedPath) || pickedPath }] });
  await rebuildIndex();
  await restartWatcher();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:config-change', next);
  }
}

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

function revealCurrentFile() {
  if (currentActivePath) shell.showItemInFolder(currentActivePath);
}

function toggleSidebar() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:toggle-sidebar');
  }
}

function focusSearch() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:focus-search');
  }
}

async function setSortByFromMenu(sortBy) {
  await state.setSortBy(sortBy);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:sort-by-changed', sortBy);
  }
}

function updateRevealMenuState() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('reveal-file');
  if (item) item.enabled = Boolean(currentActivePath);
}

async function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const currentState = await state.read();
  const currentSort = currentState.sortBy || 'name';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: openSettingsDirectly },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Root…', accelerator: 'CmdOrCtrl+Shift+O', click: addRootViaPicker },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: openSettingsDirectly },
        { type: 'separator' },
        { label: 'Reveal File in Finder', id: 'reveal-file', enabled: false, click: revealCurrentFile },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Focus Search', accelerator: 'CmdOrCtrl+F', click: focusSearch },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: toggleSidebar },
        { type: 'separator' },
        {
          label: 'Sort Files By',
          submenu: [
            { label: 'Name', type: 'radio', checked: currentSort === 'name', click: () => setSortByFromMenu('name') },
            { label: 'Last Modified', type: 'radio', checked: currentSort === 'modified', click: () => setSortByFromMenu('modified') }
          ]
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let settingsWindow = null;
function openSettingsDirectly() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 480,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC handlers

ipcMain.handle('docket:getConfig', async () => await config.read());

ipcMain.handle('docket:updateConfig', async (_e, partial) => {
  const next = await config.write(partial);
  await rebuildIndex();
  await restartWatcher();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:config-change', next);
  }
  return next;
});

ipcMain.handle('docket:getState', async () => await state.read());
ipcMain.handle('docket:updateState', async (_e, partial) => await state.write(partial));
ipcMain.handle('docket:addRecent', async (_e, p) => {
  const r = await state.addRecent(p);
  return r;
});
ipcMain.handle('docket:removeRecent', async (_e, p) => {
  const r = await state.removeRecent(p);
  return r;
});
ipcMain.handle('docket:addFavorite', async (_e, p) => {
  const r = await state.addFavorite(p);
  return r;
});
ipcMain.handle('docket:removeFavorite', async (_e, p) => {
  const r = await state.removeFavorite(p);
  return r;
});
ipcMain.handle('docket:setOverride', async (_e, p, mode) => await state.setOverride(p, mode));
ipcMain.handle('docket:clearOverride', async (_e, p) => await state.clearOverride(p));
ipcMain.handle('docket:setSortBy', async (_e, sortBy) => await state.setSortBy(sortBy));
ipcMain.handle('docket:setSearchMode', async (_e, mode) => await state.setSearchMode(mode));
ipcMain.handle('docket:setDocScale', async (_e, v) => await state.setDocScale(v));
ipcMain.handle('docket:setSectionOrder', async (_e, order) => await state.setSectionOrder(order));
ipcMain.handle('docket:setSectionCollapsed', async (_e, id, collapsed) => await state.setSectionCollapsed(id, collapsed));
ipcMain.handle('docket:setFavoritesOrder', async (_e, paths) => await state.setFavoritesOrder(paths));
ipcMain.handle('docket:setTabs', async (_e, tabs) => await state.setTabs(tabs));
ipcMain.handle('docket:setActiveTabIndex', async (_e, idx) => await state.setActiveTabIndex(idx));

// Returns, per root that has a top-level README.md, the absolute path to
// that README. Renderer pins it as a 'Table of Contents' sidebar entry.
ipcMain.handle('docket:getRootTocs', async () => {
  const cfg = await config.read();
  const results = [];
  for (const root of cfg.roots) {
    const readmePath = path.join(root.path, 'README.md');
    try {
      await fs.access(readmePath);
      results.push({ rootId: root.id, rootLabel: root.label, readmePath });
    } catch {
      // No README; skip
    }
  }
  return results;
});

ipcMain.handle('docket:getRootStatuses', async () => {
  const out = {};
  for (const [id, v] of rootStatuses.entries()) out[id] = v;
  return out;
});

ipcMain.handle('docket:listFiles', async (_e, rootId) => fileIndex.get(rootId) || []);
ipcMain.handle('docket:listAllFiles', async () => {
  const all = [];
  for (const list of fileIndex.values()) all.push(...list);
  return all;
});

ipcMain.handle('docket:readFile', async (_e, absolutePath) => {
  const cfg = await config.read();
  const resolved = path.resolve(absolutePath);
  if (!withinAnyRoot(resolved, cfg) && !sessionAllowedPaths.has(resolved)) {
    throw new Error('Path outside configured roots');
  }
  return await fs.readFile(resolved, 'utf8');
});

ipcMain.handle('docket:searchContent', async (_e, query) => {
  const cfg = await config.read();
  const rootPaths = cfg.roots.map((r) => r.path);
  return await searchContent(query, rootPaths);
});

ipcMain.handle('docket:cancelSearch', () => { cancelSearch(); });

ipcMain.handle('docket:pickDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('docket:getVersion', async () => ({
  version: BUILD_INFO.version,
  channel: BUILD_INFO.channel,
  buildDate: BUILD_INFO.buildDate
}));

ipcMain.handle('docket:checkForUpdates', async () => {
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: r ? r.updateInfo : null };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('docket:downloadUpdate', async () => {
  try {
    autoUpdater.downloadUpdate();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docket:update-state', { status: 'downloading' });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('docket:installUpdate', async () => {
  autoUpdater.quitAndInstall();
});

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = IS_DEV_BUILD;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docket:update-state', {
        status: 'available',
        version: info.version
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docket:update-state', {
        status: 'ready',
        version: info.version
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docket:update-state', { status: 'none' });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('auto-updater error:', err && err.message ? err.message : err);
  });

  // Only actually poll if this is a packaged build. In dev (electron .)
  // electron-updater will throw because there's no update feed.
  if (app.isPackaged) {
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 5000);
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
  }
}

ipcMain.handle('docket:openSettings', async () => { openSettingsDirectly(); });

ipcMain.handle('docket:setActivePath', async (_e, absolutePath) => {
  currentActivePath = absolutePath || null;
  updateRevealMenuState();
});

ipcMain.handle('docket:revealInFinder', async (_e, absolutePath) => {
  if (typeof absolutePath === 'string' && absolutePath) shell.showItemInFolder(absolutePath);
});

// App lifecycle

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  handleOpenPath(filePath, { fromCli: false }).catch(() => {});
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock && !process.env.DOCKET_SECURITY_CHECK && !process.env.DOCKET_GOLDEN_PATH && !process.env.DOCKET_BUILD_ICON) {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    try { app.dock.setIcon(iconPath); } catch {}
  }
  cachedState = await state.read();
  await rebuildIndex();
  await restartWatcher();
  await buildAppMenu();
  createMainWindow();
  setupAutoUpdater();

  const initialArg = parseCliMarkdownArg(process.argv);
  if (initialArg) {
    handleOpenPath(initialArg, { fromCli: true }).catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  if (watcher) await watcher.close();
});
