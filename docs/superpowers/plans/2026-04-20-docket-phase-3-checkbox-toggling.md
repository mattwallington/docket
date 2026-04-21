# Docket Phase 3 — Checkbox Toggling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user toggle `- [ ]` ↔ `- [x]` by clicking a task in the checklist view. Writes back to the file atomically with external-edit protection.

**Architecture:** Renderer sends `toggleTask` IPC with the absolute path, task identity (phase + section + title), and the previously-observed mtime. Main reads the file, compares mtime against the observed value, rewrites the one matching line, writes atomically (`write-file-atomic`), and suppresses the resulting chokidar `change` event via a short-lived self-write tracking set so the renderer doesn't flicker.

**Tech Stack:** `write-file-atomic` for atomic writes; reuse parser from Phase 1.

**Reference:**
- Spec: `docs/superpowers/specs/2026-04-20-docket-electron-design.md` (Phase 3 section)
- Phase 1 parser: `lib/parser.js`
- Phase 1 IPC: `main.js` `docket:readFile` handler

**Prerequisites:** Phases 1 and 2 complete and merged.

---

## File Structure

**Modified:**
- `lib/parser.js` (Task 1 — add `toggleTaskLine` pure function)
- `test/parser.test.js` (Task 1 — tests for the new function)
- `main.js` (Task 2 — add `docket:toggleTask` IPC + self-write tracking)
- `preload.js` (Task 2 — expose `toggleTask`)
- `renderer/app.js` (Task 3 — click handler, mtime tracking, toast)
- `renderer/styles.css` (Task 3 — hover affordance + toast style)
- `package.json` (Task 2 — add `write-file-atomic`)

---

## Task 1: `toggleTaskLine` pure function with tests

**Files:**
- Modify: `lib/parser.js`
- Modify: `test/parser.test.js`
- Create: `test/fixtures/toggle-target.md`

- [ ] **Step 1: Add fixture**

Create `~/Development/docket/test/fixtures/toggle-target.md`:

```markdown
---
name: Toggle Test
---

# Toggle Test

## Phase 1

- [ ] **1. Unchecked item**
- [x] **2. Already checked**
- [ ] **3. Another unchecked**

## Phase 2

- [ ] **1. Duplicate title across phases**

### Subsection

- [ ] **A. Scoped task**
```

- [ ] **Step 2: Write failing tests**

Append to `~/Development/docket/test/parser.test.js`:

```javascript
test('toggleTaskLine flips [ ] to [x] by phase + title identity', () => {
  const text = fixture('toggle-target.md');
  const result = parser.toggleTaskLine(text, { phase: 'Phase 1', section: null, title: '1. Unchecked item' });
  const lines = result.split('\n');
  assert.ok(lines.some((l) => l === '- [x] **1. Unchecked item**'));
  // Other tasks unchanged
  assert.ok(lines.some((l) => l === '- [x] **2. Already checked**'));
  assert.ok(lines.some((l) => l === '- [ ] **3. Another unchecked**'));
});

test('toggleTaskLine flips [x] to [ ]', () => {
  const text = fixture('toggle-target.md');
  const result = parser.toggleTaskLine(text, { phase: 'Phase 1', section: null, title: '2. Already checked' });
  const lines = result.split('\n');
  assert.ok(lines.some((l) => l === '- [ ] **2. Already checked**'));
});

test('toggleTaskLine disambiguates duplicate titles by phase', () => {
  const text = fixture('toggle-target.md');
  const result = parser.toggleTaskLine(text, { phase: 'Phase 2', section: null, title: '1. Duplicate title across phases' });
  const lines = result.split('\n');
  // Phase 1's "1. Unchecked item" still unchecked
  assert.ok(lines.some((l) => l === '- [ ] **1. Unchecked item**'));
  // Phase 2's matching task is now checked
  assert.ok(lines.some((l) => l === '- [x] **1. Duplicate title across phases**'));
});

test('toggleTaskLine disambiguates by section', () => {
  const text = fixture('toggle-target.md');
  const result = parser.toggleTaskLine(text, { phase: 'Phase 2', section: 'Subsection', title: 'A. Scoped task' });
  assert.match(result, /- \[x\] \*\*A\. Scoped task\*\*/);
});

test('toggleTaskLine preserves trailing notes', () => {
  const text = '## P\n\n- [ ] **1. Do thing** — with note\n';
  const result = parser.toggleTaskLine(text, { phase: 'P', section: null, title: '1. Do thing' });
  assert.equal(result, '## P\n\n- [x] **1. Do thing** — with note\n');
});

test('toggleTaskLine is idempotent in byte diff: toggle twice returns to original', () => {
  const text = fixture('toggle-target.md');
  const once = parser.toggleTaskLine(text, { phase: 'Phase 1', section: null, title: '1. Unchecked item' });
  const twice = parser.toggleTaskLine(once, { phase: 'Phase 1', section: null, title: '1. Unchecked item' });
  assert.equal(twice, text);
});

test('toggleTaskLine handles CRLF line endings without losing them', () => {
  const crlf = '## P\r\n\r\n- [ ] **1. Task**\r\n';
  const result = parser.toggleTaskLine(crlf, { phase: 'P', section: null, title: '1. Task' });
  assert.equal(result, '## P\r\n\r\n- [x] **1. Task**\r\n');
});

test('toggleTaskLine throws if task not found', () => {
  const text = fixture('toggle-target.md');
  assert.throws(() => {
    parser.toggleTaskLine(text, { phase: 'Phase 1', section: null, title: 'Does not exist' });
  }, /not found/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd ~/Development/docket && npm test -- test/parser.test.js
```

