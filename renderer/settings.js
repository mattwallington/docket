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
        const removingId = cfg.roots[i].id;
        cfg.roots.splice(i, 1);
        cfg = await window.docket.updateConfig({ roots: cfg.roots });
        const s = await window.docket.getState();
        if (s.activeBrowseRoot === removingId) {
          await window.docket.setActiveBrowseRoot(null);
        }
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
    const s = await window.docket.getState();
    const voices = await loadVoices();
    const voiceOptions = ['<option value="">System default</option>']
      .concat(voices.map((v) => {
        const sel = s.voiceURI === v.voiceURI ? ' selected' : '';
        const lang = v.lang ? ` (${v.lang})` : '';
        return `<option value="${escapeHTML(v.voiceURI)}"${sel}>${escapeHTML(v.name)}${escapeHTML(lang)}</option>`;
      }))
      .join('');

    panes.appearance.innerHTML = `
      <h2>Appearance</h2>
      <label class="pref-row">Theme:
        <select id="theme-select">
          <option value="system"${cfg.theme === 'system' ? ' selected' : ''}>System</option>
          <option value="dark"${cfg.theme === 'dark' ? ' selected' : ''}>Dark</option>
          <option value="light"${cfg.theme === 'light' ? ' selected' : ''}>Light</option>
        </select>
      </label>
      <label class="pref-row">Default view:
        <select id="default-view-select">
          <option value="auto"${s.defaultView === 'auto' ? ' selected' : ''}>Auto (detect from content)</option>
          <option value="checklist"${s.defaultView === 'checklist' ? ' selected' : ''}>Checklist</option>
          <option value="markdown"${s.defaultView === 'markdown' ? ' selected' : ''}>Markdown</option>
        </select>
      </label>
      <p class="pref-hint">Per-document view (including Raw) is set via the view-mode button in the tab strip and lasts for this session only.</p>

      <h3 class="pref-section">Voice playback</h3>
      <label class="pref-row">Voice:
        <select id="voice-select">${voiceOptions}</select>
      </label>
      <label class="pref-row">Speech rate:
        <input type="range" id="rate-slider" min="0.5" max="2" step="0.1" value="${s.speechRate}">
        <span id="rate-display">${s.speechRate.toFixed(1)}x</span>
      </label>
      <div class="pref-row">
        <button type="button" id="voice-test" class="btn">Test voice</button>
        <span id="voice-test-status" class="pref-hint" style="margin-left: 8px;"></span>
      </div>
      <p class="pref-hint">For higher-quality voices, install Apple's premium voices in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices. Ava, Allison, and Evan (Premium) are dramatically better than the defaults.</p>
    `;

    panes.appearance.querySelector('#theme-select').addEventListener('change', async (e) => {
      cfg = await window.docket.updateConfig({ theme: e.target.value });
    });
    panes.appearance.querySelector('#default-view-select').addEventListener('change', async (e) => {
      await window.docket.setDefaultView(e.target.value);
    });
    panes.appearance.querySelector('#voice-select').addEventListener('change', async (e) => {
      await window.docket.setVoiceURI(e.target.value || null);
    });
    const rateSlider = panes.appearance.querySelector('#rate-slider');
    const rateDisplay = panes.appearance.querySelector('#rate-display');
    rateSlider.addEventListener('input', () => {
      rateDisplay.textContent = `${Number(rateSlider.value).toFixed(1)}x`;
    });
    rateSlider.addEventListener('change', async () => {
      await window.docket.setSpeechRate(Number(rateSlider.value));
    });
    panes.appearance.querySelector('#voice-test').addEventListener('click', async () => {
      const fresh = await window.docket.getState();
      const sample = 'This is a test of the selected voice and speech rate.';
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(sample);
      u.rate = fresh.speechRate || 1;
      if (fresh.voiceURI) {
        const allVoices = synth.getVoices();
        const found = allVoices.find((v) => v.voiceURI === fresh.voiceURI);
        if (found) u.voice = found;
      }
      synth.speak(u);
    });
  }

  function loadVoices() {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      let voices = synth.getVoices();
      if (voices.length) { resolve(voices); return; }
      // Voices may load async; wait once.
      const handler = () => {
        synth.removeEventListener('voiceschanged', handler);
        resolve(synth.getVoices());
      };
      synth.addEventListener('voiceschanged', handler);
      // Fallback timeout in case voiceschanged doesn't fire.
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', handler);
        resolve(synth.getVoices());
      }, 1000);
    });
  }

  let localUpdateState = null;
  let unsubscribeUpdateState = null;

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
      <div id="update-action" class="update-row"></div>
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

    document.getElementById('auto-check').addEventListener('change', async (e) => {
      await window.docket.setAutoCheck(e.target.checked);
    });
    document.getElementById('allow-prerelease').addEventListener('change', async (e) => {
      await window.docket.setAllowPrerelease(e.target.checked);
    });

    renderUpdateAction(v.version);

    // Subscribe once. Tear down any prior subscription to avoid duplicates.
    if (unsubscribeUpdateState) { unsubscribeUpdateState(); unsubscribeUpdateState = null; }
    if (window.docket.onUpdateState) {
      unsubscribeUpdateState = window.docket.onUpdateState((payload) => {
        localUpdateState = payload;
        renderUpdateAction(v.version);
      });
    }
  }

  function renderUpdateAction(currentVersion) {
    const el = document.getElementById('update-action');
    if (!el) return;
    const s = localUpdateState;
    let html;

    if (!s || s.status === 'none' || !s.status) {
      // Default state — show the manual check button
      html = `
        <button type="button" id="check-updates" class="update-btn">Check for updates…</button>
        <span id="update-status" class="update-status"></span>
      `;
    } else if (s.status === 'available') {
      html = `
        <button type="button" id="action-download" class="update-btn primary">↓ Download v${escapeHTML(s.version)}</button>
      `;
    } else if (s.status === 'downloading') {
      const pct = typeof s.percent === 'number' ? Math.round(s.percent) : null;
      const speed = typeof s.bytesPerSecond === 'number' ? formatBytesPerSec(s.bytesPerSecond) : null;
      let label = '↓ Downloading…';
      if (pct !== null && speed) label = `↓ Downloading ${pct}% (${escapeHTML(speed)})`;
      else if (pct !== null) label = `↓ Downloading ${pct}%`;
      html = `<button type="button" class="update-btn primary" disabled>${label}</button>`;
    } else if (s.status === 'ready') {
      html = `
        <button type="button" id="action-install" class="update-btn primary">↻ Restart to install v${escapeHTML(s.version)}</button>
      `;
    } else if (s.status === 'error') {
      html = `
        <button type="button" id="action-retry" class="update-btn error">⚠ Download failed — Retry</button>
      `;
    } else {
      html = `
        <button type="button" id="check-updates" class="update-btn">Check for updates…</button>
        <span id="update-status" class="update-status"></span>
      `;
    }

    el.innerHTML = html;

    // Wire whichever buttons are present
    const checkBtn = document.getElementById('check-updates');
    if (checkBtn) {
      const statusEl = document.getElementById('update-status');
      checkBtn.addEventListener('click', async () => {
        if (statusEl) statusEl.textContent = 'Checking…';
        const r = await window.docket.checkForUpdates();
        if (!r.ok) {
          if (statusEl) statusEl.textContent = 'Error: ' + r.error;
          return;
        }
        if (!r.updateInfo || r.updateInfo.version === currentVersion) {
          if (statusEl) statusEl.textContent = 'Up to date.';
        }
        // If an update IS available, the main process emits an `update-available`
        // event whose listener calls broadcastUpdateState — our subscription above
        // catches it and re-renders this area as a Download button.
      });
    }
    const downloadBtn = document.getElementById('action-download') || document.getElementById('action-retry');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        await window.docket.downloadUpdate();
      });
    }
    const installBtn = document.getElementById('action-install');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        await window.docket.installUpdate();
      });
    }
  }

  function formatBytesPerSec(bps) {
    if (!bps || bps < 1024) return `${Math.round(bps || 0)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
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
