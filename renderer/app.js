(async () => {
  const SIDEBAR_KEY = 'docket:sidebar-hidden';
  const COLLAPSE_KEY = 'docket:collapsed-phases';

  const browse = document.getElementById('sidebar-browse');
  const recents = document.getElementById('sidebar-recents');
  const favoritesEl = document.getElementById('sidebar-favorites');
  const tocEl = document.getElementById('sidebar-toc');
  const results = document.getElementById('sidebar-results');
  const search = document.getElementById('search-box');
  const content = document.getElementById('content');

  marked.setOptions({ gfm: true, breaks: false });
  const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

  let cfg = await window.docket.getConfig();
  let allFiles = await window.docket.listAllFiles();
  let appState = await window.docket.getState();
  let tocs = await window.docket.getRootTocs();
  let currentPath = null;

  function isFavorite(absolutePath) {
    return (appState.favorites || []).some((f) => f.absolutePath === absolutePath);
  }

  const DOC_SCALE_MIN = 0.7;
  const DOC_SCALE_MAX = 1.6;
  const DOC_SCALE_STEP = 0.1;

  function applyDocScale() {
    const s = Number(appState.docScale) || 1;
    document.documentElement.style.setProperty('--doc-scale', String(s));
  }
  applyDocScale();

  async function adjustDocScale(delta) {
    const cur = Number(appState.docScale) || 1;
    const next = Math.max(DOC_SCALE_MIN, Math.min(DOC_SCALE_MAX, Math.round((cur + delta) * 100) / 100));
    if (next === cur) return;
    await window.docket.setDocScale(next);
    appState = await window.docket.getState();
    applyDocScale();
    updateScaleButtons();
  }

  function updateScaleButtons() {
    const cur = Number(appState.docScale) || 1;
    const dec = document.getElementById('scale-down');
    const inc = document.getElementById('scale-up');
    if (dec) dec.disabled = cur <= DOC_SCALE_MIN + 1e-6;
    if (inc) inc.disabled = cur >= DOC_SCALE_MAX - 1e-6;
  }

  // ---- Sidebar rendering ----

  function compareFiles(a, b) {
    const sortBy = appState.sortBy || 'name';
    if (sortBy === 'modified') return (b.mtime || 0) - (a.mtime || 0);
    return a.relativePath.localeCompare(b.relativePath);
  }

  async function renderBrowse() {
    const statuses = await window.docket.getRootStatuses();
    const pinnedReadmes = new Set((tocs || []).map((t) => t.readmePath));
    const byRoot = new Map();
    for (const e of allFiles) {
      if (pinnedReadmes.has(e.absolutePath)) continue;
      if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
      byRoot.get(e.rootId).push(e);
    }
    const parts = [];
    for (const root of cfg.roots) {
      const files = (byRoot.get(root.id) || []).slice().sort(compareFiles);
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

  function renderListItem(absolutePath, label, { removable = false, removeKind = null } = {}) {
    const activeCls = currentPath === absolutePath ? ' active' : '';
    const removeHTML = removable
      ? `<button type="button" class="remove-btn" data-remove-path="${escapeHTML(absolutePath)}" data-remove-kind="${removeKind}" title="Remove">×</button>`
      : '';
    return `<li class="dismissable"><button type="button" class="file-btn${activeCls}" data-path="${escapeHTML(absolutePath)}">${escapeHTML(label)}</button>${removeHTML}</li>`;
  }

  function renderRecents() {
    const valid = (appState.recents || []).filter((r) => allFiles.some((f) => f.absolutePath === r.absolutePath));
    if (!valid.length) { recents.innerHTML = ''; return; }
    const parts = ['<div class="sidebar-section-title">Recents</div><ul class="file-list">'];
    for (const r of valid) {
      const basename = r.absolutePath.split('/').pop();
      parts.push(renderListItem(r.absolutePath, basename, { removable: true, removeKind: 'recent' }));
    }
    parts.push('</ul>');
    recents.innerHTML = parts.join('');
    wireListSection(recents);
  }

  function renderFavorites() {
    const valid = (appState.favorites || []).filter((f) => allFiles.some((e) => e.absolutePath === f.absolutePath));
    if (!valid.length) { favoritesEl.innerHTML = ''; return; }
    const parts = ['<div class="sidebar-section-title">Favorites</div><ul class="file-list">'];
    for (const f of valid) {
      const basename = f.absolutePath.split('/').pop();
      parts.push(renderListItem(f.absolutePath, basename, { removable: true, removeKind: 'favorite' }));
    }
    parts.push('</ul>');
    favoritesEl.innerHTML = parts.join('');
    wireListSection(favoritesEl);
  }

  function renderToc() {
    if (!tocs || !tocs.length) { tocEl.innerHTML = ''; return; }
    const parts = [];
    for (const toc of tocs) {
      const heading = tocs.length > 1 ? `${escapeHTML(toc.rootLabel)} · Table of Contents` : 'Table of Contents';
      parts.push(`<div class="sidebar-section-title">${heading}</div><ul class="file-list">`);
      const activeCls = currentPath === toc.readmePath ? ' active' : '';
      parts.push(`<li><button type="button" class="file-btn toc${activeCls}" data-path="${escapeHTML(toc.readmePath)}" data-skip-recents="1">README.md</button></li>`);
      parts.push('</ul>');
    }
    tocEl.innerHTML = parts.join('');
    tocEl.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path, { skipRecents: btn.dataset.skipRecents === '1' }));
    });
  }

  function wireListSection(container) {
    container.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
    container.querySelectorAll('button[data-remove-path]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = btn.dataset.removePath;
        const kind = btn.dataset.removeKind;
        if (kind === 'recent') await window.docket.removeRecent(p);
        else if (kind === 'favorite') await window.docket.removeFavorite(p);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
  }

  function renderSidebar() {
    renderToc();
    renderFavorites();
    renderRecents();
  }

  // ---- Search ----

  let searchDebounce;
  search.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 150);
  });

  async function runSearch() {
    const q = search.value.trim();
    if (!q) {
      results.innerHTML = '';
      renderSidebar();
      browse.style.display = '';
      tocEl.style.display = '';
      favoritesEl.style.display = '';
      return;
    }
    recents.innerHTML = '';
    favoritesEl.innerHTML = '';
    tocEl.innerHTML = '';
    browse.style.display = 'none';
    tocEl.style.display = 'none';
    favoritesEl.style.display = 'none';

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

  async function openFile(absolutePath, { skipRecents = false } = {}) {
    currentPath = absolutePath;
    window.docket.setActivePath(absolutePath);
    try {
      const text = await window.docket.readFile(absolutePath);
      if (!skipRecents) await window.docket.addRecent(absolutePath);
      appState = await window.docket.getState();
      renderFile(absolutePath, text);
      await renderBrowse();
      if (!search.value.trim()) renderSidebar();
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p><button type="button" id="retry-load" class="retry-btn">Retry</button></div>`;
      const retry = document.getElementById('retry-load');
      if (retry) retry.addEventListener('click', () => openFile(absolutePath, { skipRecents }));
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
    const entry = allFiles.find((f) => f.absolutePath === absolutePath);
    const mtime = entry ? entry.mtime : null;
    const updatedHTML = mtime
      ? `<span class="updated" data-mtime="${mtime}" title="${escapeHTML(formatAbsolute(mtime))}">Updated ${escapeHTML(formatRelative(mtime))}</span>`
      : '';
    const fav = isFavorite(absolutePath);
    const starHTML = `<button type="button" id="fav-toggle" class="star-btn${fav ? ' on' : ''}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>`;
    const scaleHTML = `<div class="scale-ctl" role="group" aria-label="Text size">
      <button type="button" id="scale-down" class="scale-btn scale-btn-sm" title="Smaller text">A</button>
      <button type="button" id="scale-up" class="scale-btn scale-btn-lg" title="Larger text">A</button>
    </div>`;
    const headerParts = [];
    headerParts.push(`<header class="file-head"><div class="breadcrumb">${starHTML}<span>${escapeHTML(basename)}</span>${frontmatterWarning ? ' <span class="chip-warn">⚠ invalid frontmatter</span>' : ''}${updatedHTML}</div>`);
    headerParts.push(`<div class="file-head-right">${scaleHTML}<div class="view-toggle"><label>View: <select id="view-mode"><option value="checklist"${mode === 'checklist' ? ' selected' : ''}>Checklist</option><option value="markdown"${mode === 'markdown' ? ' selected' : ''}>Markdown</option></select></label></div></div>`);
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

    content.innerHTML = headerParts.join('') + '<div class="doc-body">' + bodyHTML + '</div>';
    wireCollapsibles(absolutePath);
    wireMarkdownLinks(absolutePath);
    updateScaleButtons();
    const dec = document.getElementById('scale-down');
    const inc = document.getElementById('scale-up');
    if (dec) dec.addEventListener('click', () => adjustDocScale(-DOC_SCALE_STEP));
    if (inc) inc.addEventListener('click', () => adjustDocScale(DOC_SCALE_STEP));

    const toggle = document.getElementById('view-mode');
    toggle.addEventListener('change', async () => {
      await window.docket.setOverride(absolutePath, toggle.value);
      appState = await window.docket.getState();
      renderFile(absolutePath, text);
    });

    const star = document.getElementById('fav-toggle');
    if (star) {
      star.addEventListener('click', async () => {
        if (isFavorite(absolutePath)) await window.docket.removeFavorite(absolutePath);
        else await window.docket.addFavorite(absolutePath);
        appState = await window.docket.getState();
        renderFile(absolutePath, text);
        renderSidebar();
      });
    }
  }

  function wireMarkdownLinks(absolutePath) {
    const dir = absolutePath.replace(/\/[^/]*$/, '');
    content.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const resolved = resolveRelative(dir, href);
        if (allFiles.some((f) => f.absolutePath === resolved)) openFile(resolved);
      });
    });
  }

  function resolveRelative(baseDir, href) {
    // Strip fragment/query for file resolution
    const cleanHref = href.replace(/[?#].*$/, '');
    if (cleanHref.startsWith('/')) return cleanHref;
    const parts = (baseDir + '/' + cleanHref).split('/');
    const stack = [];
    for (const p of parts) {
      if (p === '' || p === '.') continue;
      if (p === '..') { stack.pop(); continue; }
      stack.push(p);
    }
    return '/' + stack.join('/');
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

  function formatRelative(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const s = Math.floor(diff / 1000);
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w}w ago`;
    const abs = new Date(ms);
    return abs.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatAbsolute(ms) {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  setInterval(() => {
    document.querySelectorAll('.updated[data-mtime]').forEach((el) => {
      const mt = Number(el.dataset.mtime);
      if (mt) el.textContent = 'Updated ' + formatRelative(mt);
    });
  }, 60_000);

  // ---- Live refresh ----

  window.docket.onFileChange(async () => {
    allFiles = await window.docket.listAllFiles();
    tocs = await window.docket.getRootTocs();
    if (!search.value.trim()) renderSidebar();
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
        window.docket.setActivePath(null);
      }
    } else if (currentPath) {
      content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
      currentPath = null;
      window.docket.setActivePath(null);
    }
  });

  window.docket.onConfigChange(async (newCfg) => {
    cfg = newCfg;
    allFiles = await window.docket.listAllFiles();
    tocs = await window.docket.getRootTocs();
    await renderBrowse();
    if (!search.value.trim()) renderSidebar();
  });

  // ---- Menu-driven actions (accelerators live on the menu items) ----
  function applySidebarHidden(hidden) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('hidden', hidden);
  }
  const initialHidden = localStorage.getItem(SIDEBAR_KEY) === '1';
  applySidebarHidden(initialHidden);

  window.docket.onToggleSidebar(() => {
    const sidebar = document.getElementById('sidebar');
    const nowHidden = !sidebar.classList.contains('hidden');
    applySidebarHidden(nowHidden);
    localStorage.setItem(SIDEBAR_KEY, nowHidden ? '1' : '0');
  });

  window.docket.onFocusSearch(() => {
    search.focus();
    search.select();
  });

  window.docket.onSortByChanged(async (sortBy) => {
    appState = { ...appState, sortBy };
    await renderBrowse();
    if (!search.value.trim()) renderSidebar();
  });

  await renderBrowse();
  renderSidebar();

  if (appState.recents.length) openFile(appState.recents[0].absolutePath);
})();
