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
  let tocs = await window.docket.getRootTocs();
  let currentPath = null;
  let pendingOutsideRootBanner = null;
  let currentIsOutsideRoot = false;

  function isFavorite(absolutePath) {
    return (appState.favorites || []).some((f) => f.absolutePath === absolutePath);
  }

  const SECTION_TITLES = {
    toc: 'Table of Contents',
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
    lastBrowseHTML = parts.join('');
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

  function renderListItem(absolutePath, label, { removable = false, removeKind = null, draggable = false } = {}) {
    const activeCls = currentPath === absolutePath ? ' active' : '';
    const removeHTML = removable
      ? `<button type="button" class="remove-btn" data-remove-path="${escapeHTML(absolutePath)}" data-remove-kind="${removeKind}" title="Remove">×</button>`
      : '';
    const dragAttr = draggable ? ' draggable="true"' : '';
    const dragHandle = draggable ? `<span class="row-drag" aria-hidden="true">⋮⋮</span>` : '';
    return `<li class="dismissable${draggable ? ' draggable' : ''}"${dragAttr} data-path="${escapeHTML(absolutePath)}">${dragHandle}<button type="button" class="file-btn${activeCls}" data-path="${escapeHTML(absolutePath)}">${escapeHTML(label)}</button>${removeHTML}</li>`;
  }

  function renderTocBody() {
    if (!tocs || !tocs.length) return null;
    const parts = [];
    for (const toc of tocs) {
      const heading = tocs.length > 1 ? `<div class="sub-heading">${escapeHTML(toc.rootLabel)}</div>` : '';
      parts.push(heading);
      parts.push('<ul class="file-list">');
      const activeCls = currentPath === toc.readmePath ? ' active' : '';
      parts.push(`<li><button type="button" class="file-btn toc${activeCls}" data-path="${escapeHTML(toc.readmePath)}" data-skip-recents="1">README.md</button></li>`);
      parts.push('</ul>');
    }
    return parts.join('');
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
    if (id === 'toc') return renderTocBody();
    if (id === 'favorites') return renderFavoritesBody();
    if (id === 'recents') return renderRecentsBody();
    if (id === 'browse') return renderBrowseBody();
    return null;
  }

  function renderSidebar() {
    const order = (appState.sectionOrder && appState.sectionOrder.length)
      ? appState.sectionOrder
      : ['toc', 'favorites', 'recents', 'browse'];
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
      btn.addEventListener('click', () => openFile(btn.dataset.path, { skipRecents: btn.dataset.skipRecents === '1' }));
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
    wireSectionDrag();
    wireFavoritesDrag();
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

  async function openFile(absolutePath, { skipRecents = false, keepBanner = false, skipTabRoute = false } = {}) {
    if (!keepBanner) {
      pendingOutsideRootBanner = null;
      currentIsOutsideRoot = false;
    }
    if (activePlayKey) { tts.stop(); activePlayKey = null; }
    currentPath = absolutePath;
    window.docket.setActivePath(absolutePath);
    // Tab routing: open or switch to the tab for this path, then persist.
    // Skipped when the caller explicitly handled tab state already (e.g. tab-click).
    if (!skipTabRoute) {
      const next = openOrSwitchAt(absolutePath);
      const currentTabs = appState.tabs || [];
      if (next.tabs.length !== currentTabs.length || next.activeTabIndex !== appState.activeTabIndex) {
        await window.docket.setTabs(next.tabs);
        await window.docket.setActiveTabIndex(next.activeTabIndex);
        appState = await window.docket.getState();
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
      if (retry) retry.addEventListener('click', () => openFile(absolutePath, { skipRecents, keepBanner, skipTabRoute }));
    }
  }

  function renderFile(absolutePath, text) {
    const { meta, body } = docketParser.parseFrontmatter(text);
    const override = appState.overrides[absolutePath];
    const mode = override || docketParser.detectViewMode({ meta, body });

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

        tts.play(text, {
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
  let updateState = null; // { status: 'available' | 'downloading' | 'ready' | 'none', version }

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

    const override = appState.overrides[currentPath];
    const viewModeValue = override || 'auto';

    const fav = isFavorite(currentPath);
    const starText = fav ? '★ Favorited' : '☆ Favorite';

    const updatePillHTML = updateState && updateState.status && updateState.status !== 'none'
      ? `<button type="button" class="update-pill" id="update-pill">${escapeHTML(updateLabel(updateState))}</button>`
      : '';

    statusBar.innerHTML = `
      <div class="status-left">
        <span class="status-path" title="${escapeHTML(currentPath)}">${escapeHTML(currentPath)}</span>
        ${createdHTML ? `<span>· ${createdHTML}</span>` : ''}
        ${updatedHTML ? `<span>· ${updatedHTML}</span>` : ''}
      </div>
      <div class="status-right">
        ${updatePillHTML}
        <select id="view-mode-select" aria-label="View mode">
          <option value="auto"${viewModeValue === 'auto' ? ' selected' : ''}>Auto</option>
          <option value="checklist"${viewModeValue === 'checklist' ? ' selected' : ''}>Checklist</option>
          <option value="markdown"${viewModeValue === 'markdown' ? ' selected' : ''}>Markdown</option>
        </select>
        <button type="button" class="status-bar-control${fav ? ' active' : ''}" id="favorite-toggle">${escapeHTML(starText)}</button>
      </div>
    `;

    const select = document.getElementById('view-mode-select');
    select.addEventListener('change', async () => {
      const v = select.value;
      if (v === 'auto') await window.docket.clearOverride(currentPath);
      else await window.docket.setOverride(currentPath, v);
      appState = await window.docket.getState();
      const text = await window.docket.readFile(currentPath);
      renderFile(currentPath, text);
      renderStatusBar();
    });

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
      if (pill) pill.addEventListener('click', () => onUpdatePillClick());
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
      return `<div class="tab${activeCls}" data-index="${i}" data-path="${escapeHTML(t.absolutePath)}" draggable="true" title="${escapeHTML(t.absolutePath)}">
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
      </div>
    `;

    wireTabStrip();
    updateScaleButtons();
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
    const items = [
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: 'toggle-fav' },
      { type: 'separator' },
      { label: 'Close', action: 'close' },
      { label: 'Close Others', action: 'close-others' },
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
        if (action === 'toggle-fav') {
          if (fav) await window.docket.removeFavorite(path);
          else await window.docket.addFavorite(path);
          appState = await window.docket.getState();
          renderTabStrip();
          renderSidebar();
          renderStatusBar();
        } else if (action === 'close') {
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

  function openOrSwitchAt(absolutePath) {
    const tabs = (appState.tabs || []).slice();
    const existing = tabs.findIndex((t) => t.absolutePath === absolutePath);
    if (existing !== -1) return { tabs, activeTabIndex: existing };
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
    if (s.status === 'downloading') return `↓ Downloading v${s.version}…`;
    if (s.status === 'ready') return `↻ Restart to install v${s.version}`;
    return '';
  }

  async function onUpdatePillClick() {
    if (!updateState) return;
    if (updateState.status === 'available') {
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
    tocs = await window.docket.getRootTocs();
    await renderBrowse();
    if (!currentPath) return;
    const isInAllFiles = allFiles.some((f) => f.absolutePath === currentPath);
    if (!isInAllFiles && !currentIsOutsideRoot) {
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
      content.innerHTML = `<div class="empty-state"><h1>File was moved or deleted</h1></div>`;
      currentPath = null;
      currentIsOutsideRoot = false;
      window.docket.setActivePath(null);
    }
  });

  window.docket.onConfigChange(async (newCfg) => {
    cfg = newCfg;
    allFiles = await window.docket.listAllFiles();
    tocs = await window.docket.getRootTocs();
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
