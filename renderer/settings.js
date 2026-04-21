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
