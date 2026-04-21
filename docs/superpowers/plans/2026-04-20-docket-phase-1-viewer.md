# Docket Phase 1 — v1 Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert docket from a Docker+Python web-service into a native macOS Electron app that browses configurable markdown directories, auto-detects checklist-shaped files, and live-refreshes on disk changes.

**Architecture:** Vanilla Electron (no bundler, no framework). CommonJS everywhere (`"type": "commonjs"` — Electron default). Main process owns all filesystem + native access + chokidar + ripgrep. Renderer is sandboxed with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, talks to main only via `contextBridge` IPC. Parser written UMD-style so tests can `require()` it in Node and the renderer can load it via `<script>`.

**Tech Stack:** Electron 32, chokidar, `@vscode/ripgrep`, marked, dompurify, node's built-in `node --test` runner (no framework).

**Reference spec:** `docs/superpowers/specs/2026-04-20-docket-electron-design.md`

---

## Prerequisites

- Working directory: `~/Development/docket/` on `main` branch.
- Node 20+ (Electron 32 ships Node 20).
- `gh` CLI is NOT required for Phase 1 (used by Phase 2 release pipeline).
- Existing files to port (do NOT delete until Task 17):
  - `web/app.js` — source of the parser + renderer logic
  - `web/index.html` — source of the DOM structure
  - `web/styles.css` — dark-theme styles, will copy over unchanged
  - `format.md` — checklist format spec, will update paths only

## File Structure

**Created by this plan:**

```
docket/
├── package.json                       (Task 1)
├── .gitignore                         (Task 1)
├── main.js                            (Task 8, expanded through 9, 11, 13, 14)
├── preload.js                         (Task 8)
├── renderer/
│   ├── index.html                     (Task 10)
│   ├── app.js                         (Task 11, expanded through 13, 15)
│   ├── styles.css                     (Task 10, copy of web/styles.css with additions)
│   ├── settings.html                  (Task 14)
│   ├── settings.js                    (Task 14)
│   └── vendor/                        (Task 10, populated by scripts/copy-vendor.js)
│       ├── marked.min.js
│       └── purify.min.js
├── lib/
│   ├── parser.js                      (Task 2)
│   ├── config.js                      (Task 3)
│   ├── state.js                       (Task 4)
│   ├── files.js                       (Task 5)
│   └── search.js                      (Task 6)
├── scripts/
│   └── copy-vendor.js                 (Task 10)
├── test/
│   ├── parser.test.js                 (Task 2)
│   ├── config.test.js                 (Task 3)
│   ├── state.test.js                  (Task 4)
│   ├── files.test.js                  (Task 5)
│   ├── search.test.js                 (Task 6)
│   └── fixtures/                      (Task 2+, shared by multiple tests)
│       ├── checklist.md
│       ├── plain.md
│       └── bad-frontmatter.md
└── assets/
    └── icon.png                       (Task 1, placeholder 512×512)
```

**Modified:** `.gitignore` (Task 1), `format.md` (Task 17), `README.md` (Task 17), `agent-rule.md` (Task 17).

**Deleted in Task 17:** `docker-compose.yml`, `Dockerfile`, `install.sh`, `docket/` (entire Python package), `web/` (renamed content now lives under `renderer/`).

**One commit per task.** Each task's Commit step uses an imperative conventional-commit subject.

---

## Task 1: Initialize Electron project

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `assets/icon.png` (placeholder — any 512×512 PNG is fine for Phase 1)

- [ ] **Step 1: Write package.json**

```json
{
  "name": "docket",
  "version": "0.1.0",
  "description": "Native macOS markdown docs browser with checklist support",
  "main": "main.js",
  "author": "Matt Wallington",
  "license": "MIT",
  "scripts": {
    "start": "electron .",
    "test": "node --test test/",
    "postinstall": "node scripts/copy-vendor.js || true"
  },
  "devDependencies": {
    "electron": "^32.0.0"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "@vscode/ripgrep": "^1.15.9",
    "marked": "^12.0.2",
    "dompurify": "^3.1.6"
  }
}
```

Write to `~/Development/docket/package.json`.

- [ ] **Step 2: Write .gitignore**

```
node_modules/
dist/
renderer/vendor/
.DS_Store
*.log
```

Write to `~/Development/docket/.gitignore`.

- [ ] **Step 3: Create assets directory + placeholder icon**

```bash
mkdir -p ~/Development/docket/assets
# Create a 512x512 solid-color PNG as a placeholder. Any tool; sips works:
sips -z 512 512 --setProperty format png /System/Library/CoreServices/DefaultDesktop.heic --out ~/Development/docket/assets/icon.png 2>/dev/null \
  || python3 -c "from PIL import Image; Image.new('RGBA', (512,512), (30,40,60,255)).save('/Users/matt/Development/docket/assets/icon.png')" 2>/dev/null \
  || echo "Generate any 512x512 PNG at assets/icon.png manually"
```

The icon only matters for Phase 2's signed build. A solid color is fine for v1.

- [ ] **Step 4: Install dependencies**

Run from repo root:
```bash
cd ~/Development/docket && npm install
```

Expected: `npm install` completes. `node_modules/` populated. `postinstall` exits 0 even though `scripts/copy-vendor.js` doesn't exist yet (the `|| true` catches it — we'll add the script in Task 10).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add package.json package-lock.json .gitignore assets/
git commit -m "chore: initialize Electron project scaffolding"
```

---

## Task 2: Extract parser to lib/parser.js with tests

**Files:**
- Create: `lib/parser.js`
- Create: `test/parser.test.js`
- Create: `test/fixtures/checklist.md`
- Create: `test/fixtures/plain.md`

Rationale: extract the parser from `web/app.js` so it's testable without a DOM. UMD-style file: renderer loads via `<script>` and consumes via `window.docketParser`; Node tests `require()` it. Same file, two contexts.

- [ ] **Step 1: Create fixtures**

Create `~/Development/docket/test/fixtures/checklist.md`:

```markdown
---
name: Sample Rollout
description: Testing fixture
project: test-repo
status: active
---

# Sample Rollout

Lead-in paragraph before any phase.

## Phase 1 — Setup

- [x] **1. First thing** — done last week
- [ ] **2. Second thing**
- [ ] **3. Blocked thing** — blocked on dependency

### Subsection

- [ ] **4. Scoped task**

## Phase 2 — Follow-up

- [ ] **5. Future work**
```

Create `~/Development/docket/test/fixtures/plain.md`:

```markdown
# Not a Checklist

Just a regular markdown document with **formatting** and `code` and a link: [example](https://example.com).

## Section

- Regular bullet
- Another bullet

End.
```

- [ ] **Step 2: Write the failing parser tests**

Create `~/Development/docket/test/parser.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parser = require('../lib/parser.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('parseFrontmatter extracts YAML-like header', () => {
  const text = fixture('checklist.md');
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(meta.name, 'Sample Rollout');
  assert.equal(meta.description, 'Testing fixture');
  assert.equal(meta.project, 'test-repo');
  assert.equal(meta.status, 'active');
  assert.match(body, /^# Sample Rollout/);
});

test('parseFrontmatter returns empty meta when absent', () => {
  const text = fixture('plain.md');
  const { meta, body } = parser.parseFrontmatter(text);
  assert.deepEqual(meta, {});
  assert.equal(body, text);
});

test('parseFrontmatter handles missing close delimiter', () => {
  const text = '---\nname: broken\nno close delimiter\n\n# Body';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.deepEqual(meta, {});
  assert.equal(body, text);
});

test('parseChecklist extracts title, phases, sections, tasks', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  assert.equal(parsed.title, 'Sample Rollout');
  assert.equal(parsed.phases.length, 2);
  const p1 = parsed.phases[0];
  assert.equal(p1.name, 'Phase 1 — Setup');
  assert.equal(p1.orphanItems.filter((i) => i.type === 'task').length, 3);
  assert.equal(p1.sections.length, 1);
  assert.equal(p1.sections[0].name, 'Subsection');
});

test('parseChecklist marks done vs pending vs blocked', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  const tasks = parsed.phases[0].orphanItems.filter((i) => i.type === 'task');
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[0].blocked, false);
  assert.equal(tasks[1].status, 'pending');
  assert.equal(tasks[1].blocked, false);
  assert.equal(tasks[2].status, 'pending');
  assert.equal(tasks[2].blocked, true);
});

test('detectViewMode returns checklist when frontmatter has name', () => {
  const { meta, body } = parser.parseFrontmatter(fixture('checklist.md'));
  assert.equal(parser.detectViewMode({ meta, body }), 'checklist');
});

test('detectViewMode returns markdown for plain file', () => {
  const { meta, body } = parser.parseFrontmatter(fixture('plain.md'));
  assert.equal(parser.detectViewMode({ meta, body }), 'markdown');
});

