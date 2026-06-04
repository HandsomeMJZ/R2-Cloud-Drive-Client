//by HandsomeMJZ
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { R2DriveClient, normalizeRemotePath } = require('./apiClient');
const { BackupManager } = require('./backupManager');

const APP_ID = 'io.qzz.r2drive.client';
const PRODUCT_NAME = 'R2 Cloud Drive';
const WINDOW_ICON = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const UPDATE_GITHUB_REPO = 'HandsomeMJZ/R2-Cloud-Drive-Client';
const UPDATE_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_GITHUB_REPO}/releases/latest`;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// 必须在 app.whenReady() 之前设置，否则 Windows 任务栏图标无法正确显示
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

let mainWindow;
let tray;
let client;
let backupManager;
let isQuitting = false;
let closePromptOpen = false;
let updateCheckTimer = null;
let pendingUpdateInfo = null;
const activeDownloads = new Map();
const systemTransfers = new Map();
const MAX_PARALLEL_UPLOADS = 3;
// 批量上传追踪：用于仅在全部上传完成时通知
const pendingUploadBatches = new Map(); // batchKey -> { total, done, failed, names }
const pendingDownloadBatches = new Map(); // batchKey -> { total, done, failed, names, localPaths }

function iconPath(fileName) {
  return path.join(__dirname, '../../assets/icons', fileName);
}

function nativeIcon(preferredName, size) {
  const candidates = [preferredName, 'icon.png', 'icon.ico', 'tray.png'].filter(Boolean);
  for (const fileName of candidates) {
    const image = nativeImage.createFromPath(iconPath(fileName));
    if (!image.isEmpty()) {
      return size ? image.resize(size) : image;
    }
  }
  return nativeImage.createEmpty();
}

function notificationIconPath() {
  const candidates = ['icon.png', 'icon.ico'];
  return candidates.map(iconPath).find((filePath) => fs.existsSync(filePath)) || undefined;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const parse = (value) => normalizeVersion(value)
    .split(/[.+-]/)
    .map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

function releaseAssetUrl(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const preferred = assets.find((asset) => /setup|\.exe|\.dmg|\.appimage|\.deb|\.zip/i.test(asset?.name || ''));
  return preferred?.browser_download_url || assets[0]?.browser_download_url || release?.html_url || '';
}

function normalizeReleaseUpdate(release) {
  const version = normalizeVersion(release?.tag_name || release?.name || '');
  return {
    version,
    tagName: release?.tag_name || version,
    name: release?.name || `v${version}`,
    body: release?.body || '',
    htmlUrl: release?.html_url || `https://github.com/${UPDATE_GITHUB_REPO}/releases/latest`,
    downloadUrl: releaseAssetUrl(release),
    publishedAt: release?.published_at || '',
    currentVersion: app.getVersion()
  };
}

async function fetchLatestReleaseUpdate() {
  const response = await fetch(UPDATE_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${PRODUCT_NAME}/${app.getVersion()}`
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub 更新检查失败：HTTP ${response.status}`);
  }

  return normalizeReleaseUpdate(await response.json());
}

function markUpdateVersionPrompted(version) {
  const config = client.getConfig();
  const versions = Array.isArray(config.updatePromptedVersions) ? config.updatePromptedVersions : [];
  if (versions.includes(version)) {
    return;
  }
  client.setConfig({
    updatePromptedVersions: [...versions, version].slice(-30)
  });
}

function sendUpdateEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('update:event', payload);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
    return;
  }
  send();
}

function isMainWindowForeground() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused());
}

function showUpdateNotification(update) {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: `${PRODUCT_NAME} 有新版本`,
    body: `发现 v${update.version}，点击查看更新内容。`,
    icon: notificationIconPath()
  });
  notification.on('click', () => {
    openPendingUpdateWindow(update);
  });
  notification.show();
}

function openPendingUpdateWindow(update = pendingUpdateInfo) {
  if (!update) {
    return;
  }
  pendingUpdateInfo = update;
  showMainWindow();
  sendUpdateEvent({
    type: 'update-available',
    update
  });
}

function announceUpdate(update, options = {}) {
  pendingUpdateInfo = update;
  if (options.manual || isMainWindowForeground()) {
    sendUpdateEvent({
      type: 'update-available',
      update
    });
  }
  if (!options.manual) {
    showUpdateNotification(update);
  }
}

