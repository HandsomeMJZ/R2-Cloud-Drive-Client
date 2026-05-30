(function () {
  if (window.r2Drive || !window.Capacitor) {
    return;
  }

  const PHOTO_SYNC = window.Capacitor.Plugins?.PhotoSync;
  const DIRECT_UPLOAD_LIMIT = 512 * 1024;
  const DISTRIBUTED_UPLOAD_LIMIT = DIRECT_UPLOAD_LIMIT;
  const CHUNK_SIZE = 32 * 1024 * 1024;
  const MAX_CHUNK_SIZE = 90 * 1024 * 1024;
  const MAX_MULTIPART_PARTS = 10000;
  const MOBILE_UPLOAD_CONCURRENCY = 3;
  const uploadTokens = new Map();
  const listeners = {
    transfer: new Set(),
    backup: new Set()
  };
  const state = {
    baseUrl: localStorage.getItem('r2mobile:baseUrl') || '',
    sessionCookie: localStorage.getItem('r2mobile:sessionCookie') || '',
    downloadDir: '',
    closeBehavior: 'ask',
    minimizeBehavior: 'taskbar',
    startHiddenToTray: false,
    customBrandHtml: '',
    customBrandCss: '',
    albumSyncEnabled: localStorage.getItem('r2mobile:albumSyncEnabled') === 'true',
    albumTarget: localStorage.getItem('r2mobile:albumTarget') || '相册/手机相册',
    albumSourceUri: localStorage.getItem('r2mobile:albumSourceUri') || '',
    albumSourceName: localStorage.getItem('r2mobile:albumSourceName') || ''
  };

  window.r2Drive = {
    getConfig,
    setConfig,
    testConnection,
    selectDownloadDir: async () => ({ canceled: true }),
    login,
    logout,

    list: (remotePath) => requestJson(`/api/list?path=${encodeURIComponent(remotePath || '')}`),
    sharedList: (remotePath) => requestJson(`/api/shared-list?path=${encodeURIComponent(remotePath || '')}`, { includeCookie: false }),
    storage: () => requestJson('/api/storage'),
    mkdir: (remotePath) => requestJson('/api/mkdir', { method: 'POST', body: { path: normalizeRemotePath(remotePath) } }),
    deletePath: (remotePath) => requestJson(`/api/delete?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`, { method: 'DELETE' }),
    deleteBatch: (paths) => requestJson('/api/delete-batch', {
      method: 'POST',
      body: { paths: (Array.isArray(paths) ? paths : [paths]).map(normalizeRemotePath).filter(Boolean) }
    }),
    rename: (from, to) => requestJson('/api/rename', {
      method: 'POST',
      body: { from: normalizeRemotePath(from), to: normalizeRemotePath(to) }
    }),
    selectUploadFiles,
    uploadFiles,
    downloadFile,
    cancelDownload: async () => ({ ok: false, reason: 'unsupported' }),
    previewFile,

    nodesList: () => requestJson('/api/storage-nodes'),
    nodesSave: (node) => requestJson('/api/storage-nodes', { method: 'POST', body: node }),
    nodesDelete: (id) => requestJson(`/api/storage-nodes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    nodesTest: (id) => requestJson(`/api/storage-nodes/test?id=${encodeURIComponent(id)}`, { method: 'POST' }),
    scanOrphans: () => requestJson('/api/orphan-cleanup', { method: 'POST', body: { action: 'scan' } }),
    cleanOrphans: (keys) => requestJson('/api/orphan-cleanup', {
      method: 'POST',
      body: { action: 'clean', keys: Array.isArray(keys) ? keys : [keys] }
    }),

    clipboardGet: async () => ({ items: [], action: 'copy', sourcePath: '' }),
    clipboardSet: async () => ({ ok: true }),
    clipboardDelete: async () => ({ ok: true }),
    clipboardPaste: (payload) => requestJson('/api/clipboard/paste', { method: 'POST', body: payload }),

    getBackupConfig,
    setBackupConfig,
    selectBackupFolder: selectUploadFolder,
    addBackupFolder: addMobileBackupPlaceholder,
    selectAlbumBackupFolder,
    addAlbumBackupFolder,
    removeBackupJob,
    setBackupEnabled,
    runBackupNow,

    openPath: async () => {},
    openExternal: (url) => window.open(url, '_blank'),
    minimizeWindow: async () => {},
    hideToTray: async () => {},
    toggleMaximizeWindow: async () => false,
    closeWindow: async () => {},

    onTransfer(callback) {
      listeners.transfer.add(callback);
      return () => listeners.transfer.delete(callback);
    },
    onBackup(callback) {
      listeners.backup.add(callback);
      return () => listeners.backup.delete(callback);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('mobile-app');
    showMobileSplash();
    setupMobileNavigation();
    setupMobileTopbar();
    setupMobileHiddenDesktopOptions();
    setupMobileActionMenus();
    setupAlbumScrollChrome();
    setupAlbumGlassPatching();
    setupViewerBlankClose();
    setupPullToRefresh();
    setupBackButtonConfirm();
    suppressTouchCallouts();
    const albumButton = document.querySelector('.nav-item[data-view="album"]');
    if (albumButton) {
      setTimeout(() => albumButton.click(), 80);
    }
  });

  function showMobileSplash() {
    if (document.querySelector('.mobile-splash')) {
      return;
    }
    const splash = document.createElement('div');
    splash.className = 'mobile-splash';
    splash.innerHTML = [
      '<div class="mobile-splash-mark">R2</div>',
      '<div class="mobile-splash-title">Cloud Drive</div>',
      '<div class="mobile-splash-bar"><span></span></div>'
    ].join('');
    document.body.append(splash);
    window.setTimeout(() => {
      splash.classList.add('is-leaving');
      window.setTimeout(() => splash.remove(), 560);
    }, 920);
  }

  function setupMobileHiddenDesktopOptions() {
    ['#backupAutoStart', '#backupIntervalInput'].forEach((selector) => {
      const input = document.querySelector(selector);
      input?.closest('label')?.classList.add('mobile-desktop-only');
    });
  }

  function setupMobileTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || topbar.querySelector('#mobileAlbumUploadButton')) {
      return;
    }

    const albumUpload = document.createElement('button');
    albumUpload.id = 'mobileAlbumUploadButton';
    albumUpload.className = 'circle-button mobile-album-upload';
    albumUpload.type = 'button';
    albumUpload.title = '上传到相册';
    albumUpload.append(materialIcon('add_photo_alternate'));
    albumUpload.addEventListener('click', () => document.querySelector('#albumUploadButton')?.click());
    topbar.append(albumUpload);
  }

  function setupMobileNavigation() {
    const nav = document.querySelector('.nav');
    if (!nav) {
      return;
    }

    const drive = nav.querySelector('[data-view="drive"]');
    const album = nav.querySelector('[data-view="album"]');
    const quick = nav.querySelector('[data-view="quick"]');
    const backup = nav.querySelector('[data-view="backup"]');
    const transfers = nav.querySelector('[data-view="transfers"]');
    const nodes = nav.querySelector('[data-view="nodes"]');

    setNavItem(drive, 'cloud', '云盘', 'mobile-tab-drive');
    setNavItem(quick, 'history', '最近访问', 'mobile-tab-quick');
    setNavItem(album, 'photo_library', '相册', 'mobile-tab-album');
    setNavItem(transfers, 'sync_alt', '传输', 'mobile-tab-transfers');
    backup?.classList.add('mobile-lowfreq-tab');
    nodes?.classList.add('mobile-lowfreq-tab');

    if (!nav.querySelector('#mobileMoreTab')) {
      const more = document.createElement('button');
      more.id = 'mobileMoreTab';
      more.className = 'nav-item mobile-tab-more';
      more.dataset.view = 'settings';
      more.type = 'button';
      more.append(materialIcon('more_horiz'), textSpan('更多'));
      more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector('#settingsButton')?.click();
        document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
        more.classList.add('active');
      });
      nav.append(more);
    }

    const settingsView = document.querySelector('#settingsView .settings-panel');
    if (settingsView && !settingsView.querySelector('.mobile-more-actions')) {
      const actions = document.createElement('section');
      actions.className = 'mobile-more-actions';
      actions.append(
        mobileMoreButton('photo_library', '相册同步', () => addAlbumBackupFolder()),
        mobileMoreButton('folder_open', '选择相册路径', () => chooseAndEnableAlbumFolder()),
        mobileMoreButton('backup', '备份状态', () => backup?.click()),
        mobileMoreButton('hub', '存储节点', () => nodes?.click())
      );
      settingsView.prepend(actions);
    }
  }

  function setNavItem(item, icon, label, className) {
    if (!item) {
      return;
    }
    item.classList.add(className);
    const iconEl = item.querySelector('.material-icons-round');
    const labelEl = item.querySelector('span:not(.material-icons-round)');
    if (iconEl) {
      iconEl.textContent = icon;
    }
    if (labelEl) {
      labelEl.textContent = label;
    }
  }

  function setupMobileActionMenus() {
    const actionBar = document.querySelector('#actionBar');
    if (actionBar && !actionBar.querySelector('#mobileSelectionActionButton')) {
      const button = document.createElement('button');
      button.id = 'mobileSelectionActionButton';
      button.className = 'action-btn secondary mobile-selection-menu';
      button.type = 'button';
      button.append(materialIcon('more_horiz'), textSpan('操作'));
      button.addEventListener('click', () => showActionSheet([
        ['content_copy', '复制', '#copySelectedButton'],
        ['content_cut', '剪切', '#cutSelectedButton'],
        ['content_paste', '粘贴', '#pasteButton'],
        ['drive_file_rename_outline', '重命名', '#renameSelectedButton'],
        ['download', '下载', '#downloadSelectedButton'],
        ['delete_outline', '删除', '#deleteSelectedButton']
      ]));
      actionBar.append(button);
    }

    const observer = new MutationObserver(() => patchRowMenus());
    observer.observe(document.body, { childList: true, subtree: true });
    patchRowMenus();
  }

  function setupAlbumScrollChrome() {
    const albumView = document.querySelector('#albumView');
    if (!albumView) {
      return;
    }
    let lastTop = 0;
    albumView.addEventListener('scroll', () => {
      if (document.body.dataset.view !== 'album') {
        return;
      }
      const top = albumView.scrollTop;
      const shouldHide = top > 28 && top > lastTop + 2;
      const shouldShow = top < lastTop - 2 || top < 12;
      if (shouldHide) {
        document.body.classList.add('mobile-album-chrome-hidden');
      } else if (shouldShow) {
        document.body.classList.remove('mobile-album-chrome-hidden');
      }
      lastTop = Math.max(0, top);
    }, { passive: true });

    document.querySelector('.nav')?.addEventListener('click', () => {
      document.body.classList.remove('mobile-album-chrome-hidden');
    });
  }

  function setupAlbumGlassPatching() {
    const ensureBackdrop = () => {
      const albumView = document.querySelector('#albumView');
      const albumGrid = document.querySelector('#albumGrid');
      if (!albumView || !albumGrid) {
        return null;
      }
      let backdrop = albumView.querySelector(':scope > .mobile-album-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'mobile-album-backdrop';
        albumView.insertBefore(backdrop, albumGrid);
      }
      return backdrop;
    };

    const syncBackdrop = () => {
      const backdrop = ensureBackdrop();
      if (!backdrop) {
        return;
      }
      const sources = [...document.querySelectorAll('#albumGrid .album-preview img')]
        .map((img) => img.currentSrc || img.src)
        .filter(Boolean)
        .slice(0, 180);
      if (backdrop.dataset.sources === sources.join('\n')) {
        return;
      }
      backdrop.dataset.sources = sources.join('\n');
      backdrop.replaceChildren(...sources.map((source) => {
        const cell = document.createElement('div');
        cell.className = 'mobile-album-bg-cell';
        cell.style.backgroundImage = `url("${source.replace(/"/g, '\\"')}")`;
        return cell;
      }));
    };

    const patch = () => {
      document.querySelectorAll('#albumGrid .album-preview img').forEach((img) => {
        const preview = img.closest('.album-preview');
        if (!preview || preview.classList.contains('has-mobile-glass')) {
          return;
        }
        const apply = () => {
          if (!img.currentSrc && !img.src) {
            return;
          }
          preview.style.setProperty('--album-glass-image', `url("${img.currentSrc || img.src}")`);
          preview.classList.add('has-mobile-glass');
          syncBackdrop();
        };
        if (img.complete) {
          apply();
        } else {
          img.addEventListener('load', apply, { once: true });
        }
      });
      syncBackdrop();
    };
    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true });
    patch();
  }

  function setupViewerBlankClose() {
    const viewer = document.querySelector('#mediaViewer');
    if (!viewer) {
      return;
    }
    viewer.addEventListener('click', (event) => {
      if (!document.body.classList.contains('mobile-app')) {
        return;
      }
      if (event.target.closest('img, video, button, .viewer-topbar, .viewer-meta')) {
        return;
      }
      document.querySelector('#viewerCloseButton')?.click();
    }, true);
  }

  function setupPullToRefresh() {
    if (document.querySelector('.pull-refresh-indicator')) {
      return;
    }

    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.textContent = '松开刷新';
    document.body.append(indicator);

    let startX = 0;
    let startY = 0;
    let pulling = false;
    let distance = 0;

    document.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1 || event.target.closest('input, textarea, button, .media-viewer, .mobile-action-sheet')) {
        return;
      }
      const view = activeScrollableView();
      if (!view || view.scrollTop > 0) {
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      pulling = true;
      distance = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (event) => {
      if (!pulling || event.touches.length !== 1) {
        return;
      }
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) > Math.max(24, Math.abs(dy) * 0.65)) {
        pulling = false;
        indicator.classList.remove('is-visible');
        return;
      }
      distance = Math.max(0, dy);
      if (distance > 18) {
        indicator.classList.add('is-visible');
        indicator.style.transform = `translate(-50%, ${Math.min(46, distance * 0.35)}px) scale(1)`;
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!pulling) {
        return;
      }
      pulling = false;
      indicator.classList.remove('is-visible');
      indicator.style.transform = '';
      if (distance >= 72) {
        triggerMobileRefresh();
      }
    }, { passive: true });
  }

  function setupBackButtonConfirm() {
    let lastBackAt = 0;
    document.addEventListener('backbutton', (event) => {
      event.preventDefault();
      if (!document.querySelector('#mediaViewer')?.classList.contains('hidden')) {
        document.querySelector('#viewerCloseButton')?.click();
        return;
      }
      if (document.body.dataset.view === 'drive' && !document.querySelector('#backButton')?.disabled) {
        document.querySelector('#backButton')?.click();
        return;
      }
      if (document.body.dataset.view === 'album' && !document.querySelector('#albumBackButton')?.disabled) {
        document.querySelector('#albumBackButton')?.click();
        return;
      }

      const now = Date.now();
      if (now - lastBackAt < 1800) {
        navigator.app?.exitApp?.();
        return;
      }
      lastBackAt = now;
      showMobileToast('再按一次返回退出');
    }, false);
  }

  function activeScrollableView() {
    return document.querySelector('.view:not(.hidden)');
  }

  function triggerMobileRefresh() {
    const view = document.body.dataset.view;
    if (view === 'album') {
      document.querySelector('#albumRefreshButton')?.click();
    } else if (view === 'drive') {
      document.querySelector('#refreshButton')?.click();
    } else if (view === 'nodes') {
      document.querySelector('#nodesRefreshButton')?.click();
    } else {
      document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
    }
    showMobileToast('正在刷新');
  }

  function showMobileToast(message) {
    const toast = document.querySelector('#toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.remove('hidden');
      clearTimeout(showMobileToast.timer);
      showMobileToast.timer = setTimeout(() => toast.classList.add('hidden'), 1800);
    }
  }

  function patchRowMenus() {
    document.querySelectorAll('.row-actions').forEach((actions) => {
      if (actions.querySelector('.mobile-row-menu')) {
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary mobile-row-menu';
      button.title = '操作';
      button.append(materialIcon('more_vert'));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const items = [...actions.querySelectorAll('button:not(.mobile-row-menu)')]
          .map((source) => [source.querySelector('.material-icons-round')?.textContent || 'radio_button_unchecked', source.textContent.trim() || source.title || '操作', source])
          .filter(([, , source]) => !source.disabled);
        showActionSheet(items);
      });
      actions.append(button);
    });
  }

  function showActionSheet(items) {
    document.querySelector('.mobile-action-sheet')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-action-sheet';
    const panel = document.createElement('div');
    panel.className = 'mobile-action-panel';
    for (const [icon, label, target] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.append(materialIcon(icon), textSpan(label));
      button.addEventListener('click', () => {
        backdrop.remove();
        if (typeof target === 'string') {
          document.querySelector(target)?.click();
        } else {
          target?.click?.();
        }
      });
      panel.append(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mobile-action-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => backdrop.remove());
    panel.append(cancel);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        backdrop.remove();
      }
    });
    backdrop.append(panel);
    document.body.append(backdrop);
  }

  function suppressTouchCallouts() {
    document.addEventListener('contextmenu', (event) => {
      if (!event.target.closest('input, textarea')) {
        event.preventDefault();
      }
    }, true);
    document.addEventListener('selectstart', (event) => {
      if (!event.target.closest('input, textarea')) {
        event.preventDefault();
      }
    }, true);
  }

  function mobileMoreButton(icon, label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary mobile-more-button';
    button.append(materialIcon(icon), textSpan(label));
    button.addEventListener('click', handler);
    return button;
  }

  function materialIcon(name) {
    const icon = document.createElement('span');
    icon.className = 'material-icons-round';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = name;
    return icon;
  }

  function textSpan(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  async function getConfig() {
    return {
      baseUrl: state.baseUrl,
      downloadDir: '',
      closeBehavior: state.closeBehavior,
      minimizeBehavior: state.minimizeBehavior,
      startHiddenToTray: state.startHiddenToTray,
      customBrandHtml: state.customBrandHtml,
      customBrandCss: state.customBrandCss,
      hasSession: Boolean(state.sessionCookie)
    };
  }

  async function setConfig(config = {}) {
    if (typeof config.baseUrl === 'string') {
      state.baseUrl = normalizeBaseUrl(config.baseUrl);
      localStorage.setItem('r2mobile:baseUrl', state.baseUrl);
      await configureNativeSync();
    }
    if (typeof config.customBrandHtml === 'string') {
      state.customBrandHtml = config.customBrandHtml;
    }
    if (typeof config.customBrandCss === 'string') {
      state.customBrandCss = config.customBrandCss;
    }
    if (['ask', 'tray', 'quit'].includes(config.closeBehavior)) {
      state.closeBehavior = config.closeBehavior;
    }
    if (['taskbar', 'tray'].includes(config.minimizeBehavior)) {
      state.minimizeBehavior = config.minimizeBehavior;
    }
    if (typeof config.startHiddenToTray === 'boolean') {
      state.startHiddenToTray = config.startHiddenToTray;
    }
    return getConfig();
  }

  async function testConnection() {
    const startedAt = Date.now();
    const storage = await requestJson('/api/storage');
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      storage
    };
  }

  async function login(password) {
    const result = await requestJson('/api/login', {
      method: 'POST',
      includeCookie: false,
      body: { password: password || '' }
    });
    localStorage.setItem('r2mobile:sessionCookie', state.sessionCookie);
    await configureNativeSync();
    return { ...result, hasSession: Boolean(state.sessionCookie) };
  }

  async function logout() {
    try {
      await requestJson('/api/logout', { method: 'POST' });
    } finally {
      state.sessionCookie = '';
      localStorage.removeItem('r2mobile:sessionCookie');
      await configureNativeSync({ enabled: false });
    }
    return {};
  }

  async function selectUploadFiles() {
    const files = await pickFiles('image/*,video/*,*/*', true);
    return files.map((file) => {
      const token = `mobile-file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      uploadTokens.set(token, file);
      return token;
    });
  }

  async function uploadFiles(fileTokens, remotePath) {
    const results = [];
    await runWithConcurrency(fileTokens || [], MOBILE_UPLOAD_CONCURRENCY, async (token) => {
      const file = uploadTokens.get(token);
      if (!file) {
        return;
      }
      const target = joinRemote(remotePath || '', file.name);
      const transferId = `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      emitTransfer({
        id: transferId,
        type: 'upload',
        name: file.name,
        remotePath: target,
        status: 'running',
        phase: '上传中',
        transferred: 0,
        total: file.size
      });
      try {
        await uploadBlob(file, target, (progress) => {
          emitTransfer({
            id: transferId,
            type: 'upload',
            name: file.name,
            remotePath: target,
            status: 'running',
            ...progress
          });
        });
        emitTransfer({
          id: transferId,
          type: 'upload',
          name: file.name,
          remotePath: target,
          status: 'done',
          phase: '上传完成',
          transferred: file.size,
          total: file.size
        });
        results.push({ ok: true, filePath: file.name, remotePath: target });
      } catch (error) {
        emitTransfer({
          id: transferId,
          type: 'upload',
          name: file.name,
          remotePath: target,
          status: 'error',
          phase: '上传失败',
          message: error.message
        });
        results.push({ ok: false, filePath: file.name, remotePath: target, error: error.message });
      } finally {
        uploadTokens.delete(token);
      }
    });
    return results;
  }

  async function downloadFile(remotePath, name) {
    const url = makeUrl(`/api/download?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`);
    window.open(url.toString(), '_blank');
    return { ok: true, filePath: name || remotePath };
  }

  async function previewFile(remotePath, maxBytes) {
    const response = await fetch(makeUrl(`/api/download?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`), {
      headers: cookieHeaders()
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (maxBytes && contentLength > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }
    const blob = await response.blob();
    if (maxBytes && blob.size > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }
    return { ok: true, dataUrl: await blobToDataUrl(blob) };
  }

  async function getBackupConfig() {
    const status = await nativeStatus();
    const jobs = [];
    if (state.albumSyncEnabled) {
      const sourceName = status.sourceTreeName || state.albumSourceName;
      jobs.push({
        id: 'android-album-sync',
        name: '手机相册',
        localPath: sourceName ? `自定义路径：${sourceName}` : 'Android 相册媒体库',
        remotePath: state.albumTarget,
        kind: 'album',
        mediaOnly: true,
        enabled: true,
        lastRunAt: status.lastRunAt || '',
        lastStatus: status.lastStatus || 'idle',
        lastMessage: status.lastMessage || '后台相册同步已开启',
        stats: {
          scanned: status.scanned || 0,
          uploaded: status.uploaded || 0,
          skipped: status.skipped || 0,
          failed: status.failed || 0
        }
      });
    }
    return {
      jobs,
      intervalMinutes: 15,
      autoStart: state.albumSyncEnabled,
      runningJobIds: []
    };
  }

  async function setBackupConfig(config = {}) {
    if (typeof config.autoStart === 'boolean') {
      state.albumSyncEnabled = config.autoStart;
      localStorage.setItem('r2mobile:albumSyncEnabled', String(state.albumSyncEnabled));
      await configureNativeSync();
    }
    return getBackupConfig();
  }

  async function selectUploadFolder() {
    return { canceled: true };
  }

  async function addMobileBackupPlaceholder() {
    return getBackupConfig();
  }

  async function selectAlbumBackupFolder() {
    if (PHOTO_SYNC?.selectAlbumFolder) {
      const result = await PHOTO_SYNC.selectAlbumFolder();
      if (result?.canceled) {
        return { canceled: true };
      }
      state.albumSourceUri = result.uri || '';
      state.albumSourceName = result.name || '自定义相册目录';
      localStorage.setItem('r2mobile:albumSourceUri', state.albumSourceUri);
      localStorage.setItem('r2mobile:albumSourceName', state.albumSourceName);
      await configureNativeSync();
      return { canceled: false, filePath: state.albumSourceName };
    }

    const ok = await ensureNativePermission();
    if (!ok) {
      return { canceled: true };
    }
    return { canceled: false, filePath: 'Android 相册媒体库' };
  }

  async function chooseAndEnableAlbumFolder() {
    const result = await selectAlbumBackupFolder();
    if (result?.canceled) {
      return getBackupConfig();
    }
    return addAlbumBackupFolder(result.filePath);
  }

  async function addAlbumBackupFolder() {
    state.albumSyncEnabled = true;
    localStorage.setItem('r2mobile:albumSyncEnabled', 'true');
    await configureNativeSync({ enabled: true });
    await runBackupNow('android-album-sync');
    return getBackupConfig();
  }

  async function removeBackupJob() {
    state.albumSyncEnabled = false;
    localStorage.setItem('r2mobile:albumSyncEnabled', 'false');
    await configureNativeSync({ enabled: false });
    return getBackupConfig();
  }

  async function setBackupEnabled(id, enabled) {
    state.albumSyncEnabled = Boolean(enabled);
    localStorage.setItem('r2mobile:albumSyncEnabled', String(state.albumSyncEnabled));
    await configureNativeSync();
    return getBackupConfig();
  }

  async function runBackupNow() {
    await configureNativeSync();
    if (PHOTO_SYNC?.runNow) {
      await PHOTO_SYNC.runNow();
    }
    emitBackup({
      jobId: 'android-album-sync',
      jobName: '手机相册',
      status: 'running',
      phase: '后台相册同步已启动',
      stats: { scanned: 0, uploaded: 0, skipped: 0, failed: 0 }
    });
    return getBackupConfig();
  }

  async function requestJson(route, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.includeCookie === false ? {} : cookieHeaders())
    };
    const response = await fetch(makeUrl(route), {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'include'
    });
    captureCookie(response);
    const text = await response.text();
    if (!response.ok) {
      throw httpError(response.status, text);
    }
    return text ? JSON.parse(text) : {};
  }

  async function uploadBlob(blob, remotePath, onProgress) {
    const targetPath = normalizeRemotePath(remotePath);
    const plan = createUploadPlan(blob.size || 0);

    onProgress?.({
      transferred: 0,
      total: blob.size,
      phase: '准备上传',
      strategy: plan.strategy
    });

    if ((blob.size || 0) <= DIRECT_UPLOAD_LIMIT) {
      return uploadSimpleBlob(blob, targetPath, onProgress);
    }

    if ((blob.size || 0) > DISTRIBUTED_UPLOAD_LIMIT) {
      try {
        return await uploadDistributedBlob(blob, targetPath, plan, onProgress);
      } catch (error) {
        if (!isDistributedFallbackError(error)) {
          throw error;
        }
      }
    }

    return uploadMultipartBlob(blob, targetPath, plan, onProgress);
  }

  async function uploadSimpleBlob(blob, remotePath, onProgress) {
    const response = await fetch(makeUrl(`/api/upload?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`), {
      method: 'POST',
      headers: {
        ...cookieHeaders(),
        'Content-Type': 'application/octet-stream'
      },
      body: blob,
      credentials: 'include'
    });
    captureCookie(response);
    if (!response.ok) {
      throw httpError(response.status, await response.text());
    }
    onProgress?.({
      transferred: blob.size,
      total: blob.size,
      phase: '普通上传',
      strategy: 'simple'
    });
    return response.text();
  }

  async function uploadDistributedBlob(blob, remotePath, plan, onProgress) {
    let sessionId = '';
    try {
      const init = await requestJson('/api/distributed/init', {
        method: 'POST',
        body: {
          path: remotePath,
          size: blob.size,
          contentType: blob.type || 'application/octet-stream',
          chunkSize: plan.chunkSize,
          parts: plan.partCount
        }
      });

      sessionId = init.sessionId || '';
      const parts = Array.isArray(init.parts) ? init.parts.slice().sort((a, b) => a.partNumber - b.partNumber) : [];
      if (!init.ok || !sessionId || !parts.length) {
        throw new Error('分布式上传初始化响应无效');
      }

      let completed = 0;
      for (const part of parts) {
        const partNumber = Number(part.partNumber);
        const partSize = Number(part.size || 0);
        if (!partNumber || partSize <= 0 || !part.uploadUrl) {
          throw new Error('分布式上传分片信息无效');
        }

        const start = (partNumber - 1) * plan.chunkSize;
        const chunk = blob.slice(start, start + partSize);
        const response = await fetch(makeUrl(part.uploadUrl), {
          method: 'PUT',
          headers: {
            ...cookieHeaders(),
            'Content-Type': 'application/octet-stream'
          },
          body: chunk,
          credentials: 'include'
        });
        captureCookie(response);
        if (!response.ok) {
          throw httpError(response.status, await response.text());
        }
        completed += partSize;
        onProgress?.({
          transferred: Math.min(completed, blob.size),
          total: blob.size,
          phase: `分布式上传 ${partNumber}/${plan.partCount}`,
          strategy: 'distributed',
          partNumber,
          partCount: plan.partCount
        });
      }

      await requestJson('/api/distributed/complete', {
        method: 'POST',
        body: { sessionId }
      });
      return { ok: true, strategy: 'distributed' };
    } catch (error) {
      if (sessionId) {
        await requestJson('/api/distributed/abort', {
          method: 'POST',
          body: { sessionId }
        }).catch(() => {});
      }
      throw error;
    }
  }

  async function uploadMultipartBlob(blob, remotePath, plan, onProgress) {
    const init = await requestJson('/api/multipart/init', {
      method: 'POST',
      body: {
        path: remotePath,
        contentType: blob.type || 'application/octet-stream'
      }
    });

    if (!init.uploadId) {
      throw new Error('R2 分片上传初始化响应无效');
    }

    const parts = [];
    let completed = 0;
    try {
      for (let partNumber = 1; partNumber <= plan.partCount; partNumber += 1) {
        const start = (partNumber - 1) * plan.chunkSize;
        const partSize = Math.min(plan.chunkSize, blob.size - start);
        const response = await fetch(makeUrl(`/api/multipart/part?path=${encodeURIComponent(remotePath)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`), {
          method: 'POST',
          headers: {
            ...cookieHeaders(),
            'Content-Type': 'application/octet-stream'
          },
          body: blob.slice(start, start + partSize),
          credentials: 'include'
        });
        captureCookie(response);
        const text = await response.text();
        if (!response.ok) {
          throw httpError(response.status, text);
        }
        parts.push(text ? JSON.parse(text) : {});
        completed += partSize;
        onProgress?.({
          transferred: Math.min(completed, blob.size),
          total: blob.size,
          phase: `R2 分片上传 ${partNumber}/${plan.partCount}`,
          strategy: 'multipart',
          partNumber,
          partCount: plan.partCount
        });
      }

      return requestJson('/api/multipart/complete', {
        method: 'POST',
        body: {
          path: remotePath,
          uploadId: init.uploadId,
          parts
        }
      });
    } catch (error) {
      await requestJson('/api/multipart/abort', {
        method: 'POST',
        body: {
          path: remotePath,
          uploadId: init.uploadId
        }
      }).catch(() => {});
      throw error;
    }
  }

  async function ensureNativePermission() {
    if (!PHOTO_SYNC?.requestPermissions) {
      return true;
    }
    const result = await PHOTO_SYNC.requestPermissions();
    if (result.granted !== false) {
      return true;
    }
    if (PHOTO_SYNC.requestAllFilesAccess) {
      const fallback = await PHOTO_SYNC.requestAllFilesAccess().catch(() => ({ granted: false }));
      return fallback.granted !== false || fallback.allFiles === true;
    }
    return false;
  }

  async function configureNativeSync(extra = {}) {
    if (!PHOTO_SYNC?.configure) {
      return;
    }
    if ((extra.enabled !== undefined ? extra.enabled : state.albumSyncEnabled) && !(await ensureNativePermission())) {
      emitBackup({
        jobId: 'android-album-sync',
        jobName: '手机相册',
        status: 'error',
        phase: '相册权限未授予',
        message: '请在系统权限中允许访问照片和视频，或选择一个自定义相册路径',
        stats: { scanned: 0, uploaded: 0, skipped: 0, failed: 0 }
      });
      return;
    }
    await PHOTO_SYNC.configure({
      baseUrl: state.baseUrl,
      cookie: state.sessionCookie,
      targetPath: state.albumTarget,
      sourceTreeUri: state.albumSourceUri,
      sourceTreeName: state.albumSourceName,
      enabled: extra.enabled !== undefined ? extra.enabled : state.albumSyncEnabled
    }).catch(() => {});
  }

  async function nativeStatus() {
    if (!PHOTO_SYNC?.status) {
      return {};
    }
    return PHOTO_SYNC.status().catch(() => ({}));
  }

  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.addEventListener('change', () => resolve([...input.files]));
      input.click();
    });
  }

  function emitTransfer(payload) {
    for (const listener of listeners.transfer) {
      listener(payload);
    }
  }

  function emitBackup(payload) {
    for (const listener of listeners.backup) {
      listener(payload);
    }
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

  function createUploadPlan(size) {
    const strategy = size > DISTRIBUTED_UPLOAD_LIMIT
      ? 'distributed'
      : size > DIRECT_UPLOAD_LIMIT
        ? 'multipart'
        : 'simple';
    let chunkSize = CHUNK_SIZE;
    let partCount = Math.max(1, Math.ceil(size / chunkSize));

    if (partCount > MAX_MULTIPART_PARTS) {
      chunkSize = Math.ceil(size / MAX_MULTIPART_PARTS);
      chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(CHUNK_SIZE, chunkSize));
      partCount = Math.ceil(size / chunkSize);
    }

    if (partCount > MAX_MULTIPART_PARTS || chunkSize > MAX_CHUNK_SIZE) {
      throw new Error('文件过大，超过当前分片上传限制');
    }

    return {
      strategy,
      chunkSize,
      partCount
    };
  }

  function httpError(status, body) {
    const error = new Error(`HTTP ${status}${body ? `: ${String(body).slice(0, 180)}` : ''}`);
    error.status = status;
    error.body = body || '';
    return error;
  }

  function isDistributedFallbackError(error) {
    return error?.status === 409 || (error?.status === 400 && /distributed|threshold|below/i.test(String(error.body || error.message || '')));
  }

  function makeUrl(route) {
    if (!state.baseUrl) {
      throw new Error('请先设置 API 地址');
    }
    return new URL(route, state.baseUrl);
  }

  function cookieHeaders() {
    return state.sessionCookie ? { Cookie: state.sessionCookie } : {};
  }

  function captureCookie(response) {
    const cookie = response.headers.get('set-cookie') || '';
    const match = cookie.match(/r2drive_session=[^;]*/i);
    if (match) {
      state.sessionCookie = match[0];
      localStorage.setItem('r2mobile:sessionCookie', state.sessionCookie);
      configureNativeSync();
    }
  }

  function normalizeBaseUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return '';
    }
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  }

  function normalizeRemotePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/, '');
  }

  function joinRemote(...segments) {
    return normalizeRemotePath(segments.filter(Boolean).join('/'));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
})();
