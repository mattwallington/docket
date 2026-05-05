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

test('setDocScale clamps and persists', async () => {
  await state.setDocScale(1.2);
  let s = await state.read();
  assert.equal(s.docScale, 1.2);
  await state.setDocScale(5); // clamped to max 1.6
  s = await state.read();
  assert.equal(s.docScale, 1.6);
  await state.setDocScale(0.1); // clamped to min 0.7
  s = await state.read();
  assert.equal(s.docScale, 0.7);
});

test('setDocScale rejects non-numeric input', async () => {
  await assert.rejects(() => state.setDocScale('big'), /Invalid docScale/);
});

test('setSearchMode persists whitelisted values', async () => {
  await state.setSearchMode('filename');
  let s = await state.read();
  assert.equal(s.searchMode, 'filename');
  await state.setSearchMode('contents');
  s = await state.read();
  assert.equal(s.searchMode, 'contents');
});

test('setSearchMode rejects invalid values', async () => {
  await assert.rejects(() => state.setSearchMode('bogus'), /Invalid searchMode/);
});

test('defaultState sets searchMode to contents', async () => {
  const s = await state.read();
  assert.equal(s.searchMode, 'contents');
});

test('defaultState exposes new section fields', async () => {
  const s = await state.read();
  assert.deepEqual(s.sectionOrder, ['favorites', 'recents', 'browse']);
  assert.deepEqual(s.collapsedSections, {});
  assert.deepEqual(s.favoritesOrder, []);
});

test('setSectionOrder persists a valid order', async () => {
  await state.setSectionOrder(['recents', 'favorites', 'browse']);
  const s = await state.read();
  assert.deepEqual(s.sectionOrder, ['recents', 'favorites', 'browse']);
});

test('setSectionOrder rejects unknown section ids', async () => {
  await assert.rejects(() => state.setSectionOrder(['bogus']), /Invalid section/);
});

test('setSectionOrder rejects non-array input', async () => {
  await assert.rejects(() => state.setSectionOrder('toc'), /Invalid section/);
});

test('setSectionCollapsed persists per-section flag', async () => {
  await state.setSectionCollapsed('recents', true);
  let s = await state.read();
  assert.equal(s.collapsedSections.recents, true);
  await state.setSectionCollapsed('recents', false);
  s = await state.read();
  assert.equal(s.collapsedSections.recents, false);
});

test('setSectionCollapsed rejects unknown section ids', async () => {
  await assert.rejects(() => state.setSectionCollapsed('bogus', true), /Invalid section/);
});

test('setFavoritesOrder persists provided order', async () => {
  await state.setFavoritesOrder(['/b.md', '/a.md', '/c.md']);
  const s = await state.read();
  assert.deepEqual(s.favoritesOrder, ['/b.md', '/a.md', '/c.md']);
});

test('setFavoritesOrder rejects non-array input', async () => {
  await assert.rejects(() => state.setFavoritesOrder('a'), /Invalid favoritesOrder/);
});

test('setSectionOrder rejects duplicate ids', async () => {
  await assert.rejects(() => state.setSectionOrder(['browse', 'browse', 'favorites']), /Invalid section/);
});

test('setSectionCollapsed preserves other keys when updating one section', async () => {
  await state.setSectionCollapsed('recents', true);
  await state.setSectionCollapsed('favorites', true);
  await state.setSectionCollapsed('recents', false);
  const s = await state.read();
  assert.equal(s.collapsedSections.recents, false);
  assert.equal(s.collapsedSections.favorites, true);
});

test('setSectionOrder rejects empty arrays', async () => {
  await assert.rejects(() => state.setSectionOrder([]), /must not be empty/);
});

test('defaultState exposes tabs and activeTabIndex', async () => {
  const s = await state.read();
  assert.deepEqual(s.tabs, []);
  assert.equal(s.activeTabIndex, -1);
});