async function checkForAppUpdate(options = {}) {
  const manual = Boolean(options.manual);
  const currentVersion = app.getVersion();
  const config = client.getConfig();

  if (!manual && config.updateAutoCheck === false) {
    return {
      ok: true,
      disabled: true,
      currentVersion
    };
  }

  const update = await fetchLatestReleaseUpdate();
  update.currentVersion = currentVersion;
  if (!update.version || compareVersions(update.version, currentVersion) <= 0) {
    return {
      ok: true,
      hasUpdate: false,
      currentVersion,
      latestVersion: update.version || ''
    };
  }

  const skipped = config.updateSkippedVersion === update.version;
  if (!manual && skipped) {
    return {
      ok: true,
      hasUpdate: true,
      skipped: true,
      update,
      currentVersion
    };
  }

  const promptedVersions = Array.isArray(config.updatePromptedVersions) ? config.updatePromptedVersions : [];
  if (!manual && promptedVersions.includes(update.version)) {
    pendingUpdateInfo = update;
    return {
      ok: true,
      hasUpdate: true,
      alreadyPrompted: true,
      update,
      currentVersion
    };
  }

  if (!manual) {
    markUpdateVersionPrompted(update.version);
  }

  if (options.notify !== false) {
    announceUpdate(update, { manual });
  } else {
    pendingUpdateInfo = update;
  }

  return {
    ok: true,
    hasUpdate: true,
    skipped,
    update,
    currentVersion
  };
}

function startUpdateChecks() {
  stopUpdateChecks();
  setTimeout(() => {
    checkForAppUpdate({ manual: false }).catch((error) => {
      console.warn('Update check failed:', error.message);
    });
  }, 5000);
  updateCheckTimer = setInterval(() => {
    checkForAppUpdate({ manual: false }).catch((error) => {
      console.warn('Update check failed:', error.message);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

function stopUpdateChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 360,
    minHeight: 540,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafd',
    title: PRODUCT_NAME,
    icon: nativeIcon(WINDOW_ICON),
    show: client?.getConfig().startHiddenToTray !== true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', async (event) => {
    if (isQuitting) {
      return;
    }

    const closeBehavior = client?.getConfig().closeBehavior || 'ask';
    if (closeBehavior === 'tray') {
      event.preventDefault();
      hideToTray();
      return;
    }
    if (closeBehavior === 'quit') {
      isQuitting = true;
      app.quit();
      return;
    }

    event.preventDefault();
    if (closePromptOpen) {
      return;
    }
    closePromptOpen = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '关闭方式',
      message: '要关闭程序，还是最小化到托盘继续后台同步？',
      buttons: ['最小化到托盘', '退出程序', '取消'],
      defaultId: 0,
      cancelId: 2
    });
    closePromptOpen = false;

    if (result.response === 0) {
      client.setConfig({ closeBehavior: 'tray' });
      hideToTray();
    } else if (result.response === 1) {
      client.setConfig({ closeBehavior: 'quit' });
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function emitTransfer(payload) {
  updateSystemTransferState(payload);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('transfer:event', payload);
}

function updateSystemTransferState(payload) {
  if (!payload?.id) {
    return;
  }

  if (payload.status === 'running') {
    systemTransfers.set(payload.id, {
      ...(systemTransfers.get(payload.id) || {}),
      ...payload
    });
  } else if (['done', 'error', 'canceled'].includes(payload.status)) {
    systemTransfers.delete(payload.id);
  }

  updateTaskbarProgress();

  // 上传结束：仅在整个上传批次完成后通知
  const notifyUpload = client?.getConfig().uploadBatchNotify !== false;
  if (payload.type === 'upload' && payload.batchKey && ['done', 'error', 'canceled'].includes(payload.status)) {
    const completedBatch = recordUploadBatchProgress(payload);
    if (completedBatch && notifyUpload) {
      showUploadBatchNotification(payload.batchKey, completedBatch.total, completedBatch.failed, completedBatch.names);
    }
  }

  const notifyDownload = client?.getConfig().downloadBatchNotify !== false;
  if (payload.type === 'download' && payload.batchKey && ['done', 'error', 'canceled'].includes(payload.status)) {
    const completedBatch = recordDownloadBatchProgress(payload);
    if (completedBatch && notifyDownload) {
      showDownloadBatchNotification(payload.batchKey, completedBatch.total, completedBatch.failed, completedBatch.names, completedBatch.localPaths);
    }
  }
}

function recordUploadBatchProgress(payload) {
  const batch = pendingUploadBatches.get(payload.batchKey);
  if (!batch) {
    return null;
  }

  if (!batch.completedIds) {
    batch.completedIds = new Set();
  }
  if (batch.completedIds.has(payload.id)) {
    return null;
  }

  batch.completedIds.add(payload.id);
  batch.done += 1;
  if (payload.status !== 'done') {
    batch.failed += 1;
  }

  if (batch.done < batch.total) {
    return null;
  }

  pendingUploadBatches.delete(payload.batchKey);
  return batch;
}

function recordDownloadBatchProgress(payload) {
  const batch = pendingDownloadBatches.get(payload.batchKey);
  if (!batch) {
    return null;
  }

  if (!batch.completedIds) {
    batch.completedIds = new Set();
  }
  if (batch.completedIds.has(payload.id)) {
    return null;
  }

  batch.completedIds.add(payload.id);
  batch.done += 1;
  if (payload.status !== 'done') {
    batch.failed += 1;
  } else if (payload.localPath) {
    batch.localPaths.push(payload.localPath);
  }

  if (batch.done < batch.total) {
    return null;
  }

  pendingDownloadBatches.delete(payload.batchKey);
  return batch;
}

function updateTaskbarProgress() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const running = Array.from(systemTransfers.values()).filter((item) => item.status === 'running');
  if (!running.length) {
    mainWindow.setProgressBar(-1);
    return;
  }

  const knownTotal = running.filter((item) => Number(item.total) > 0);
  if (!knownTotal.length) {
    mainWindow.setProgressBar(2);
    return;
  }

  const transferred = knownTotal.reduce((sum, item) => sum + Number(item.transferred || 0), 0);
  const total = knownTotal.reduce((sum, item) => sum + Number(item.total || 0), 0);
  mainWindow.setProgressBar(Math.max(0, Math.min(1, transferred / total)));
}

function showUploadBatchNotification(batchKey, total, failed, names) {
  if (!Notification.isSupported()) {
    return;
  }
  const successCount = total - failed;
  const body = failed > 0
    ? `上传完成，本次上传 ${total} 个文件，${successCount} 个成功，${failed} 个失败`
    : `上传完成，本次上传 ${total} 个文件`;

  const notification = new Notification({
    title: 'R2 Cloud Drive',
    body,
    icon: notificationIconPath()
  });
  notification.show();
}

function showDownloadBatchNotification(batchKey, total, failed, names, localPaths) {
  if (!Notification.isSupported()) {
    return;
  }
  const successCount = total - failed;
  const body = failed > 0
    ? `下载完成，本次下载 ${total} 个文件，${successCount} 个成功，${failed} 个失败`
    : `下载完成，本次下载 ${total} 个文件`;

  const notification = new Notification({
    title: PRODUCT_NAME,
    body,
    icon: notificationIconPath()
  });
  const firstLocalPath = Array.isArray(localPaths) ? localPaths[0] : '';
  if (firstLocalPath) {
    notification.on('click', () => shell.showItemInFolder(firstLocalPath));
  }
  notification.show();
}

function emitBackup(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('backup:event', payload);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function hideToTray() {
  createTray();
  mainWindow?.hide();
}

function createTray() {
  if (tray) {
    return tray;
  }

  const icon = nativeIcon(process.platform === 'win32' ? 'tray.png' : 'tray.png', { width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '立即自动同步', click: () => backupManager?.runAll({ reason: 'tray' }) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function applyAutoLaunch(enabled) {
  if (!app.isPackaged && process.defaultApp) {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: [app.getAppPath()]
    });
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled)
  });
}

function makeProgressEmitter(transferId, basePayload) {
  let lastEmitTime = 0;
  let lastPayload = null;
  let timer = null;

  const send = (payload) => {
    lastPayload = null;
    lastEmitTime = Date.now();
    emitTransfer(payload);
  };

  const emitProgress = (progress) => {
    const payload = {
      id: transferId,
      ...basePayload,
      ...progress
    };
    const now = Date.now();
    const elapsed = now - lastEmitTime;

    if (elapsed >= 120) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      send(payload);
      return;
    }

    lastPayload = payload;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (lastPayload) {
          send(lastPayload);
        }
      }, Math.max(16, 120 - elapsed));
    }
  };

  emitProgress.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastPayload) {
      send(lastPayload);
    }
  };

  emitProgress.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastPayload = null;
  };

  return emitProgress;
}

