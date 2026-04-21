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

const VALID_SORT_BY = new Set(['name', 'modified']);
const VALID_SEARCH_MODE = new Set(['filename', 'contents']);
const DOC_SCALE_MIN = 0.7;
const DOC_SCALE_MAX = 1.6;

function defaultState() {
  return { recents: [], favorites: [], overrides: {}, sortBy: 'name', searchMode: 'contents', docScale: 1 };
}

async function read() {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
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

async function setOverride(absolutePath, mode) {
  const s = await read();
  s.overrides[absolutePath] = mode;
  return write(s);
}

async function clearOverride(absolutePath) {
  const s = await read();
  delete s.overrides[absolutePath];
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

module.exports = { read, write, addRecent, removeRecent, addFavorite, removeFavorite, setOverride, clearOverride, setSortBy, setSearchMode, setDocScale, setWindowState, DOC_SCALE_MIN, DOC_SCALE_MAX };
