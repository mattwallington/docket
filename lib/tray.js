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