test('detectViewMode returns checklist when body has unchecked tasks', () => {
  const text = '# No Frontmatter\n\n- [ ] a task\n';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(parser.detectViewMode({ meta, body }), 'checklist');
});

test('computeStats totals done/pending/blocked', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  const stats = parser.computeStats(parsed);
  assert.equal(stats.total, 5);
  assert.equal(stats.done, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.pending, 3);
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
cd ~/Development/docket && npm test
```

Expected: FAIL with "Cannot find module '../lib/parser.js'".

- [ ] **Step 4: Implement parser**

Create `~/Development/docket/lib/parser.js`:

```javascript
// UMD-style so this file works in Node (tests, main process) and as a
// classic <script> in the renderer.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== 'undefined') {
    window.docketParser = mod;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function parseFrontmatter(text) {
    const lines = text.split('\n');
    if (lines[0] !== '---') return { meta: {}, body: text };
    const meta = {};
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') { end = i; break; }
      const idx = lines[i].indexOf(':');
      if (idx > -1) meta[lines[i].slice(0, idx).trim()] = lines[i].slice(idx + 1).trim();
    }
    if (end === -1) return { meta: {}, body: text };
    return { meta, body: lines.slice(end + 1).join('\n') };
  }

  function parseChecklist(body) {
    const lines = body.split('\n');
    const headingRe = /^(#{1,6})\s+(.*)$/;
    const taskRe = /^-\s+\[( |x)\]\s+\*\*([^*]+)\*\*(.*)$/;

    let title = 'Untitled';
    const leadItems = [];
    const phases = [];
    let phase = null;
    let section = null;
    let proseBuffer = [];

    function flushProse() {
      if (!proseBuffer.length) return;
      const text = proseBuffer.join('\n').trim();
      proseBuffer = [];
      if (!text) return;
      const target = section ? section.items : (phase ? phase.orphanItems : leadItems);
      target.push({ type: 'prose', text });
    }

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const m = line.match(headingRe);
      if (m) {
        flushProse();
        const depth = m[1].length;
        const name = m[2].trim();
        if (depth === 1) {
          title = name;
        } else if (depth === 2) {
          phase = { name, sections: [], orphanItems: [] };
          phases.push(phase);
          section = null;
        } else if (depth >= 3) {
          if (!phase) { phase = { name: 'Tasks', sections: [], orphanItems: [] }; phases.push(phase); }
          section = { name, items: [] };
          phase.sections.push(section);
        }
        continue;
      }
      const t = line.match(taskRe);
      if (t) {
        flushProse();
        const status = t[1] === 'x' ? 'done' : 'pending';
        const titleText = t[2].trim().replace(/\.$/, '');
        const rest = (t[3] || '').trim();
        const note = rest.replace(/^—\s*/, '').replace(/^-\s*/, '').trim();
        const lower = rest.toLowerCase();
        const blocked = status === 'pending' && (
          lower.includes('blocked') ||
          lower.includes('e2e pending') ||
          (section && section.name.toLowerCase().includes('blocked'))
        );
        const item = { type: 'task', status, title: titleText, note, blocked };
        if (section) section.items.push(item);
        else if (phase) phase.orphanItems.push(item);
        else leadItems.push(item);
        continue;
      }
      proseBuffer.push(line);
    }
    flushProse();

    return { title, lead: leadItems, phases };
  }

  function computeStats(parsed) {
    let total = 0, done = 0, blocked = 0;
    const visit = (items) => {
      for (const it of items) {
        if (it.type !== 'task') continue;
        total++;
        if (it.status === 'done') done++;
        else if (it.blocked) blocked++;
      }
    };
    visit(parsed.lead);
    for (const p of parsed.phases) {
      visit(p.orphanItems);
      for (const s of p.sections) visit(s.items);
    }
    return { total, done, blocked, pending: total - done - blocked };
  }

  function phaseStats(phase) {
    let total = 0, done = 0;
    const visit = (items) => {
      for (const it of items) {
        if (it.type !== 'task') continue;
        total++;
        if (it.status === 'done') done++;
      }
    };
    visit(phase.orphanItems);
    for (const s of phase.sections) visit(s.items);
    return { done, total };
  }

  function detectViewMode({ meta, body }) {
    if (meta && (meta.name || meta.description || meta.project || meta.repo || meta.status)) {
      return 'checklist';
    }
    if (/^-\s+\[[ x]\]\s+/m.test(body)) return 'checklist';
    return 'markdown';
  }

  function stableId(value) {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    }
    return 'id-' + (h >>> 0).toString(16);
  }

  return { parseFrontmatter, parseChecklist, computeStats, phaseStats, detectViewMode, stableId };
}));
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd ~/Development/docket && npm test
```

Expected: all 9 tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/Development/docket
git add lib/parser.js test/parser.test.js test/fixtures/
git commit -m "feat: extract checklist parser to lib/parser.js with tests"
```

---

## Task 3: Config module (lib/config.js) with tests

**Files:**
- Create: `lib/config.js`
- Create: `test/config.test.js`

- [ ] **Step 1: Write failing tests**

Create `~/Development/docket/test/config.test.js`:

```javascript
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Override config dir for tests
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-config-test-'));
process.env.DOCKET_HOME = TEST_HOME;

const config = require('../lib/config.js');

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

test('read() seeds default config on first run', async () => {
  const cfg = await config.read();
  assert.equal(cfg.roots.length, 1);
  assert.equal(cfg.roots[0].id, 'projects');
  assert.equal(cfg.roots[0].path, path.join(TEST_HOME, 'projects'));
  assert.equal(cfg.roots[0].label, 'Projects');
  assert.ok(fs.existsSync(path.join(TEST_HOME, 'docket.json')));
  assert.ok(fs.existsSync(path.join(TEST_HOME, 'projects')));
});

test('read() returns persisted config on subsequent calls', async () => {
  const cfg = await config.read();
  cfg.roots.push({ id: 'docs', path: '/Users/test/docs', label: 'Docs' });
  await config.write(cfg);
  const reloaded = await config.read();
  assert.equal(reloaded.roots.length, 2);
  assert.equal(reloaded.roots[1].path, '/Users/test/docs');
});

test('write() merges new fields without clobbering unrelated fields', async () => {
  await config.read();
  await config.write({ theme: 'dark' });
  const reloaded = await config.read();
  assert.equal(reloaded.theme, 'dark');
  assert.equal(reloaded.roots.length, 1);  // unchanged
});

test('read() handles malformed JSON by reseeding', async () => {
  fs.writeFileSync(path.join(TEST_HOME, 'docket.json'), '{not valid json');
  const cfg = await config.read();
  assert.equal(cfg.roots.length, 1);
  assert.equal(cfg.roots[0].id, 'projects');
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Development/docket && npm test -- test/config.test.js
```

Expected: FAIL with "Cannot find module '../lib/config.js'".

- [ ] **Step 3: Implement config module**

Create `~/Development/docket/lib/config.js`:

```javascript
const fs = require('fs').promises;
const fsSync = require('fs');
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
    if (!cfg || !Array.isArray(cfg.roots)) throw new Error('invalid');
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/Development/docket && npm test -- test/config.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add lib/config.js test/config.test.js
git commit -m "feat: add config module with seeding and corruption recovery"
```

---

## Task 4: State module (lib/state.js) with tests

**Files:**
- Create: `lib/state.js`
- Create: `test/state.test.js`

- [ ] **Step 1: Write failing tests**

Create `~/Development/docket/test/state.test.js`:

```javascript
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-state-test-'));
process.env.DOCKET_HOME = TEST_HOME;

const state = require('../lib/state.js');

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

test('read() returns empty state on first run', async () => {
  const s = await state.read();
  assert.deepEqual(s.recents, []);
  assert.deepEqual(s.overrides, {});
});

test('write() persists partial updates', async () => {
  await state.write({ recents: [{ absolutePath: '/a.md', openedAt: 1 }] });
  const s = await state.read();
  assert.equal(s.recents.length, 1);
  assert.equal(s.recents[0].absolutePath, '/a.md');
});

test('addRecent() caps at 10 and moves repeats to front', async () => {
  for (let i = 0; i < 12; i++) {
    await state.addRecent(`/file${i}.md`);
  }
  let s = await state.read();
  assert.equal(s.recents.length, 10);
  assert.equal(s.recents[0].absolutePath, '/file11.md');
  await state.addRecent('/file5.md');
  s = await state.read();
  assert.equal(s.recents[0].absolutePath, '/file5.md');
  // still 10, not 11 (no duplicates)
  assert.equal(s.recents.length, 10);
});

test('setOverride persists per-file view mode', async () => {
  await state.setOverride('/x.md', 'markdown');
  const s = await state.read();
  assert.equal(s.overrides['/x.md'], 'markdown');
});

test('clearOverride removes entry', async () => {
  await state.setOverride('/x.md', 'markdown');
  await state.clearOverride('/x.md');
  const s = await state.read();
  assert.equal(s.overrides['/x.md'], undefined);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Development/docket && npm test -- test/state.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement state module**

Create `~/Development/docket/lib/state.js`:

```javascript
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/Development/docket && npm test -- test/state.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add lib/state.js test/state.test.js
git commit -m "feat: add state module for recents and per-file overrides"
```

---

## Task 5: File walker (lib/files.js) with tests

**Files:**
- Create: `lib/files.js`
- Create: `test/files.test.js`

- [ ] **Step 1: Write failing tests**

Create `~/Development/docket/test/files.test.js`:

```javascript
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { walkRoot } = require('../lib/files.js');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-files-test-'));

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

