(() => {
  const REFRESH_MS = 30000;
  const SELECTED_KEY = 'docket:selected';
  const COLLAPSE_KEY = 'docket:collapsed-phases';
  const SIDEBAR_KEY = 'docket:sidebar-hidden';
  const AUTO_KEY = 'docket:auto-refresh';

  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarItems = document.getElementById('sidebar-items');
  const content = document.getElementById('content');
  const generated = document.getElementById('generated');
  const checkbox = document.getElementById('auto-refresh');
  const ring = document.getElementById('refresh-ring');
  const fill = document.getElementById('refresh-ring-fill');
  const circumference = 2 * Math.PI * 8;

  let dashboards = [];
  let currentSlug = null;

  marked.setOptions({ gfm: true, breaks: false });
  const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

  // --- Sidebar toggle ---
  if (localStorage.getItem(SIDEBAR_KEY) === 'true') sidebar.classList.add('hidden');
  sidebarToggle.addEventListener('click', () => {
    const hidden = sidebar.classList.toggle('hidden');
    localStorage.setItem(SIDEBAR_KEY, hidden);
  });

  // --- Dashboard list ---
  async function fetchList() {
    const res = await fetch('/api/dashboards');
    if (!res.ok) throw new Error('Failed to list dashboards');
    dashboards = await res.json();
  }

  function renderSidebar() {
    sidebarItems.innerHTML = '';
    if (!dashboards.length) {
      sidebarItems.innerHTML = '<div style="color: var(--muted); font-size: 12px;">No dashboards found.</div>';
      return;
    }
    for (const d of dashboards) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-item' + (d.status === 'archived' ? ' status-archived' : '');
      btn.dataset.slug = d.slug;
      btn.innerHTML = `
        <div class="sidebar-item-name">${escapeHTML(d.name)}</div>
        ${d.project ? `<div class="sidebar-item-project">${escapeHTML(d.project)}</div>` : ''}
        ${d.description ? `<div class="sidebar-item-desc">${escapeHTML(d.description)}</div>` : ''}
        <div class="sidebar-item-stats">${d.stats.done}/${d.stats.total} done</div>
      `;
      if (d.slug === currentSlug) btn.classList.add('active');
      btn.addEventListener('click', () => select(d.slug));
      sidebarItems.appendChild(btn);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // --- Dashboard view ---
  async function fetchDashboard(slug) {
    const res = await fetch(`/api/dashboards/${slug}`);
    if (!res.ok) throw new Error('Failed to load dashboard');
    return await res.text();
  }

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

  // Parse markdown body into a tree: { title, phases: [{ name, sections: [{ name, items: [task|prose] }] }] }
  function parseDashboard(body) {
    const lines = body.split('\n');
    const headingRe = /^(#{1,6})\s+(.*)$/;
    const taskRe = /^-\s+\[( |x)\]\s+\*\*([^*]+)\*\*(.*)$/;

    let title = 'Untitled';
    // Leading prose before first phase
    const lead = { type: 'prose', text: '' };
    const phases = [];
    let phase = null;
    let section = null;
    let proseBuffer = [];
    let items = () => section ? section.items : (phase ? phase.orphanItems : leadItems);
    const leadItems = [];

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

  function stableId(value) {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    }
    return 'id-' + (h >>> 0).toString(16);
  }

  function renderTaskRow(t) {
    const cls = t.status === 'done' ? 'done' : (t.blocked ? 'blocked' : 'pending');
    const icon = t.status === 'done' ? '✓' : (t.blocked ? '⏸' : '○');
    const noteHTML = t.note ? `<div class="note">${md(t.note)}</div>` : '';
    return `<li class="row ${cls}"><span class="icon">${icon}</span>
      <div class="content"><div class="title">${escapeHTML(t.title)}</div>${noteHTML}</div></li>`;
  }

  function renderItems(items) {
    // Group consecutive task items into <ul.task-list>; render prose as .prose
    const parts = [];
    let taskGroup = [];
    const flushTasks = () => {
      if (taskGroup.length) {
        parts.push(`<ul class="task-list">${taskGroup.map(renderTaskRow).join('')}</ul>`);
        taskGroup = [];
      }
    };
    for (const it of items) {
      if (it.type === 'task') taskGroup.push(it);
      else {
        flushTasks();
        parts.push(`<div class="prose">${md(it.text)}</div>`);
      }
    }
    flushTasks();
    return parts.join('');
  }

  function renderPhase(phase, phaseIdPrefix) {
    const phaseId = stableId(phaseIdPrefix + '::' + phase.name);
    const stats = phaseStats(phase);
    const sectionsHTML = [];
    if (phase.orphanItems.length) sectionsHTML.push(`<div class="section">${renderItems(phase.orphanItems)}</div>`);
    for (const s of phase.sections) {
      sectionsHTML.push(`<div class="section"><h3>${escapeHTML(s.name)}</h3>${renderItems(s.items)}</div>`);
    }
    return `<div class="phase" data-phase-id="${phaseId}">
      <button class="phase-header" type="button" aria-expanded="true">
        <span class="chevron" aria-hidden="true">▾</span>
        <h2>${escapeHTML(phase.name)}</h2>
        <div class="phase-stats">${stats.done}/${stats.total} done</div>
      </button>
      <div class="phase-body">${sectionsHTML.join('')}</div>
    </div>`;
  }

  function loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveCollapsed(set) {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  }

  function renderDashboard(slug, text) {
    const { meta, body } = parseFrontmatter(text);
    const parsed = parseDashboard(body);
    const stats = computeStats(parsed);
    const pct = stats.total ? Math.round(100 * stats.done / stats.total) : 0;
    const name = meta.name || parsed.title;
    const desc = meta.description ? `<p class="dashboard-desc">${escapeHTML(meta.description)}</p>` : '';
    const project = meta.project ? `<p class="dashboard-project">${escapeHTML(meta.project)}</p>` : '';
    const leadHTML = parsed.lead.length ? `<div class="lead">${renderItems(parsed.lead)}</div>` : '';
    const phasesHTML = parsed.phases.map((p) => renderPhase(p, slug)).join('');

    content.innerHTML = `
      <header class="dashboard-head">
        <h1>${escapeHTML(name)}</h1>
        ${desc}
        ${project}
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

    // Wire collapsibles, restoring state
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

    generated.textContent = `Loaded ${new Date().toLocaleTimeString()}`;
  }

  async function select(slug) {
    currentSlug = slug;
    localStorage.setItem(SELECTED_KEY, slug);
    document.querySelectorAll('.sidebar-item').forEach((i) => {
      i.classList.toggle('active', i.dataset.slug === slug);
    });
    try {
      const text = await fetchDashboard(slug);
      renderDashboard(slug, text);
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Failed to load</h1><p>${escapeHTML(String(e))}</p></div>`;
    }
  }

  async function refresh() {
    try {
      await fetchList();
      renderSidebar();
      if (currentSlug && dashboards.some((d) => d.slug === currentSlug)) {
        const text = await fetchDashboard(currentSlug);
        renderDashboard(currentSlug, text);
      } else if (dashboards.length) {
        const stored = localStorage.getItem(SELECTED_KEY);
        const target = dashboards.find((d) => d.slug === stored) ? stored : dashboards[0].slug;
        await select(target);
      } else {
        content.innerHTML = `<div class="empty-state"><h1>No dashboards yet</h1>
          <p>Add markdown files to <code>~/.docket/dashboards/</code>.</p></div>`;
      }
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Connection error</h1><p>${escapeHTML(String(e))}</p></div>`;
    }
  }

  // --- Auto refresh ring ---
  const storedRefresh = localStorage.getItem(AUTO_KEY);
  const enabled = storedRefresh === null ? true : storedRefresh === 'true';
  checkbox.checked = enabled;
  ring.classList.toggle('hidden', !enabled);

  let startTime = Date.now();
  let rafId = null;

  function tick() {
    if (!checkbox.checked) return;
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / REFRESH_MS, 1);
    fill.setAttribute('stroke-dashoffset', circumference * (1 - progress));
    if (progress >= 1) {
      startTime = Date.now();
      refresh().finally(() => { if (checkbox.checked) tick(); });
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function restartTimer() {
    if (rafId) cancelAnimationFrame(rafId);
    startTime = Date.now();
    fill.setAttribute('stroke-dashoffset', circumference);
    if (checkbox.checked) { ring.classList.remove('hidden'); tick(); }
    else ring.classList.add('hidden');
  }

  checkbox.addEventListener('change', () => {
    localStorage.setItem(AUTO_KEY, checkbox.checked);
    restartTimer();
  });

  refresh().then(restartTimer);
})();
