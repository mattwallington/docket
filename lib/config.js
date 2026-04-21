const fs = require('fs').promises;
const path = require('path');
const os = require('os');

function docketHome() {
  return process.env.DOCKET_HOME || path.join(os.homedir(), '.docket');
}

function configPath() {
  return path.join(docketHome(), 'docket.json');
}

function defaultConfig() {
  return {
    roots: [
      { id: 'projects', path: path.join(docketHome(), 'projects'), label: 'Projects' }
    ],
    theme: 'system'
  };
}

async function ensureSeeded() {
  const home = docketHome();
  await fs.mkdir(home, { recursive: true });
  const cfgPath = configPath();
  let cfg;
  try {
    const raw = await fs.readFile(cfgPath, 'utf8');
    cfg = JSON.parse(raw);
    if (!cfg || !Array.isArray(cfg.roots) || cfg.roots.length === 0) throw new Error('invalid');
  } catch (e) {
    cfg = defaultConfig();
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  }
  // Ensure each root's path exists if it's under DOCKET_HOME (i.e., our seeded default).
  for (const r of cfg.roots) {
    if (r.path && r.path.startsWith(home)) {
      await fs.mkdir(r.path, { recursive: true }).catch(() => {});
    }
  }
  return cfg;
}

async function read() {
  return ensureSeeded();
}

async function write(partial) {
  const current = await ensureSeeded();
  const next = { ...current, ...partial };
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { read, write, docketHome, configPath };