function touch(relativePath, contents = '') {
  const full = path.join(TEST_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('walkRoot finds .md files recursively', async () => {
  touch('a.md');
  touch('sub/b.md');
  touch('sub/deeper/c.md');
  const entries = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  const paths = entries.map((e) => e.relativePath).sort();
  assert.deepEqual(paths, ['a.md', 'sub/b.md', 'sub/deeper/c.md']);
});

test('walkRoot skips non-.md files', async () => {
  touch('a.md');
  touch('b.txt');
  touch('c.json');
  const entries = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].relativePath, 'a.md');
});

test('walkRoot skips dotdirs and node_modules', async () => {
  touch('keep.md');
  touch('.git/hidden.md');
  touch('.hidden/nope.md');
  touch('node_modules/package/junk.md');
  const entries = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  const paths = entries.map((e) => e.relativePath);
  assert.deepEqual(paths, ['keep.md']);
});

test('walkRoot returns rootId, absolutePath, mtime, size', async () => {
  touch('x.md', 'hello');
  const entries = await walkRoot({ id: 'test-root', path: TEST_ROOT, label: 'X' });
  assert.equal(entries[0].rootId, 'test-root');
  assert.equal(entries[0].absolutePath, path.join(TEST_ROOT, 'x.md'));
  assert.equal(entries[0].size, 5);
  assert.ok(typeof entries[0].mtime === 'number');
});

test('walkRoot returns [] if root does not exist', async () => {
  const entries = await walkRoot({ id: 'r', path: '/nonexistent/path', label: 'R' });
  assert.deepEqual(entries, []);
});

test('walkRoot caps at 5000 files and returns capped flag', async () => {
  for (let i = 0; i < 5050; i++) touch(`f${i}.md`);
  const entries = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  assert.equal(entries.length, 5000);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Development/docket && npm test -- test/files.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement file walker**

Create `~/Development/docket/lib/files.js`:

```javascript
const fs = require('fs').promises;
const path = require('path');

const MAX_FILES_PER_ROOT = 5000;
const SKIP_DIRS = new Set(['node_modules']);

function isSkippedDir(name) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  return false;
}

async function walkRoot(root) {
  const entries = [];
  async function recurse(dir) {
    if (entries.length >= MAX_FILES_PER_ROOT) return;
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= MAX_FILES_PER_ROOT) return;
      if (child.isDirectory()) {
        if (isSkippedDir(child.name)) continue;
        await recurse(path.join(dir, child.name));
      } else if (child.isFile()) {
        if (!child.name.endsWith('.md')) continue;
        const absolutePath = path.join(dir, child.name);
        let stat;
        try {
          stat = await fs.stat(absolutePath);
        } catch {
          continue;
        }
        entries.push({
          rootId: root.id,
          absolutePath,
          relativePath: path.relative(root.path, absolutePath),
          mtime: stat.mtimeMs,
          size: stat.size
        });
      }
    }
  }
  await recurse(root.path);
  return entries;
}

module.exports = { walkRoot, MAX_FILES_PER_ROOT };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/Development/docket && npm test -- test/files.test.js
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add lib/files.js test/files.test.js
git commit -m "feat: add recursive .md walker with skip rules and file cap"
```

---

## Task 6: Content search (lib/search.js) with tests

**Files:**
- Create: `lib/search.js`
- Create: `test/search.test.js`

- [ ] **Step 1: Write failing tests**

Create `~/Development/docket/test/search.test.js`:

```javascript
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { searchContent, cancelSearch } = require('../lib/search.js');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-search-test-'));

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

function touch(relativePath, contents) {
  const full = path.join(TEST_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('searchContent finds substring matches', async () => {
  touch('a.md', 'hello world\nanother line\n');
  touch('b.md', 'nothing interesting here\n');
  const hits = await searchContent('hello', [TEST_ROOT]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].absolutePath, path.join(TEST_ROOT, 'a.md'));
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].snippet, /hello world/);
});

test('searchContent is case-insensitive', async () => {
  touch('a.md', 'Hello World\n');
  const hits = await searchContent('HELLO', [TEST_ROOT]);
  assert.equal(hits.length, 1);
});

test('searchContent returns empty array for no matches', async () => {
  touch('a.md', 'nothing here\n');
  const hits = await searchContent('missing-term', [TEST_ROOT]);
  assert.deepEqual(hits, []);
});

test('searchContent returns empty array for empty query', async () => {
  touch('a.md', 'nothing here\n');
  const hits = await searchContent('', [TEST_ROOT]);
  assert.deepEqual(hits, []);
});

test('searchContent caps at 50 hits total', async () => {
  let content = '';
  for (let i = 0; i < 100; i++) content += `match ${i}\n`;
  touch('a.md', content);
  const hits = await searchContent('match', [TEST_ROOT]);
  assert.ok(hits.length <= 50);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Development/docket && npm test -- test/search.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement search**

Create `~/Development/docket/lib/search.js`:

```javascript
const { spawn } = require('child_process');
const { rgPath } = require('@vscode/ripgrep');

const MAX_HITS = 50;
const MAX_PER_FILE = 5;
let currentProcess = null;

function cancelSearch() {
  if (currentProcess && !currentProcess.killed) {
    currentProcess.kill();
  }
  currentProcess = null;
}

function searchContent(query, rootPaths) {
  return new Promise((resolve) => {
    if (!query || !query.trim()) { resolve([]); return; }
    if (!rootPaths || rootPaths.length === 0) { resolve([]); return; }

    cancelSearch();

    const args = [
      '--json',
      '-i',
      `--max-count=${MAX_PER_FILE}`,
      '--type=md',
      '-e', query,
      ...rootPaths
    ];
    const proc = spawn(rgPath, args);
    currentProcess = proc;

    const hits = [];
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (hits.length >= MAX_HITS) break;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match' && obj.data) {
            hits.push({
              absolutePath: obj.data.path.text,
              line: obj.data.line_number,
              snippet: obj.data.lines.text.replace(/\n$/, '')
            });
          }
        } catch {
          // ignore malformed lines
        }
      }
      if (hits.length >= MAX_HITS) proc.kill();
    });

    proc.on('close', () => {
      if (currentProcess === proc) currentProcess = null;
      resolve(hits);
    });

    proc.on('error', () => {
      if (currentProcess === proc) currentProcess = null;
      resolve(hits);
    });
  });
}

module.exports = { searchContent, cancelSearch };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/Development/docket && npm test -- test/search.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add lib/search.js test/search.test.js
git commit -m "feat: add ripgrep-backed content search with cancellation"
```

---

## Task 7: Vendor libraries copy script

**Files:**
- Create: `scripts/copy-vendor.js`

- [ ] **Step 1: Write the script**

Create `~/Development/docket/scripts/copy-vendor.js`:

```javascript
const fs = require('fs');
const path = require('path');

const targets = [
  {
    src: path.resolve(__dirname, '../node_modules/marked/marked.min.js'),
    dst: path.resolve(__dirname, '../renderer/vendor/marked.min.js')
  },
  {
    src: path.resolve(__dirname, '../node_modules/dompurify/dist/purify.min.js'),
    dst: path.resolve(__dirname, '../renderer/vendor/purify.min.js')
  }
];

fs.mkdirSync(path.resolve(__dirname, '../renderer/vendor'), { recursive: true });

for (const { src, dst } of targets) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-vendor] source missing: ${src}`);
    process.exit(0);
  }
  fs.copyFileSync(src, dst);
  console.log(`[copy-vendor] ${path.relative(path.resolve(__dirname, '..'), dst)}`);
}
```

- [ ] **Step 2: Run it**

```bash
cd ~/Development/docket && node scripts/copy-vendor.js
```

