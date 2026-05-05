const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toggleCheckboxInBody } = require('../lib/checkbox-toggle.js');

test('flips [ ] to [x] at the right lineIndex', () => {
  const body = '- [ ] **A**\n- [ ] **B**\n- [ ] **C**\n';
  const result = toggleCheckboxInBody(body, 1, true);
  assert.equal(result, '- [ ] **A**\n- [x] **B**\n- [ ] **C**\n');
});

test('flips [x] to [ ] at the right lineIndex', () => {
  const body = '- [x] **A**\n- [x] **B**\n';
  const result = toggleCheckboxInBody(body, 0, false);
  assert.equal(result, '- [ ] **A**\n- [x] **B**\n');
});

test('idempotent when target matches current state', () => {
  const body = '- [ ] **A**\n';
  const result = toggleCheckboxInBody(body, 0, false);
  assert.equal(result, body);
});

test('preserves indented continuation lines under the target task', () => {
  const body = '- [ ] **A**\n    instructions\n    more\n- [ ] **B**\n';
  const result = toggleCheckboxInBody(body, 0, true);
  assert.equal(result, '- [x] **A**\n    instructions\n    more\n- [ ] **B**\n');
});

test('throws on out-of-range lineIndex', () => {
  assert.throws(() => toggleCheckboxInBody('- [ ] **A**\n', 5, true), /lineIndex out of range/);
  assert.throws(() => toggleCheckboxInBody('- [ ] **A**\n', -1, true), /lineIndex out of range/);
});

test('preserves CRLF line endings if present', () => {
  const body = '- [ ] **A**\r\n- [ ] **B**\r\n';
  const result = toggleCheckboxInBody(body, 1, true);
  assert.equal(result, '- [ ] **A**\r\n- [x] **B**\r\n');
});
