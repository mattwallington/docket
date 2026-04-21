# Docket Phase 4 — WYSIWYG Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Edit mode to docket that lets the user edit any markdown file with a WYSIWYG interface. The selected library must round-trip a representative sample of files from `~/docs/` without byte drift.

**Architecture:** Two-step approach. Task 1 is a library bake-off: evaluate candidates against a real round-trip test corpus, pick the winner, lock that choice in for the rest of the phase. Tasks 2–7 build the edit experience around the chosen library: Edit/View toggle per file, dirty-state guard on file switch, external-edit race handled with the same mtime-guard as Phase 3.

**Tech Stack:** WYSIWYG library TBD by Task 1 (ranked candidates: Milkdown, Lexical, TipTap, MDXEditor). Reuse `write-file-atomic` + Phase 3's self-write suppression and mtime-guard.

**Reference:**
- Spec: `docs/superpowers/specs/2026-04-20-docket-electron-design.md` (Phase 4 section)
- Phase 3 mtime-guard pattern: `main.js` `docket:toggleTask` handler

**Prerequisites:** Phases 1–3 complete and merged.

---

## File Structure

**Created:**
- `test/editor-roundtrip.test.js` (Task 1)
- `test/fixtures/roundtrip/` (Task 1 — snapshot of 20 `~/docs/` files; gitignored)
- `renderer/vendor/<library>/` (Task 2 — copied via `copy-vendor.js`)
- `renderer/editor.js` (Task 3 — library-specific setup + glue)
- `docs/editor-library-choice.md` (Task 1 — captures the decision)

