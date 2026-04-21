const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { searchContent, cancelSearch } = require('../lib/search.js');

let TEST_ROOT;

beforeEach(() => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-search-test-'));
});

function touch(relativePath, contents) {
  const full = path.join(TEST_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('searchContent finds substring matches', async () => {
  touch('a.md', 'hello world\nanother line\n');
  touch('b.md', 'nothing interesting here\n');
  const hits = await searchContent('hello', [TEST_ROOT]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].absolutePath, path.join(TEST_ROOT, 'a.md'));
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].snippet, /hello world/);
});

test('searchContent is case-insensitive', async () => {
  touch('a.md', 'Hello World\n');
  const hits = await searchContent('HELLO', [TEST_ROOT]);
  assert.equal(hits.length, 1);
});

test('searchContent returns empty array for no matches', async () => {
  touch('a.md', 'nothing here\n');
  const hits = await searchContent('missing-term', [TEST_ROOT]);
  assert.deepEqual(hits, []);
});

test('searchContent returns empty array for empty query', async () => {
  touch('a.md', 'nothing here\n');
  const hits = await searchContent('', [TEST_ROOT]);
  assert.deepEqual(hits, []);
});

test('searchContent caps at 50 hits total', async () => {
  let content = '';
  for (let i = 0; i < 100; i++) content += `match ${i}\n`;
  touch('a.md', content);
  const hits = await searchContent('match', [TEST_ROOT]);
  assert.ok(hits.length <= 50);
});
