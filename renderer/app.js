(async () => {
  const browse = document.getElementById('sidebar-browse');
  const content = document.getElementById('content');

  const cfg = await window.docket.getConfig();
  const allFiles = await window.docket.listAllFiles();

  function render() {
    const byRoot = new Map();
    for (const e of allFiles) {
      if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, []);
      byRoot.get(e.rootId).push(e);
    }
    const parts = [];
    for (const root of cfg.roots) {
      const files = (byRoot.get(root.id) || []).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      parts.push(`<details open class="root"><summary>${escapeHTML(root.label)}</summary><ul class="file-list">`);
      for (const f of files) {
        parts.push(`<li><button type="button" data-path="${escapeHTML(f.absolutePath)}">${escapeHTML(f.relativePath)}</button></li>`);
      }
      parts.push('</ul></details>');
    }
    browse.innerHTML = parts.join('');
    browse.querySelectorAll('button[data-path]').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });
  }

  async function openFile(absolutePath) {
    try {
      const text = await window.docket.readFile(absolutePath);
      content.innerHTML = `<pre style="padding:16px; white-space:pre-wrap">${escapeHTML(text)}</pre>`;
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><h1>Error</h1><p>${escapeHTML(String(e))}</p></div>`;
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  render();
})();
