(async () => {
  const SIDEBAR_KEY = 'docket:sidebar-hidden';
  const COLLAPSE_KEY = 'docket:collapsed-phases';

  const tabStrip = document.getElementById('tab-strip');
  const sections = document.getElementById('sidebar-sections');
  const results = document.getElementById('sidebar-results');
  const search = document.getElementById('search-box');
  const content = document.getElementById('content');

  const tts = new window.TTSPlayer();
  let activePlayKey = null;

  marked.setOptions({ gfm: true, breaks: false });
  const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

  let cfg = await window.docket.getConfig();
  let allFiles = await window.docket.listAllFiles();
  let appState = await window.docket.getState();
  let currentPath = null;
  let pendingOutsideRootBanner = null;
  let currentIsOutsideRoot = false;

  // Session-only per-document view-mode overrides. Map<absolutePath, 'checklist'|'markdown'|'raw'>.
  // Cleared on app restart by design.
  const sessionViewOverrides = new Map();
  let lastResolvedViewMode = null;
  let viewModePopoverEl = null;

  function isFavorite(absolutePath) {
    return (appState.favorites || []).some((f) => f.absolutePath === absolutePath);
  }

  const SECTION_TITLES = {
    favorites: 'Favorites',
    recents: 'Recents',
    browse: 'Files'
  };

  function orderedFavorites() {
    const all = appState.favorites || [];
    const order = appState.favoritesOrder || [];
    if (!order.length) return all;
    const byPath = new Map(all.map((f) => [f.absolutePath, f]));
    const ordered = [];
    for (const p of order) {
      if (byPath.has(p)) { ordered.push(byPath.get(p)); byPath.delete(p); }
    }
    for (const f of all) if (byPath.has(f.absolutePath)) ordered.push(f);
    return ordered;
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

  let lastBrowseHTML = '';

  // Session-only set of expanded folder paths within the active root tree.
  // Key = path-of-dir-names joined with '/' starting from the root.
  const expandedDirs = new Set();

  function pickActiveBrowseRootId() {
    if (!cfg.roots || !cfg.roots.length) return null;
    const persisted = appState.activeBrowseRoot;
    if (persisted && cfg.roots.some((r) => r.id === persisted)) return persisted;
    return cfg.roots[0].id;
  }

  async function renderBrowse() {
    if (!cfg.roots || !cfg.roots.length) {
      lastBrowseHTML = `
        <div class="file-tabs">
          <div class="file-tab-add" title="Add root…">+</div>
        </div>
        <div class="empty-hint">No roots configured. Click + to add one.</div>
      `;
      if (!search.value.trim()) renderSidebar();
      return;
    }
    const statuses = await window.docket.getRootStatuses();
    const activeRootId = pickActiveBrowseRootId();
    const tabs = cfg.roots.map((r) => {
      const cls = r.id === activeRootId ? ' active' : '';
      return `<div class="file-tab${cls}" data-root-id="${escapeHTML(r.id)}" draggable="true" title="${escapeHTML(r.path)}">${escapeHTML(r.label)}</div>`;
    }).join('');
    const tabStripHTML = `
      <div class="file-tabs">
        ${tabs}
        <div class="file-tab-add" title="Add root…">+</div>
      </div>
    `;

    const root = cfg.roots.find((r) => r.id === activeRootId);
    const status = statuses[activeRootId] || { capped: false, status: 'ok' };
    let bodyHTML;
    if (status.status !== 'ok') {
      const chip = status.status === 'missing'
        ? `<span class="chip-warn">missing</span>`
        : `<span class="chip-warn">permission denied</span>`;
      bodyHTML = `<div class="empty-hint">${escapeHTML(root.path)} ${chip}</div>`;
    } else {
      const files = allFiles.filter((e) => e.rootId === activeRootId)
        .slice().sort(compareFiles);
      const cappedBanner = status.capped ? `<div class="cap-warning">⚠ More than 5,000 files — sidebar listing may be incomplete. Content search still covers everything.</div>` : '';
      const tree = buildTree(files);
      bodyHTML = cappedBanner + renderTree(tree);
    }

    lastBrowseHTML = tabStripHTML + bodyHTML;
    if (!search.value.trim()) renderSidebar();
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

  function renderTree(node, parentPath = '') {
    const parts = ['<ul class="file-list">'];
    const dirNames = [...node.dirs.keys()].sort();
    for (const name of dirNames) {
      const dirPath = parentPath ? parentPath + '/' + name : name;
      const isExpanded = expandedDirs.has(dirPath);
      const chevron = isExpanded ? '▾' : '▸';
      const childHTML = isExpanded ? renderTree(node.dirs.get(name), dirPath) : '';
      parts.push(`
      <li class="tree-li">
        <div class="dir-row${isExpanded ? ' expanded' : ''}" data-dir-path="${escapeHTML(dirPath)}">
          <span class="tree-chevron">${chevron}</span>
          <span class="tree-icon dir-icon" aria-hidden="true">📁</span>
          <span class="tree-label">${escapeHTML(name)}</span>
        </div>
        ${childHTML}
      </li>
    `);
    }
    for (const f of node.files) {
      const basename = f.relativePath.split('/').pop();
      const activeCls = currentPath === f.absolutePath ? ' active' : '';
      parts.push(`
      <li class="tree-li">
        <button type="button" class="file-row${activeCls}" data-path="${escapeHTML(f.absolutePath)}">
          <span class="tree-chevron-spacer"></span>
          <span class="tree-icon file-icon" aria-hidden="true">·</span>
          <span class="tree-label">${escapeHTML(basename)}</span>
        </button>
      </li>
    `);
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderListItem(absolutePath, label, { removable = false, removeKind = null, draggable = false } = {}) {
    const activeCls = currentPath === absolutePath ? ' active' : '';
    const removeHTML = removable
      ? `<button type="button" class="remove-btn" data-remove-path="${escapeHTML(absolutePath)}" data-remove-kind="${removeKind}" title="Remove">×</button>`
      : '';
    const dragAttr = draggable ? ' draggable="true"' : '';
    const dragHandle = draggable ? `<span class="row-drag" aria-hidden="true">⋮⋮</span>` : '';
    return `<li class="dismissable${draggable ? ' draggable' : ''}"${dragAttr} data-path="${escapeHTML(absolutePath)}">${dragHandle}<button type="button" class="file-btn${activeCls}" data-path="${escapeHTML(absolutePath)}">${escapeHTML(label)}</button>${removeHTML}</li>`;
  }

  function renderFavoritesBody() {
    const valid = orderedFavorites().filter((f) => allFiles.some((e) => e.absolutePath === f.absolutePath));
    if (!valid.length) return null;
    const parts = ['<ul class="file-list" data-favorites-list>'];
    for (const f of valid) {
      const basename = f.absolutePath.split('/').pop();
      parts.push(renderListItem(f.absolutePath, basename, { removable: true, removeKind: 'favorite', draggable: true }));
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderRecentsBody() {
    const valid = (appState.recents || []).filter((r) => allFiles.some((f) => f.absolutePath === r.absolutePath));
    if (!valid.length) return null;
    const parts = ['<ul class="file-list">'];
    for (const r of valid) {
      const basename = r.absolutePath.split('/').pop();
      parts.push(renderListItem(r.absolutePath, basename, { removable: true, removeKind: 'recent' }));
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderBrowseBody() {
    return lastBrowseHTML || '<div class="empty-hint">No files yet.</div>';
  }

  function renderSectionBody(id) {
    if (id === 'favorites') return renderFavoritesBody();
    if (id === 'recents') return renderRecentsBody();
    if (id === 'browse') return renderBrowseBody();
    return null;
  }

  function renderSidebar() {
    const order = (appState.sectionOrder && appState.sectionOrder.length)
      ? appState.sectionOrder
      : ['favorites', 'recents', 'browse'];
    const collapsed = appState.collapsedSections || {};

    const cards = [];
    for (const id of order) {
      const bodyHTML = renderSectionBody(id);
      if (bodyHTML === null) continue;
      const isCollapsed = Boolean(collapsed[id]);
      cards.push(`
        <section class="section-card${isCollapsed ? ' collapsed' : ''}" data-section="${id}" draggable="true">
          <header class="section-card-head">
            <button type="button" class="section-toggle" aria-expanded="${isCollapsed ? 'false' : 'true'}">
              <span class="chevron" aria-hidden="true">▾</span>
              <span class="section-title">${escapeHTML(SECTION_TITLES[id] || id)}</span>
            </button>
            <span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
          </header>
          <div class="section-card-body">${bodyHTML}</div>
        </section>
      `);
    }
    sections.innerHTML = cards.join('');
    wireSectionCards();
  }

  function wireSectionCards() {
    sections.querySelectorAll('button[data-path]').forEach((btn) => {
      let clickTimer = null;
      btn.addEventListener('click', () => {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          // Double-click → open as permanent
          openFile(btn.dataset.path, {
            skipRecents: btn.dataset.skipRecents === '1',
            preview: false
          });
        } else {
          clickTimer = setTimeout(() => {
            clickTimer = null;
            // Single-click → open as preview
            openFile(btn.dataset.path, {
              skipRecents: btn.dataset.skipRecents === '1',
              preview: true
            });
          }, 350);
        }
      });
    });
    sections.querySelectorAll('button[data-remove-path]').forEach((btn) => {
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
    sections.querySelectorAll('.section-toggle').forEach((toggle) => {
      toggle.addEventListener('click', async () => {
        const card = toggle.closest('.section-card');
        const id = card.dataset.section;
        const isCollapsed = card.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        await window.docket.setSectionCollapsed(id, isCollapsed);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
    // File-browser tab clicks (NEW)
    sections.querySelectorAll('.file-tab').forEach((el) => {
      el.addEventListener('click', async () => {
        const rootId = el.dataset.rootId;
        if (rootId === appState.activeBrowseRoot) return;
        await window.docket.setActiveBrowseRoot(rootId);
        appState = await window.docket.getState();
        await renderBrowse();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showRootTabContextMenu(e.clientX, e.clientY, el.dataset.rootId);
      });
    });

    // File-browser + (add root) button (NEW)
    sections.querySelectorAll('.file-tab-add').forEach((el) => {
      el.addEventListener('click', async () => {
        const picked = await window.docket.pickDirectory();
        if (!picked) return;
        await window.docket.addRootForPath(picked);
        const fresh = await window.docket.getConfig();
        const newRoot = fresh.roots[fresh.roots.length - 1];
        if (newRoot) {
          await window.docket.setActiveBrowseRoot(newRoot.id);
          appState = await window.docket.getState();
          await renderBrowse();
        }
      });
    });

    sections.querySelectorAll('.dir-row').forEach((el) => {
      el.addEventListener('click', () => {
        const dirPath = el.dataset.dirPath;
        if (expandedDirs.has(dirPath)) expandedDirs.delete(dirPath);
        else expandedDirs.add(dirPath);
        // Re-render only the browse section to avoid losing other state.
        renderBrowse();
      });
    });

    wireSectionDrag();
    wireFavoritesDrag();
    wireFileTabDrag();
  }

  function wireSectionDrag() {
    const cards = Array.from(sections.querySelectorAll('.section-card'));
    let dragSrc = null;

    cards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        if (e.target.closest('li.draggable')) return; // favourite-row drag, not section drag
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.dataset.section); } catch {}
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        cards.forEach((c) => c.classList.remove('drop-target'));
        dragSrc = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === card) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cards.forEach((c) => c.classList.toggle('drop-target', c === card));
      });
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragSrc || dragSrc === card) return;
        const order = cards.map((c) => c.dataset.section);
        const fromIdx = order.indexOf(dragSrc.dataset.section);
        const toIdx = order.indexOf(card.dataset.section);
        if (fromIdx === -1 || toIdx === -1) return;
        order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
        await window.docket.setSectionOrder(order);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
  }

  function wireFavoritesDrag() {
    const list = sections.querySelector('[data-favorites-list]');
    if (!list) return;
    const items = Array.from(list.querySelectorAll('li.draggable'));
    let dragSrc = null;

    items.forEach((li) => {
      li.addEventListener('dragstart', (e) => {
        dragSrc = li;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', li.dataset.path); } catch {}
        e.stopPropagation();
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        items.forEach((x) => x.classList.remove('drop-target'));
        dragSrc = null;
      });
      li.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === li) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        items.forEach((x) => x.classList.toggle('drop-target', x === li));
      });
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragSrc || dragSrc === li) return;
        const order = items.map((x) => x.dataset.path);
        const from = order.indexOf(dragSrc.dataset.path);
        const to = order.indexOf(li.dataset.path);
        if (from === -1 || to === -1) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        await window.docket.setFavoritesOrder(order);
        appState = await window.docket.getState();
        renderSidebar();
      });
    });
  }

  function wireFileTabDrag() {
    const tabs = Array.from(sections.querySelectorAll('.file-tab'));
    let dragSrc = null;
    tabs.forEach((tab) => {
      tab.addEventListener('dragstart', (e) => {
        dragSrc = tab;
        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', tab.dataset.rootId); } catch {}
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        tabs.forEach((t) => t.classList.remove('drop-target'));
        dragSrc = null;
      });
      tab.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === tab) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabs.forEach((t) => t.classList.toggle('drop-target', t === tab));
      });
      tab.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragSrc || dragSrc === tab) return;
        const fromId = dragSrc.dataset.rootId;
        const toId = tab.dataset.rootId;
        const order = cfg.roots.slice();
        const fromIdx = order.findIndex((r) => r.id === fromId);
        const toIdx = order.findIndex((r) => r.id === toId);
        if (fromIdx === -1 || toIdx === -1) return;
        order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
        cfg = await window.docket.updateConfig({ roots: order });
        await renderBrowse();
      });
    });
  }

  // ---- Search ----

  const searchModeRadios = document.querySelectorAll('input[name="search-mode"]');
  function applySearchModeRadios() {
    const mode = appState.searchMode || 'contents';
    searchModeRadios.forEach((r) => { r.checked = r.value === mode; });
  }
  applySearchModeRadios();
  searchModeRadios.forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      await window.docket.setSearchMode(r.value);
      appState = await window.docket.getState();
      if (search.value.trim()) runSearch();
    });
  });

  let searchDebounce;
  search.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 150);
  });

  async function runSearch() {
    const q = search.value.trim();
    if (!q) {
      results.innerHTML = '';
      sections.style.display = '';
      renderSidebar();
      return;
    }
    sections.style.display = 'none';

    const mode = appState.searchMode || 'contents';
    const qLower = q.toLowerCase();
    const nameHits = [];
    for (const f of allFiles) {
      const base = f.relativePath.split('/').pop().toLowerCase();
      if (base.includes(qLower)) nameHits.push({ file: f, rank: 0 });
      else if (f.relativePath.toLowerCase().includes(qLower)) nameHits.push({ file: f, rank: 1 });
    }
    nameHits.sort((a, b) => a.rank - b.rank || a.file.relativePath.localeCompare(b.file.relativePath));

    const contentHits = mode === 'filename' ? [] : await window.docket.searchContent(q);
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

  async function openFile(absolutePath, { skipRecents = false, keepBanner = false, skipTabRoute = false, preview = false } = {}) {
    if (!keepBanner) {
      pendingOutsideRootBanner = null;
      currentIsOutsideRoot = false;
    }
    stopActivePlayback();
    currentPath = absolutePath;
    window.docket.setActivePath(absolutePath);
    // Tab routing: open or switch to the tab for this path, then persist.
    // Skipped when the caller explicitly handled tab state already (e.g. tab-click).
    if (!skipTabRoute) {
      const next = openOrSwitchAt(absolutePath, { preview });
      const currentTabs = appState.tabs || [];
      if (next.tabs.length !== currentTabs.length || next.activeTabIndex !== appState.activeTabIndex) {
        await window.docket.setTabs(next.tabs);
        await window.docket.setActiveTabIndex(next.activeTabIndex);
        appState = await window.docket.getState();
      } else {
        // Same length + same active index — but a preview tab might have been replaced
        // (path changed in-place). Persist the new tabs array regardless to capture this.
        if (JSON.stringify(next.tabs) !== JSON.stringify(currentTabs)) {
          await window.docket.setTabs(next.tabs);
          appState = await window.docket.getState();
        }
      }
    }
    try {
      const text = await window.docket.readFile(absolutePath);
      if (!skipRecents) await window.docket.addRecent(absolutePath);
      appState = await window.docket.getState();
      renderFile(absolutePath, text);
      renderStatusBar();
      renderTabStrip();
      await renderBrowse();
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p><button type="button" id="retry-load" class="retry-btn">Retry</button></div>`;
      const retry = document.getElementById('retry-load');
      if (retry) retry.addEventListener('click', () => openFile(absolutePath, { skipRecents, keepBanner, skipTabRoute, preview }));
    }
  }

  function resolveViewMode(absolutePath, meta, body) {
    if (sessionViewOverrides.has(absolutePath)) return sessionViewOverrides.get(absolutePath);
    const def = appState.defaultView || 'auto';
    if (def === 'auto') return docketParser.detectViewMode({ meta, body });
    return def;
  }

  function renderFile(absolutePath, text) {
    const { meta, body } = docketParser.parseFrontmatter(text);
    const mode = resolveViewMode(absolutePath, meta, body);
    lastResolvedViewMode = mode;

    // Frontmatter warning: has delimiters but meta empty → malformed
    const looksLikeFrontmatter = text.startsWith('---\n');
    const frontmatterWarning = looksLikeFrontmatter && Object.keys(meta).length === 0;

    let outsideBannerHTML = '';
    if (pendingOutsideRootBanner && pendingOutsideRootBanner.parentDir) {
      const dir = pendingOutsideRootBanner.parentDir;
      outsideBannerHTML = `<div class="outside-root-banner" data-parent="${escapeHTML(dir)}"><span>This file isn't inside a configured root. Open it now and add <code>${escapeHTML(dir)}</code> as a root for next time?</span><div class="banner-actions"><button type="button" class="banner-add">Add root</button><button type="button" class="banner-dismiss">Dismiss</button></div></div>`;
    }

    const frontmatterWarningHTML = frontmatterWarning
      ? `<div class="frontmatter-warning"><span class="chip-warn">⚠ invalid frontmatter</span></div>`
      : '';

    let bodyHTML;
    try {
      if (mode === 'checklist') {
        bodyHTML = renderChecklist(meta, body);
      } else if (mode === 'raw') {
        bodyHTML = renderRaw(text);
      } else {
        bodyHTML = `<div class="prose">${md(text)}</div>`;
      }
    } catch (e) {
      bodyHTML = `<div class="empty-state"><h1>Render failed</h1><p>${escapeHTML(String(e))}</p></div>`;
    }

    content.innerHTML = outsideBannerHTML + frontmatterWarningHTML + '<div class="doc-scroll"><div class="doc-body">' + bodyHTML + '</div></div>';
    wireCollapsibles(absolutePath);
    wireMarkdownLinks(absolutePath);

    content.querySelectorAll('.row.expandable').forEach((row) => {
      row.addEventListener('click', (e) => {
        // Don't toggle if the click came from the play button or a link inside the instructions.
        if (e.target.closest('.task-play')) return;
        if (e.target.closest('a')) return;
        row.classList.toggle('expanded');
      });
    });

    content.querySelectorAll('.task-play').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.taskKey;
        const row = btn.closest('.row.expandable');
        const inner = row ? row.querySelector('.task-instructions-inner') : null;
        if (!inner) return;

        // If we're already playing THIS task, toggle pause/resume.
        if (activePlayKey === key) {
          if (tts.isPaused()) {
            tts.resume();
            btn.classList.add('playing');
            btn.textContent = '❙❙';
          } else {
            tts.pause();
            btn.textContent = '▶';
          }
          return;
        }

        // Otherwise: stop any active playback, expand this row, wrap the
        // text in word-spans, and start playing.
        if (activePlayKey) clearActivePlay();
        if (!row.classList.contains('expanded')) row.classList.add('expanded');

        const text = inner.textContent;
        wrapWords(inner, text);
        activePlayKey = key;
        btn.classList.add('playing');
        btn.textContent = '❙❙';

        const synth = window.speechSynthesis;
        const allVoices = synth.getVoices();
        const savedVoice = appState.voiceURI ? allVoices.find((v) => v.voiceURI === appState.voiceURI) : null;
        tts.play(text, {
          rate: appState.speechRate || 1,
          voice: savedVoice || undefined,
          onBoundary: (charIndex) => highlightWordAt(inner, charIndex),
          onEnd: () => clearActivePlay()
        });
      });
    });

    const bannerAdd = content.querySelector('.outside-root-banner .banner-add');
    const bannerDismiss = content.querySelector('.outside-root-banner .banner-dismiss');
    if (bannerAdd) {
      bannerAdd.addEventListener('click', async () => {
        const dir = content.querySelector('.outside-root-banner').dataset.parent;
        try { await window.docket.addRootForPath(dir); }
        catch (e) { console.warn('addRootForPath failed', e); }
        pendingOutsideRootBanner = null;
        const banner = content.querySelector('.outside-root-banner');
        if (banner) banner.remove();
      });
    }
    if (bannerDismiss) {
      bannerDismiss.addEventListener('click', () => {
        pendingOutsideRootBanner = null;
        const banner = content.querySelector('.outside-root-banner');
        if (banner) banner.remove();
      });
    }
  }

  // ---- Status bar ----

  const statusBar = document.getElementById('status-bar');
  let updateState = null; // { status: 'available'|'downloading'|'ready'|'error'|'none', version?, percent?, bytesPerSecond?, transferred?, total?, message? }

  function renderStatusBar() {
    if (!currentPath) {
      statusBar.innerHTML = '';
      return;
    }
    const entry = allFiles.find((f) => f.absolutePath === currentPath);
    const mtime = entry ? entry.mtime : null;
    const ctime = entry ? entry.ctime : null;
    const updatedHTML = mtime ? `Updated ${escapeHTML(formatRelative(mtime))}` : '';
    const createdHTML = ctime ? `Created ${escapeHTML(formatRelative(ctime))}` : '';

    const fav = isFavorite(currentPath);
    const starText = fav ? '★ Favorited' : '☆ Favorite';

    const pillCls = updateState && updateState.status === 'error' ? ' error' : '';
    const updatePillHTML = updateState && updateState.status && updateState.status !== 'none'
      ? `<button type="button" class="update-pill${pillCls}" id="update-pill">${escapeHTML(updateLabel(updateState))}</button>`
      : '';

    statusBar.innerHTML = `
      <div class="status-left">
        <span class="status-path" title="${escapeHTML(currentPath)}">${escapeHTML(currentPath)}</span>
        ${createdHTML ? `<span>· ${createdHTML}</span>` : ''}
        ${updatedHTML ? `<span>· ${updatedHTML}</span>` : ''}
      </div>
      <div class="status-right">
        ${updatePillHTML}
        <button type="button" class="status-bar-control${fav ? ' active' : ''}" id="favorite-toggle">${escapeHTML(starText)}</button>
      </div>
    `;

    const star = document.getElementById('favorite-toggle');
    star.addEventListener('click', async () => {
      if (isFavorite(currentPath)) await window.docket.removeFavorite(currentPath);
      else await window.docket.addFavorite(currentPath);
      appState = await window.docket.getState();
      renderStatusBar();
      renderSidebar();
      if (typeof renderTabStrip === 'function') renderTabStrip();
    });

    if (updateState && updateState.status && updateState.status !== 'none') {
      const pill = document.getElementById('update-pill');
      if (pill) {
        if (updateState.status === 'downloading') {
          pill.disabled = true;
        } else {
          pill.addEventListener('click', () => onUpdatePillClick());
        }
      }
    }
  }

  // ---- Tab strip ----

  function renderTabStrip() {
    const tabs = appState.tabs || [];
    const activeIdx = appState.activeTabIndex >= 0 ? appState.activeTabIndex : -1;

    const tabHTML = tabs.map((t, i) => {
      const basename = t.absolutePath.split('/').pop();
      const fav = (appState.favorites || []).some((f) => f.absolutePath === t.absolutePath);
      const star = fav ? '<span class="tab-star" aria-hidden="true">★</span>' : '';
      const activeCls = i === activeIdx ? ' active' : '';
      const previewCls = t.isPreview ? ' preview' : '';
      return `<div class="tab${activeCls}${previewCls}" data-index="${i}" data-path="${escapeHTML(t.absolutePath)}" draggable="true" title="${escapeHTML(t.absolutePath)}">
        ${star}
        <span class="tab-name">${escapeHTML(basename)}</span>
        <button type="button" class="tab-close" data-close-index="${i}" title="Close">×</button>
      </div>`;
    }).join('');

    tabStrip.innerHTML = `
      <div class="tab-list">${tabHTML}</div>
      <div class="tab-strip-controls">
        <div class="scale-ctl" role="group" aria-label="Text size">
          <button type="button" id="scale-down" class="scale-btn scale-btn-sm" title="Smaller text">A</button>
          <button type="button" id="scale-up" class="scale-btn scale-btn-lg" title="Larger text">A</button>
        </div>
        <button type="button" id="view-mode-btn" class="view-mode-btn" title="View mode">
          <span class="vm-icon">${viewModeIcon(currentEffectiveViewMode())}</span>
        </button>
      </div>
    `;

    wireTabStrip();
    updateScaleButtons();
  }

  function viewModeIcon(mode) {
    if (mode === 'checklist') return '☑';
    if (mode === 'raw') return '&lt;/&gt;';
    return '📄'; // markdown
  }

  function currentEffectiveViewMode() {
    if (!currentPath) return 'markdown';
    if (sessionViewOverrides.has(currentPath)) return sessionViewOverrides.get(currentPath);
    return lastResolvedViewMode || 'markdown';
  }

  function wireTabStrip() {
    // Activate tab on click
    tabStrip.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.tab-close')) return;
        const idx = Number(el.dataset.index);
        if (idx === appState.activeTabIndex) return;
        await window.docket.setActiveTabIndex(idx);
        appState = await window.docket.getState();
        const path = appState.tabs[idx].absolutePath;
        await openFile(path, { skipRecents: true, skipTabRoute: true });
      });
    });

    // Close button
    tabStrip.querySelectorAll('.tab-close').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        stopActivePlayback();
        const idx = Number(btn.dataset.closeIndex);
        const next = closeTabAt(idx);
        await window.docket.setTabs(next.tabs);
        await window.docket.setActiveTabIndex(next.activeTabIndex);
        appState = await window.docket.getState();
        if (next.activeTabIndex === -1) {
          currentPath = null;
          window.docket.setActivePath(null);
          content.innerHTML = `<div class="empty-state"><h1>Docket</h1><p>Select a file from the sidebar.</p></div>`;
          renderStatusBar();
          renderTabStrip();
          return;
        }
        const path = appState.tabs[next.activeTabIndex].absolutePath;
        await openFile(path, { skipRecents: true, skipTabRoute: true });
      });
    });

    wireTabDrag();
    wireTabContextMenu();

    // Scale button click handlers (moved from old file-head)
    const dec = document.getElementById('scale-down');
    const inc = document.getElementById('scale-up');
    if (dec) dec.addEventListener('click', () => adjustDocScale(-DOC_SCALE_STEP));
    if (inc) inc.addEventListener('click', () => adjustDocScale(DOC_SCALE_STEP));

    const vmBtn = document.getElementById('view-mode-btn');
    if (vmBtn) {
      vmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleViewModePopover(vmBtn);
      });
    }
  }

  function wireTabContextMenu() {
    tabStrip.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const idx = Number(el.dataset.index);
        const path = el.dataset.path;
        showTabContextMenu(e.clientX, e.clientY, idx, path);
      });
    });
  }

  let contextMenuEl = null;
  function showTabContextMenu(x, y, idx, path) {
    closeTabContextMenu();
    const fav = (appState.favorites || []).some((f) => f.absolutePath === path);
    const tab = (appState.tabs || [])[idx] || {};
    const items = [];
    if (tab.isPreview) {
      items.push({ label: 'Keep Open', action: 'keep-open' });
      items.push({ type: 'separator' });
    }
    items.push({ label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: 'toggle-fav' });
    items.push({ type: 'separator' });
    items.push({ label: 'Close', action: 'close' });
    items.push({ label: 'Close Others', action: 'close-others' });
    items.push({ type: 'separator' });
    items.push({ label: 'Reveal in Finder', action: 'reveal' });
    const html = items.map((i) =>
      i.type === 'separator'
        ? `<div class="ctx-sep"></div>`
        : `<button type="button" class="ctx-item" data-action="${i.action}">${escapeHTML(i.label)}</button>`
    ).join('');

    const el = document.createElement('div');
    el.className = 'tab-context-menu';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = html;
    document.body.appendChild(el);
    contextMenuEl = el;

    el.querySelectorAll('.ctx-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        closeTabContextMenu();
        if (action === 'keep-open') {
          const next = (appState.tabs || []).slice();
          if (next[idx]) {
            next[idx] = { ...next[idx], isPreview: false };
            await window.docket.setTabs(next);
            appState = await window.docket.getState();
            renderTabStrip();
          }
        } else if (action === 'toggle-fav') {
          if (fav) await window.docket.removeFavorite(path);
          else await window.docket.addFavorite(path);
          appState = await window.docket.getState();
          renderTabStrip();
          renderSidebar();
          renderStatusBar();
        } else if (action === 'close') {
          stopActivePlayback();
          const next = closeTabAt(idx);
          await window.docket.setTabs(next.tabs);
          await window.docket.setActiveTabIndex(next.activeTabIndex);
          appState = await window.docket.getState();
          if (next.activeTabIndex === -1) {
            currentPath = null;
            content.innerHTML = `<div class="empty-state"><h1>Docket</h1><p>Select a file from the sidebar.</p></div>`;
            renderTabStrip();
            renderStatusBar();
          } else {
            await openFile(appState.tabs[next.activeTabIndex].absolutePath, { skipRecents: true, skipTabRoute: true });
          }
        } else if (action === 'close-others') {
          stopActivePlayback();
          const onlyThis = [appState.tabs[idx]];
          await window.docket.setTabs(onlyThis);
          await window.docket.setActiveTabIndex(0);
          appState = await window.docket.getState();
          await openFile(path, { skipRecents: true, skipTabRoute: true });
        } else if (action === 'reveal') {
          await window.docket.revealInFinder(path);
        }
      });
    });

    // Click outside closes the menu.
    setTimeout(() => {
      document.addEventListener('click', closeTabContextMenu, { once: true });
    }, 0);
  }

  function closeTabContextMenu() {
    if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
  }

  function toggleViewModePopover(anchorBtn) {
    if (viewModePopoverEl) { closeViewModePopover(); return; }
    const current = currentEffectiveViewMode();
    const tiles = [
      { mode: 'checklist', label: 'Checklist', icon: '☑' },
      { mode: 'markdown', label: 'Markdown', icon: '📄' },
      { mode: 'raw', label: 'Raw', icon: '&lt;/&gt;' }
    ].map((t) => `
      <div class="view-mode-tile${t.mode === current ? ' active' : ''}" data-mode="${t.mode}">
        <span class="view-mode-tile-icon">${t.icon}</span>
        <span class="view-mode-tile-label">${escapeHTML(t.label)}</span>
      </div>
    `).join('');
    const el = document.createElement('div');
    el.className = 'view-mode-popover';
    el.innerHTML = tiles;
    anchorBtn.appendChild(el);
    viewModePopoverEl = el;

    el.querySelectorAll('.view-mode-tile').forEach((tile) => {
      tile.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mode = tile.dataset.mode;
        if (currentPath) {
          sessionViewOverrides.set(currentPath, mode);
          const text = await window.docket.readFile(currentPath);
          renderFile(currentPath, text);
          renderTabStrip();
        }
        closeViewModePopover();
      });
    });

    setTimeout(() => {
      document.addEventListener('click', closeViewModePopover, { once: true });
    }, 0);
  }

  function closeViewModePopover() {
    if (viewModePopoverEl) { viewModePopoverEl.remove(); viewModePopoverEl = null; }
  }

  function showRootTabContextMenu(x, y, rootId) {
    closeTabContextMenu();
    const root = cfg.roots.find((r) => r.id === rootId);
    if (!root) return;
    const items = [
      { label: 'Rename…', action: 'rename' },
      { label: 'Remove', action: 'remove' },
      { type: 'separator' },
      { label: 'Reveal in Finder', action: 'reveal' }
    ];
    const html = items.map((i) =>
      i.type === 'separator'
        ? `<div class="ctx-sep"></div>`
        : `<button type="button" class="ctx-item" data-action="${i.action}">${escapeHTML(i.label)}</button>`
    ).join('');

    const el = document.createElement('div');
    el.className = 'tab-context-menu';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = html;
    document.body.appendChild(el);
    contextMenuEl = el;

    el.querySelectorAll('.ctx-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        closeTabContextMenu();
        if (action === 'rename') {
          const next = prompt('Rename root', root.label);
          if (next === null) return;
          const trimmed = next.trim();
          if (!trimmed) return;
          const updated = cfg.roots.map((r) => r.id === rootId ? { ...r, label: trimmed } : r);
          cfg = await window.docket.updateConfig({ roots: updated });
          await renderBrowse();
        } else if (action === 'remove') {
          if (cfg.roots.length === 1) {
            alert('At least one root is required.');
            return;
          }
          if (!confirm(`Remove root "${root.label}"? Files won't be deleted; the root just won't appear in docket.`)) return;
          const updated = cfg.roots.filter((r) => r.id !== rootId);
          cfg = await window.docket.updateConfig({ roots: updated });
          if (appState.activeBrowseRoot === rootId) {
            await window.docket.setActiveBrowseRoot(null);
            appState = await window.docket.getState();
          }
          await renderBrowse();
        } else if (action === 'reveal') {
          await window.docket.revealInFinder(root.path);
        }
      });
    });

    setTimeout(() => {
      document.addEventListener('click', closeTabContextMenu, { once: true });
    }, 0);
  }

  function wireTabDrag() {
    const cards = Array.from(tabStrip.querySelectorAll('.tab'));
    let dragSrc = null;
    cards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.dataset.path); } catch {}
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        cards.forEach((c) => c.classList.remove('drop-target'));
        dragSrc = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === card) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cards.forEach((c) => c.classList.toggle('drop-target', c === card));
      });
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragSrc || dragSrc === card) return;
        const from = Number(dragSrc.dataset.index);
        const to = Number(card.dataset.index);
        const next = reorderTabsAt(from, to);
        await window.docket.setTabs(next.tabs);
        await window.docket.setActiveTabIndex(next.activeTabIndex);
        appState = await window.docket.getState();
        renderTabStrip();
      });
    });
  }

  // Local copies of the tab manager logic. They MUST stay in sync with
  // lib/tabs.js (which has tests). Renderer can't require lib/tabs.js
  // without a bundler, so we duplicate.
  function closeTabAt(index) {
    const tabs = (appState.tabs || []).slice();
    if (index < 0 || index >= tabs.length) return { tabs, activeTabIndex: appState.activeTabIndex };
    const wasActive = appState.activeTabIndex === index;
    tabs.splice(index, 1);
    let activeTabIndex;
    if (tabs.length === 0) activeTabIndex = -1;
    else if (wasActive) activeTabIndex = Math.min(index, tabs.length - 1);
    else if (appState.activeTabIndex > index) activeTabIndex = appState.activeTabIndex - 1;
    else activeTabIndex = appState.activeTabIndex;
    return { tabs, activeTabIndex };
  }

  function openOrSwitchAt(absolutePath, opts) {
    opts = opts || {};
    const preview = Boolean(opts.preview);
    const tabs = (appState.tabs || []).slice();
    const existing = tabs.findIndex((t) => t.absolutePath === absolutePath);
    if (existing !== -1) {
      if (!preview && tabs[existing].isPreview) {
        tabs[existing] = { ...tabs[existing], isPreview: false };
      }
      return { tabs, activeTabIndex: existing };
    }
    if (preview) {
      const previewIdx = tabs.findIndex((t) => t.isPreview);
      if (previewIdx !== -1) {
        tabs[previewIdx] = { ...tabs[previewIdx], absolutePath };
        return { tabs, activeTabIndex: previewIdx };
      }
      tabs.push({ absolutePath, isPreview: true });
      return { tabs, activeTabIndex: tabs.length - 1 };
    }
    tabs.push({ absolutePath });
    return { tabs, activeTabIndex: tabs.length - 1 };
  }

  function reorderTabsAt(from, to) {
    const tabs = (appState.tabs || []).slice();
    if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length || from === to) {
      return { tabs, activeTabIndex: appState.activeTabIndex };
    }
    const activePath = appState.activeTabIndex >= 0 ? tabs[appState.activeTabIndex].absolutePath : null;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    const activeTabIndex = activePath ? tabs.findIndex((t) => t.absolutePath === activePath) : appState.activeTabIndex;
    return { tabs, activeTabIndex };
  }

  function updateLabel(s) {
    if (s.status === 'available') return `↓ Download v${s.version}`;
    if (s.status === 'downloading') {
      const pct = typeof s.percent === 'number' ? Math.round(s.percent) : null;
      const speed = typeof s.bytesPerSecond === 'number' ? formatBytesPerSec(s.bytesPerSecond) : null;
      if (pct !== null && speed) return `↓ Downloading ${pct}% (${speed})`;
      if (pct !== null) return `↓ Downloading ${pct}%`;
      return `↓ Downloading…`;
    }
    if (s.status === 'ready') return `↻ Restart to install v${s.version}`;
    if (s.status === 'error') return `⚠ Download failed — Retry`;
    return '';
  }

  function formatBytesPerSec(bps) {
    if (!bps || bps < 1024) return `${Math.round(bps || 0)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  async function onUpdatePillClick() {
    if (!updateState) return;
    if (updateState.status === 'available' || updateState.status === 'error') {
      await window.docket.downloadUpdate();
    } else if (updateState.status === 'ready') {
      await window.docket.installUpdate();
    }
  }

  // Subscribe to update-state from the main process.
  window.docket.onUpdateState((payload) => {
    updateState = payload;
    renderStatusBar();
  });

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

  function renderRaw(text) {
    let highlighted;
    try {
      highlighted = window.hljs.highlight(text, { language: 'markdown' }).value;
    } catch {
      highlighted = escapeHTML(text);
    }
    return `<pre class="raw-view"><code class="hljs language-markdown">${highlighted}</code></pre>`;
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
      parts.push(`<ul class="task-list">${tasks.map((t, i) => renderTaskRow(t, docketParser.stableId(t.title + '::' + i))).join('')}</ul>`);
      tasks = [];
    };
    for (const it of items) {
      if (it.type === 'task') tasks.push(it);
      else { flush(); parts.push(`<div class="prose">${md(it.text)}</div>`); }
    }
    flush();
    return parts.join('');
  }

  function renderTaskRow(t, taskKey) {
    const cls = t.status === 'done' ? 'done' : (t.blocked ? 'blocked' : 'pending');
    const icon = t.status === 'done' ? '✓' : (t.blocked ? '⏸' : '○');
    const inlineNoteHTML = t.inlineNote ? `<div class="note">${md(t.inlineNote)}</div>` : '';
    const hasInstructions = !!(t.instructions && t.instructions.trim());
    const instructionsHTML = hasInstructions
      ? `<div class="task-instructions" data-task-key="${escapeHTML(taskKey)}"><div class="task-instructions-inner">${md(t.instructions)}</div></div>`
      : '';
    const playButtonHTML = hasInstructions
      ? `<button type="button" class="task-play" data-task-key="${escapeHTML(taskKey)}" title="Play instructions" aria-label="Play instructions">▶</button>`
      : '';
    const expandableCls = hasInstructions ? ' expandable' : '';
    return `<li class="row ${cls}${expandableCls}" data-task-key="${escapeHTML(taskKey)}">
      <span class="icon">${icon}</span>
      <div class="content">
        <div class="task-head">
          <div class="title">${escapeHTML(t.title)}</div>
          ${playButtonHTML}
        </div>
        ${inlineNoteHTML}
        ${instructionsHTML}
      </div>
    </li>`;
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

  function clearActivePlay() {
    document.querySelectorAll('.task-play.playing').forEach((b) => {
      b.classList.remove('playing');
      b.textContent = '▶';
    });
    document.querySelectorAll('.task-instructions-inner .word.active').forEach((w) => w.classList.remove('active'));
    activePlayKey = null;
  }

  function stopActivePlayback() {
    if (activePlayKey) {
      tts.stop();
      activePlayKey = null;
    }
  }

  function wrapWords(container, text) {
    const tokens = [];
    const re = /\S+|\s+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      tokens.push({ text: m[0], offset: m.index, isWhitespace: /^\s+$/.test(m[0]) });
    }
    const html = tokens.map((t) =>
      t.isWhitespace ? escapeHTML(t.text) : `<span class="word" data-offset="${t.offset}">${escapeHTML(t.text)}</span>`
    ).join('');
    container.innerHTML = html;
  }

  function highlightWordAt(container, charIndex) {
    let bestSpan = null;
    container.querySelectorAll('.word').forEach((span) => {
      const offset = Number(span.dataset.offset);
      if (offset <= charIndex) bestSpan = span;
    });
    container.querySelectorAll('.word.active').forEach((s) => s.classList.remove('active'));
    if (bestSpan) bestSpan.classList.add('active');
  }

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
    await renderBrowse();
    if (!currentPath) return;
    const isInAllFiles = allFiles.some((f) => f.absolutePath === currentPath);
    if (!isInAllFiles && !currentIsOutsideRoot) {
      stopActivePlayback();
      content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
      currentPath = null;
      window.docket.setActivePath(null);
      return;
    }
    // Either in-root file (in allFiles) or outside-root session-allowed file —
    // attempt to re-read in both cases.
    try {
      const text = await window.docket.readFile(currentPath);
      const prevScroller = content.querySelector('.doc-scroll');
      const savedScroll = prevScroller ? prevScroller.scrollTop : 0;
      renderFile(currentPath, text);
      renderStatusBar();
      renderTabStrip();
      const nextScroller = content.querySelector('.doc-scroll');
      if (nextScroller) nextScroller.scrollTop = savedScroll;
    } catch {
      stopActivePlayback();
      content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
      currentPath = null;
      currentIsOutsideRoot = false;
      window.docket.setActivePath(null);
    }
  });

  window.docket.onConfigChange(async (newCfg) => {
    cfg = newCfg;
    allFiles = await window.docket.listAllFiles();
    // If the currently-shown outside-root file is now inside one of the new
    // roots, drop the outside-root flag and the banner.
    if (currentPath && currentIsOutsideRoot) {
      const nowInRoot = (newCfg.roots || []).some((r) => {
        const rootPath = r.path;
        return currentPath === rootPath || currentPath.startsWith(rootPath + '/');
      });
      if (nowInRoot) {
        currentIsOutsideRoot = false;
        pendingOutsideRootBanner = null;
        const banner = content.querySelector('.outside-root-banner');
        if (banner) banner.remove();
      }
    }
    await renderBrowse();
    renderStatusBar();
    renderTabStrip();
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
    renderStatusBar();
    renderTabStrip();
  });

  window.docket.onOpenPath(async ({ absolutePath, inRoot, parentDir }) => {
    pendingOutsideRootBanner = inRoot ? null : { parentDir };
    currentIsOutsideRoot = !inRoot;
    await openFile(absolutePath, { skipRecents: !inRoot, keepBanner: !inRoot });
  });

  await renderBrowse();
  renderStatusBar();
  renderTabStrip();

  // Drop tabs whose files are no longer in any configured root. (CLI/Finder-opened
  // session-allowed paths from the previous run aren't tracked here; users
  // re-open them via CLI/Finder.)
  if ((appState.tabs || []).length) {
    const validTabs = appState.tabs.filter((t) => allFiles.some((f) => f.absolutePath === t.absolutePath));
    if (validTabs.length !== appState.tabs.length) {
      let activeTabIndex = appState.activeTabIndex;
      if (activeTabIndex >= 0) {
        const activePath = appState.tabs[activeTabIndex] ? appState.tabs[activeTabIndex].absolutePath : null;
        activeTabIndex = activePath ? validTabs.findIndex((t) => t.absolutePath === activePath) : -1;
      }
      if (activeTabIndex === -1 && validTabs.length > 0) activeTabIndex = 0;
      await window.docket.setTabs(validTabs);
      await window.docket.setActiveTabIndex(activeTabIndex);
      appState = await window.docket.getState();
      renderTabStrip();
    }
  }

  // Restore last-active tab if persisted; otherwise fall back to most-recent file.
  if (appState.activeTabIndex >= 0 && appState.tabs[appState.activeTabIndex]) {
    const path = appState.tabs[appState.activeTabIndex].absolutePath;
    openFile(path, { skipRecents: true, skipTabRoute: true });
  } else if (appState.recents.length) {
    openFile(appState.recents[0].absolutePath);
  }
})();
