const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const MAX_RECENTS = 10;

function docketHome() {
  return process.env.DOCKET_HOME || path.join(os.homedir(), '.docket');
}

function statePath() {
  return path.join(docketHome(), 'state.json');
}

const VALID_SORT_BY = new Set(['name', 'modified', 'created']);
const VALID_SEARCH_MODE = new Set(['filename', 'contents']);
const DOC_SCALE_MIN = 0.7;
const DOC_SCALE_MAX = 1.6;
const SPEECH_RATE_MIN = 0.5;
const SPEECH_RATE_MAX = 2;
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 600;
const VALID_SECTIONS = new Set(['favorites', 'recents', 'browse']);
const DEFAULT_SECTION_ORDER = ['favorites', 'recents', 'browse'];
const VALID_DEFAULT_VIEWS = new Set(['auto', 'checklist', 'markdown']);

function defaultState() {
  return {
    recents: [],
    favorites: [],
    sortBy: 'name',
    sortReverse: false,
    searchMode: 'contents',
    docScale: 1,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    collapsedSections: {},
    favoritesOrder: [],
    tabs: [],
    activeTabIndex: -1,
    autoCheck: true,
    allowPrerelease: false,
    lastUpdateCheck: null,
    defaultView: 'auto',
    activeBrowseRoot: null,
    voiceURI: null,
    speechRate: 1,
    sidebarWidth: 280
  };
}

async function read() {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...defaultState(), ...parsed };
    if (Array.isArray(merged.sectionOrder)) {
      merged.sectionOrder = merged.sectionOrder.filter((id) => VALID_SECTIONS.has(id));
      if (merged.sectionOrder.length === 0) merged.sectionOrder = [...DEFAULT_SECTION_ORDER];
    }
    return merged;
  } catch {
    return defaultState();
  }
}

async function write(partial) {
  const home = docketHome();
  await fs.mkdir(home, { recursive: true });
  const current = await read();
  const next = { ...current, ...partial };
  await fs.writeFile(statePath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

async function addRecent(absolutePath) {
  const s = await read();
  const filtered = s.recents.filter((r) => r.absolutePath !== absolutePath);
  filtered.unshift({ absolutePath, openedAt: Date.now() });
  s.recents = filtered.slice(0, MAX_RECENTS);
  return write(s);
}

async function removeRecent(absolutePath) {
  const s = await read();
  s.recents = s.recents.filter((r) => r.absolutePath !== absolutePath);
  return write(s);
}

async function addFavorite(absolutePath) {
  const s = await read();
  if (s.favorites.some((f) => f.absolutePath === absolutePath)) return s;
  s.favorites = [...s.favorites, { absolutePath, addedAt: Date.now() }];
  return write(s);
}

async function removeFavorite(absolutePath) {
  const s = await read();
  s.favorites = s.favorites.filter((f) => f.absolutePath !== absolutePath);
  return write(s);
}

async function setSortBy(sortBy) {
  if (!VALID_SORT_BY.has(sortBy)) throw new Error(`Invalid sortBy: ${sortBy}`);
  return write({ sortBy });
}

async function setSearchMode(mode) {
  if (!VALID_SEARCH_MODE.has(mode)) throw new Error(`Invalid searchMode: ${mode}`);
  return write({ searchMode: mode });
}

async function setDocScale(value) {
  const n = Number(value);
  if (!isFinite(n)) throw new Error(`Invalid docScale: ${value}`);
  const clamped = Math.max(DOC_SCALE_MIN, Math.min(DOC_SCALE_MAX, Math.round(n * 100) / 100));
  return write({ docScale: clamped });
}

async function setWindowState(ws) {
  return write({ windowState: ws });
}

async function setSectionOrder(order) {
  if (!Array.isArray(order)) throw new Error('Invalid sectionOrder: must be an array');
  if (order.length === 0) throw new Error('Invalid sectionOrder: must not be empty');
  const seen = new Set();
  for (const id of order) {
    if (!VALID_SECTIONS.has(id)) throw new Error(`Invalid section: ${id}`);
    if (seen.has(id)) throw new Error(`Invalid section: duplicate ${id}`);
    seen.add(id);
  }
  return write({ sectionOrder: order.slice() });
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

async function setTabs(tabs) {
  if (!Array.isArray(tabs)) throw new Error('Invalid tabs: must be an array');
  for (const t of tabs) {
    if (!t || typeof t.absolutePath !== 'string' || !t.absolutePath) {
      throw new Error('Invalid tabs: each entry must have absolutePath');
    }
    if ('isPreview' in t && typeof t.isPreview !== 'boolean') {
      throw new Error('Invalid tabs: isPreview must be a boolean');
    }
  }
  return write({ tabs: tabs.slice() });
}

async function setActiveTabIndex(idx) {
  if (!Number.isInteger(idx)) throw new Error(`Invalid activeTabIndex: ${idx}`);
  return write({ activeTabIndex: idx });
}

async function setAutoCheck(value) {
  return write({ autoCheck: Boolean(value) });
}

async function setAllowPrerelease(value) {
  return write({ allowPrerelease: Boolean(value) });
}

async function setLastUpdateCheck(value) {
  if (value !== null && !Number.isInteger(value)) {
    throw new Error(`Invalid lastUpdateCheck: ${value}`);
  }
  return write({ lastUpdateCheck: value });
}

async function setDefaultView(value) {
  if (!VALID_DEFAULT_VIEWS.has(value)) throw new Error(`Invalid defaultView: ${value}`);
  return write({ defaultView: value });
}

async function setActiveBrowseRoot(value) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`Invalid activeBrowseRoot: ${value}`);
  }
  return write({ activeBrowseRoot: value });
}

async function setVoiceURI(value) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`Invalid voiceURI: ${value}`);
  }
  return write({ voiceURI: value });
}

async function setSpeechRate(value) {
  const n = Number(value);
  if (!isFinite(n)) throw new Error(`Invalid speechRate: ${value}`);
  const clamped = Math.max(SPEECH_RATE_MIN, Math.min(SPEECH_RATE_MAX, Math.round(n * 100) / 100));
  return write({ speechRate: clamped });
}

async function setSortReverse(value) {
  return write({ sortReverse: Boolean(value) });
}

async function setSidebarWidth(value) {
  const n = Number(value);
  if (!isFinite(n)) throw new Error(`Invalid sidebarWidth: ${value}`);
  const clamped = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(n)));
  return write({ sidebarWidth: clamped });
}

module.exports = { read, write, addRecent, removeRecent, addFavorite, removeFavorite, setSortBy, setSortReverse, setSearchMode, setDocScale, setWindowState, setSectionOrder, setSectionCollapsed, setFavoritesOrder, setTabs, setActiveTabIndex, setAutoCheck, setAllowPrerelease, setLastUpdateCheck, setDefaultView, setActiveBrowseRoot, setVoiceURI, setSpeechRate, setSidebarWidth, DOC_SCALE_MIN, DOC_SCALE_MAX, SPEECH_RATE_MIN, SPEECH_RATE_MAX, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, VALID_SECTIONS, DEFAULT_SECTION_ORDER, VALID_DEFAULT_VIEWS };
