const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docket', {
  getConfig: () => ipcRenderer.invoke('docket:getConfig'),
  getRootStatuses: () => ipcRenderer.invoke('docket:getRootStatuses'),
  updateConfig: (partial) => ipcRenderer.invoke('docket:updateConfig', partial),
  getState: () => ipcRenderer.invoke('docket:getState'),
  updateState: (partial) => ipcRenderer.invoke('docket:updateState', partial),
  addRecent: (absolutePath) => ipcRenderer.invoke('docket:addRecent', absolutePath),
  removeRecent: (absolutePath) => ipcRenderer.invoke('docket:removeRecent', absolutePath),
  addFavorite: (absolutePath) => ipcRenderer.invoke('docket:addFavorite', absolutePath),
  removeFavorite: (absolutePath) => ipcRenderer.invoke('docket:removeFavorite', absolutePath),
  setDefaultView: (v) => ipcRenderer.invoke('docket:setDefaultView', v),
  setActiveBrowseRoot: (v) => ipcRenderer.invoke('docket:setActiveBrowseRoot', v),
  setSortBy: (sortBy) => ipcRenderer.invoke('docket:setSortBy', sortBy),
  setSearchMode: (mode) => ipcRenderer.invoke('docket:setSearchMode', mode),
  setDocScale: (value) => ipcRenderer.invoke('docket:setDocScale', value),
  toggleTaskStatus: (absolutePath, lineIndex, completed) => ipcRenderer.invoke('docket:toggleTaskStatus', absolutePath, lineIndex, completed),
  setSortReverse: (v) => ipcRenderer.invoke('docket:setSortReverse', v),
  setSidebarWidth: (v) => ipcRenderer.invoke('docket:setSidebarWidth', v),
  listFiles: (rootId) => ipcRenderer.invoke('docket:listFiles', rootId),
  listAllFiles: () => ipcRenderer.invoke('docket:listAllFiles'),
  readFile: (absolutePath) => ipcRenderer.invoke('docket:readFile', absolutePath),
  searchContent: (query) => ipcRenderer.invoke('docket:searchContent', query),
  cancelSearch: () => ipcRenderer.invoke('docket:cancelSearch'),
  openSettingsWindow: () => ipcRenderer.invoke('docket:openSettings'),
  pickDirectory: () => ipcRenderer.invoke('docket:pickDirectory'),
  setActivePath: (absolutePath) => ipcRenderer.invoke('docket:setActivePath', absolutePath),
  getVersion: () => ipcRenderer.invoke('docket:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('docket:checkForUpdates'),
  onFileChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:file-change', listener);
    return () => ipcRenderer.removeListener('docket:file-change', listener);
  },
  onConfigChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:config-change', listener);
    return () => ipcRenderer.removeListener('docket:config-change', listener);
  },
  onToggleSidebar: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('docket:toggle-sidebar', listener);
    return () => ipcRenderer.removeListener('docket:toggle-sidebar', listener);
  },
  onFocusSearch: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('docket:focus-search', listener);
    return () => ipcRenderer.removeListener('docket:focus-search', listener);
  },
  onSortByChanged: (cb) => {
    const listener = (_event, sortBy) => cb(sortBy);
    ipcRenderer.on('docket:sort-by-changed', listener);
    return () => ipcRenderer.removeListener('docket:sort-by-changed', listener);
  },
  onOpenPath: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:open-path', listener);
    return () => ipcRenderer.removeListener('docket:open-path', listener);
  },
  addRootForPath: (dirPath) => ipcRenderer.invoke('docket:addRootForPath', dirPath),
  setSectionOrder: (order) => ipcRenderer.invoke('docket:setSectionOrder', order),
  setSectionCollapsed: (id, collapsed) => ipcRenderer.invoke('docket:setSectionCollapsed', id, collapsed),
  setFavoritesOrder: (paths) => ipcRenderer.invoke('docket:setFavoritesOrder', paths),
  setTabs: (tabs) => ipcRenderer.invoke('docket:setTabs', tabs),
  setActiveTabIndex: (idx) => ipcRenderer.invoke('docket:setActiveTabIndex', idx),
  setAutoCheck: (v) => ipcRenderer.invoke('docket:setAutoCheck', v),
  setAllowPrerelease: (v) => ipcRenderer.invoke('docket:setAllowPrerelease', v),
  setLastUpdateCheck: (v) => ipcRenderer.invoke('docket:setLastUpdateCheck', v),
  setVoiceURI: (v) => ipcRenderer.invoke('docket:setVoiceURI', v),
  setSpeechRate: (v) => ipcRenderer.invoke('docket:setSpeechRate', v),
  revealInFinder: (absolutePath) => ipcRenderer.invoke('docket:revealInFinder', absolutePath),
  downloadUpdate: () => ipcRenderer.invoke('docket:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('docket:installUpdate'),
  onUpdateState: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:update-state', listener);
    return () => ipcRenderer.removeListener('docket:update-state', listener);
  },
});
