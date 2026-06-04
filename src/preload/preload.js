const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r2Drive', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('config:set-auto-launch', enabled),
  testConnection: () => ipcRenderer.invoke('config:test-connection'),
  selectDownloadDir: () => ipcRenderer.invoke('config:select-download-dir'),
  login: (password) => ipcRenderer.invoke('auth:login', password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  getBackupConfig: () => ipcRenderer.invoke('backup:get'),
  setBackupConfig: (config) => ipcRenderer.invoke('backup:set-config', config),
  getRemoteBackupDirs: () => ipcRenderer.invoke('backup:remote-dirs-get'),
  syncRemoteBackupFolders: (remoteDirs) => ipcRenderer.invoke('backup:sync-remote-folders', remoteDirs),
  pushBackupDirsToRemote: (dirs) => ipcRenderer.invoke('backup:push-dirs-to-remote', dirs),
  dismissBackupSyncPrompt: () => ipcRenderer.invoke('backup:dismiss-sync-prompt'),
  selectBackupFolder: () => ipcRenderer.invoke('backup:select-folder'),
  addBackupFolder: (folderPath) => ipcRenderer.invoke('backup:add-folder', folderPath),
  selectAlbumBackupFolder: () => ipcRenderer.invoke('backup:select-album-folder'),
  addAlbumBackupFolder: (folderPath) => ipcRenderer.invoke('backup:add-album-folder', folderPath),
  removeBackupJob: (id) => ipcRenderer.invoke('backup:remove-job', id),
  setBackupEnabled: (id, enabled) => ipcRenderer.invoke('backup:set-enabled', { id, enabled }),
  runBackupNow: (id) => ipcRenderer.invoke('backup:run-now', id),

  list: (remotePath) => ipcRenderer.invoke('drive:list', remotePath),
  sharedList: (remotePath) => ipcRenderer.invoke('drive:shared-list', remotePath),
  storage: () => ipcRenderer.invoke('drive:storage'),
  mkdir: (remotePath) => ipcRenderer.invoke('drive:mkdir', remotePath),
  deletePath: (remotePath) => ipcRenderer.invoke('drive:delete', remotePath),
  deleteBatch: (paths) => ipcRenderer.invoke('drive:delete-batch', paths),
  rename: (from, to) => ipcRenderer.invoke('drive:rename', { from, to }),
  selectUploadFiles: () => ipcRenderer.invoke('drive:select-upload'),
  uploadFiles: (filePaths, remotePath) => ipcRenderer.invoke('drive:upload', { filePaths, remotePath }),
  downloadFile: (remotePath, name, options = {}) => ipcRenderer.invoke('drive:download', { remotePath, name, ...options }),
  cancelDownload: (transferId) => ipcRenderer.invoke('drive:cancel-download', transferId),
  previewFile: (remotePath, maxBytes) => ipcRenderer.invoke('drive:preview', { remotePath, maxBytes }),

  nodesList: () => ipcRenderer.invoke('drive:nodes-list'),
  nodesSave: (node) => ipcRenderer.invoke('drive:nodes-save', node),
  nodesDelete: (id) => ipcRenderer.invoke('drive:nodes-delete', id),
  nodesTest: (id) => ipcRenderer.invoke('drive:nodes-test', id),
  scanOrphans: () => ipcRenderer.invoke('drive:orphans-scan'),
  cleanOrphans: (keys) => ipcRenderer.invoke('drive:orphans-clean', keys),

  clipboardGet: (id) => ipcRenderer.invoke('clipboard:get', id),
  clipboardSet: (items, action, sourcePath, id) => ipcRenderer.invoke('clipboard:set', { items, action, sourcePath, id }),
  clipboardDelete: (id) => ipcRenderer.invoke('clipboard:delete', id),
  clipboardPaste: (payload) => ipcRenderer.invoke('clipboard:paste', payload),

  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  hideToTray: () => ipcRenderer.invoke('window:hide-to-tray'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  onTransfer: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('transfer:event', listener);
    return () => ipcRenderer.removeListener('transfer:event', listener);
  },

  onBackup: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('backup:event', listener);
    return () => ipcRenderer.removeListener('backup:event', listener);
  },

  // 重置/清除本地数据
  resetClearAll: () => ipcRenderer.invoke('reset:clear-all'),

  // 多端同步 - 文件级更新检测
  checkRemoteFileUpdates: () => ipcRenderer.invoke('sync:check-file-updates'),
  setAutoSyncEnabled: (enabled) => ipcRenderer.invoke('sync:set-auto-sync', enabled),
  getAutoSyncEnabled: () => ipcRenderer.invoke('sync:get-auto-sync'),
  dismissSyncUpdate: () => ipcRenderer.invoke('sync:dismiss-update'),
  applySyncUpdates: (updates) => ipcRenderer.invoke('sync:apply-file-updates', updates),

  // 首次使用引导 - 检查是否已完成引导
  isSetupComplete: () => ipcRenderer.invoke('setup:is-complete'),
  completeSetup: () => ipcRenderer.invoke('setup:complete'),

  // 文件更新通知事件
  onSyncUpdate: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('sync:update-event', listener);
    return () => ipcRenderer.removeListener('sync:update-event', listener);
  },

  // 重新启动应用
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  checkForUpdates: (options = {}) => ipcRenderer.invoke('update:check', options),
  getPendingUpdate: () => ipcRenderer.invoke('update:get-pending'),
  skipUpdateVersion: (version) => ipcRenderer.invoke('update:skip-version', version),
  onUpdate: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  }
});
