const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-state-test-'));
process.env.DOCKET_HOME = TEST_HOME;

const state = require('../lib/state.js');

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

test('read() returns empty state on first run', async () => {
  const s = await state.read();
  assert.deepEqual(s.recents, []);
  assert.deepEqual(s.overrides, {});
  assert.equal(s.sortBy, 'name');
});

test('write() persists partial updates', async () => {
  await state.write({ recents: [{ absolutePath: '/a.md', openedAt: 1 }] });
  const s = await state.read();
  assert.equal(s.recents.length, 1);
  assert.equal(s.recents[0].absolutePath, '/a.md');
});

test('addRecent() caps at 10 and moves repeats to front', async () => {
  for (let i = 0; i < 12; i++) {
    await state.addRecent(`/file${i}.md`);
  }
  let s = await state.read();
  assert.equal(s.recents.length, 10);
  assert.equal(s.recents[0].absolutePath, '/file11.md');
  await state.addRecent('/file5.md');
  s = await state.read();
  assert.equal(s.recents[0].absolutePath, '/file5.md');
  assert.equal(s.recents.length, 10);
});

test('setOverride persists per-file view mode', async () => {
  await state.setOverride('/x.md', 'markdown');
  const s = await state.read();
  assert.equal(s.overrides['/x.md'], 'markdown');
});

test('clearOverride removes entry', async () => {
  await state.setOverride('/x.md', 'markdown');
  await state.clearOverride('/x.md');
  const s = await state.read();
  assert.equal(s.overrides['/x.md'], undefined);
});

test('setSortBy persists valid values', async () => {
  await state.setSortBy('modified');
  let s = await state.read();
  assert.equal(s.sortBy, 'modified');
  await state.setSortBy('name');
  s = await state.read();
  assert.equal(s.sortBy, 'name');
});

test('setSortBy rejects invalid values', async () => {
  await assert.rejects(() => state.setSortBy('random'), /Invalid sortBy/);
});

test('removeRecent drops the matching path', async () => {
  await state.addRecent('/a.md');
  await state.addRecent('/b.md');
  await state.removeRecent('/a.md');
  const s = await state.read();
  assert.equal(s.recents.length, 1);
  assert.equal(s.recents[0].absolutePath, '/b.md');
});

test('addFavorite appends and dedupes; removeFavorite drops', async () => {
  await state.addFavorite('/x.md');
  await state.addFavorite('/x.md'); // dedupe
  await state.addFavorite('/y.md');
  let s = await state.read();
  assert.equal(s.favorites.length, 2);
  assert.equal(s.favorites[0].absolutePath, '/x.md');
  assert.equal(s.favorites[1].absolutePath, '/y.md');
  await state.removeFavorite('/x.md');
  s = await state.read();
  assert.equal(s.favorites.length, 1);
  assert.equal(s.favorites[0].absolutePath, '/y.md');
});

test('defaultState exposes favorites array', async () => {
  const s = await state.read();
  assert.deepEqual(s.favorites, []);
});