**Modified:**
- `scripts/copy-vendor.js` (Task 2 — copy the chosen library's bundle)
- `package.json` (Task 2 — add the chosen library as a dep)
- `main.js` (Task 4 — `docket:writeFile` IPC)
- `preload.js` (Task 4 — expose `writeFile`)
- `renderer/app.js` (Tasks 5, 6, 7 — Edit/View toggle, dirty guard, external-edit toast)
- `renderer/styles.css` (Tasks 5, 7 — editor styling)
- `renderer/index.html` (Task 2 — load chosen library)

---

## Task 1: Library bake-off

Goal: pick a library by empirical round-trip test on real files.

**Files:**
- Create: `test/editor-roundtrip.test.js`
- Create: `test/fixtures/roundtrip/` (populated manually, gitignored)
- Create: `docs/editor-library-choice.md`
- Modify: `.gitignore`

Candidates, in order of expected fit:
1. **Milkdown** — ProseMirror-based, designed for markdown fidelity (first choice)
2. **Lexical** — Meta's editor framework, requires more plumbing for markdown
3. **TipTap** — excellent UX but markdown round-trip via plugin
4. **MDXEditor** — requires adding React to docket just for the editor (last resort)

- [ ] **Step 1: Populate test corpus**

```bash
mkdir -p ~/Development/docket/test/fixtures/roundtrip
# Pick 20 files from ~/docs/ that exercise varied markdown features
cp ~/docs/unified-auth-rollout-plan.md ~/Development/docket/test/fixtures/roundtrip/
cp ~/docs/ecs-secrets-management.md ~/Development/docket/test/fixtures/roundtrip/ 2>/dev/null || true
cp ~/docs/identity-lambda-prod-deploy.md ~/Development/docket/test/fixtures/roundtrip/ 2>/dev/null || true
cp ~/docs/deploy-pipeline-speed-and-gating.md ~/Development/docket/test/fixtures/roundtrip/ 2>/dev/null || true
cp ~/docs/signup-token-types.md ~/Development/docket/test/fixtures/roundtrip/ 2>/dev/null || true
# Add a handful more to total ~20:
ls -1 ~/docs/*.md | head -20 | xargs -I{} cp {} ~/Development/docket/test/fixtures/roundtrip/
```

- [ ] **Step 2: Gitignore the corpus**

Append to `~/Development/docket/.gitignore`:
```
test/fixtures/roundtrip/
```

The corpus contains personal docs — don't commit. The test harness finds whatever is present at test time.

- [ ] **Step 3: Install Milkdown (first candidate)**

```bash
cd ~/Development/docket
npm install --save @milkdown/core@^7 @milkdown/preset-commonmark@^7 @milkdown/preset-gfm@^7 @milkdown/theme-nord@^7
```

- [ ] **Step 4: Write the round-trip test harness**

Create `~/Development/docket/test/editor-roundtrip.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Round-trip test: for each file in test/fixtures/roundtrip/,
// parse with the candidate library's markdown parser + serializer
// and confirm the output equals the input byte-for-byte.

const { Editor, rootCtx, defaultValueCtx } = require('@milkdown/core');
const { commonmark } = require('@milkdown/preset-commonmark');
const { gfm } = require('@milkdown/preset-gfm');

// Milkdown requires a DOM. In Node tests we use jsdom — install it only for this test.
// If jsdom is not installed, skip the test gracefully so `npm test` still passes on CI.
let jsdom;
try { jsdom = require('jsdom'); } catch { jsdom = null; }

const corpusDir = path.join(__dirname, 'fixtures', 'roundtrip');

if (!jsdom) {
  test('editor round-trip (SKIP: jsdom not installed)', () => { /* skipped */ });
} else if (!fs.existsSync(corpusDir)) {
  test('editor round-trip (SKIP: no corpus at test/fixtures/roundtrip/)', () => { /* skipped */ });
} else {
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.md'));

  for (const f of files) {
    test(`round-trip: ${f}`, async () => {
      const raw = fs.readFileSync(path.join(corpusDir, f), 'utf8');
      const roundTripped = await milkdownRoundTrip(raw);
      assert.equal(roundTripped, raw, `byte mismatch for ${f}`);
    });
  }
}

async function milkdownRoundTrip(input) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;

  const root = document.getElementById('root');

  const editor = await Editor
    .make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, input);
    })
    .use(commonmark)
    .use(gfm)
    .create();

  const output = editor.action((ctx) => {
    const { serializerCtx } = require('@milkdown/core');
    const serializer = ctx.get(serializerCtx);
    const editorView = ctx.get(require('@milkdown/core').editorViewCtx);
    return serializer(editorView.state.doc);
  });

  editor.destroy();
  return output;
}
```

- [ ] **Step 5: Install jsdom for the harness**

```bash
cd ~/Development/docket
npm install --save-dev jsdom@^24
```

- [ ] **Step 6: Run the harness**

```bash
cd ~/Development/docket && npm test -- test/editor-roundtrip.test.js
```

Two possible outcomes:

- **All files round-trip byte-perfect** → Milkdown wins. Document in `docs/editor-library-choice.md` (Step 8) and skip to Task 2.
- **Some files fail** → inspect the diffs for the failing files. Common failure patterns:
  - Whitespace normalization (trailing spaces, tab vs 4-space indent)
  - Fence-language preservation (` ```js ` vs ` ``` `)
  - HTML inside markdown (` <details> ` etc.)

If >10% of files fail or failures are on docs you care about, fall through to Step 7.

- [ ] **Step 7: If Milkdown fails, try Lexical**

Uninstall Milkdown:
```bash
cd ~/Development/docket
npm uninstall @milkdown/core @milkdown/preset-commonmark @milkdown/preset-gfm @milkdown/theme-nord
npm install --save lexical@^0.17 @lexical/markdown@^0.17 @lexical/react@^0.17
```

Rewrite the `milkdownRoundTrip` function in the test file as `lexicalRoundTrip` using Lexical's `$convertFromMarkdownString` + `$convertToMarkdownString` APIs. Run again. If Lexical also fails, move to TipTap, then MDXEditor.

If all four fail: document the failure modes in `docs/editor-library-choice.md`, treat Phase 4 as partially-achievable, and pick the library with the *narrowest and most benign* failure profile. Alternatively: ship a **CodeMirror-based source editor** with live-preview rendering — not WYSIWYG but faithful to disk. (This is out-of-scope for this plan; create a follow-up task.)

- [ ] **Step 8: Document the decision**

Create `~/Development/docket/docs/editor-library-choice.md`:

```markdown
# Editor library choice

**Chosen:** <library>
**Version:** <version>
**Date:** 2026-04-20 (replace with actual)

## Why

- Round-tripped <N>/<M> corpus files byte-perfect.
- <brief fit notes>

## Corpus

Tested against <M> files from `~/docs/`. Corpus is gitignored (personal docs).

## Failure patterns

<If any: list the files that failed and why; otherwise "none.">

## Alternatives considered

- Milkdown: <result>
- Lexical: <result>
- TipTap: <result>
- MDXEditor: <result>
```

Replace `<library>`, `<version>`, etc. with actual values.

- [ ] **Step 9: Commit**

```bash
cd ~/Development/docket
git add test/editor-roundtrip.test.js docs/editor-library-choice.md package.json package-lock.json .gitignore
git commit -m "feat(editor): library bake-off with round-trip test harness"
```

The rest of this plan assumes **Milkdown** was chosen. If a different library won, adapt Tasks 2, 3, and 5 accordingly.

---

## Task 2: Vendor the chosen library

**Files:**
- Modify: `scripts/copy-vendor.js`
- Modify: `renderer/index.html`

- [ ] **Step 1: Produce a renderer bundle**

Milkdown is distributed as ESM packages. Unlike marked/DOMPurify (single-file UMD), it needs a bundler to produce a browser-loadable file. Simplest path: use `esbuild` as a one-shot bundler in the copy-vendor script.

Install esbuild as a dev dep:

```bash
cd ~/Development/docket
npm install --save-dev esbuild@^0.21
```

- [ ] **Step 2: Create a small editor entry script**

Create `~/Development/docket/scripts/editor-entry.js`:

```javascript
// Entry point bundled by esbuild into renderer/vendor/docket-editor.js
// Exposes window.docketEditor = { createEditor(rootEl, initialMarkdown, onChange), destroyEditor, getMarkdown }.

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';

let editor = null;

async function createEditor(rootEl, initialMarkdown, onChange) {
  editor = await Editor
    .make()
    .config((ctx) => {
      ctx.set(rootCtx, rootEl);
      ctx.set(defaultValueCtx, initialMarkdown);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (onChange) onChange(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .create();
  return editor;
}

function destroyEditor() {
  if (editor) { editor.destroy(); editor = null; }
}

function getMarkdown() {
  if (!editor) return null;
  return editor.action((ctx) => {
    const serializer = ctx.get(serializerCtx);
    const view = ctx.get(editorViewCtx);
    return serializer(view.state.doc);
  });
}

window.docketEditor = { createEditor, destroyEditor, getMarkdown };
```

- [ ] **Step 3: Update scripts/copy-vendor.js**

Append to `~/Development/docket/scripts/copy-vendor.js`:

```javascript
// --- Bundle the editor entry via esbuild ---
try {
  const esbuild = require('esbuild');
  esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, 'editor-entry.js')],
    bundle: true,
    format: 'iife',
    outfile: path.resolve(__dirname, '../renderer/vendor/docket-editor.js'),
    platform: 'browser',
    logLevel: 'warning'
  });
  console.log('[copy-vendor] renderer/vendor/docket-editor.js');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.warn('[copy-vendor] esbuild not installed; skipping editor bundle');
  } else {
    throw e;
  }
}
```

Also install `@milkdown/plugin-listener` (not installed by Task 1):

```bash
cd ~/Development/docket
npm install --save @milkdown/plugin-listener@^7
```

Run the postinstall:

```bash
cd ~/Development/docket
node scripts/copy-vendor.js
```

Expected: `renderer/vendor/docket-editor.js` exists (a self-contained IIFE bundle).

- [ ] **Step 4: Load editor bundle in renderer**

Modify `~/Development/docket/renderer/index.html` — add a script tag before `app.js`:

```html
<script src="./vendor/marked.min.js"></script>
<script src="./vendor/purify.min.js"></script>
<script src="./vendor/docket-editor.js"></script>
<script src="../lib/parser.js"></script>
<script src="./app.js"></script>
```

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add scripts/ renderer/index.html package.json package-lock.json
git commit -m "feat(editor): vendor Milkdown bundle via esbuild"
```

---

## Task 3: Edit/View toggle in renderer

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add edit-mode state**

Add to the top of the IIFE in `renderer/app.js`:

```javascript
let editMode = false;  // true when editor is active for current file
let isDirty = false;   // true when editor buffer differs from disk
let activeEditor = null;
```

- [ ] **Step 2: Add an Edit button to the file header**

In `renderFile`, change the header block to include an Edit toggle:

```javascript
headerParts.push(`<header class="file-head"><div class="breadcrumb">${escapeHTML(basename)}${frontmatterWarning ? ' <span class="chip-warn">⚠ invalid frontmatter</span>' : ''}${isDirty ? ' <span class="chip-warn">● unsaved</span>' : ''}</div>`);
headerParts.push(`<div class="view-toggle"><label>View: <select id="view-mode"${editMode ? ' disabled' : ''}><option value="checklist"${mode === 'checklist' ? ' selected' : ''}>Checklist</option><option value="markdown"${mode === 'markdown' ? ' selected' : ''}>Markdown</option></select></label>`);
headerParts.push(`<button type="button" id="edit-toggle" class="btn">${editMode ? 'Save' : 'Edit'}</button>`);
if (editMode) headerParts.push(`<button type="button" id="edit-cancel" class="btn">Cancel</button>`);
headerParts.push('</div></header>');
```

- [ ] **Step 3: Wire edit/save/cancel handlers**

At the end of `renderFile` (after existing handlers), add:

```javascript
const editBtn = document.getElementById('edit-toggle');
const cancelBtn = document.getElementById('edit-cancel');

editBtn.addEventListener('click', async () => {
  if (!editMode) {
    await enterEditMode(absolutePath, text);
  } else {
    await saveEdits(absolutePath);
  }
});

if (cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    await exitEditMode(absolutePath);
  });
}
```

- [ ] **Step 4: Implement enter/save/exit**

Add near the bottom of the IIFE:

```javascript
async function enterEditMode(absolutePath, text) {
  editMode = true;
  isDirty = false;
  // Parse frontmatter so we edit body only
  const { meta, body } = docketParser.parseFrontmatter(text);
  const frontmatterRaw = (text.length > body.length)
    ? text.slice(0, text.length - body.length)
    : '';

  // Swap body into an editor mount
  content.innerHTML = '';
  const head = document.createElement('header');
  head.className = 'file-head';
  head.innerHTML = `
    <div class="breadcrumb">${escapeHTML(absolutePath.split('/').pop())}<span class="chip-warn" id="dirty-chip" style="display:none">● unsaved</span></div>
    <div class="view-toggle">
      <button type="button" id="save-btn" class="btn">Save</button>
      <button type="button" id="cancel-btn" class="btn">Cancel</button>
    </div>
  `;
  const mount = document.createElement('div');
  mount.className = 'editor-mount';
  content.appendChild(head);
  content.appendChild(mount);

  activeEditor = await window.docketEditor.createEditor(mount, body, (newMarkdown) => {
    if (newMarkdown !== body) {
      isDirty = true;
      document.getElementById('dirty-chip').style.display = 'inline-block';
    }
  });

  document.getElementById('save-btn').addEventListener('click', async () => { await saveEdits(absolutePath, frontmatterRaw); });
  document.getElementById('cancel-btn').addEventListener('click', async () => {
    if (isDirty && !confirm('Discard unsaved changes?')) return;
    await exitEditMode(absolutePath);
  });
}