Expected: FAIL with "parser.toggleTaskLine is not a function" or similar.

- [ ] **Step 4: Implement `toggleTaskLine`**

Inside `lib/parser.js`'s factory function, add this function:

```javascript
function toggleTaskLine(fileText, ident) {
  // ident: { phase: string | null, section: string | null, title: string }
  const taskRe = /^(\s*-\s+\[)( |x)(\]\s+\*\*)([^*]+)(\*\*.*)$/;
  const headingRe = /^(#{1,6})\s+(.*)$/;

  // Split by any newline convention; remember line endings.
  const parts = fileText.split(/(\r\n|\n|\r)/);
  // parts alternates: [line, sep, line, sep, ..., lastLine, maybe '']
  let currentPhase = null;
  let currentSection = null;

  for (let i = 0; i < parts.length; i += 2) {
    const rawLine = parts[i];
    const line = rawLine.replace(/\s+$/, '');
    const h = line.match(headingRe);
    if (h) {
      const depth = h[1].length;
      const name = h[2].trim();
      if (depth === 1) {
        // title — ignore
      } else if (depth === 2) {
        currentPhase = name;
        currentSection = null;
      } else if (depth >= 3) {
        currentSection = name;
      }
      continue;
    }
    const m = rawLine.match(taskRe);
    if (!m) continue;
    const titleText = m[4].trim().replace(/\.$/, '');
    if (titleText !== ident.title.trim().replace(/\.$/, '')) continue;
    // Match phase if specified
    if (ident.phase != null && currentPhase !== ident.phase) continue;
    // Match section: if ident.section is null, only match unscoped tasks; if provided, must match
    if (ident.section == null && currentSection !== null) continue;
    if (ident.section != null && currentSection !== ident.section) continue;

    // Flip the checkbox char (m[2] is ' ' or 'x')
    const newChar = m[2] === 'x' ? ' ' : 'x';
    parts[i] = m[1] + newChar + m[3] + m[4] + m[5];
    return parts.join('');
  }
  throw new Error(`Task not found: phase=${ident.phase} section=${ident.section} title=${ident.title}`);
}
```

And add `toggleTaskLine` to the returned exports object:

```javascript
return { parseFrontmatter, parseChecklist, computeStats, phaseStats, detectViewMode, stableId, toggleTaskLine };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/Development/docket && npm test -- test/parser.test.js
```

Expected: all parser tests (original + new) pass.

