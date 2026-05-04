function openOrSwitch(state, absolutePath, opts) {
  opts = opts || {};
  const preview = Boolean(opts.preview);
  const tabs = (state.tabs || []).slice();
  const existing = tabs.findIndex((t) => t.absolutePath === absolutePath);
  if (existing !== -1) {
    if (!preview && tabs[existing].isPreview) {
      tabs[existing] = { ...tabs[existing], isPreview: false };
    }
    return { tabs, activeTabIndex: existing };
  }
  if (preview) {
    const previewIdx = tabs.findIndex((t) => t.isPreview);
    if (previewIdx !== -1) {
      tabs[previewIdx] = { ...tabs[previewIdx], absolutePath };
      return { tabs, activeTabIndex: previewIdx };
    }
    tabs.push({ absolutePath, isPreview: true });
    return { tabs, activeTabIndex: tabs.length - 1 };
  }
  tabs.push({ absolutePath });
  return { tabs, activeTabIndex: tabs.length - 1 };
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
