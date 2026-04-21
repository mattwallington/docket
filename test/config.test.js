const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Override config dir for tests
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-config-test-'));
process.env.DOCKET_HOME = TEST_HOME;

const config = require('../lib/config.js');

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

test('read() seeds default config on first run', async () => {
  const cfg = await config.read();
  assert.equal(cfg.roots.length, 1);
  assert.equal(cfg.roots[0].id, 'projects');
  assert.equal(cfg.roots[0].path, path.join(TEST_HOME, 'projects'));
  assert.equal(cfg.roots[0].label, 'Projects');
  assert.ok(fs.existsSync(path.join(TEST_HOME, 'docket.json')));
  assert.ok(fs.existsSync(path.join(TEST_HOME, 'projects')));
});

test('read() returns persisted config on subsequent calls', async () => {
  const cfg = await config.read();
  cfg.roots.push({ id: 'docs', path: '/Users/test/docs', label: 'Docs' });
  await config.write(cfg);
  const reloaded = await config.read();
  assert.equal(reloaded.roots.length, 2);
  assert.equal(reloaded.roots[1].path, '/Users/test/docs');
});

test('write() merges new fields without clobbering unrelated fields', async () => {
  await config.read();
  await config.write({ theme: 'dark' });
  const reloaded = await config.read();
  assert.equal(reloaded.theme, 'dark');
  assert.equal(reloaded.roots.length, 1);  // unchanged
});

test('read() handles malformed JSON by reseeding', async () => {
  fs.writeFileSync(path.join(TEST_HOME, 'docket.json'), '{not valid json');
  const cfg = await config.read();
  assert.equal(cfg.roots.length, 1);
  assert.equal(cfg.roots[0].id, 'projects');
});