function makeTransferId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(1, limit), queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function makeSpeedTracker() {
  let lastBytes = 0;
  let lastTime = Date.now();
  let speed = 0;

  return (progress) => {
    const now = Date.now();
    const transferred = Number(progress.transferred || 0);
    const elapsed = (now - lastTime) / 1000;

    if (elapsed >= 0.2) {
      speed = Math.max(0, (transferred - lastBytes) / elapsed);
      lastBytes = transferred;
      lastTime = now;
    }

    return {
      ...progress,
      speed
    };
  };
}

function joinRemotePath(parentPath, name) {
  return normalizeRemotePath([parentPath, name].filter(Boolean).join('/'));
}

function safeLocalFileName(name) {
  const fallback = 'download';
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function uniqueLocalPath(directory, fileName) {
  const parsed = path.parse(safeLocalFileName(fileName));
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function uniqueLocalDirectory(parentDirectory, directoryName) {
  const baseName = safeLocalFileName(directoryName || 'sync-folder');
  let candidate = path.join(parentDirectory, baseName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDirectory, `${baseName} (${index})`);
    index += 1;
  }

  return candidate;
}

function remoteBackupDirsFromJobs(config = backupManager?.getConfig()) {
  const seen = new Set();
  const dirs = [];

  for (const job of Array.isArray(config?.jobs) ? config.jobs : []) {
    const remotePath = normalizeRemotePath(job.remotePath || '');
    if (!remotePath || seen.has(remotePath)) {
      continue;
    }
    seen.add(remotePath);
    dirs.push(remotePath);
  }

  return dirs;
}

async function saveRemoteBackupDirsFromJobs(config) {
  const dirs = remoteBackupDirsFromJobs(config);
  await client.saveBackupDirs(dirs);
}

async function selectSyncRootDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择同步到本地的位置',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled || !result.filePaths.length
    ? { canceled: true }
    : { canceled: false, filePath: result.filePaths[0] };
}

