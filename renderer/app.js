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

    const qLower = q.toLowerCase();
    const nameHits = [];
    for (const f of allFiles) {
      const base = f.relativePath.split('/').pop().toLowerCase();
      if (base.includes(qLower)) nameHits.push({ file: f, rank: 0 });
      else if (f.relativePath.toLowerCase().includes(qLower)) nameHits.push({ file: f, rank: 1 });
    }
    nameHits.sort((a, b) => a.rank - b.rank || a.file.relativePath.localeCompare(b.file.relativePath));

    const contentHits = await window.docket.searchContent(q);
    if (search.value.trim() !== q) return;

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
      await renderBrowse();
      if (!search.value.trim()) renderRecents();
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p><button type="button" id="retry-load" class="retry-btn">Retry</button></div>`;
      const retry = document.getElementById('retry-load');
      if (retry) retry.addEventListener('click', () => openFile(absolutePath));
    }
  }

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
    await renderBrowse();
    if (currentPath && allFiles.some((f) => f.absolutePath === currentPath)) {
      try {
        const text = await window.docket.readFile(currentPath);
        const savedScroll = window.scrollY;
        renderFile(currentPath, text);
        window.scrollTo({ top: savedScroll, behavior: 'instant' });
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
    await renderBrowse();
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

  await renderBrowse();
  renderRecents();

  if (appState.recents.length) openFile(appState.recents[0].absolutePath);
})();