Expected: `renderer/vendor/marked.min.js` and `renderer/vendor/purify.min.js` now exist.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add scripts/copy-vendor.js
git commit -m "chore: add postinstall script to copy marked and dompurify to renderer/vendor"
```

---

## Task 8: Main process skeleton + preload

**Files:**
- Create: `main.js`
- Create: `preload.js`

Minimal working app: opens a window, exposes IPC for config/state/files/readFile/search, wires chokidar. No settings window yet (Task 14).

- [ ] **Step 1: Write preload.js**

Create `~/Development/docket/preload.js`:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docket', {
  getConfig: () => ipcRenderer.invoke('docket:getConfig'),
  updateConfig: (partial) => ipcRenderer.invoke('docket:updateConfig', partial),
  getState: () => ipcRenderer.invoke('docket:getState'),
  updateState: (partial) => ipcRenderer.invoke('docket:updateState', partial),
  addRecent: (absolutePath) => ipcRenderer.invoke('docket:addRecent', absolutePath),
  setOverride: (absolutePath, mode) => ipcRenderer.invoke('docket:setOverride', absolutePath, mode),
  clearOverride: (absolutePath) => ipcRenderer.invoke('docket:clearOverride', absolutePath),
  listFiles: (rootId) => ipcRenderer.invoke('docket:listFiles', rootId),
  listAllFiles: () => ipcRenderer.invoke('docket:listAllFiles'),
  readFile: (absolutePath) => ipcRenderer.invoke('docket:readFile', absolutePath),
  searchContent: (query) => ipcRenderer.invoke('docket:searchContent', query),
  cancelSearch: () => ipcRenderer.invoke('docket:cancelSearch'),
  openSettingsWindow: () => ipcRenderer.invoke('docket:openSettings'),
  pickDirectory: () => ipcRenderer.invoke('docket:pickDirectory'),
  getVersion: () => ipcRenderer.invoke('docket:getVersion'),
  onFileChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:file-change', listener);
    return () => ipcRenderer.removeListener('docket:file-change', listener);
  },
  onConfigChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:config-change', listener);
    return () => ipcRenderer.removeListener('docket:config-change', listener);
  }
});
```

- [ ] **Step 2: Write main.js**

Create `~/Development/docket/main.js`:

```javascript
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
  // Implemented in Task 14
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
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add main.js preload.js
git commit -m "feat: add main process, preload IPC surface, and chokidar watcher"
```

---

## Task 9: Minimal renderer — index.html + placeholder app.js

Goal: `npm start` opens a window that populates a sidebar with files from the `projects` root.

**Files:**
- Create: `renderer/index.html`
- Create: `renderer/styles.css` (copy from `web/styles.css`)
- Create: `renderer/app.js` (minimal version)

- [ ] **Step 1: Copy styles**

```bash
cd ~/Development/docket && cp web/styles.css renderer/styles.css
```

- [ ] **Step 2: Write renderer/index.html**

