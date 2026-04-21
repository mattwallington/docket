const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

app.setName('Docket');

const config = require('./lib/config.js');
const state = require('./lib/state.js');
const { walkRoot } = require('./lib/files.js');
const { searchContent, cancelSearch } = require('./lib/search.js');

let mainWindow = null;
let watcher = null;
let fileIndex = new Map();  // rootId -> FileEntry[]
let rootStatuses = new Map(); // rootId -> { capped, status }
let currentActivePath = null;

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

function createMainWindow() {
  const securityCheck = process.env.DOCKET_SECURITY_CHECK === '1';
  const goldenPath = process.env.DOCKET_GOLDEN_PATH === '1';
  const headless = securityCheck || goldenPath;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
  if (securityCheck) runSecurityCheckAndExit();
  if (goldenPath) runGoldenPathAndExit();
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
ipcMain.handle('docket:addRecent', async (_e, p) => await state.addRecent(p));
ipcMain.handle('docket:setOverride', async (_e, p, mode) => await state.setOverride(p, mode));
ipcMain.handle('docket:clearOverride', async (_e, p) => await state.clearOverride(p));
ipcMain.handle('docket:setSortBy', async (_e, sortBy) => await state.setSortBy(sortBy));

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
  if (!withinAnyRoot(absolutePath, cfg)) {
    throw new Error('Path outside configured roots');
  }
  return await fs.readFile(absolutePath, 'utf8');
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

ipcMain.handle('docket:getVersion', async () => {
  const pkg = require('./package.json');
  return { version: pkg.version, channel: 'stable', buildDate: null };
});

ipcMain.handle('docket:openSettings', async () => { openSettingsDirectly(); });

ipcMain.handle('docket:setActivePath', async (_e, absolutePath) => {
  currentActivePath = absolutePath || null;
  updateRevealMenuState();
});

// App lifecycle

app.whenReady().then(async () => {
  await rebuildIndex();
  await restartWatcher();
  await buildAppMenu();
  createMainWindow();

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
