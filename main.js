const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

const config = require('./lib/config.js');
const state = require('./lib/state.js');
const { walkRoot } = require('./lib/files.js');
const { searchContent, cancelSearch } = require('./lib/search.js');

let mainWindow = null;
let watcher = null;
let fileIndex = new Map();  // rootId -> FileEntry[]

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
  for (const root of cfg.roots) {
    const entries = await walkRoot(root);
    fileIndex.set(root.id, entries);
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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

ipcMain.handle('docket:openSettings', async () => {
  // Implemented in Task 11
});

// App lifecycle

app.whenReady().then(async () => {
  await rebuildIndex();
  await restartWatcher();
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
