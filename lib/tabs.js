function openOrSwitch(state, absolutePath) {
  const tabs = state.tabs || [];
  const existing = tabs.findIndex((t) => t.absolutePath === absolutePath);
  if (existing !== -1) return { tabs, activeTabIndex: existing };
  const next = tabs.concat([{ absolutePath }]);
  return { tabs: next, activeTabIndex: next.length - 1 };
}

function closeTab(state, index) {
  const tabs = (state.tabs || []).slice();
  if (index < 0 || index >= tabs.length) return state;
  const wasActive = state.activeTabIndex === index;
  tabs.splice(index, 1);
  let activeTabIndex;
  if (tabs.length === 0) {
    activeTabIndex = -1;
  } else if (wasActive) {
    // Prefer the next tab at the same index; clamp to last if we removed the tail.
    activeTabIndex = Math.min(index, tabs.length - 1);
  } else if (state.activeTabIndex > index) {
    activeTabIndex = state.activeTabIndex - 1;
  } else {
    activeTabIndex = state.activeTabIndex;
  }
  return { tabs, activeTabIndex };
}

function reorderTabs(state, from, to) {
  const tabs = (state.tabs || []).slice();
  if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length || from === to) return state;
  const activePath = state.activeTabIndex >= 0 ? tabs[state.activeTabIndex].absolutePath : null;
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  const activeTabIndex = activePath ? tabs.findIndex((t) => t.absolutePath === activePath) : state.activeTabIndex;
  return { tabs, activeTabIndex };
}

module.exports = { openOrSwitch, closeTab, reorderTabs };
