const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { R2DriveClient, normalizeRemotePath } = require('./apiClient');
const { BackupManager } = require('./backupManager');

let mainWindow;
let tray;
let client;
let backupManager;
let isQuitting = false;
let closePromptOpen = false;
const activeDownloads = new Map();
const MAX_PARALLEL_UPLOADS = 3;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 360,
    minHeight: 540,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafd',
    title: 'R2 Cloud Drive',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
      message: '要关闭程序，还是最小化到托盘继续后台备份？',
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('transfer:event', payload);
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

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#1a73e8"/>',
    '<path fill="#fff" d="M8 20.5c-2.2 0-4-1.8-4-4 0-1.9 1.4-3.6 3.2-3.9A7 7 0 0 1 20.3 10a5.4 5.4 0 0 1 1.2 10.5H8z"/>',
    '<path fill="#34a853" d="M17 13h8v3h-8zM17 18h8v3h-8z"/>',
    '</svg>'
  ].join('');
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('R2 Cloud Drive');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '立即自动备份', click: () => backupManager?.runAll({ reason: 'tray' }) },
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

async function resolveDownloadTarget(defaultName) {
  const downloadDir = client.getConfig().downloadDir;
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

  ipcMain.handle('backup:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要自动备份的文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths.length
      ? { canceled: true }
      : { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('backup:add-folder', (event, folderPath) => backupManager.addJob(folderPath));

  ipcMain.handle('backup:select-album-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要备份到相册的文件夹',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths.length
      ? { canceled: true }
      : { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('backup:add-album-folder', (event, folderPath) => backupManager.addAlbumJob(folderPath));

  ipcMain.handle('backup:remove-job', (event, id) => backupManager.removeJob(id));

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

    await runWithConcurrency(filePaths, MAX_PARALLEL_UPLOADS, async (filePath) => {
      const fileName = path.basename(filePath);
      const remotePath = joinRemotePath(remoteDir, fileName);
      const transferId = makeTransferId('upload');

      emitTransfer({
        id: transferId,
        type: 'upload',
        name: fileName,
        remotePath,
        status: 'running',
        phase: '准备上传',
        transferred: 0,
        total: 0
      });

      const emitProgress = makeProgressEmitter(transferId, {
        type: 'upload',
        name: fileName,
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
          remotePath,
          status: 'done',
          phase: '上传完成'
        });
        results.push({ ok: true, filePath, remotePath });
      } catch (error) {
        emitProgress.cancel();
        emitTransfer({
          id: transferId,
          type: 'upload',
          name: fileName,
          remotePath,
          status: 'error',
          phase: lastUploadPhase ? `${lastUploadPhase}失败` : '上传失败',
          strategy: lastUploadStrategy,
          message: error.message
        });
        results.push({ ok: false, filePath, remotePath, error: error.message });
      }
    });

    return results;
  });

  ipcMain.handle('drive:download', async (event, payload) => {
    const remotePath = normalizeRemotePath(payload?.remotePath || '');
    const defaultName = safeLocalFileName(payload?.name || path.posix.basename(remotePath));
    const result = await resolveDownloadTarget(defaultName);

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const transferId = makeTransferId('download');
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
      total: 0
    });

    const emitProgress = makeProgressEmitter(transferId, {
      type: 'download',
      name: defaultName,
      remotePath,
      localPath: result.filePath,
      status: 'running',
      phase: '下载中'
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
        phase: '下载完成'
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
          message: '下载已取消'
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
        message: error.message
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  client = new R2DriveClient(path.join(app.getPath('userData'), 'config.json'));
  backupManager = new BackupManager(client, emitBackup);
  applyAutoLaunch(client.getConfig().backupAutoStart);
  registerIpc();
  createTray();
  createWindow();
  backupManager.start();

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
      app.quit();
    }
  }
});
