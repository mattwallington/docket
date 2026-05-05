const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parser = require('../lib/parser.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('parseFrontmatter extracts YAML-like header', () => {
  const text = fixture('checklist.md');
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(meta.name, 'Sample Rollout');
  assert.equal(meta.description, 'Testing fixture');
  assert.equal(meta.project, 'test-repo');
  assert.equal(meta.status, 'active');
  assert.match(body, /^# Sample Rollout/);
});

test('parseFrontmatter returns empty meta when absent', () => {
  const text = fixture('plain.md');
  const { meta, body } = parser.parseFrontmatter(text);
  assert.deepEqual(meta, {});
  assert.equal(body, text);
});

test('parseFrontmatter handles missing close delimiter', () => {
  const text = '---\nname: broken\nno close delimiter\n\n# Body';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.deepEqual(meta, {});
  assert.equal(body, text);
});

test('parseChecklist extracts title, phases, sections, tasks', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  assert.equal(parsed.title, 'Sample Rollout');
  assert.equal(parsed.phases.length, 2);
  const p1 = parsed.phases[0];
  assert.equal(p1.name, 'Phase 1 — Setup');
  assert.equal(p1.orphanItems.filter((i) => i.type === 'task').length, 3);
  assert.equal(p1.sections.length, 1);
  assert.equal(p1.sections[0].name, 'Subsection');
});

test('parseChecklist marks done vs pending vs blocked', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  const tasks = parsed.phases[0].orphanItems.filter((i) => i.type === 'task');
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[0].blocked, false);
  assert.equal(tasks[1].status, 'pending');
  assert.equal(tasks[1].blocked, false);
  assert.equal(tasks[2].status, 'pending');
  assert.equal(tasks[2].blocked, true);
});

test('detectViewMode returns checklist when frontmatter has name', () => {
  const { meta, body } = parser.parseFrontmatter(fixture('checklist.md'));
  assert.equal(parser.detectViewMode({ meta, body }), 'checklist');
});

test('detectViewMode returns markdown for plain file', () => {
  const { meta, body } = parser.parseFrontmatter(fixture('plain.md'));
  assert.equal(parser.detectViewMode({ meta, body }), 'markdown');
});

test('detectViewMode returns checklist when body has unchecked tasks', () => {
  const text = '# No Frontmatter\n\n- [ ] a task\n';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(parser.detectViewMode({ meta, body }), 'checklist');
});

test('computeStats totals done/pending/blocked', () => {
  const text = fixture('checklist.md');
  const { body } = parser.parseFrontmatter(text);
  const parsed = parser.parseChecklist(body);
  const stats = parser.computeStats(parsed);
  assert.equal(stats.total, 5);
  assert.equal(stats.done, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.pending, 3);
});

test('parseFrontmatter recovers gracefully from lines without colons', () => {
  const text = '---\nname: test\nweird-line-without-colon\n---\n# Body';
  const { meta, body } = parser.parseFrontmatter(text);
  assert.equal(meta.name, 'test');
  assert.match(body, /^# Body/);
});

test('parseChecklist captures indented sub-bullets as task note', () => {
  const body = [
    '## Phase 1',
    '',
    '- [x] **1. Net-new customer — organic signup**',
    '  - URL: `auth.example.com/`',
    '  - Expected: signup → verify',
    '  - *Done: tester@example.com*',
    '',
    '- [ ] **2. Next task**',
    '  - URL: `auth.example.com/?invite=X`',
    ''
  ].join('\n');
  const parsed = parser.parseChecklist(body);
  const tasks = parsed.phases[0].orphanItems.filter((it) => it.type === 'task');
  assert.equal(tasks.length, 2);
  assert.match(tasks[0].note, /URL: `auth\.example\.com\/`/);
  assert.match(tasks[0].note, /Expected: signup → verify/);
  assert.match(tasks[0].note, /\*Done: tester@example\.com\*/);
  // No dedent leftover indentation
  assert.ok(!tasks[0].note.startsWith('  '));
  assert.match(tasks[1].note, /URL: `auth\.example\.com\/\?invite=X`/);
});

test('parseChecklist keeps inline note AND indented continuation', () => {
  const body = [
    '- [ ] **Task** — inline rest',
    '  - sub bullet',
    ''
  ].join('\n');
  const parsed = parser.parseChecklist(body);
  const task = parsed.lead[0];
  assert.equal(task.type, 'task');
  assert.match(task.note, /^inline rest/);
  assert.match(task.note, /- sub bullet/);
});

test('parseChecklist does not swallow following top-level content into task note', () => {
  const body = [
    '- [ ] **Task**',
    '  - sub',
    '',
    'Top-level paragraph after.',
    ''
  ].join('\n');
  const parsed = parser.parseChecklist(body);
  assert.equal(parsed.lead[0].type, 'task');
  assert.match(parsed.lead[0].note, /- sub/);
  // Top-level paragraph goes to proseBuffer, rendered as prose
  const prose = parsed.lead.filter((it) => it.type === 'prose');
  assert.equal(prose.length, 1);
  assert.match(prose[0].text, /Top-level paragraph/);
});

test('parseChecklist exposes inlineNote and instructions separately', () => {
  const text = `# Plan
- [ ] **1. Run migrations** — pending
    Open psql at db.example.com.
    Run BEGIN, paste the script, COMMIT.
- [x] **2. Done thing** — passed Apr 20
- [ ] **3. No details**
`;
  const { phases, lead } = parser.parseChecklist(text);
  const tasks = lead;
  assert.equal(tasks[0].inlineNote, 'pending');
  assert.equal(tasks[0].instructions, 'Open psql at db.example.com.\nRun BEGIN, paste the script, COMMIT.');
  assert.equal(tasks[1].inlineNote, 'passed Apr 20');
  assert.equal(tasks[1].instructions, '');
  assert.equal(tasks[2].inlineNote, '');
  assert.equal(tasks[2].instructions, '');
});

test('parseChecklist preserves task.note as concatenated for back-compat', () => {
  const text = `# Plan
- [ ] **1. Mixed** — short note
    longer detail line
`;
  const { lead } = parser.parseChecklist(text);
  assert.equal(lead[0].note, 'short note\n\nlonger detail line');
});

test('parseChecklist emits 0-based lineIndex per task across phases', () => {
  const text = `# Plan
- [ ] **A**
- [x] **B**

## Phase 1
- [ ] **C**

## Phase 2
- [ ] **D**
- [x] **E**
`;
  const { lead, phases } = parser.parseChecklist(text);
  assert.equal(lead[0].lineIndex, 0); // A
  assert.equal(lead[1].lineIndex, 1); // B
  assert.equal(phases[0].orphanItems[0].lineIndex, 2); // C
  assert.equal(phases[1].orphanItems[0].lineIndex, 3); // D
  assert.equal(phases[1].orphanItems[1].lineIndex, 4); // E
});
