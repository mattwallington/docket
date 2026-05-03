const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveOpenRequest } = require('../lib/open-path.js');

const cfg = {
  roots: [
    { id: 'docs', path: '/Users/x/docs' },
    { id: 'projects', path: '/Users/x/.docket/projects' }
  ]
};

test('returns inRoot=true for paths inside a configured root', () => {
  const r = resolveOpenRequest('/Users/x/docs/readme.md', cfg);
  assert.equal(r.inRoot, true);
  assert.equal(r.absolutePath, '/Users/x/docs/readme.md');
  assert.equal(r.parentDir, '/Users/x/docs');
});

test('returns inRoot=true for deeply-nested paths inside a configured root', () => {
  const r = resolveOpenRequest('/Users/x/docs/sub/note.md', cfg);
  assert.equal(r.inRoot, true);
});

test('returns inRoot=false for paths outside all roots', () => {
  const r = resolveOpenRequest('/tmp/random.md', cfg);
  assert.equal(r.inRoot, false);
  assert.equal(r.parentDir, '/tmp');
});

test('rejects non-markdown extensions', () => {
  assert.throws(() => resolveOpenRequest('/Users/x/docs/image.png', cfg), /not a markdown file/i);
});

test('accepts .markdown extension', () => {
  const r = resolveOpenRequest('/Users/x/docs/note.markdown', cfg);
  assert.equal(r.inRoot, true);
});

test('resolves relative paths against the cwd argument', () => {
  const r = resolveOpenRequest('./note.md', cfg, { cwd: '/Users/x/docs' });
  assert.equal(r.absolutePath, '/Users/x/docs/note.md');
  assert.equal(r.inRoot, true);
});

test('handles trailing-separator edge case (path equals root not subpath)', () => {
  // /Users/x/docs2/foo.md should NOT match root /Users/x/docs
  const r = resolveOpenRequest('/Users/x/docs2/foo.md', cfg);
  assert.equal(r.inRoot, false);
});

test('accepts uppercase markdown extension', () => {
  const r = resolveOpenRequest('/Users/x/docs/NOTE.MD', cfg);
  assert.equal(r.inRoot, true);
});

test('relative paths fall back to process.cwd() when cwd option is omitted', () => {
  const r = resolveOpenRequest('./note.md', cfg);
  assert.equal(r.absolutePath, path.resolve(process.cwd(), 'note.md'));
});
