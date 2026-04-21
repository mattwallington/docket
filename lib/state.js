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

function defaultState() {
  return { recents: [], overrides: {} };
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

module.exports = { read, write, addRecent, setOverride, clearOverride };
