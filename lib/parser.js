// UMD-style so this file works in Node (tests, main process) and as a
// classic <script> in the renderer.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== 'undefined') {
    window.docketParser = mod;
  }
}(typeof self !== 'undefined' ? self : this, function () {

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
    const body = lines.slice(end + 1).join('\n').trim() + '\n';
    return { meta, body };
  }

  function parseChecklist(body) {
    const lines = body.split('\n');
    const headingRe = /^(#{1,6})\s+(.*)$/;
    const taskRe = /^-\s+\[( |x)\]\s+\*\*([^*]+)\*\*(.*)$/;
    const indentedRe = /^(\s{2,}|\t)/;

    let title = 'Untitled';
    const leadItems = [];
    const phases = [];
    let phase = null;
    let section = null;
    let proseBuffer = [];

    function flushProse() {
      if (!proseBuffer.length) return;
      const text = proseBuffer.join('\n').trim();
      proseBuffer = [];
      if (!text) return;
      const target = section ? section.items : (phase ? phase.orphanItems : leadItems);
      target.push({ type: 'prose', text });
    }

    function stripCommonIndent(block) {
      const arr = block.slice();
      let minIndent = Infinity;
      for (const l of arr) {
        if (!l.trim()) continue;
        const m = l.match(/^(\s*)/);
        minIndent = Math.min(minIndent, m[1].length);
      }
      if (!isFinite(minIndent) || minIndent === 0) return arr.join('\n');
      return arr.map((l) => l.startsWith(' '.repeat(minIndent)) ? l.slice(minIndent) : l).join('\n');
    }

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
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
        i++;
        continue;
      }
      const t = line.match(taskRe);
      if (t) {
        flushProse();
        const status = t[1] === 'x' ? 'done' : 'pending';
        const titleText = t[2].trim().replace(/\.$/, '');
        const rest = (t[3] || '').trim();
        const inlineNote = rest.replace(/^—\s*/, '').replace(/^-\s*/, '').trim();
        const lower = rest.toLowerCase();

        // Lookahead: collect indented continuation lines (incl. blank lines
        // sandwiched between indented blocks). Stop at top-level content.
        const contLines = [];
        let j = i + 1;
        while (j < lines.length) {
          const lh = lines[j];
          if (lh.trim() === '') {
            let k = j + 1;
            while (k < lines.length && lines[k].trim() === '') k++;
            if (k < lines.length && indentedRe.test(lines[k])) {
              for (let b = j; b < k; b++) contLines.push(lines[b]);
              j = k;
              continue;
            }
            break;
          }
          if (!indentedRe.test(lh)) break;
          contLines.push(lh);
          j++;
        }

        const contBlock = contLines.length ? stripCommonIndent(contLines).replace(/\s+$/, '') : '';
        const note = contBlock
          ? (inlineNote ? inlineNote + '\n\n' + contBlock : contBlock)
          : inlineNote;

        const blockedHaystack = (lower + ' ' + contBlock).toLowerCase();
        const blocked = status === 'pending' && (
          blockedHaystack.includes('blocked') ||
          blockedHaystack.includes('e2e pending') ||
          (section && section.name.toLowerCase().includes('blocked'))
        ) ? true : false;

        const item = { type: 'task', status, title: titleText, note, blocked };
        if (section) section.items.push(item);
        else if (phase) phase.orphanItems.push(item);
        else leadItems.push(item);
        i = j;
        continue;
      }
      proseBuffer.push(line);
      i++;
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

  function detectViewMode({ meta, body }) {
    if (meta && (meta.name || meta.description || meta.project || meta.repo || meta.status)) {
      return 'checklist';
    }
    if (/^-\s+\[[ x]\]\s+/m.test(body)) return 'checklist';
    return 'markdown';
  }

  function stableId(value) {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    }
    return 'id-' + (h >>> 0).toString(16);
  }

  return { parseFrontmatter, parseChecklist, computeStats, phaseStats, detectViewMode, stableId };
}));