- [ ] **Step 6: Commit**

```bash
cd ~/Development/docket
git add lib/parser.js test/parser.test.js test/fixtures/toggle-target.md
git commit -m "feat(parser): add toggleTaskLine with phase/section disambiguation"
```

---

## Task 2: Main IPC handler for toggleTask

**Files:**
- Modify: `package.json` (add `write-file-atomic`)
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Install write-file-atomic**

```bash
cd ~/Development/docket
npm install --save write-file-atomic@^6.0.0
```

- [ ] **Step 2: Add `docket:toggleTask` IPC handler to main.js**

At the top of `main.js`, add:
```javascript
const writeFileAtomic = require('write-file-atomic');
const parser = require('./lib/parser.js');
```

Near other IPC handlers, add a self-write suppression set and the toggle handler:

```javascript
// Absolute paths we recently wrote ourselves; suppress chokidar change events for 500ms.
const selfWrittenPaths = new Map(); // path -> timeoutId

function markSelfWrite(absolutePath) {
  if (selfWrittenPaths.has(absolutePath)) {
    clearTimeout(selfWrittenPaths.get(absolutePath));
  }
  const id = setTimeout(() => selfWrittenPaths.delete(absolutePath), 500);
  selfWrittenPaths.set(absolutePath, id);
}

ipcMain.handle('docket:toggleTask', async (_e, absolutePath, ident, observedMtime) => {
  const cfg = await config.read();
  if (!withinAnyRoot(absolutePath, cfg)) {
    return { ok: false, error: 'Path outside configured roots' };
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (e) {
    return { ok: false, error: 'File not found' };
  }
  if (observedMtime && Math.abs(stat.mtimeMs - observedMtime) > 1) {
    return { ok: false, error: 'File changed externally' };
  }
  const text = await fs.readFile(absolutePath, 'utf8');
  let newText;
  try {
    newText = parser.toggleTaskLine(text, ident);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (newText === text) {
    return { ok: false, error: 'No change (task already in desired state)' };
  }
  markSelfWrite(absolutePath);
  await writeFileAtomic(absolutePath, newText);
  const newStat = await fs.stat(absolutePath);
  return { ok: true, mtime: newStat.mtimeMs };
});
```

- [ ] **Step 3: Update chokidar's `change` handler to respect self-writes**

Find `onFsEvent` and replace:

```javascript
async function onFsEvent(type, absolutePath) {
  if (!absolutePath.endsWith('.md')) return;
  if (type === 'change' && selfWrittenPaths.has(absolutePath)) return;
  await rebuildIndex();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('docket:file-change', { type, absolutePath });
  }
}
```

- [ ] **Step 4: Expose `toggleTask` in preload.js**

Inside the `contextBridge.exposeInMainWorld('docket', {...})` block, add:

```javascript
toggleTask: (absolutePath, ident, observedMtime) =>
  ipcRenderer.invoke('docket:toggleTask', absolutePath, ident, observedMtime),
```

Also modify `readFile` to return `{ text, mtime }` so the renderer can track mtime. Change the preload line from:
```javascript
readFile: (absolutePath) => ipcRenderer.invoke('docket:readFile', absolutePath),
```
to:
```javascript
readFile: (absolutePath) => ipcRenderer.invoke('docket:readFile', absolutePath),
readFileWithMtime: (absolutePath) => ipcRenderer.invoke('docket:readFileWithMtime', absolutePath),
```

And add the corresponding IPC handler in `main.js`:

