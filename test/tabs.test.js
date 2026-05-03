const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openOrSwitch, closeTab, reorderTabs } = require('../lib/tabs.js');

test('openOrSwitch on empty list creates a tab and selects it', () => {
  const r = openOrSwitch({ tabs: [], activeTabIndex: -1 }, '/a.md');
  assert.deepEqual(r.tabs, [{ absolutePath: '/a.md' }]);
  assert.equal(r.activeTabIndex, 0);
});

test('openOrSwitch on a path already open switches to it without duplicating', () => {
  const r = openOrSwitch({ tabs: [{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }], activeTabIndex: 0 }, '/b.md');
  assert.equal(r.tabs.length, 2);
  assert.equal(r.activeTabIndex, 1);
});

test('openOrSwitch on a new path appends and selects it', () => {
  const r = openOrSwitch({ tabs: [{ absolutePath: '/a.md' }], activeTabIndex: 0 }, '/b.md');
  assert.deepEqual(r.tabs.map((t) => t.absolutePath), ['/a.md', '/b.md']);
  assert.equal(r.activeTabIndex, 1);
});

test('closeTab removes the entry and adjusts activeTabIndex', () => {
  // Closing the active (middle) tab → activate the next one (which now sits at the same index).
  let r = closeTab({ tabs: [{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }, { absolutePath: '/c.md' }], activeTabIndex: 1 }, 1);
  assert.deepEqual(r.tabs.map((t) => t.absolutePath), ['/a.md', '/c.md']);
  assert.equal(r.activeTabIndex, 1); // /c.md is now at index 1

  // Closing the last (active) tab → activate the new last.
  r = closeTab({ tabs: [{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }], activeTabIndex: 1 }, 1);
  assert.equal(r.activeTabIndex, 0);

  // Closing a tab BEFORE the active → activeTabIndex shifts down by 1.
  r = closeTab({ tabs: [{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }, { absolutePath: '/c.md' }], activeTabIndex: 2 }, 0);
  assert.equal(r.activeTabIndex, 1);

  // Closing the only tab → empty list, activeTabIndex = -1.
  r = closeTab({ tabs: [{ absolutePath: '/a.md' }], activeTabIndex: 0 }, 0);
  assert.deepEqual(r.tabs, []);
  assert.equal(r.activeTabIndex, -1);
});

test('reorderTabs moves a tab and keeps active pointer on the same logical tab', () => {
  // Move /a.md (index 0) to index 2; active was on /b.md (index 1) → still /b.md after.
  const r = reorderTabs({ tabs: [{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }, { absolutePath: '/c.md' }], activeTabIndex: 1 }, 0, 2);
  assert.deepEqual(r.tabs.map((t) => t.absolutePath), ['/b.md', '/c.md', '/a.md']);
  assert.equal(r.activeTabIndex, 0); // /b.md moved from 1 to 0
});