test('setTabs persists a valid tab list', async () => {
  await state.setTabs([{ absolutePath: '/a.md' }, { absolutePath: '/b.md', scrollTop: 120 }]);
  const s = await state.read();
  assert.equal(s.tabs.length, 2);
  assert.equal(s.tabs[0].absolutePath, '/a.md');
  assert.equal(s.tabs[1].scrollTop, 120);
});

test('setTabs rejects non-array', async () => {
  await assert.rejects(() => state.setTabs('foo'), /Invalid tabs/);
});

test('setTabs rejects entries missing absolutePath', async () => {
  await assert.rejects(() => state.setTabs([{ scrollTop: 0 }]), /Invalid tabs/);
});

test('setActiveTabIndex persists and accepts -1', async () => {
  await state.setTabs([{ absolutePath: '/a.md' }, { absolutePath: '/b.md' }]);
  await state.setActiveTabIndex(1);
  let s = await state.read();
  assert.equal(s.activeTabIndex, 1);
  await state.setActiveTabIndex(-1);
  s = await state.read();
  assert.equal(s.activeTabIndex, -1);
});

test('setActiveTabIndex rejects non-integer', async () => {
  await assert.rejects(() => state.setActiveTabIndex('1'), /Invalid activeTabIndex/);
  await assert.rejects(() => state.setActiveTabIndex(1.5), /Invalid activeTabIndex/);
});

test('defaultState exposes update prefs with sensible defaults', async () => {
  const s = await state.read();
  assert.equal(s.autoCheck, true);
  assert.equal(s.allowPrerelease, false);
  assert.equal(s.lastUpdateCheck, null);
});

test('setAutoCheck persists boolean', async () => {
  await state.setAutoCheck(false);
  let s = await state.read();
  assert.equal(s.autoCheck, false);
  await state.setAutoCheck(true);
  s = await state.read();
  assert.equal(s.autoCheck, true);
});

test('setAutoCheck coerces to boolean', async () => {
  await state.setAutoCheck(1);
  const s = await state.read();
  assert.strictEqual(s.autoCheck, true);
});

test('setAllowPrerelease persists boolean', async () => {
  await state.setAllowPrerelease(true);
  const s = await state.read();
  assert.equal(s.allowPrerelease, true);
});

test('setLastUpdateCheck accepts integer timestamps', async () => {
  await state.setLastUpdateCheck(1700000000000);
  const s = await state.read();
  assert.equal(s.lastUpdateCheck, 1700000000000);
});

test('setLastUpdateCheck accepts null to clear', async () => {
  await state.setLastUpdateCheck(1700000000000);
  await state.setLastUpdateCheck(null);
  const s = await state.read();
  assert.equal(s.lastUpdateCheck, null);
});

test('setLastUpdateCheck rejects non-integer non-null', async () => {
  await assert.rejects(() => state.setLastUpdateCheck('not a number'), /Invalid lastUpdateCheck/);
  await assert.rejects(() => state.setLastUpdateCheck(1.5), /Invalid lastUpdateCheck/);
});

test('defaultState exposes defaultView=auto and activeBrowseRoot=null', async () => {
  const s = await state.read();
  assert.equal(s.defaultView, 'auto');
  assert.equal(s.activeBrowseRoot, null);
});

test('defaultState no longer exposes overrides', async () => {
  const s = await state.read();
  assert.equal(s.overrides, undefined);
});

test('setDefaultView accepts auto|checklist|markdown', async () => {
  await state.setDefaultView('checklist');
  let s = await state.read();
  assert.equal(s.defaultView, 'checklist');
  await state.setDefaultView('markdown');
  s = await state.read();
  assert.equal(s.defaultView, 'markdown');
  await state.setDefaultView('auto');
  s = await state.read();
  assert.equal(s.defaultView, 'auto');
});

test('setDefaultView rejects unknown values', async () => {
  await assert.rejects(() => state.setDefaultView('raw'), /Invalid defaultView/);
  await assert.rejects(() => state.setDefaultView(''), /Invalid defaultView/);
});