```javascript
ipcMain.handle('docket:readFileWithMtime', async (_e, absolutePath) => {
  const cfg = await config.read();
  if (!withinAnyRoot(absolutePath, cfg)) {
    throw new Error('Path outside configured roots');
  }
  const text = await fs.readFile(absolutePath, 'utf8');
  const stat = await fs.stat(absolutePath);
  return { text, mtime: stat.mtimeMs };
});
```

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add main.js preload.js package.json package-lock.json
git commit -m "feat: add toggleTask IPC with atomic writes and self-write suppression"
```

---

## Task 3: Renderer — click to toggle + toast on conflict

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Track observed mtime in renderer state**

Near the top of the IIFE in `renderer/app.js`, add:

```javascript
let currentMtime = null;
```

- [ ] **Step 2: Switch renderer to use readFileWithMtime**

Find `async function openFile(absolutePath)` and replace its `const text = await window.docket.readFile(absolutePath);` with:

```javascript
const { text, mtime } = await window.docket.readFileWithMtime(absolutePath);
currentMtime = mtime;
```

And the same substitution in the file-change handler (inside `window.docket.onFileChange(...)`):

```javascript
try {
  const { text, mtime } = await window.docket.readFileWithMtime(currentPath);
  currentMtime = mtime;
  renderFile(currentPath, text);
} catch {
  content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
  currentPath = null;
  currentMtime = null;
}
```

- [ ] **Step 3: Add data attributes to task rows and click handler**

In `renderer/app.js`, find `renderTaskRow(t)` and replace with:

```javascript
function renderTaskRow(t, phaseName, sectionName) {
  const cls = t.status === 'done' ? 'done' : (t.blocked ? 'blocked' : 'pending');
  const icon = t.status === 'done' ? '✓' : (t.blocked ? '⏸' : '○');
  const noteHTML = t.note ? `<div class="note">${md(t.note)}</div>` : '';
  const dataPhase = phaseName ? ` data-phase="${escapeHTML(phaseName)}"` : '';
  const dataSection = sectionName ? ` data-section="${escapeHTML(sectionName)}"` : '';
  return `<li class="row ${cls}"${dataPhase}${dataSection} data-title="${escapeHTML(t.title)}"><button type="button" class="task-toggle" aria-label="Toggle task"><span class="icon">${icon}</span></button><div class="content"><div class="title">${escapeHTML(t.title)}</div>${noteHTML}</div></li>`;
}
```

And update the `renderItems` signature to thread the phase/section down:

```javascript
function renderItems(items, phaseName, sectionName) {
  const parts = [];
  let tasks = [];
  const flush = () => {
    if (!tasks.length) return;
    parts.push(`<ul class="task-list">${tasks.map((t) => renderTaskRow(t, phaseName || null, sectionName || null)).join('')}</ul>`);
    tasks = [];
  };
  for (const it of items) {
    if (it.type === 'task') tasks.push(it);
    else { flush(); parts.push(`<div class="prose">${md(it.text)}</div>`); }
  }
  flush();
  return parts.join('');
}
```

Update `renderPhase` call sites to pass phase + section:

```javascript
function renderPhase(phase, idPrefix) {
  const phaseId = docketParser.stableId(idPrefix + '::' + phase.name);
  const s = docketParser.phaseStats(phase);
  const secs = [];
  if (phase.orphanItems.length) secs.push(`<div class="section">${renderItems(phase.orphanItems, phase.name, null)}</div>`);
  for (const sec of phase.sections) {
    secs.push(`<div class="section"><h3>${escapeHTML(sec.name)}</h3>${renderItems(sec.items, phase.name, sec.name)}</div>`);
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
```

- [ ] **Step 4: Add click handler + toast**

Add at the bottom of the IIFE (before the final `renderBrowse(); renderRecents(); ...` lines):

```javascript
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('visible'), 4000);
}

