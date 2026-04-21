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
