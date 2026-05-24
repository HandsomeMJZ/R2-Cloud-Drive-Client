const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { R2DriveClient, normalizeRemotePath } = require('./apiClient');

let mainWindow;
let client;
const activeDownloads = new Map();

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
}

function emitTransfer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('transfer:event', payload);
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

    for (const filePath of filePaths) {
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

      try {
        await client.uploadFile(filePath, remotePath, (progress) => {
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
          phase: '上传失败',
          message: error.message
        });
        results.push({ ok: false, filePath, remotePath, error: error.message });
      }
    }

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

  ipcMain.handle('shell:open-path', (event, filePath) => shell.showItemInFolder(filePath));

  ipcMain.handle('shell:open-external', (event, url) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('只允许打开 HTTP/HTTPS 链接');
    }
    return shell.openExternal(target.toString());
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
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
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
