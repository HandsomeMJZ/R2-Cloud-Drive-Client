const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r2Drive', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  selectDownloadDir: () => ipcRenderer.invoke('config:select-download-dir'),
  login: (password) => ipcRenderer.invoke('auth:login', password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  list: (remotePath) => ipcRenderer.invoke('drive:list', remotePath),
  sharedList: (remotePath) => ipcRenderer.invoke('drive:shared-list', remotePath),
  storage: () => ipcRenderer.invoke('drive:storage'),
  mkdir: (remotePath) => ipcRenderer.invoke('drive:mkdir', remotePath),
  deletePath: (remotePath) => ipcRenderer.invoke('drive:delete', remotePath),
  rename: (from, to) => ipcRenderer.invoke('drive:rename', { from, to }),
  selectUploadFiles: () => ipcRenderer.invoke('drive:select-upload'),
  uploadFiles: (filePaths, remotePath) => ipcRenderer.invoke('drive:upload', { filePaths, remotePath }),
  downloadFile: (remotePath, name) => ipcRenderer.invoke('drive:download', { remotePath, name }),
  cancelDownload: (transferId) => ipcRenderer.invoke('drive:cancel-download', transferId),
  previewFile: (remotePath, maxBytes) => ipcRenderer.invoke('drive:preview', { remotePath, maxBytes }),

  nodesList: () => ipcRenderer.invoke('drive:nodes-list'),
  nodesSave: (node) => ipcRenderer.invoke('drive:nodes-save', node),
  nodesDelete: (id) => ipcRenderer.invoke('drive:nodes-delete', id),
  nodesTest: (id) => ipcRenderer.invoke('drive:nodes-test', id),

  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  onTransfer: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('transfer:event', listener);
    return () => ipcRenderer.removeListener('transfer:event', listener);
  }
});
