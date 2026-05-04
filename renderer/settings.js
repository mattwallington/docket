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
    const s = await window.docket.getState();
    const lastCheckedText = s.lastUpdateCheck
      ? formatRelative(s.lastUpdateCheck)
      : 'never';

    panes.about.innerHTML = `
      <h2>About</h2>
      <div class="about-line"><span class="label">Version</span>${escapeHTML(v.version)}</div>
      <div class="about-line"><span class="label">Channel</span>${escapeHTML(v.channel)}</div>
      ${v.buildDate ? `<div class="about-line"><span class="label">Build date</span>${escapeHTML(v.buildDate)}</div>` : ''}
      <div class="about-line"><span class="label">Last checked</span>${escapeHTML(lastCheckedText)}</div>
      <div class="update-row">
        <button type="button" id="check-updates" class="update-btn">Check for updates…</button>
        <span id="update-status" class="update-status"></span>
      </div>
      <div class="prefs-block" style="margin-top: 24px;">
        <label class="pref-toggle">
          <input type="checkbox" id="auto-check" ${s.autoCheck ? 'checked' : ''}>
          Automatically check for updates
        </label>
        <label class="pref-toggle">
          <input type="checkbox" id="allow-prerelease" ${s.allowPrerelease ? 'checked' : ''}>
          Include pre-release builds (dev channel)
        </label>
      </div>
    `;
    const statusEl = document.getElementById('update-status');
    document.getElementById('check-updates').addEventListener('click', async () => {
      statusEl.textContent = 'Checking…';
      const r = await window.docket.checkForUpdates();
      await window.docket.setLastUpdateCheck(Date.now());
      if (!r.ok) { statusEl.textContent = 'Error: ' + r.error; return; }
      if (!r.updateInfo || r.updateInfo.version === v.version) {
        statusEl.textContent = 'Up to date.';
      } else {
        statusEl.textContent = `v${r.updateInfo.version} available`;
      }
      // Re-render to update the "Last checked" line
      renderAbout();
    });
    document.getElementById('auto-check').addEventListener('change', async (e) => {
      await window.docket.setAutoCheck(e.target.checked);
    });
    document.getElementById('allow-prerelease').addEventListener('change', async (e) => {
      await window.docket.setAllowPrerelease(e.target.checked);
    });
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
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  renderRoots();
  renderAppearance();
  renderAbout();
})();