content.addEventListener('click', async (e) => {
  const btn = e.target.closest('.task-toggle');
  if (!btn) return;
  const row = btn.closest('.row');
  if (!row) return;
  // Plain-markdown view disables toggling
  const viewModeEl = document.getElementById('view-mode');
  if (viewModeEl && viewModeEl.value === 'markdown') return;

  const phase = row.dataset.phase || null;
  const section = row.dataset.section || null;
  const title = row.dataset.title;
  if (!currentPath) return;

  const result = await window.docket.toggleTask(currentPath, { phase, section, title }, currentMtime);
  if (!result.ok) {
    showToast(result.error || 'Toggle failed');
    return;
  }
  currentMtime = result.mtime;
  // Reload + rerender (read updated contents)
  const { text, mtime } = await window.docket.readFileWithMtime(currentPath);
  currentMtime = mtime;
  renderFile(currentPath, text);
});
```

- [ ] **Step 5: Add CSS for clickable rows + toast**

Append to `renderer/styles.css`:

```css
.task-toggle {
  background: transparent;
  border: 0;
  color: inherit;
  padding: 0;
  cursor: pointer;
  font: inherit;
}
.row .task-toggle .icon {
  transition: transform 0.1s ease;
}
.row:hover .task-toggle .icon {
  transform: scale(1.15);
}
#toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(40, 50, 70, 0.95);
  color: #fff;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 1000;
}
#toast.visible { opacity: 1; }
```

- [ ] **Step 6: Commit**

```bash
cd ~/Development/docket
git add renderer/app.js renderer/styles.css
git commit -m "feat: click-to-toggle task checkboxes with external-edit conflict toast"
```

---

## Task 4: Manual verification

- [ ] **Step 1: Golden path**

```bash
cat > ~/.docket/projects/toggle-test.md <<'EOF'
---
name: Toggle Test
status: active
---

# Toggle Test

## Phase 1

- [ ] **1. First**
- [x] **2. Second**
- [ ] **3. Third**
EOF
```

Launch docket (`npm start`), open `toggle-test.md`. Click the `○` icon on task 1.

Expected:
- Icon instantly flips to `✓`, progress stats update.
- `cat ~/.docket/projects/toggle-test.md` shows `- [x] **1. First**`.

Click it again.
Expected: back to `[ ]` on disk and in UI.

- [ ] **Step 2: External-edit conflict**

With `toggle-test.md` open in docket, externally modify it:
```bash
echo "\n<!-- external edit -->" >> ~/.docket/projects/toggle-test.md
```

Click the `○` on task 3 before docket's live-refresh catches the external edit (within ~100ms).

Expected: toast "File changed externally" appears; file on disk is unchanged.

After ~1s, docket has auto-refreshed; click task 3 again.
Expected: toggle now succeeds.

- [ ] **Step 3: Rapid repeated clicks**

Click task 1 five times in rapid succession.

Expected: end state is predictable (ends in `[x]` if count is odd, `[ ]` if even); no torn writes; no spurious flicker from chokidar (thanks to self-write suppression).

- [ ] **Step 4: Markdown-mode override disables toggling**

Open `toggle-test.md`, change View to Markdown, click a task line.

Expected: nothing happens. No write. No toast.

- [ ] **Step 5: Duplicate titles in different phases**

```bash
cat > ~/.docket/projects/dup-test.md <<'EOF'
---
name: Dup Test
---

# Dup Test

## Phase A

- [ ] **1. Same title**

## Phase B

- [ ] **1. Same title**
EOF
```

Click the Phase B task. Verify only the Phase B line flips on disk; Phase A stays `[ ]`.

- [ ] **Step 6: Commit tests + cleanup**

No code changes. Remove test files: `rm ~/.docket/projects/toggle-test.md ~/.docket/projects/dup-test.md`.

---

## Task 5: Cut release

Follow Phase 2 release flow:

- [ ] **Step 1: Release**

```bash
cd ~/Development/docket
./scripts/release.sh --minor   # 0.1.x → 0.2.0
```

Verify the new version appears in GitHub Releases.

- [ ] **Step 2: Auto-update installed app**

Trigger "Check for updates" in the settings → About pane on an already-installed docket. Accept the update, restart, and verify the new version shows.

---

## Success criteria

Phase 3 is complete when:

- All parser tests pass (including the 8 new `toggleTaskLine` tests).
- Clicking a task in the checklist view toggles it on disk and in the UI.
- Rapid clicks produce a consistent final state with no torn writes.
- External-edit conflicts abort with a toast; original external edits are preserved.
- Markdown-mode override disables toggling.
- Duplicate titles across phases/sections disambiguate correctly.
- A new signed release is published and installed copies auto-update.

Phase 4 (WYSIWYG editor) begins after Phase 3 ships.
