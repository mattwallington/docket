const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { walkRoot } = require('../lib/files.js');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-files-test-'));

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

function touch(relativePath, contents = '') {
  const full = path.join(TEST_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('walkRoot finds .md files recursively', async () => {
  touch('a.md');
  touch('sub/b.md');
  touch('sub/deeper/c.md');
  const { entries } = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  const paths = entries.map((e) => e.relativePath).sort();
  assert.deepEqual(paths, ['a.md', 'sub/b.md', 'sub/deeper/c.md']);
});

test('walkRoot skips non-.md files', async () => {
  touch('a.md');
  touch('b.txt');
  touch('c.json');
  const { entries } = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].relativePath, 'a.md');
});

test('walkRoot skips dotdirs and node_modules', async () => {
  touch('keep.md');
  touch('.git/hidden.md');
  touch('.hidden/nope.md');
  touch('node_modules/package/junk.md');
  const { entries } = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  const paths = entries.map((e) => e.relativePath);
  assert.deepEqual(paths, ['keep.md']);
});

test('walkRoot returns rootId, absolutePath, mtime, ctime, size', async () => {
  touch('x.md', 'hello');
  const { entries } = await walkRoot({ id: 'test-root', path: TEST_ROOT, label: 'X' });
  assert.equal(entries[0].rootId, 'test-root');
  assert.equal(entries[0].absolutePath, path.join(TEST_ROOT, 'x.md'));
  assert.equal(entries[0].size, 5);
  assert.ok(typeof entries[0].mtime === 'number');
  assert.ok(typeof entries[0].ctime === 'number');
});

test('walkRoot returns [] if root does not exist', async () => {
  const r = await walkRoot({ id: 'r', path: '/nonexistent/path', label: 'R' });
  assert.deepEqual(r.entries, []);
  assert.equal(r.status, 'missing');
});

test('walkRoot caps at 5000 files and returns capped flag', async () => {
  for (let i = 0; i < 5050; i++) touch(`f${i}.md`);
  const r = await walkRoot({ id: 'r', path: TEST_ROOT, label: 'R' });
  assert.equal(r.entries.length, 5000);
  assert.equal(r.capped, true);
  assert.equal(r.status, 'ok');
});

test('walkRoot reports status: missing when path does not exist', async () => {
  const r = await walkRoot({ id: 'r', path: '/nonexistent/definitely/not/here', label: 'R' });
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.entries, []);
  assert.equal(r.capped, false);
});
