const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docket', {
  getConfig: () => ipcRenderer.invoke('docket:getConfig'),
  getRootStatuses: () => ipcRenderer.invoke('docket:getRootStatuses'),
  updateConfig: (partial) => ipcRenderer.invoke('docket:updateConfig', partial),
  getState: () => ipcRenderer.invoke('docket:getState'),
  updateState: (partial) => ipcRenderer.invoke('docket:updateState', partial),
  addRecent: (absolutePath) => ipcRenderer.invoke('docket:addRecent', absolutePath),
  setOverride: (absolutePath, mode) => ipcRenderer.invoke('docket:setOverride', absolutePath, mode),
  clearOverride: (absolutePath) => ipcRenderer.invoke('docket:clearOverride', absolutePath),
  listFiles: (rootId) => ipcRenderer.invoke('docket:listFiles', rootId),
  listAllFiles: () => ipcRenderer.invoke('docket:listAllFiles'),
  readFile: (absolutePath) => ipcRenderer.invoke('docket:readFile', absolutePath),
  searchContent: (query) => ipcRenderer.invoke('docket:searchContent', query),
  cancelSearch: () => ipcRenderer.invoke('docket:cancelSearch'),
  openSettingsWindow: () => ipcRenderer.invoke('docket:openSettings'),
  pickDirectory: () => ipcRenderer.invoke('docket:pickDirectory'),
  getVersion: () => ipcRenderer.invoke('docket:getVersion'),
  onFileChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:file-change', listener);
    return () => ipcRenderer.removeListener('docket:file-change', listener);
  },
  onConfigChange: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('docket:config-change', listener);
    return () => ipcRenderer.removeListener('docket:config-change', listener);
  }
});