Create `~/Development/docket/renderer/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:;" />
  <title>Docket</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div class="app">
    <aside id="sidebar" class="sidebar">
      <div class="sidebar-head">
        <input id="search-box" type="text" placeholder="Search files…" />
      </div>
      <div id="sidebar-results"></div>
      <div id="sidebar-recents"></div>
      <div id="sidebar-browse"></div>
    </aside>
    <main id="content" class="content">
      <div class="empty-state"><h1>Docket</h1><p>Select a file from the sidebar.</p></div>
    </main>
  </div>

  <script src="./vendor/marked.min.js"></script>
  <script src="./vendor/purify.min.js"></script>
  <script src="../lib/parser.js"></script>
  <script src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write minimal app.js**

Create `~/Development/docket/renderer/app.js`:

```javascript
(async () => {
  const browse = document.getElementById('sidebar-browse');
  const content = document.getElementById('content');

  const cfg = await window.docket.getConfig();
  const allFiles = await window.docket.listAllFiles();

  function render() {
    const byRoot = new Map();
    for (const e of allFiles) {
      if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
      byRoot.get(e.rootId).push(e);
    }
    const parts = [];
    for (const root of cfg.roots) {
      const files = (byRoot.get(root.id) || []).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      parts.push(`<details open class="root"><summary>${escapeHTML(root.label)}</summary><ul class="file-list">`);
      for (const f of files) {
        parts.push(`<li><button type="button" data-path="${escapeHTML(f.absolutePath)}">${escapeHTML(f.relativePath)}</button></li>`);
      }
      parts.push('</ul></details>');
    }
    browse.innerHTML = parts.join('');
    browse.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
  }

  async function openFile(absolutePath) {
    try {
      const text = await window.docket.readFile(absolutePath);
      content.innerHTML = `<pre style="padding:16px; white-space:pre-wrap">${escapeHTML(text)}</pre>`;
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Error</h1><p>${escapeHTML(String(e))}</p></div>`;
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  render();
})();
```

- [ ] **Step 4: Smoke test**

```bash
cd ~/Development/docket && npm start
```

Expected: window opens. Sidebar shows "Projects" root (empty). No crash.

Place a test file:
```bash
mkdir -p ~/.docket/projects
echo "# Hello from docket" > ~/.docket/projects/hello.md
```

Close the window and rerun `npm start`. Expected: `hello.md` appears in sidebar. Click it → raw text renders in right pane.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add renderer/
git commit -m "feat: minimal renderer showing file list and raw content"
```

---

## Task 10: Full renderer port — checklist + markdown rendering

Goal: replace the minimal `app.js` with a full port of `web/app.js` that renders both checklist and plain-markdown views, using the shared parser and bundled marked/DOMPurify.

**Files:**
- Modify: `renderer/app.js` (full rewrite)
- Modify: `renderer/styles.css` (add view-mode toggle styles)

- [ ] **Step 1: Full renderer/app.js**

Overwrite `~/Development/docket/renderer/app.js`:

```javascript
(async () => {
  const SIDEBAR_KEY = 'docket:sidebar-hidden';
  const COLLAPSE_KEY = 'docket:collapsed-phases';

  const browse = document.getElementById('sidebar-browse');
  const recents = document.getElementById('sidebar-recents');
  const results = document.getElementById('sidebar-results');
  const search = document.getElementById('search-box');
  const content = document.getElementById('content');

  marked.setOptions({ gfm: true, breaks: false });
  const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

  let cfg = await window.docket.getConfig();
  let allFiles = await window.docket.listAllFiles();
  let appState = await window.docket.getState();
  let currentPath = null;

  // ---- Sidebar rendering ----

  function renderBrowse() {
    const byRoot = new Map();
    for (const e of allFiles) {
      if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
      byRoot.get(e.rootId).push(e);
    }
    const parts = [];
    for (const root of cfg.roots) {
      const files = (byRoot.get(root.id) || []).slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const tree = buildTree(files);
      parts.push(`<details class="root" open><summary>${escapeHTML(root.label)}</summary>${renderTree(tree)}</details>`);
    }
    browse.innerHTML = parts.join('');
    browse.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
  }

  function buildTree(files) {
    const tree = { dirs: new Map(), files: [] };
    for (const f of files) {
      const segs = f.relativePath.split('/');
      let node = tree;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!node.dirs.has(segs[i])) node.dirs.set(segs[i], { dirs: new Map(), files: [] });
        node = node.dirs.get(segs[i]);
      }
      node.files.push(f);
    }
    return tree;
  }

  function renderTree(node) {
    const parts = ['<ul class="file-list">'];
    const dirNames = [...node.dirs.keys()].sort();
    for (const name of dirNames) {
      parts.push(`<li><details><summary>${escapeHTML(name)}/</summary>${renderTree(node.dirs.get(name))}</details></li>`);
    }
    for (const f of node.files) {
      const basename = f.relativePath.split('/').pop();
      parts.push(`<li><button type="button" data-path="${escapeHTML(f.absolutePath)}"${currentPath === f.absolutePath ? ' class="active"' : ''}>${escapeHTML(basename)}</button></li>`);
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderRecents() {
    const valid = appState.recents.filter((r) => allFiles.some((f) => f.absolutePath === r.absolutePath));
    if (!valid.length) { recents.innerHTML = ''; return; }
    const parts = ['<div class="sidebar-section-title">Recents</div><ul class="file-list">'];
    for (const r of valid) {
      const basename = r.absolutePath.split('/').pop();
      parts.push(`<li><button type="button" data-path="${escapeHTML(r.absolutePath)}"${currentPath === r.absolutePath ? ' class="active"' : ''}>${escapeHTML(basename)}</button></li>`);
    }
    parts.push('</ul>');
    recents.innerHTML = parts.join('');
    recents.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
  }

  // ---- Search ----

  let searchDebounce;
  search.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 150);
  });

  async function runSearch() {
    const q = search.value.trim();
    if (!q) { results.innerHTML = ''; renderRecents(); browse.style.display = ''; return; }
    recents.innerHTML = '';
    browse.style.display = 'none';

    // Filename matches (basename-first ranking)
    const qLower = q.toLowerCase();
    const nameHits = [];
    for (const f of allFiles) {
      const base = f.relativePath.split('/').pop().toLowerCase();
      if (base.includes(qLower)) nameHits.push({ file: f, rank: 0 });
      else if (f.relativePath.toLowerCase().includes(qLower)) nameHits.push({ file: f, rank: 1 });
    }
    nameHits.sort((a, b) => a.rank - b.rank || a.file.relativePath.localeCompare(b.file.relativePath));

    const contentHits = await window.docket.searchContent(q);
    if (search.value.trim() !== q) return;  // discard stale results

    const parts = [];
    if (nameHits.length) {
      parts.push('<div class="sidebar-section-title">Files</div><ul class="file-list">');
      for (const h of nameHits.slice(0, 50)) {
        parts.push(`<li><button type="button" data-path="${escapeHTML(h.file.absolutePath)}">${escapeHTML(h.file.relativePath)}</button></li>`);
      }
      parts.push('</ul>');
    }
    if (contentHits.length) {
      parts.push('<div class="sidebar-section-title">In content</div><ul class="file-list">');
      for (const h of contentHits) {
        const basename = h.absolutePath.split('/').pop();
        parts.push(`<li><button type="button" data-path="${escapeHTML(h.absolutePath)}" data-line="${h.line}"><div>${escapeHTML(basename)}:${h.line}</div><div class="snippet">${escapeHTML(h.snippet)}</div></button></li>`);
      }
      parts.push('</ul>');
    }
    if (!nameHits.length && !contentHits.length) {
      parts.push('<div class="empty-hint">No matches.</div>');
    }
    results.innerHTML = parts.join('');
    results.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
  }

  // ---- File opening + rendering ----

  async function openFile(absolutePath) {
    currentPath = absolutePath;
    try {
      const text = await window.docket.readFile(absolutePath);
      await window.docket.addRecent(absolutePath);
      appState = await window.docket.getState();
      renderFile(absolutePath, text);
      renderBrowse();
      if (!search.value.trim()) renderRecents();
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p></div>`;
    }
  }

  function renderFile(absolutePath, text) {
    const { meta, body } = docketParser.parseFrontmatter(text);
    const override = appState.overrides[absolutePath];
    const mode = override || docketParser.detectViewMode({ meta, body });

    const headerParts = [];
    const basename = absolutePath.split('/').pop();
    headerParts.push(`<header class="file-head"><div class="breadcrumb">${escapeHTML(basename)}</div>`);
    headerParts.push(`<div class="view-toggle"><label>View: <select id="view-mode"><option value="checklist"${mode === 'checklist' ? ' selected' : ''}>Checklist</option><option value="markdown"${mode === 'markdown' ? ' selected' : ''}>Markdown</option></select></label></div>`);
    headerParts.push('</header>');

    let bodyHTML;
    if (mode === 'checklist') {
      bodyHTML = renderChecklist(meta, body);
    } else {
      bodyHTML = `<div class="prose">${md(text)}</div>`;
    }

    content.innerHTML = headerParts.join('') + bodyHTML;
    wireCollapsibles(absolutePath);

    const toggle = document.getElementById('view-mode');
    toggle.addEventListener('change', async () => {
      await window.docket.setOverride(absolutePath, toggle.value);
      appState = await window.docket.getState();
      renderFile(absolutePath, text);
    });
  }

  function renderChecklist(meta, body) {
    const parsed = docketParser.parseChecklist(body);
    const stats = docketParser.computeStats(parsed);
    const pct = stats.total ? Math.round(100 * stats.done / stats.total) : 0;
    const name = meta.name || parsed.title;
    const descHTML = meta.description ? `<p class="dashboard-desc">${escapeHTML(meta.description)}</p>` : '';
    const projHTML = (meta.project || meta.repo) ? `<p class="dashboard-project">${escapeHTML(meta.project || meta.repo)}</p>` : '';
    const leadHTML = parsed.lead.length ? `<div class="lead">${renderItems(parsed.lead)}</div>` : '';
    const phasesHTML = parsed.phases.map((p) => renderPhase(p, name)).join('');

    return `
      <header class="dashboard-head">
        <h1>${escapeHTML(name)}</h1>
        ${descHTML}
        ${projHTML}
      </header>
      <div class="stats">
        <div class="stat done"><div class="label">Done</div><div class="value">${stats.done}</div></div>
        <div class="stat pending"><div class="label">Pending</div><div class="value">${stats.pending}</div></div>
        <div class="stat blocked"><div class="label">Blocked</div><div class="value">${stats.blocked}</div></div>
        <div class="stat"><div class="label">Total</div><div class="value">${stats.total}</div></div>
      </div>
      <div class="progress"><div class="progress-bar" style="width: ${pct}%"></div></div>
      ${leadHTML}
      ${phasesHTML}
    `;
  }

  function renderItems(items) {
    const parts = [];
    let tasks = [];
    const flush = () => {
      if (!tasks.length) return;
      parts.push(`<ul class="task-list">${tasks.map(renderTaskRow).join('')}</ul>`);
      tasks = [];
    };
    for (const it of items) {
      if (it.type === 'task') tasks.push(it);
      else { flush(); parts.push(`<div class="prose">${md(it.text)}</div>`); }
    }
    flush();
    return parts.join('');
  }

  function renderTaskRow(t) {
    const cls = t.status === 'done' ? 'done' : (t.blocked ? 'blocked' : 'pending');
    const icon = t.status === 'done' ? '✓' : (t.blocked ? '⏸' : '○');
    const noteHTML = t.note ? `<div class="note">${md(t.note)}</div>` : '';
    return `<li class="row ${cls}"><span class="icon">${icon}</span><div class="content"><div class="title">${escapeHTML(t.title)}</div>${noteHTML}</div></li>`;
  }

  function renderPhase(phase, idPrefix) {
    const phaseId = docketParser.stableId(idPrefix + '::' + phase.name);
    const s = docketParser.phaseStats(phase);
    const secs = [];
    if (phase.orphanItems.length) secs.push(`<div class="section">${renderItems(phase.orphanItems)}</div>`);
    for (const sec of phase.sections) {
      secs.push(`<div class="section"><h3>${escapeHTML(sec.name)}</h3>${renderItems(sec.items)}</div>`);
    }
    return `<div class="phase" data-phase-id="${phaseId}">
      <button class="phase-header" type="button" aria-expanded="true">
        <span class="chevron" aria-hidden="true">▾</span>
        <h2>${escapeHTML(phase.name)}</h2>
        <div class="phase-stats">${s.done}/${s.total} done</div>
      </button>
      <div class="phase-body">${secs.join('')}</div>
    </div>`;
  }

  function wireCollapsibles(absolutePath) {
    const collapsed = loadCollapsed();
    content.querySelectorAll('.phase').forEach((phase) => {
      const id = phase.dataset.phaseId;
      const header = phase.querySelector('.phase-header');
      if (collapsed.has(id)) {
        phase.classList.add('collapsed');
        header.setAttribute('aria-expanded', 'false');
      }
      header.addEventListener('click', () => {
        const isCollapsed = phase.classList.toggle('collapsed');
        header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        if (isCollapsed) collapsed.add(id); else collapsed.delete(id);
        saveCollapsed(collapsed);
      });
    });
  }

  function loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveCollapsed(s) { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s])); }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---- Live refresh ----

  window.docket.onFileChange(async () => {
    allFiles = await window.docket.listAllFiles();
    if (!search.value.trim()) renderRecents();
    renderBrowse();
    if (currentPath && allFiles.some((f) => f.absolutePath === currentPath)) {
      try {
        const text = await window.docket.readFile(currentPath);
        renderFile(currentPath, text);
      } catch {
        content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
        currentPath = null;
      }
    } else if (currentPath) {
      content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
      currentPath = null;
    }
  });

  window.docket.onConfigChange(async (newCfg) => {
    cfg = newCfg;
    allFiles = await window.docket.listAllFiles();
    renderBrowse();
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      search.focus(); search.select();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      window.docket.openSettingsWindow();
    }
  });

  renderBrowse();
  renderRecents();

  // Re-open last recent if present
  if (appState.recents.length) openFile(appState.recents[0].absolutePath);
})();
```

- [ ] **Step 2: Add view-toggle styles**

Append to `~/Development/docket/renderer/styles.css` (at the end):

```css
.file-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.file-head .breadcrumb { font-size: 12px; color: var(--muted); }
.file-head select {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
}
.sidebar-section-title {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 0.05em;
  padding: 8px 12px 4px;
}
.file-list { list-style: none; padding: 0 4px; margin: 0; }
.file-list li button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--fg);
  font: inherit;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.file-list li button:hover { background: rgba(255, 255, 255, 0.04); }
.file-list li button.active { background: rgba(123, 147, 255, 0.18); }
.file-list .snippet { font-size: 11px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-head { padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
#search-box {
  width: 100%;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--fg);
  font-size: 13px;
}
.empty-hint { color: var(--muted); font-size: 12px; padding: 12px; }
details.root > summary {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
details > summary { cursor: pointer; }
details summary::-webkit-details-marker { display: none; }
```

- [ ] **Step 3: Smoke test**

```bash
cd ~/Development/docket && npm start
```

Place a test checklist in `~/.docket/projects/test.md`:

```markdown
---
name: Test
status: active
---

# Test

## Phase 1

- [x] **1. Done**
- [ ] **2. Pending**
```

Expected: sidebar shows `test.md`, clicking it renders the checklist view with progress bar, phase card, task chips. Changing "View: Markdown" re-renders as plain markdown. Editing `test.md` externally updates the display within ~1s.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/docket
git add renderer/app.js renderer/styles.css
git commit -m "feat: port full renderer with checklist view, search, and live refresh"
```

---

## Task 11: Settings window

**Files:**
- Create: `renderer/settings.html`
- Create: `renderer/settings.js`
- Modify: `main.js` (implement `docket:openSettings`)

- [ ] **Step 1: Write settings.html**

Create `~/Development/docket/renderer/settings.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';" />
  <title>Docket Preferences</title>
  <link rel="stylesheet" href="./styles.css" />
  <style>
    body { margin: 0; }
    .settings { display: flex; height: 100vh; }
    .settings-nav { width: 140px; border-right: 1px solid rgba(255, 255, 255, 0.06); padding: 12px 0; }
    .settings-nav button { display: block; width: 100%; text-align: left; background: transparent; border: 0; color: var(--fg); padding: 8px 16px; cursor: pointer; font: inherit; }
    .settings-nav button.active { background: rgba(123, 147, 255, 0.18); }
    .settings-body { flex: 1; padding: 20px; overflow: auto; }
    .root-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .root-row input { flex: 1; background: rgba(255, 255, 255, 0.06); color: var(--fg); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 4px 8px; }
    .root-row .path { color: var(--muted); font-size: 11px; flex: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn { background: rgba(255, 255, 255, 0.06); color: var(--fg); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
    .btn:hover { background: rgba(255, 255, 255, 0.12); }
    .about-line { padding: 4px 0; font-size: 13px; color: var(--fg); }
    .about-line .label { color: var(--muted); margin-right: 8px; }
  </style>
</head>
<body>
  <div class="settings">
    <nav class="settings-nav">
      <button type="button" class="active" data-pane="roots">Roots</button>
      <button type="button" data-pane="appearance">Appearance</button>
      <button type="button" data-pane="about">About</button>
    </nav>
    <div class="settings-body">
      <section id="pane-roots"></section>
      <section id="pane-appearance" style="display:none"></section>
      <section id="pane-about" style="display:none"></section>
    </div>
  </div>
  <script src="./settings.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write settings.js**

Create `~/Development/docket/renderer/settings.js`:

```javascript
(async () => {
  const navButtons = document.querySelectorAll('.settings-nav button');
  const panes = {
    roots: document.getElementById('pane-roots'),
    appearance: document.getElementById('pane-appearance'),
    about: document.getElementById('pane-about')
  };

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.toggle('active', b === btn));
      Object.entries(panes).forEach(([name, el]) => {
        el.style.display = name === btn.dataset.pane ? '' : 'none';
      });
    });
  });

  let cfg = await window.docket.getConfig();

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function renderRoots() {
    const rows = cfg.roots.map((r, i) => `
      <div class="root-row" data-index="${i}">
        <input type="text" class="label-input" value="${escapeHTML(r.label)}" />
        <span class="path" title="${escapeHTML(r.path)}">${escapeHTML(r.path)}</span>
        <button type="button" class="btn remove">Remove</button>
      </div>
    `).join('');
    panes.roots.innerHTML = `
      <h2>Roots</h2>
      <div id="root-rows">${rows}</div>
      <div style="margin-top: 16px;">
        <button type="button" id="add-root" class="btn">Add root…</button>
      </div>
    `;
    panes.roots.querySelectorAll('.label-input').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const i = Number(inp.closest('.root-row').dataset.index);
        cfg.roots[i].label = inp.value.trim() || cfg.roots[i].path.split('/').pop();
        cfg = await window.docket.updateConfig({ roots: cfg.roots });
        renderRoots();
      });
    });
    panes.roots.querySelectorAll('.remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.closest('.root-row').dataset.index);
        if (cfg.roots.length === 1) { alert('At least one root is required.'); return; }
        cfg.roots.splice(i, 1);
        cfg = await window.docket.updateConfig({ roots: cfg.roots });
        renderRoots();
      });
    });
    document.getElementById('add-root').addEventListener('click', async () => {
      const picked = await window.docket.pickDirectory();
      if (!picked) return;
      const basename = picked.split('/').pop();
      cfg.roots.push({ id: 'root-' + Date.now().toString(36), path: picked, label: basename });
      cfg = await window.docket.updateConfig({ roots: cfg.roots });
      renderRoots();
    });
  }

  async function renderAppearance() {
    panes.appearance.innerHTML = `
      <h2>Appearance</h2>
      <label>Theme:
        <select id="theme-select">
          <option value="system"${cfg.theme === 'system' ? ' selected' : ''}>System</option>
          <option value="dark"${cfg.theme === 'dark' ? ' selected' : ''}>Dark</option>
          <option value="light"${cfg.theme === 'light' ? ' selected' : ''}>Light</option>
        </select>
      </label>
    `;
    panes.appearance.querySelector('#theme-select').addEventListener('change', async (e) => {
      cfg = await window.docket.updateConfig({ theme: e.target.value });
    });
  }

  async function renderAbout() {
    const v = await window.docket.getVersion();
    panes.about.innerHTML = `
      <h2>About</h2>
      <div class="about-line"><span class="label">Version</span>${escapeHTML(v.version)}</div>
      <div class="about-line"><span class="label">Channel</span>${escapeHTML(v.channel)}</div>
      ${v.buildDate ? `<div class="about-line"><span class="label">Build date</span>${escapeHTML(v.buildDate)}</div>` : ''}
    `;
  }

  renderRoots();
  renderAppearance();
  renderAbout();
})();
```

- [ ] **Step 3: Implement `docket:openSettings` in main.js**

Find this block in `main.js`:
```javascript
ipcMain.handle('docket:openSettings', async () => {
  // Implemented in Task 14
});
```

Replace with:
```javascript
let settingsWindow = null;
ipcMain.handle('docket:openSettings', async () => {
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
});
```

- [ ] **Step 4: Smoke test**

```bash
cd ~/Development/docket && npm start
```

Press `⌘,`. Expected: settings window opens. "Roots" pane lists the `Projects` root. Click "Add root…" → pick a directory → new root appears in main window's sidebar. Edit a label → sidebar updates. Remove a non-default root → it disappears from sidebar.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add renderer/settings.html renderer/settings.js main.js
git commit -m "feat: add preferences window with roots/appearance/about panes"
```

---

## Task 12: Error boundaries

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

Goal: graceful handling of bad frontmatter, missing files, I/O errors, and unavailable roots.

- [ ] **Step 1: Add bad-frontmatter fixture and test**

Create `~/Development/docket/test/fixtures/bad-frontmatter.md`:

```markdown
---
name: Broken
this is not valid yaml at all: and has: colons: everywhere:
---

# Broken

Body continues.
```

Add to `test/parser.test.js`:

```javascript
test('parseFrontmatter recovers gracefully from lines without colons', () => {
  const text = '---\nname: test\nweird-line-without-colon\n---\n# Body';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(meta.name, 'test');
  assert.match(body, /^# Body/);
});
```

Run tests to verify parser already handles this:
```bash
cd ~/Development/docket && npm test -- test/parser.test.js
```

Expected: all tests pass (including the new one).

- [ ] **Step 2: Add error-chip rendering to renderFile**

In `renderer/app.js`, find `function renderFile(absolutePath, text) {` and replace the whole function with:

```javascript
function renderFile(absolutePath, text) {
  const { meta, body } = docketParser.parseFrontmatter(text);
  const override = appState.overrides[absolutePath];
  const mode = override || docketParser.detectViewMode({ meta, body });

  // Frontmatter warning: has delimiters but meta empty → malformed
  const looksLikeFrontmatter = text.startsWith('---\n');
  const frontmatterWarning = looksLikeFrontmatter && Object.keys(meta).length === 0;

  const basename = absolutePath.split('/').pop();
  const headerParts = [];
  headerParts.push(`<header class="file-head"><div class="breadcrumb">${escapeHTML(basename)}${frontmatterWarning ? ' <span class="chip-warn">⚠ invalid frontmatter</span>' : ''}</div>`);
  headerParts.push(`<div class="view-toggle"><label>View: <select id="view-mode"><option value="checklist"${mode === 'checklist' ? ' selected' : ''}>Checklist</option><option value="markdown"${mode === 'markdown' ? ' selected' : ''}>Markdown</option></select></label></div>`);
  headerParts.push('</header>');

  let bodyHTML;
  try {
    if (mode === 'checklist') {
      bodyHTML = renderChecklist(meta, body);
    } else {
      bodyHTML = `<div class="prose">${md(text)}</div>`;
    }
  } catch (e) {
    bodyHTML = `<div class="empty-state"><h1>Render failed</h1><p>${escapeHTML(String(e))}</p></div>`;
  }

  content.innerHTML = headerParts.join('') + bodyHTML;
  wireCollapsibles(absolutePath);

  const toggle = document.getElementById('view-mode');
  toggle.addEventListener('change', async () => {
    await window.docket.setOverride(absolutePath, toggle.value);
    appState = await window.docket.getState();
    renderFile(absolutePath, text);
  });
}
```

- [ ] **Step 3: Add chip styles**

Append to `renderer/styles.css`:

```css
.chip-warn {
  display: inline-block;
  background: rgba(235, 168, 80, 0.15);
  color: #eba850;
  border: 1px solid rgba(235, 168, 80, 0.4);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  margin-left: 6px;
}
```

- [ ] **Step 4: Smoke test**

```bash
cp ~/Development/docket/test/fixtures/bad-frontmatter.md ~/.docket/projects/
cd ~/Development/docket && npm start
```

Expected: sidebar shows `bad-frontmatter.md`, clicking it renders the body and shows the amber "⚠ invalid frontmatter" chip next to the filename.

Then test file deletion while open:
1. With `bad-frontmatter.md` open, delete it externally: `rm ~/.docket/projects/bad-frontmatter.md`
2. Expected: pane shows "File was moved or deleted", sidebar entry disappears.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add renderer/app.js renderer/styles.css test/parser.test.js test/fixtures/bad-frontmatter.md
git commit -m "feat: add error boundaries for bad frontmatter and missing files"
```

---

## Task 13: Application menu (⌘, and Quit)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add menu construction in main.js**

At the top of `main.js`, add `Menu` to the electron import:
```javascript
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
```

Near the top of `main.js` (after imports), add:

```javascript
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'Cmd+,',
          click: () => { ipcMain.emit('docket:openSettings', {}); openSettingsDirectly(); }
        },
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
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openSettingsDirectly() {
  // Shared helper so both menu and IPC call the same code path.
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
```

Replace the previous `ipcMain.handle('docket:openSettings', ...)` body (from Task 11) with:

```javascript
ipcMain.handle('docket:openSettings', async () => { openSettingsDirectly(); });
```

And in the `app.whenReady().then(...)` block, add `buildAppMenu();` before `createMainWindow();`:

```javascript
app.whenReady().then(async () => {
  await rebuildIndex();
  await restartWatcher();
  buildAppMenu();
  createMainWindow();
  ...
});
```

- [ ] **Step 2: Smoke test**

```bash
cd ~/Development/docket && npm start
```

Expected: macOS menu bar shows `Docket` → `Preferences…` with keyboard shortcut `⌘,`. Clicking it opens the settings window. `⌘Q` quits.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add main.js
git commit -m "feat: add macOS application menu with Preferences shortcut"
```

---

## Task 14: IPC security verification

**Files:**
- Modify: `main.js` (already has path check in readFile; add same protection to any future path-accepting handler)

- [ ] **Step 1: Verify no Node globals leak to renderer**

Launch app, open DevTools via menu View → Toggle Developer Tools, and in Console run:

```javascript
typeof require  // expect: "undefined"
typeof process  // expect: "undefined"
typeof global   // expect: "undefined"
window.docket   // expect: object with all exposed methods
```

All four assertions must hold. If any leak, the security model is broken.

- [ ] **Step 2: Verify path-traversal rejection**

In renderer DevTools console:

```javascript
await window.docket.readFile('/etc/passwd')
// expect: error "Path outside configured roots"
```

And:
```javascript
await window.docket.readFile('/tmp/../etc/passwd')
// expect: error (either "outside configured roots" after path.resolve, or file-not-found if symlinked)
```

Both must error out.

- [ ] **Step 3: Document result**

No code changes if both steps pass. If they don't, fix before continuing.

- [ ] **Step 4: Commit (if changes were required)**

```bash
cd ~/Development/docket
git add main.js
git commit -m "fix: tighten IPC path validation against traversal"
```

If no changes were needed, skip this step.

---

## Task 15: Manual golden path verification

Run through the full user story end-to-end.

- [ ] **Step 1: First-run seeding**

```bash
rm -rf ~/.docket
cd ~/Development/docket && npm start
```

Expected: window opens. `~/.docket/docket.json`, `~/.docket/state.json`, and `~/.docket/projects/` directory all created. Sidebar shows "Projects" root (empty), main pane shows empty state.

- [ ] **Step 2: Render checklist file**

In a separate terminal:
```bash
cat > ~/.docket/projects/sample.md <<'EOF'
---
name: Sample
status: active
---

# Sample

## Phase 1

- [x] **1. Done**
- [ ] **2. Pending**
- [ ] **3. Blocked** — blocked on something
EOF
```

Expected (within 1s): `sample.md` appears in sidebar. Click it: checklist view renders with progress bar (33%), three task chips styled done/pending/blocked.

- [ ] **Step 3: Live refresh**

In the same terminal, edit the file:
```bash
sed -i '' 's/2. Pending/2. Now done/; s/\[ \] \*\*2/[x] **2/' ~/.docket/projects/sample.md
```

Expected: within 1s, UI updates — progress bar now 67%, task 2 has green "done" styling.

- [ ] **Step 4: Add another root**

Press `⌘,`, click "Add root…", pick `~/docs/` (or any directory with `.md` files). Close settings.

Expected: sidebar now has two root sections. Files from the new root appear under its section.

- [ ] **Step 5: Search**

Type a substring of a filename in the search box.

Expected: "Files" section appears with matching entries, ranked by basename-match-first.

Then type a unique word that appears inside a file (not in the filename).

Expected: "In content" section appears with filename, line number, and snippet.

- [ ] **Step 6: View-mode override**

Click the "View" dropdown on any rendered file. Change from Checklist to Markdown.

Expected: pane re-renders as plain markdown. Close the file and reopen — still Markdown (override persisted in `state.json`).

- [ ] **Step 7: Settings persistence**

Quit docket (`⌘Q`). Relaunch.

Expected: previously opened file auto-opens (last recent). Both roots still present. Override still applied.

- [ ] **Step 8: Bad frontmatter**

```bash
cat > ~/.docket/projects/bad.md <<'EOF'
---
name: Bad
missing colon line
---
# Body
EOF
```

Expected: `bad.md` opens with amber "⚠ invalid frontmatter" chip next to the filename.

- [ ] **Step 9: File deletion while open**

With `sample.md` open:
```bash
rm ~/.docket/projects/sample.md
```

Expected: pane shows "File was moved or deleted"; sidebar entry disappears.

- [ ] **Step 10: No commit needed**

This task is a verification pass. If any step fails, go back and fix in the earlier task that covered it. Only proceed when all 9 steps pass.

---

## Task 16: Rename web/ → renderer/ cleanup + delete dead Python/Docker code

**Files:**
- Delete: `docker-compose.yml`, `Dockerfile`, `install.sh`, entire `docket/` directory, entire `web/` directory

By this point, `renderer/` has all the UI; `web/` still exists as the source we ported from but is no longer used.

- [ ] **Step 1: Remove dead files**

```bash
cd ~/Development/docket
rm -rf docker-compose.yml Dockerfile install.sh docket/ web/
```

- [ ] **Step 2: Verify app still starts**

```bash
cd ~/Development/docket && npm start
```

Expected: app launches normally — `web/` was not referenced by main.js or renderer code. If this breaks, stop and find the stray reference.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add -A
git commit -m "chore: remove obsolete Python/Docker code and superseded web/ directory"
```

---

## Task 17: Update docs

**Files:**
- Modify: `README.md` (full rewrite)
- Modify: `format.md` (update paths)
- Modify: `agent-rule.md` (update paths)

- [ ] **Step 1: Rewrite README.md**

Overwrite `~/Development/docket/README.md`:

```markdown
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
```

- [ ] **Step 2: Update format.md paths**

Open `~/Development/docket/format.md` and find:

```
stored in `~/.docket/dashboards/`.
```

Replace with:

```
stored in a configured root. The default root is `~/.docket/projects/`.
```

Also find the architecture diagram that shows `~/.docket/dashboards/` and replace it with:

```
~/.docket/
├── docket.json                       # user config (roots, theme)
├── state.json                        # recents, overrides
└── projects/                         # default root
```

Also remove the line that says `Run python3 <docket repo>/docket.py to regenerate the viewer.` — the app is now live-refresh.

- [ ] **Step 3: Update agent-rule.md**

Overwrite `~/Development/docket/agent-rule.md`:

```markdown
# docket — agent rule

Copy this file to `~/.claude/rules/docket.md` (or your agent's rules directory) so coding sessions automatically keep the relevant checklist up to date.

## docket awareness

docket is a native macOS app that browses markdown files. The default root is `~/.docket/projects/`, but the user can add more roots via Preferences (⌘,). Any checklist-shaped markdown file the agent works with probably lives in one of those roots or in a repo the user is working on.

## When working on a task that has a checklist

1. **Find it**: look for a markdown file with frontmatter (`name:`, `status:`, `project:` or `repo:`) and H2 phases containing `- [ ]` tasks. Common locations:
   - `~/.docket/projects/` — the default docket root
   - The repo's `docs/` or top level
2. **Match by `project:` or `repo:` frontmatter** — if it matches the current repo name, that's the relevant checklist.
3. **Update tasks as progress happens**: tick `[ ]` → `[x]`, add status notes after an em-dash (e.g. `— passed Apr 20`).
4. **No regeneration step**: docket live-refreshes. Just save the markdown file; the open viewer picks it up.

## Format

See `format.md` in this repo for the full checklist spec.

## Don't

- Don't use non-GitHub checkbox syntax — the parser expects `- [ ]` / `- [x]`.
- Don't put multi-line values in frontmatter.
```

- [ ] **Step 4: Commit**

```bash
cd ~/Development/docket
git add README.md format.md agent-rule.md
git commit -m "docs: rewrite README for Electron app; update format and agent rule"
```

---

## Task 18: Root availability and file-cap warnings

Spec callouts: "Root directory missing / permission denied → root greyed in sidebar with 'unavailable' tooltip; files hidden from recents / search." and "If a root has > 5000 files, its entry in 'Browse' shows a warning ribbon and filename-only indexing."

**Files:**
- Modify: `lib/files.js` (add status introspection)
- Modify: `test/files.test.js` (tests for the new shape)
- Modify: `main.js` (track status per root, expose in a new IPC)
- Modify: `preload.js` (expose `getRootStatuses`)
- Modify: `renderer/app.js` (render unavailable state + cap warning)
- Modify: `renderer/styles.css` (warning styles)

- [ ] **Step 1: Extend walker with status**

Replace the body of `lib/files.js` with:

```javascript
const fs = require('fs').promises;
const path = require('path');

const MAX_FILES_PER_ROOT = 5000;
const SKIP_DIRS = new Set(['node_modules']);

function isSkippedDir(name) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  return false;
}

async function walkRoot(root) {
  const entries = [];
  let status = 'ok';
  let capped = false;

  try {
    await fs.access(root.path);
  } catch (e) {
    status = e.code === 'EACCES' ? 'permission-denied' : 'missing';
    return { entries: [], capped: false, status };
  }

  async function recurse(dir) {
    if (entries.length >= MAX_FILES_PER_ROOT) { capped = true; return; }
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= MAX_FILES_PER_ROOT) { capped = true; return; }
      if (child.isDirectory()) {
        if (isSkippedDir(child.name)) continue;
        await recurse(path.join(dir, child.name));
      } else if (child.isFile()) {
        if (!child.name.endsWith('.md')) continue;
        const absolutePath = path.join(dir, child.name);
        let stat;
        try { stat = await fs.stat(absolutePath); } catch { continue; }
        entries.push({
          rootId: root.id,
          absolutePath,
          relativePath: path.relative(root.path, absolutePath),
          mtime: stat.mtimeMs,
          size: stat.size
        });
      }
    }
  }
  await recurse(root.path);
  return { entries, capped, status };
}

module.exports = { walkRoot, MAX_FILES_PER_ROOT };
```

- [ ] **Step 2: Update walker tests**

Edit `test/files.test.js` to expect the new return shape. Replace:

```javascript
const entries = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
```

with the destructuring form wherever it appears:

```javascript
const { entries, capped, status } = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
```

Add two new tests:

```javascript
test('walkRoot reports status: missing when path does not exist', async () => {
  const r = await walkRoot({ id: 'r', path: '/nonexistent/definitely/not/here', label: 'R' });
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.entries, []);
  assert.equal(r.capped, false);
});

test('walkRoot reports capped=true when cap is hit', async () => {
  for (let i = 0; i < 5050; i++) touch(`f${i}.md`);
  const r = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  assert.equal(r.entries.length, 5000);
  assert.equal(r.capped, true);
  assert.equal(r.status, 'ok');
});
```

Update the existing "returns [] if root does not exist" test to assert `status: 'missing'`.

- [ ] **Step 3: Run tests — verify pass**

```bash
cd ~/Development/docket && npm test -- test/files.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Update main.js to track status per root**

In `main.js`, replace the `rebuildIndex` function:

```javascript
let rootStatuses = new Map(); // rootId -> { capped, status }

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
```

Add a new IPC handler:

```javascript
ipcMain.handle('docket:getRootStatuses', async () => {
  const out = {};
  for (const [id, v] of rootStatuses.entries()) out[id] = v;
  return out;
});
```

- [ ] **Step 5: Expose in preload.js**

Add inside the `contextBridge.exposeInMainWorld('docket', {...})`:

```javascript
getRootStatuses: () => ipcRenderer.invoke('docket:getRootStatuses'),
```

- [ ] **Step 6: Render status in sidebar**

In `renderer/app.js`, update `renderBrowse` to fetch and use root statuses:

```javascript
async function renderBrowse() {
  const statuses = await window.docket.getRootStatuses();
  const byRoot = new Map();
  for (const e of allFiles) {
    if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
    byRoot.get(e.rootId).push(e);
  }
  const parts = [];
  for (const root of cfg.roots) {
    const files = (byRoot.get(root.id) || []).slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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
  browse.innerHTML = parts.join('');
  browse.querySelectorAll('button[data-path]').forEach((btn) => {
    btn.addEventListener('click', () => openFile(btn.dataset.path));
  });
}
```

Important: `renderBrowse` is now `async`. Find every caller and add `await` (or `.then`) as appropriate. The three call sites:
1. Initial call near end of IIFE: change `renderBrowse();` to `await renderBrowse();` — but the surrounding IIFE is already async.
2. Inside `openFile`: `renderBrowse();` → `await renderBrowse();`.
3. Inside `onFileChange`: `renderBrowse();` → `await renderBrowse();`.
4. Inside `onConfigChange`: `renderBrowse();` → `await renderBrowse();`.

- [ ] **Step 7: CSS for unavailable + cap warning**

Append to `renderer/styles.css`:

```css
details.root.unavailable summary { opacity: 0.5; cursor: default; }
.cap-warning {
  background: rgba(235, 168, 80, 0.1);
  color: #eba850;
  border-left: 2px solid rgba(235, 168, 80, 0.6);
  font-size: 11px;
  padding: 6px 10px;
  margin: 4px 8px;
  border-radius: 0 4px 4px 0;
}
```

- [ ] **Step 8: Manual verification**

Add a root pointing at a nonexistent path:
1. Open Preferences, Add root, type an invalid path, save.
   - Actually: the native folder picker won't let you pick a nonexistent path. Instead, edit `~/.docket/docket.json` directly to add `{id: "bad", path: "/nonexistent/place", label: "Bad"}`.
2. Restart docket.
3. Expected: sidebar shows "Bad" root greyed out with a "missing" chip. No error toast.

Test the cap warning:
```bash
mkdir -p /tmp/docket-cap-test
for i in $(seq 1 5100); do echo "# f$i" > "/tmp/docket-cap-test/f$i.md"; done
```
Add `/tmp/docket-cap-test` as a root in Preferences. Expected: root expands but shows the amber "More than 5,000 files…" banner.

Cleanup: `rm -rf /tmp/docket-cap-test`, remove the root + the "Bad" entry.

- [ ] **Step 9: Commit**

```bash
cd ~/Development/docket
git add lib/files.js test/files.test.js main.js preload.js renderer/app.js renderer/styles.css
git commit -m "feat: surface root availability and file-cap warnings in sidebar"
```

---

## Task 19: Final verification + push

- [ ] **Step 1: Rerun all tests**

```bash
cd ~/Development/docket && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Rerun golden path (Task 15 Steps 1–9) from a clean state**

```bash
rm -rf ~/.docket
```

Run through the golden path one more time. All 9 steps should pass.

- [ ] **Step 3: Push**

```bash
cd ~/Development/docket
git push origin main
```

---

## Success criteria

Phase 1 is complete when:

- `npm start` opens a working viewer on both of Matt's Macs.
- All automated tests pass (parser, config, state, files, search).
- The manual golden path (Task 15) passes end-to-end from a clean `~/.docket/`.
- IPC security checks (Task 14) all pass.
- `npm audit` shows no high/critical vulnerabilities.
- Obsolete Python/Docker code and `web/` directory are removed.
- README, `format.md`, and `agent-rule.md` reflect the new Electron reality.

Phase 2 (release pipeline) begins after Phase 1 ships.