async function syncRemoteBackupFolders(remoteDirs = []) {
  const normalizedDirs = [...new Set((Array.isArray(remoteDirs) ? remoteDirs : [])
    .map((item) => normalizeRemotePath(item))
    .filter(Boolean))];

  if (!normalizedDirs.length) {
    return { canceled: true, reason: 'empty' };
  }

  const rootResult = await selectSyncRootDirectory();
  if (rootResult.canceled || !rootResult.filePath) {
    return { canceled: true };
  }

  const created = [];
  for (const remoteDir of normalizedDirs) {
    const localPath = uniqueLocalDirectory(rootResult.filePath, path.posix.basename(remoteDir) || remoteDir.replace(/\//g, '-'));
    await fs.promises.mkdir(localPath, { recursive: true });
    await downloadRemoteDirectory(remoteDir, localPath);
    const config = backupManager.addSyncedJob(localPath, remoteDir);
    created.push({
      localPath,
      remotePath: remoteDir,
      jobs: config.jobs
    });
  }

  const config = backupManager.setConfig({ autoStart: true });
  applyAutoLaunch(true);
  await saveRemoteBackupDirsFromJobs(config).catch((error) => {
    console.warn('Failed to save remote backup dirs:', error.message);
  });
  client.setConfig({ backupSyncPromptDismissed: true });

  return {
    ok: true,
    localRoot: rootResult.filePath,
    created,
    config
  };
}

async function downloadRemoteDirectory(remoteDir, localDir) {
  const listing = await client.list(remoteDir);
  await fs.promises.mkdir(localDir, { recursive: true });

  const folders = Array.isArray(listing.folders) ? listing.folders : [];
  for (const folderName of folders) {
    const childRemote = joinRemotePath(remoteDir, folderName);
    const childLocal = path.join(localDir, safeLocalFileName(folderName));
    await downloadRemoteDirectory(childRemote, childLocal);
  }

  const files = Array.isArray(listing.files) ? listing.files.filter((file) => file?.name && file.name !== '.keep') : [];
  await runWithConcurrency(files, Math.min(MAX_PARALLEL_UPLOADS, Math.max(1, files.length)), (file) => {
    const remotePath = joinRemotePath(remoteDir, file.name);
    const localPath = uniqueLocalPath(localDir, file.name);
    return downloadRemoteFileForSync(remotePath, localPath, file);
  });
}

async function downloadRemoteFileForSync(remotePath, localPath, file) {
  const transferId = makeTransferId('sync-download');
  const name = file?.name || path.posix.basename(remotePath);
  const abortController = new AbortController();
  const trackSpeed = makeSpeedTracker();

  emitTransfer({
    id: transferId,
    type: 'download',
    name,
    remotePath,
    localPath,
    status: 'running',
    phase: '同步下载准备中',
    transferred: 0,
    total: Number(file?.size || 0)
  });

  const emitProgress = makeProgressEmitter(transferId, {
    type: 'download',
    name,
    remotePath,
    localPath,
    status: 'running',
    phase: '同步下载中'
  });

  try {
    await client.downloadToFile(remotePath, localPath, (progress) => {
      emitProgress(trackSpeed({
        ...progress,
        phase: progress.phase || '同步下载中'
      }));
    }, {
      signal: abortController.signal
    });
    emitProgress.flush();
    emitTransfer({
      id: transferId,
      type: 'download',
      name,
      remotePath,
      localPath,
      status: 'done',
      phase: '同步下载完成'
    });
  } catch (error) {
    emitProgress.cancel();
    emitTransfer({
      id: transferId,
      type: 'download',
      name,
      remotePath,
      localPath,
      status: 'error',
      phase: '同步下载失败',
      message: error.message
    });
    throw error;
  }
}

async function resolveDownloadTarget(defaultName) {
  const downloadDir = client.getConfig().downloadDir || app.getPath('downloads');
  if (downloadDir) {
    return {
      canceled: false,
      filePath: uniqueLocalPath(downloadDir, defaultName)
    };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存文件',
    defaultPath: path.join(app.getPath('downloads'), safeLocalFileName(defaultName))
  });

  return result;
}

function registerIpc() {
  ipcMain.handle('config:get', () => client.getConfig());

  ipcMain.handle('config:set', (event, config) => client.setConfig(config || {}));

  ipcMain.handle('config:set-auto-launch', (event, enabled) => {
    applyAutoLaunch(Boolean(enabled));
    client.setConfig({ autoLaunch: Boolean(enabled) });
    return client.getConfig();
  });

  ipcMain.handle('config:test-connection', () => client.testConnection());

  ipcMain.handle('config:select-download-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择默认下载目录',
      defaultPath: client.getConfig().downloadDir || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths.length
      ? { canceled: true }
      : { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('backup:get', () => backupManager.getConfig());

  ipcMain.handle('backup:set-config', (event, payload) => {
    if (typeof payload?.autoStart === 'boolean') {
      applyAutoLaunch(payload.autoStart);
    }
    return backupManager.setConfig(payload || {});
  });

  ipcMain.handle('backup:remote-dirs-get', () => client.backupDirs());

  ipcMain.handle('backup:sync-remote-folders', (event, remoteDirs) => syncRemoteBackupFolders(remoteDirs));

  ipcMain.handle('backup:push-dirs-to-remote', async (event, remoteDirs) => {
    const config = backupManager.getConfig();
    await client.saveBackupDirs(remoteDirs);
    return { ok: true };
  });

  ipcMain.handle('backup:dismiss-sync-prompt', () => {
    client.setConfig({ backupSyncPromptDismissed: true });
    return client.getConfig();
  });

  ipcMain.handle('backup:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要自动同步的文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths.length
      ? { canceled: true }
      : { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('backup:add-folder', async (event, folderPath) => {
    const config = backupManager.addJob(folderPath);
    await saveRemoteBackupDirsFromJobs(config).catch((error) => {
      console.warn('Failed to save remote backup dirs:', error.message);
    });
    return config;
  });

  ipcMain.handle('backup:select-album-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要同步到相册的文件夹',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths.length
      ? { canceled: true }
      : { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('backup:add-album-folder', async (event, folderPath) => {
    const config = backupManager.addAlbumJob(folderPath);
    await saveRemoteBackupDirsFromJobs(config).catch((error) => {
      console.warn('Failed to save remote backup dirs:', error.message);
    });
    return config;
  });

  ipcMain.handle('backup:remove-job', async (event, id) => {
    const config = backupManager.removeJob(id);
    await saveRemoteBackupDirsFromJobs(config).catch((error) => {
      console.warn('Failed to save remote backup dirs:', error.message);
    });
    return config;
  });

  ipcMain.handle('backup:set-enabled', (event, payload) => backupManager.updateJob(payload.id, {
    enabled: Boolean(payload.enabled)
  }));

  ipcMain.handle('backup:run-now', (event, id) => {
    if (id) {
      return backupManager.runJob(id, { reason: 'manual' });
    }
    return backupManager.runAll({ reason: 'manual' });
  });

  ipcMain.handle('auth:login', (event, password) => client.login(password));

  ipcMain.handle('auth:logout', () => client.logout());

  ipcMain.handle('drive:list', (event, remotePath) => client.list(remotePath || ''));

  ipcMain.handle('drive:shared-list', (event, remotePath) => client.sharedList(remotePath || ''));

  ipcMain.handle('drive:storage', () => client.storage());

  ipcMain.handle('drive:mkdir', (event, remotePath) => client.mkdir(remotePath));

  ipcMain.handle('drive:delete', (event, remotePath) => client.delete(remotePath));

  ipcMain.handle('drive:delete-batch', (event, paths) => client.deleteBatch(paths));

  ipcMain.handle('drive:rename', (event, payload) => client.rename(payload.from, payload.to));

  ipcMain.handle('drive:select-upload', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('drive:upload', async (event, payload) => {
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    const remoteDir = normalizeRemotePath(payload?.remotePath || '');
    const results = [];
    const batchKey = makeTransferId('batch');

    // 初始化批量上传追踪
    if (filePaths.length > 0) {
      pendingUploadBatches.set(batchKey, {
        total: filePaths.length,
        done: 0,
        failed: 0,
        names: filePaths.map((p) => path.basename(p))
      });
    }

    await runWithConcurrency(filePaths, MAX_PARALLEL_UPLOADS, async (filePath) => {
      const fileName = path.basename(filePath);
      const remotePath = joinRemotePath(remoteDir, fileName);
      const transferId = makeTransferId('upload');

        emitTransfer({
          id: transferId,
          type: 'upload',
          name: fileName,
          filePath,
          remotePath,
          status: 'running',
        phase: '准备上传',
        transferred: 0,
        total: 0
      });

      const emitProgress = makeProgressEmitter(transferId, {
        type: 'upload',
        name: fileName,
        filePath,
        remotePath,
        status: 'running'
      });
      let lastUploadPhase = '上传中';
      let lastUploadStrategy = '';

      try {
        await client.uploadFile(filePath, remotePath, (progress) => {
          lastUploadPhase = progress.phase || lastUploadPhase;
          lastUploadStrategy = progress.strategy || lastUploadStrategy;
          emitProgress(progress);
        });
        emitProgress.flush();

        emitTransfer({
          id: transferId,
          type: 'upload',
          name: fileName,
          filePath,
          remotePath,
          status: 'done',
          phase: '上传完成',
          batchKey
        });
        results.push({ ok: true, filePath, remotePath });
      } catch (error) {
        emitProgress.cancel();
        emitTransfer({
          id: transferId,
          type: 'upload',
          name: fileName,
          filePath,
          remotePath,
          status: 'error',
          phase: lastUploadPhase ? `${lastUploadPhase}失败` : '上传失败',
          strategy: lastUploadStrategy,
          message: error.message,
          batchKey
        });
        results.push({ ok: false, filePath, remotePath, error: error.message });
      }
    });

    return results;
  });

  ipcMain.handle('drive:download', async (event, payload) => {
    const remotePath = normalizeRemotePath(payload?.remotePath || '');
    const defaultName = safeLocalFileName(payload?.name || path.posix.basename(remotePath));
    const transferId = makeTransferId('download');
    const batchKey = payload?.batchKey || makeTransferId('download-batch');
    const batchTotal = Math.max(1, Number(payload?.batchTotal) || 1);
    if (!pendingDownloadBatches.has(batchKey)) {
      pendingDownloadBatches.set(batchKey, {
        total: batchTotal,
        done: 0,
        failed: 0,
        names: Array.isArray(payload?.batchNames) && payload.batchNames.length ? payload.batchNames : [defaultName],
        localPaths: []
      });
    }
    const result = await resolveDownloadTarget(defaultName);

    if (result.canceled || !result.filePath) {
      emitTransfer({
        id: transferId,
        type: 'download',
        name: defaultName,
        remotePath,
        status: 'canceled',
        phase: '已取消',
        message: '下载已取消',
        batchKey
      });
      return { canceled: true };
    }

    const abortController = new AbortController();
    const trackSpeed = makeSpeedTracker();
    activeDownloads.set(transferId, {
      abortController,
      localPath: result.filePath,
      remotePath
    });

    emitTransfer({
      id: transferId,
      type: 'download',
      name: defaultName,
      remotePath,
      localPath: result.filePath,
      status: 'running',
      phase: '准备下载',
      transferred: 0,
      total: 0,
      batchKey
    });

    const emitProgress = makeProgressEmitter(transferId, {
      type: 'download',
      name: defaultName,
      remotePath,
      localPath: result.filePath,
      status: 'running',
      phase: '下载中',
      batchKey
    });

    try {
      await client.downloadToFile(remotePath, result.filePath, (progress) => {
        emitProgress(trackSpeed(progress));
      }, {
        signal: abortController.signal
      });
      emitProgress.flush();

      emitTransfer({
        id: transferId,
        type: 'download',
        name: defaultName,
        remotePath,
        localPath: result.filePath,
        status: 'done',
        phase: '下载完成',
        batchKey
      });
      activeDownloads.delete(transferId);
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      emitProgress.cancel();
      activeDownloads.delete(transferId);
      if (isAbortError(error)) {
        emitTransfer({
          id: transferId,
          type: 'download',
          name: defaultName,
          remotePath,
          localPath: result.filePath,
          status: 'canceled',
          phase: '已取消',
          message: '下载已取消',
          batchKey
        });
        return { canceled: true };
      }
      emitTransfer({
        id: transferId,
        type: 'download',
        name: defaultName,
        remotePath,
        localPath: result.filePath,
        status: 'error',
        phase: '下载失败',
        message: error.message,
        batchKey
      });
      throw error;
    }
  });

  ipcMain.handle('drive:cancel-download', async (event, transferId) => {
    const task = activeDownloads.get(transferId);
    if (!task) {
      return { ok: false, reason: 'not_found' };
    }

    task.abortController.abort();
    return { ok: true };
  });

  ipcMain.handle('drive:preview', (event, payload) => {
    const remotePath = typeof payload === 'string' ? payload : payload?.remotePath;
    const maxBytes = typeof payload?.maxBytes === 'number' ? payload.maxBytes : undefined;
    return client.previewDataUrl(remotePath, maxBytes);
  });

  ipcMain.handle('drive:nodes-list', () => client.storageNodes());

  ipcMain.handle('drive:nodes-save', (event, node) => client.saveStorageNode(node));

  ipcMain.handle('drive:nodes-delete', (event, id) => client.deleteStorageNode(id));

  ipcMain.handle('drive:nodes-test', (event, id) => client.testStorageNode(id));

  ipcMain.handle('drive:orphans-scan', () => client.scanOrphans());

  ipcMain.handle('drive:orphans-clean', (event, keys) => client.cleanOrphans(keys));

  ipcMain.handle('clipboard:get', (event, id) => client.clipboardGet(id));

  ipcMain.handle('clipboard:set', (event, payload) => client.clipboardSet(payload.items, payload.action, payload.sourcePath, payload.id));

  ipcMain.handle('clipboard:delete', (event, id) => client.clipboardDelete(id));

  ipcMain.handle('clipboard:paste', (event, payload) => client.clipboardPaste(payload));

  ipcMain.handle('shell:open-path', (event, filePath) => shell.showItemInFolder(filePath));

  ipcMain.handle('shell:open-external', (event, url) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('只允许打开 HTTP/HTTPS 链接');
    }
    return shell.openExternal(target.toString());
  });

  ipcMain.handle('window:minimize', () => {
    const minimizeBehavior = client?.getConfig().minimizeBehavior || 'taskbar';
    if (minimizeBehavior === 'tray') {
      hideToTray();
      return 'tray';
    }
    mainWindow?.minimize();
    return 'taskbar';
  });

  ipcMain.handle('window:hide-to-tray', () => {
    hideToTray();
  });

  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) {
      return false;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  // ── 重置/清除本地数据 ──
  ipcMain.handle('reset:clear-all', async () => {
    try {
      // 清除配置文件
      const configPath = path.join(app.getPath('userData'), 'config.json');
      await fs.promises.rm(configPath, { force: true }).catch(() => {});
      // 清除 session 相关文件
      const sessionsPath = path.join(app.getPath('userData'), 'Partitions');
      await fs.promises.rm(sessionsPath, { recursive: true, force: true }).catch(() => {});
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('app:relaunch', () => {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('app:info', () => ({
    name: PRODUCT_NAME,
    version: app.getVersion(),
    updateRepo: UPDATE_GITHUB_REPO
  }));

  ipcMain.handle('update:check', async (event, options = {}) => {
    try {
      return await checkForAppUpdate({
        manual: options?.manual !== false,
        notify: options?.notify
      });
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        currentVersion: app.getVersion()
      };
    }
  });

  ipcMain.handle('update:get-pending', () => ({
    update: pendingUpdateInfo,
    currentVersion: app.getVersion()
  }));

  ipcMain.handle('update:skip-version', (event, version) => {
    const targetVersion = normalizeVersion(version || pendingUpdateInfo?.version || '');
    if (!targetVersion) {
      return client.getConfig();
    }
    const config = client.getConfig();
    const promptedVersions = Array.isArray(config.updatePromptedVersions) ? config.updatePromptedVersions : [];
    return client.setConfig({
      updateSkippedVersion: targetVersion,
      updatePromptedVersions: promptedVersions.includes(targetVersion)
        ? promptedVersions
        : [...promptedVersions, targetVersion].slice(-30)
    });
  });

  // ── 首次使用引导 ──
  ipcMain.handle('setup:is-complete', () => {
    const config = client.getConfig();
    return {
      complete: Boolean(config.baseUrl),
      baseUrl: config.baseUrl || ''
    };
  });

  ipcMain.handle('setup:complete', () => {
    return client.getConfig();
  });

  // ── 多端同步 - 文件级更新检测 ──
  ipcMain.handle('sync:check-file-updates', async () => {
    const result = await checkRemoteFileUpdatesInternal();
    pendingSyncUpdates = result?.updates || [];
    return result;
  });

  ipcMain.handle('sync:set-auto-sync', (event, enabled) => {
    client.setConfig({ autoSyncEnabled: Boolean(enabled) });
    return client.getConfig();
  });

  ipcMain.handle('sync:get-auto-sync', () => {
    return { enabled: Boolean(client.getConfig().autoSyncEnabled) };
  });

  ipcMain.handle('sync:dismiss-update', () => {
    // 暂时忽略本次更新通知
    pendingSyncUpdates = [];
    return { ok: true };
  });

  ipcMain.handle('sync:apply-file-updates', async (event, updates) => {
    return applyRemoteFileUpdates(Array.isArray(updates) ? updates : pendingSyncUpdates);
  });
}

// ── 多端同步：定期检查远端文件更新 ──
let syncUpdateTimer = null;
let pendingSyncUpdates = [];

function startSyncUpdatePolling() {
  stopSyncUpdatePolling();
  // 每 5 分钟检查一次远端文件更新
  syncUpdateTimer = setInterval(async () => {
    try {
      const config = client.getConfig();
      if (!config.baseUrl) {
        return;
      }

      const result = await checkRemoteFileUpdatesInternal();
      const updates = result?.updates || [];
      if (!updates.length) {
        return;
      }

      pendingSyncUpdates = updates;
      if (config.autoSyncEnabled) {
        await applyRemoteFileUpdates(updates);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:update-event', {
          type: 'sync-update',
          updates,
          count: updates.length
        });
      }
    } catch (error) {
      console.warn('Sync update polling error:', error.message);
    }
  }, 5 * 60 * 1000);
}

function stopSyncUpdatePolling() {
  if (syncUpdateTimer) {
    clearInterval(syncUpdateTimer);
    syncUpdateTimer = null;
  }
}

async function checkRemoteFileUpdatesInternal() {
  try {
    const config = backupManager.getConfig();
    const jobs = Array.isArray(config.jobs) ? config.jobs.filter((j) => j.enabled !== false) : [];
    if (!jobs.length) {
      return { updates: [], checked: true };
    }

    const updates = [];
    for (const job of jobs) {
      try {
        const lastCheck = job.lastSyncCheck ? new Date(job.lastSyncCheck).getTime() : 0;
        await collectRemoteUpdatesForJob(job, job.remotePath || '', '', lastCheck, updates);

        backupManager.patchJobLastSyncCheck(job.id);
      } catch (error) {
        console.warn(`Failed to check updates for job ${job.name}:`, error.message);
      }
    }

    return { updates, checked: true };
  } catch (error) {
    return { updates: [], checked: false, error: error.message };
  }
}

async function collectRemoteUpdatesForJob(job, remoteDir, relativeDir, lastCheck, updates) {
  const listing = await client.list(remoteDir || '');
  const remoteFiles = Array.isArray(listing.files) ? listing.files : [];

  for (const file of remoteFiles) {
    if (!file.name || file.name === '.keep') {
      continue;
    }
    const remoteTime = file.uploaded ? new Date(file.uploaded).getTime() : 0;
    if (remoteTime > lastCheck) {
      const relativePath = normalizeRemotePath([relativeDir, file.name].filter(Boolean).join('/'));
      updates.push({
        jobId: job.id,
        jobName: job.name,
        remotePath: job.remotePath,
        remoteFilePath: joinRemotePath(job.remotePath, relativePath),
        relativePath,
        fileName: file.name,
        fileSize: file.size,
        uploaded: file.uploaded,
        etag: file.etag || ''
      });
    }
  }

  const folders = Array.isArray(listing.folders) ? listing.folders : [];
  for (const folderName of folders) {
    const nextRelative = normalizeRemotePath([relativeDir, folderName].filter(Boolean).join('/'));
    await collectRemoteUpdatesForJob(job, joinRemotePath(job.remotePath, nextRelative), nextRelative, lastCheck, updates);
  }
}

async function applyRemoteFileUpdates(updates = []) {
  const jobs = backupManager.getConfig().jobs;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (const update of Array.isArray(updates) ? updates : []) {
    const job = jobs.find((entry) => entry.id === update.jobId)
      || jobs.find((entry) => normalizeRemotePath(entry.remotePath) === normalizeRemotePath(update.remotePath));
    if (!job) {
      skipped += 1;
      continue;
    }

    const relativePath = normalizeRemotePath(update.relativePath || update.fileName || '');
    if (!relativePath) {
      skipped += 1;
      continue;
    }

    const localRoot = path.resolve(job.localPath);
    const localPath = path.resolve(localRoot, ...relativePath.split('/').map(safeLocalFileName));
    if (!isInsidePath(localRoot, localPath)) {
      skipped += 1;
      continue;
    }

    const remotePath = normalizeRemotePath(update.remoteFilePath || joinRemotePath(job.remotePath, relativePath));
    const remoteTime = update.uploaded ? new Date(update.uploaded).getTime() : 0;
    const localStat = await fs.promises.stat(localPath).catch(() => null);
    if (localStat && Number.isFinite(remoteTime) && localStat.mtimeMs >= remoteTime) {
      const remoteSize = Number(update.fileSize);
      if (!Number.isFinite(remoteSize) || remoteSize === localStat.size) {
        skipped += 1;
        continue;
      }
    }

    const tempPath = `${localPath}.r2sync-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await downloadRemoteFileForSync(remotePath, tempPath, {
        name: path.basename(localPath),
        size: update.fileSize
      });
      await fs.promises.rm(localPath, { force: true }).catch(() => {});
      await fs.promises.rename(tempPath, localPath);
      applied += 1;
      backupManager.patchJobLastSyncCheck(job.id);
    } catch (error) {
      failed += 1;
      failures.push({
        remotePath,
        message: error.message
      });
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  pendingSyncUpdates = failed ? updates : [];
  return { ok: failed === 0, applied, skipped, failed, failures };
}

function isInsidePath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  client = new R2DriveClient(path.join(app.getPath('userData'), 'config.json'));
  backupManager = new BackupManager(client, emitBackup, emitTransfer);
  applyAutoLaunch(client.getConfig().autoLaunch || client.getConfig().backupAutoStart);
  registerIpc();
  createTray();
  createWindow();
  if (client.getConfig().startHiddenToTray) {
    hideToTray();
  }
  backupManager.start();

  // ── 多端同步：定期检查远端文件更新 ──
  startSyncUpdatePolling();
  startUpdateChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (isQuitting) {
      stopUpdateChecks();
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  stopUpdateChecks();
});