async function saveEdits(absolutePath, frontmatterRaw) {
  if (!activeEditor) return;
  const newBody = window.docketEditor.getMarkdown();
  const newText = frontmatterRaw + newBody;
  const result = await window.docket.writeFile(absolutePath, newText, currentMtime);
  if (!result.ok) {
    if (result.error === 'File changed externally') {
      const keep = confirm('File changed on disk. Reload (lose edits) or keep editing?\nOK = Reload\nCancel = Keep editing');
      if (keep) {
        await exitEditMode(absolutePath);
      }
      return;
    }
    showToast(result.error || 'Save failed');
    return;
  }
  currentMtime = result.mtime;
  isDirty = false;
  await exitEditMode(absolutePath);
}

async function exitEditMode(absolutePath) {
  if (activeEditor) {
    window.docketEditor.destroyEditor();
    activeEditor = null;
  }
  editMode = false;
  isDirty = false;
  const { text, mtime } = await window.docket.readFileWithMtime(absolutePath);
  currentMtime = mtime;
  renderFile(absolutePath, text);
}
```

- [ ] **Step 5: Dirty-state guard on file switch**

Modify `openFile(absolutePath)`:

```javascript
async function openFile(absolutePath) {
  if (editMode && isDirty) {
    if (!confirm('Discard unsaved changes?')) return;
    window.docketEditor.destroyEditor();
    activeEditor = null;
    editMode = false;
    isDirty = false;
  } else if (editMode) {
    window.docketEditor.destroyEditor();
    activeEditor = null;
    editMode = false;
  }
  currentPath = absolutePath;
  try {
    const { text, mtime } = await window.docket.readFileWithMtime(absolutePath);
    currentMtime = mtime;
    await window.docket.addRecent(absolutePath);
    appState = await window.docket.getState();
    renderFile(absolutePath, text);
    renderBrowse();
    if (!search.value.trim()) renderRecents();
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p></div>`;
  }
}
```

- [ ] **Step 6: Dirty-state guard on window close**

Add at the end of the IIFE:

```javascript
window.addEventListener('beforeunload', (e) => {
  if (editMode && isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
```

- [ ] **Step 7: CSS for editor mount**

Append to `renderer/styles.css`:

```css
.editor-mount {
  padding: 20px;
  min-height: 60vh;
}
.editor-mount .milkdown {
  font-size: 14px;
  line-height: 1.6;
}
.editor-mount .ProseMirror {
  outline: none;
}
```

- [ ] **Step 8: Commit**

```bash
cd ~/Development/docket
git add renderer/app.js renderer/styles.css
git commit -m "feat(editor): Edit/View toggle with dirty-state guard and external-edit handling"
```

---

## Task 4: Main process IPC for writing

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Add writeFile IPC**

Near other IPC handlers in `main.js`:

```javascript
ipcMain.handle('docket:writeFile', async (_e, absolutePath, newText, observedMtime) => {
  const cfg = await config.read();
  if (!withinAnyRoot(absolutePath, cfg)) {
    return { ok: false, error: 'Path outside configured roots' };
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return { ok: false, error: 'File not found' };
  }
  if (observedMtime && Math.abs(stat.mtimeMs - observedMtime) > 1) {
    return { ok: false, error: 'File changed externally' };
  }
  markSelfWrite(absolutePath);
  await writeFileAtomic(absolutePath, newText);
  const newStat = await fs.stat(absolutePath);
  return { ok: true, mtime: newStat.mtimeMs };
});
```

- [ ] **Step 2: Expose writeFile in preload.js**

Add inside `contextBridge.exposeInMainWorld('docket', {...})`:

```javascript
writeFile: (absolutePath, text, observedMtime) =>
  ipcRenderer.invoke('docket:writeFile', absolutePath, text, observedMtime),
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add main.js preload.js
git commit -m "feat(editor): add writeFile IPC with mtime guard and atomic writes"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Basic edit round-trip**

Launch docket. Open any markdown file. Click Edit. Make no changes. Click Save.

Expected: no toast, file on disk unchanged (verify with `git diff` or `md5sum`).

- [ ] **Step 2: Actual edit**

Open `~/.docket/projects/sample.md` (from Phase 1 test). Click Edit. Add a paragraph. Click Save.

Expected: file updated on disk. Reopen in viewer — edit is visible.

- [ ] **Step 3: Cancel discards**

Open a file. Click Edit. Type something. Click Cancel → confirm discard. File unchanged on disk.

- [ ] **Step 4: Dirty-state guard on file switch**

Open file A. Edit. Don't save. Click file B in sidebar.

Expected: confirm dialog "Discard unsaved changes?". Cancel keeps you in A's editor; OK switches to B.

- [ ] **Step 5: External-edit race**

Open file A. Click Edit. Make an edit. Externally modify file A:
```bash
echo "\n<!-- external -->" >> ~/.docket/projects/sample.md
```

Click Save. Expected: "File changed on disk" dialog. Cancel keeps your edits; OK reloads.

- [ ] **Step 6: Large file**

Generate a 500KB markdown file:
```bash
yes "# Some heading\n\nSome paragraph text with **bold** and _italic_.\n" | head -c 500000 > ~/.docket/projects/big.md
```

Open and click Edit. Verify: load time <2s, typing latency imperceptible.

- [ ] **Step 7: Round-trip against corpus (last check)**

Run:
```bash
cd ~/Development/docket && npm test -- test/editor-roundtrip.test.js
```

Expected: all corpus round-trips still pass.

---

## Task 6: Cut release

- [ ] **Step 1: Release**

```bash
cd ~/Development/docket
./scripts/release.sh --minor   # 0.2.x → 0.3.0
```

- [ ] **Step 2: Verify auto-update**

Trigger update check on installed app; install new version; verify editing works post-install.

---

## Success criteria

Phase 4 is complete when:

- `docs/editor-library-choice.md` documents the winning library with round-trip results.
- Round-trip test passes for 100% of corpus files (or the documented acceptable subset if not 100%).
- Edit mode works: open any file → Edit → modify → Save → disk reflects the edits → reopening shows the edits.
- Cancel discards with confirm prompt; dirty-state guard blocks accidental close/switch.
- External-edit race produces the reload/keep-editing dialog without data loss on either path.
- Large file (500KB) loads and saves without UI lag.
- A new signed release is published and installed copies auto-update.

After Phase 4 ships, docket v1.0.0 can be cut with a patch bump: everything the design promised is shipped. Phase 5 parking lot items (tabs, pin, export to PDF, syntax highlighting, git status, content-search line-jump) become future enhancements.