test('setActiveBrowseRoot accepts string or null', async () => {
  await state.setActiveBrowseRoot('docs');
  let s = await state.read();
  assert.equal(s.activeBrowseRoot, 'docs');
  await state.setActiveBrowseRoot(null);
  s = await state.read();
  assert.equal(s.activeBrowseRoot, null);
});

test('setActiveBrowseRoot rejects non-string non-null', async () => {
  await assert.rejects(() => state.setActiveBrowseRoot(42), /Invalid activeBrowseRoot/);
});

test('setTabs accepts isPreview on entries', async () => {
  await state.setTabs([{ absolutePath: '/a.md', isPreview: true }]);
  const s = await state.read();
  assert.equal(s.tabs[0].isPreview, true);
});

test('defaultState exposes voiceURI=null and speechRate=1', async () => {
  const s = await state.read();
  assert.equal(s.voiceURI, null);
  assert.equal(s.speechRate, 1);
});

test('setVoiceURI accepts string or null', async () => {
  await state.setVoiceURI('com.apple.speech.synthesis.voice.ava.premium');
  let s = await state.read();
  assert.equal(s.voiceURI, 'com.apple.speech.synthesis.voice.ava.premium');
  await state.setVoiceURI(null);
  s = await state.read();
  assert.equal(s.voiceURI, null);
});

test('setVoiceURI rejects non-string non-null', async () => {
  await assert.rejects(() => state.setVoiceURI(42), /Invalid voiceURI/);
});

test('setSpeechRate clamps and persists', async () => {
  await state.setSpeechRate(1.5);
  let s = await state.read();
  assert.equal(s.speechRate, 1.5);
  await state.setSpeechRate(5); // clamped to 2
  s = await state.read();
  assert.equal(s.speechRate, 2);
  await state.setSpeechRate(0.1); // clamped to 0.5
  s = await state.read();
  assert.equal(s.speechRate, 0.5);
});

test('setSpeechRate rejects non-numeric', async () => {
  await assert.rejects(() => state.setSpeechRate('fast'), /Invalid speechRate/);
});

test('setSortBy now accepts created', async () => {
  await state.setSortBy('created');
  const s = await state.read();
  assert.equal(s.sortBy, 'created');
});

test('defaultState exposes sortReverse=false', async () => {
  const s = await state.read();
  assert.equal(s.sortReverse, false);
});

test('setSortReverse persists boolean', async () => {
  await state.setSortReverse(true);
  let s = await state.read();
  assert.equal(s.sortReverse, true);
  await state.setSortReverse(false);
  s = await state.read();
  assert.equal(s.sortReverse, false);
});

test('setSortReverse coerces to boolean', async () => {
  await state.setSortReverse(1);
  const s = await state.read();
  assert.strictEqual(s.sortReverse, true);
});

test('defaultState exposes sidebarWidth=280', async () => {
  const s = await state.read();
  assert.equal(s.sidebarWidth, 280);
});

test('setSidebarWidth clamps to [200, 600]', async () => {
  await state.setSidebarWidth(350);
  let s = await state.read();
  assert.equal(s.sidebarWidth, 350);
  await state.setSidebarWidth(50);
  s = await state.read();
  assert.equal(s.sidebarWidth, 200);
  await state.setSidebarWidth(9999);
  s = await state.read();
  assert.equal(s.sidebarWidth, 600);
});

test('setSidebarWidth rejects non-numeric', async () => {
  await assert.rejects(() => state.setSidebarWidth('big'), /Invalid sidebarWidth/);
});

test('VALID_SECTIONS no longer includes toc', () => {
  assert.equal(state.VALID_SECTIONS.has('toc'), false);
  assert.equal(state.VALID_SECTIONS.has('favorites'), true);
});

test('read() silently filters legacy toc entries from sectionOrder', async () => {
  await state.write({ sectionOrder: ['toc', 'favorites', 'recents', 'browse'] });
  const s = await state.read();
  assert.deepEqual(s.sectionOrder, ['favorites', 'recents', 'browse']);
});
