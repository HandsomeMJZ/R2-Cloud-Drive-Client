const api = window.r2Drive;
const ALBUM_ROOT = '相册';
const FILE_VIEW_STORAGE_KEY = 'r2drive-file-view';
const DOWNLOAD_HISTORY_STORAGE_KEY = 'r2drive-download-history';
const FULL_PREVIEW_LIMIT = 32 * 1024 * 1024;
const MAX_DOWNLOAD_HISTORY = 100;
const MATERIAL_ICON_BY_KEY = {
  'open-icon': 'open_in_new',
  'preview-icon': 'visibility',
  'download-icon': 'download',
  'rename-icon': 'drive_file_rename_outline',
  'trash-icon': 'delete_outline',
  'copy-icon': 'content_copy',
  'cut-icon': 'content_cut',
  'paste-icon': 'content_paste',
  'upload-icon': 'upload',
  'folder-plus-icon': 'create_new_folder',
  'refresh-icon': 'refresh'
};
const MATERIAL_ICON_BY_ACTION = {
  打开: 'open_in_new',
  预览: 'visibility',
  下载: 'download',
  重命名: 'drive_file_rename_outline',
  复制: 'content_copy',
  剪切: 'content_cut',
  删除: 'delete_outline',
  取消: 'close',
  定位: 'folder_open',
  编辑: 'edit',
  测试: 'network_check'
};
let transferRenderQueued = false;

const state = {
  config: null,
  view: 'drive',
  fileViewMode: localStorage.getItem(FILE_VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list',
  currentPath: '',
  albumPath: ALBUM_ROOT,
  folders: [],
  files: [],
  albumFolders: [],
  albumFiles: [],
  quickFolders: [],
  quickFiles: [],
  storage: null,
  nodes: [],
  backup: {
    jobs: [],
    intervalMinutes: 15,
    autoStart: false,
    statuses: new Map()
  },
  syncBootstrap: {
    remoteDirs: []
  },
  backupSyncDiff: {
    localOnly: [],
    remoteOnly: [],
    synced: [],
    checked: false
  },
  transfers: new Map(),
  downloadHistory: [],
  previewCache: new Map(),
  fullPreviewCache: new Map(),
  search: '',
  contextElement: null,
  dialogResolve: null,
  busyCount: 0,
  clipboard: null, // { items: [...], action: 'copy'|'cut', sourcePath: '' }
  selectedItems: new Map(), // name -> { name, type }
  pendingSyncUpdates: [],
  update: {
    appInfo: null,
    pending: null,
    checking: false
  },
  viewer: {
    items: [],
    index: 0,
    token: 0
  }
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  init();
});

function cacheElements() {
  Object.assign(els, {
    titlebarDrag: document.querySelector('#titlebarDrag'),
    titlebarMark: document.querySelector('#titlebarMark'),
    brandMark: document.querySelector('#brandMark'),
    customBrandStyle: document.querySelector('#customBrandStyle'),
    windowMinimizeButton: document.querySelector('#windowMinimizeButton'),
    windowMaximizeButton: document.querySelector('#windowMaximizeButton'),
    windowCloseButton: document.querySelector('#windowCloseButton'),
    loadingBar: document.querySelector('#loadingBar'),
    serverStatus: document.querySelector('#serverStatus'),
    storageText: document.querySelector('#storageText'),
    storageMeter: document.querySelector('#storageMeter'),
    nodeSummary: document.querySelector('#nodeSummary'),
    storageCard: document.querySelector('#storageCard'),
    storagePopover: document.querySelector('#storagePopover'),
    storageCloseButton: document.querySelector('#storageCloseButton'),
    storageNodeList: document.querySelector('#storageNodeList'),
    newButton: document.querySelector('#newButton'),
    newMenu: document.querySelector('#newMenu'),
    newFolderAction: document.querySelector('#newFolderAction'),
    newUploadAction: document.querySelector('#newUploadAction'),
    themeToggle: document.querySelector('#themeToggle'),
    settingsButton: document.querySelector('#settingsButton'),
    searchInput: document.querySelector('#searchInput'),
    viewTitle: document.querySelector('#viewTitle'),
    breadcrumb: document.querySelector('#breadcrumb'),
    driveToolbar: document.querySelector('#driveToolbar'),
    albumToolbar: document.querySelector('#albumToolbar'),
    driveView: document.querySelector('#driveView'),
    albumView: document.querySelector('#albumView'),
    quickView: document.querySelector('#quickView'),
    backupView: document.querySelector('#backupView'),
    transfersView: document.querySelector('#transfersView'),
    nodesView: document.querySelector('#nodesView'),
    settingsView: document.querySelector('#settingsView'),
    driveTableWrap: document.querySelector('#driveTableWrap'),
    fileGrid: document.querySelector('#fileGrid'),
    fileRows: document.querySelector('#fileRows'),
    fileEmpty: document.querySelector('#fileEmpty'),
    albumGrid: document.querySelector('#albumGrid'),
    albumEmpty: document.querySelector('#albumEmpty'),
    quickFolders: document.querySelector('#quickFolders'),
    quickFiles: document.querySelector('#quickFiles'),
    quickEmpty: document.querySelector('#quickEmpty'),
    backupAutoStart: document.querySelector('#backupAutoStart'),
    backupIntervalInput: document.querySelector('#backupIntervalInput'),
    backupSaveSettingsButton: document.querySelector('#backupSaveSettingsButton'),
    backupSelectFolderButton: document.querySelector('#backupSelectFolderButton'),
    backupRunAllButton: document.querySelector('#backupRunAllButton'),
    backupJobList: document.querySelector('#backupJobList'),
    backupEmpty: document.querySelector('#backupEmpty'),
    backButton: document.querySelector('#backButton'),
    refreshButton: document.querySelector('#refreshButton'),
    uploadButton: document.querySelector('#uploadButton'),
    mkdirButton: document.querySelector('#mkdirButton'),
    pasteButton: document.querySelector('#pasteButton'),
    actionBar: document.querySelector('#actionBar'),
    actionBarCount: document.querySelector('#actionBarCount'),
    copySelectedButton: document.querySelector('#copySelectedButton'),
    cutSelectedButton: document.querySelector('#cutSelectedButton'),
    renameSelectedButton: document.querySelector('#renameSelectedButton'),
    downloadSelectedButton: document.querySelector('#downloadSelectedButton'),
    deleteSelectedButton: document.querySelector('#deleteSelectedButton'),
    albumBackButton: document.querySelector('#albumBackButton'),
    albumRefreshButton: document.querySelector('#albumRefreshButton'),
    albumUploadButton: document.querySelector('#albumUploadButton'),
    albumBackupButton: document.querySelector('#albumBackupButton'),
    configForm: document.querySelector('#configForm'),
    baseUrlInput: document.querySelector('#baseUrlInput'),
    testConnectionButton: document.querySelector('#testConnectionButton'),
    brandForm: document.querySelector('#brandForm'),
    brandHtmlInput: document.querySelector('#brandHtmlInput'),
    brandCssInput: document.querySelector('#brandCssInput'),
    desktopBehaviorForm: document.querySelector('#desktopBehaviorForm'),
    closeBehaviorSelect: document.querySelector('#closeBehaviorSelect'),
    minimizeBehaviorSelect: document.querySelector('#minimizeBehaviorSelect'),
    startHiddenToTrayInput: document.querySelector('#startHiddenToTrayInput'),
    autoLaunchInput: document.querySelector('#autoLaunchInput'),
    uploadBatchNotifyInput: document.querySelector('#uploadBatchNotifyInput'),
    downloadBatchNotifyInput: document.querySelector('#downloadBatchNotifyInput'),
    updateForm: document.querySelector('#updateForm'),
    updateAutoCheckInput: document.querySelector('#updateAutoCheckInput'),
    updateCheckButton: document.querySelector('#updateCheckButton'),
    updateVersionText: document.querySelector('#updateVersionText'),
    updateStatus: document.querySelector('#updateStatus'),
    downloadForm: document.querySelector('#downloadForm'),
    downloadDirInput: document.querySelector('#downloadDirInput'),
    selectDownloadDirButton: document.querySelector('#selectDownloadDirButton'),
    clearDownloadDirButton: document.querySelector('#clearDownloadDirButton'),
    transferDownloadForm: document.querySelector('#transferDownloadForm'),
    transferDownloadDirInput: document.querySelector('#transferDownloadDirInput'),
    transferSelectDownloadDirButton: document.querySelector('#transferSelectDownloadDirButton'),
    transferClearDownloadDirButton: document.querySelector('#transferClearDownloadDirButton'),
    loginForm: document.querySelector('#loginForm'),
    passwordInput: document.querySelector('#passwordInput'),
    logoutButton: document.querySelector('#logoutButton'),
    authModal: document.querySelector('#authModal'),
    authForm: document.querySelector('#authForm'),
    authBaseUrl: document.querySelector('#authBaseUrl'),
    authPassword: document.querySelector('#authPassword'),
    openSharedButton: document.querySelector('#openSharedButton'),
    fileListModeButton: document.querySelector('#fileListModeButton'),
    fileGridModeButton: document.querySelector('#fileGridModeButton'),
    mediaViewer: document.querySelector('#mediaViewer'),
    viewerTitle: document.querySelector('#viewerTitle'),
    viewerStage: document.querySelector('#viewerStage'),
    viewerMeta: document.querySelector('#viewerMeta'),
    viewerDownloadButton: document.querySelector('#viewerDownloadButton'),
    viewerCloseButton: document.querySelector('#viewerCloseButton'),
    viewerPrevButton: document.querySelector('#viewerPrevButton'),
    viewerNextButton: document.querySelector('#viewerNextButton'),
    dialogModal: document.querySelector('#dialogModal'),
    dialogForm: document.querySelector('#dialogForm'),
    dialogTitle: document.querySelector('#dialogTitle'),
    dialogMessage: document.querySelector('#dialogMessage'),
    dialogInputWrap: document.querySelector('#dialogInputWrap'),
    dialogInputLabel: document.querySelector('#dialogInputLabel'),
    dialogInput: document.querySelector('#dialogInput'),
    dialogCancelButton: document.querySelector('#dialogCancelButton'),
    dialogConfirmButton: document.querySelector('#dialogConfirmButton'),
    contextMenu: document.querySelector('#contextMenu'),
    toast: document.querySelector('#toast'),
    transferBubble: document.querySelector('#transferBubble'),
    transferBubbleLabel: document.querySelector('#transferBubbleLabel'),
    transferBubbleCount: document.querySelector('#transferBubbleCount'),
    transferBubbleProgress: document.querySelector('#transferBubbleProgress'),
    uploadTransferList: document.querySelector('#uploadTransferList'),
    downloadTransferList: document.querySelector('#downloadTransferList'),
    downloadHistoryList: document.querySelector('#downloadHistoryList'),
    clearDoneUploadsButton: document.querySelector('#clearDoneUploadsButton'),
    clearDoneDownloadsButton: document.querySelector('#clearDoneDownloadsButton'),
    retryFailedUploadsButton: document.querySelector('#retryFailedUploadsButton'),
    retryFailedDownloadsButton: document.querySelector('#retryFailedDownloadsButton'),
    clearDownloadHistoryButton: document.querySelector('#clearDownloadHistoryButton'),
    nodesRefreshButton: document.querySelector('#nodesRefreshButton'),
    nodesList: document.querySelector('#nodesList'),
    nodeForm: document.querySelector('#nodeForm'),
    nodeFormTitle: document.querySelector('#nodeFormTitle'),
    nodeFormReset: document.querySelector('#nodeFormReset'),
    nodeId: document.querySelector('#nodeId'),
    nodeName: document.querySelector('#nodeName'),
    nodeUrl: document.querySelector('#nodeUrl'),
    nodeToken: document.querySelector('#nodeToken'),
    nodeEnabled: document.querySelector('#nodeEnabled'),
    orphanModal: document.querySelector('#orphanModal'),
    orphanTitle: document.querySelector('#orphanTitle'),
    orphanDesc: document.querySelector('#orphanDesc'),
    orphanStatus: document.querySelector('#orphanStatus'),
    orphanListWrap: document.querySelector('#orphanListWrap'),
    orphanSelectAll: document.querySelector('#orphanSelectAll'),
    orphanCount: document.querySelector('#orphanCount'),
    orphanList: document.querySelector('#orphanList'),
    orphanScanButton: document.querySelector('#orphanScanButton'),
    orphanCleanButton: document.querySelector('#orphanCleanButton'),
    orphanCloseButton: document.querySelector('#orphanCloseButton'),
    syncBootstrapModal: document.querySelector('#syncBootstrapModal'),
    syncSelectAll: document.querySelector('#syncSelectAll'),
    syncRemoteCount: document.querySelector('#syncRemoteCount'),
    syncRemoteList: document.querySelector('#syncRemoteList'),
    syncBootstrapSkipButton: document.querySelector('#syncBootstrapSkipButton'),
    syncBootstrapConfirmButton: document.querySelector('#syncBootstrapConfirmButton'),
    backupCheckSyncButton: document.querySelector('#backupCheckSyncButton'),
    backupSyncStatus: document.querySelector('#backupSyncStatus'),
    backupSyncInSync: document.querySelector('#backupSyncInSync'),
    backupSyncDiff: document.querySelector('#backupSyncDiff'),
    backupSyncLocalOnly: document.querySelector('#backupSyncLocalOnly'),
    backupSyncLocalOnlyList: document.querySelector('#backupSyncLocalOnlyList'),
    backupSyncPushLocalButton: document.querySelector('#backupSyncPushLocalButton'),
    backupSyncRemoteOnly: document.querySelector('#backupSyncRemoteOnly'),
    backupSyncRemoteOnlyList: document.querySelector('#backupSyncRemoteOnlyList'),
    backupSyncPullRemoteButton: document.querySelector('#backupSyncPullRemoteButton'),

    // 重置
    resetAppButton: document.querySelector('#resetAppButton'),

    // 引导配置向导
    setupWizard: document.querySelector('#setupWizard'),
    setupStep1: document.querySelector('#setupStep1'),
    setupStep2: document.querySelector('#setupStep2'),
    setupStep3: document.querySelector('#setupStep3'),
    setupStep1Form: document.querySelector('#setupStep1Form'),
    setupStep2Form: document.querySelector('#setupStep2Form'),
    setupBaseUrl: document.querySelector('#setupBaseUrl'),
    setupPassword: document.querySelector('#setupPassword'),
    setupLoginStatus: document.querySelector('#setupLoginStatus'),
    setupSkipButton: document.querySelector('#setupSkipButton'),
    setupStep2Back: document.querySelector('#setupStep2Back'),
    setupStep3SelectDownload: document.querySelector('#setupStep3SelectDownload'),
    setupFinishButton: document.querySelector('#setupFinishButton'),
    setupSummaryUrl: document.querySelector('#setupSummaryUrl'),
    setupSummaryDownload: document.querySelector('#setupSummaryDownload'),

    // 多端同步更新通知
    syncUpdateModal: document.querySelector('#syncUpdateModal'),
    syncUpdateDesc: document.querySelector('#syncUpdateDesc'),
    syncUpdateFileList: document.querySelector('#syncUpdateFileList'),
    syncUpdateSkipOnce: document.querySelector('#syncUpdateSkipOnce'),
    syncUpdateAlwaysSync: document.querySelector('#syncUpdateAlwaysSync'),
    updateModal: document.querySelector('#updateModal'),
    updateModalTitle: document.querySelector('#updateModalTitle'),
    updateModalDesc: document.querySelector('#updateModalDesc'),
    updateReleaseNotes: document.querySelector('#updateReleaseNotes'),
    updateOpenButton: document.querySelector('#updateOpenButton'),
    updateSkipButton: document.querySelector('#updateSkipButton'),
    updateDisableAutoCheckButton: document.querySelector('#updateDisableAutoCheckButton'),
    updateLaterButton: document.querySelector('#updateLaterButton')
  });
}

function bindEvents() {
  setupAboutPanel();

  // 禁止长按/拖拽选择文字
  document.addEventListener('selectstart', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || event.target.isContentEditable) {
      return;
    }
    event.preventDefault();
  });

  els.windowMinimizeButton.addEventListener('click', () => api.minimizeWindow());
  els.windowMaximizeButton.addEventListener('click', toggleWindowMaximize);
  els.windowCloseButton.addEventListener('click', () => api.closeWindow());
  els.titlebarDrag.addEventListener('dblclick', toggleWindowMaximize);

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  els.newButton.addEventListener('click', toggleNewMenu);
  els.newFolderAction.addEventListener('click', () => {
    hideNewMenu();
    createFolder();
  });
  els.newUploadAction.addEventListener('click', () => {
    hideNewMenu();
    uploadFiles();
  });
  els.settingsButton.addEventListener('click', () => setView('settings'));
  els.themeToggle.addEventListener('click', toggleTheme);
  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    renderCurrentView();
  });

  els.backButton.addEventListener('click', () => navigateFiles(parentPath(state.currentPath)));
  els.refreshButton.addEventListener('click', refreshCurrentView);
  els.fileListModeButton.addEventListener('click', () => setFileViewMode('list'));
  els.fileGridModeButton.addEventListener('click', () => setFileViewMode('grid'));
  els.uploadButton.addEventListener('click', uploadFiles);
  els.mkdirButton.addEventListener('click', createFolder);
  els.pasteButton.addEventListener('click', pasteFromClipboard);
  els.copySelectedButton.addEventListener('click', () => copySelectedToClipboard('copy'));
  els.cutSelectedButton.addEventListener('click', () => copySelectedToClipboard('cut'));
  els.renameSelectedButton.addEventListener('click', renameSelectedItem);
  els.downloadSelectedButton.addEventListener('click', downloadSelectedItems);
  els.deleteSelectedButton.addEventListener('click', deleteSelectedItems);

  els.albumBackButton.addEventListener('click', () => navigateAlbum(albumParentPath(state.albumPath)));
  els.albumRefreshButton.addEventListener('click', refreshCurrentView);
  els.albumUploadButton.addEventListener('click', uploadFiles);
  els.albumBackupButton.addEventListener('click', selectAlbumBackupFolder);
  els.backupSaveSettingsButton.addEventListener('click', saveBackupSettings);
  els.backupSelectFolderButton.addEventListener('click', selectBackupFolder);
  els.backupRunAllButton.addEventListener('click', () => runBackupNow(''));
  els.syncBootstrapSkipButton?.addEventListener('click', dismissSyncBootstrap);
  els.syncBootstrapConfirmButton?.addEventListener('click', confirmSyncBootstrap);
  els.syncSelectAll?.addEventListener('change', toggleSyncBootstrapSelection);
  els.backupCheckSyncButton?.addEventListener('click', checkBackupSyncStatus);
  els.backupSyncPushLocalButton?.addEventListener('click', pushLocalDirsToRemote);
  els.backupSyncPullRemoteButton?.addEventListener('click', pullRemoteDirsToLocal);
  els.driveView.addEventListener('contextmenu', showViewContextMenu);
  els.albumView.addEventListener('contextmenu', showViewContextMenu);

  els.storageCard.addEventListener('click', toggleStoragePopover);
  els.storageCloseButton.addEventListener('click', hideStoragePopover);
  document.addEventListener('click', (event) => {
    if (!els.newMenu.classList.contains('hidden') && !els.newMenu.contains(event.target) && !els.newButton.contains(event.target)) {
      hideNewMenu();
    }
    if (!els.contextMenu.classList.contains('hidden') && !els.contextMenu.contains(event.target)) {
      hideContextMenu();
    }
    if (els.storagePopover.classList.contains('hidden')) {
      return;
    }
    if (!els.storagePopover.contains(event.target) && !els.storageCard.contains(event.target)) {
      hideStoragePopover();
    }
  });

  els.transferBubble.addEventListener('click', () => setView('transfers'));
  els.clearDoneUploadsButton.addEventListener('click', () => clearDoneTransfers('upload'));
  els.clearDoneDownloadsButton.addEventListener('click', () => clearDoneTransfers('download'));
  els.retryFailedUploadsButton?.addEventListener('click', () => retryFailedTransfers('upload'));
  els.retryFailedDownloadsButton?.addEventListener('click', () => retryFailedTransfers('download'));
  els.clearDownloadHistoryButton.addEventListener('click', clearDownloadHistory);
  els.dialogCancelButton.addEventListener('click', () => closeDialog(null));
  els.dialogModal.addEventListener('click', (event) => {
    if (event.target === els.dialogModal) {
      closeDialog(null);
    }
  });
  els.dialogForm.addEventListener('submit', submitDialog);

  // 孤儿文件扫描弹窗
  els.orphanScanButton.addEventListener('click', scanAndShowOrphans);
  els.orphanCleanButton.addEventListener('click', executeOrphanCleanup);
  els.orphanCloseButton.addEventListener('click', closeOrphanModal);
  els.orphanModal.addEventListener('click', (event) => {
    if (event.target === els.orphanModal) {
      closeOrphanModal();
    }
  });
  els.orphanSelectAll.addEventListener('change', () => {
    const checked = els.orphanSelectAll.checked;
    els.orphanList.querySelectorAll('.orphan-item-check').forEach((cb) => {
      cb.checked = checked;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (!els.mediaViewer.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        closeMediaViewer();
      } else if (event.key === 'ArrowLeft') {
        stepMediaViewer(-1);
      } else if (event.key === 'ArrowRight') {
        stepMediaViewer(1);
      }
      return;
    }

    // 全局快捷键：Ctrl+A 全选，Escape 取消选择
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      if (['drive', 'album'].includes(state.view) && document.activeElement !== els.searchInput) {
        event.preventDefault();
        selectAllVisible();
      }
      return;
    }

    if (event.key === 'Escape') {
      hideNewMenu();
      hideContextMenu();
      closeDialog(null);
      closeOrphanModal();
      hideStoragePopover();
      if (state.selectedItems.size > 0) {
        state.selectedItems.clear();
        updateSelectionVisuals();
        updateActionBar();
      }
    }
  });

  els.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveBaseUrl(els.baseUrlInput.value);
  });
  els.testConnectionButton?.addEventListener('click', testConnection);

  els.brandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveBrandCustomization();
  });

  els.desktopBehaviorForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveDesktopBehavior();
  });
  els.updateAutoCheckInput?.addEventListener('change', saveUpdateAutoCheck);
  els.updateCheckButton?.addEventListener('click', checkForUpdatesManually);
  els.updateOpenButton?.addEventListener('click', openUpdateDownloadPage);
  els.updateSkipButton?.addEventListener('click', skipCurrentUpdateVersion);
  els.updateDisableAutoCheckButton?.addEventListener('click', disableAutoUpdateCheck);
  els.updateLaterButton?.addEventListener('click', closeUpdateModal);
  els.updateModal?.addEventListener('click', (event) => {
    if (event.target === els.updateModal) {
      closeUpdateModal();
    }
  });

  els.downloadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveDownloadDir(els.downloadDirInput.value);
  });
  els.selectDownloadDirButton.addEventListener('click', selectDownloadDir);
  els.clearDownloadDirButton.addEventListener('click', clearDownloadDir);
  els.transferDownloadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveDownloadDir(els.transferDownloadDirInput.value);
  });
  els.transferSelectDownloadDirButton.addEventListener('click', selectDownloadDir);
  els.transferClearDownloadDirButton.addEventListener('click', clearDownloadDir);

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await login(els.passwordInput.value);
  });

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveBaseUrl(els.authBaseUrl.value);
    await login(els.authPassword.value);
  });

  els.logoutButton.addEventListener('click', logout);
  els.openSharedButton.addEventListener('click', openSharedPage);
  els.nodesRefreshButton.addEventListener('click', loadNodes);
  els.nodeForm.addEventListener('submit', saveNode);
  els.nodeFormReset.addEventListener('click', resetNodeForm);
  els.viewerCloseButton.addEventListener('click', closeMediaViewer);
  els.viewerDownloadButton.addEventListener('click', downloadCurrentViewerItem);
  els.viewerPrevButton.addEventListener('click', () => stepMediaViewer(-1));
  els.viewerNextButton.addEventListener('click', () => stepMediaViewer(1));
  els.mediaViewer.addEventListener('click', (event) => {
    if (event.target === els.mediaViewer) {
      closeMediaViewer();
    }
  });

  api.onTransfer((payload) => {
    const current = state.transfers.get(payload.id) || { createdAt: Date.now() };
    const nextTransfer = {
      ...current,
      ...payload,
      updatedAt: Date.now()
    };
    state.transfers.set(payload.id, nextTransfer);
    if (nextTransfer.type === 'download' && nextTransfer.status === 'done' && nextTransfer.localPath) {
      persistDownloadedFile(nextTransfer);
    }
    if (nextTransfer.type === 'upload' && nextTransfer.status === 'done') {
      scheduleUploadListRefresh();
    }
    scheduleRenderTransfers();
  });

  api.onBackup((payload) => {
    state.backup.statuses.set(payload.jobId, payload);
    renderBackup();
  });

  // ── 重置应用 ──
  els.resetAppButton?.addEventListener('click', resetAppData);

  // ── 引导配置向导 ──
  els.setupStep1Form?.addEventListener('submit', setupStep1Submit);
  els.setupStep2Form?.addEventListener('submit', setupStep2Submit);
  els.setupSkipButton?.addEventListener('click', skipSetupWizard);
  els.setupStep2Back?.addEventListener('click', setupGoToStep1);
  els.setupStep3SelectDownload?.addEventListener('click', setupSelectDownloadDir);
  els.setupFinishButton?.addEventListener('click', finishSetupWizard);

  // ── 多端同步更新通知 ──
  els.syncUpdateSkipOnce?.addEventListener('click', dismissSyncUpdate);
  els.syncUpdateAlwaysSync?.addEventListener('click', enableAutoSyncAndApply);
  els.syncUpdateModal?.addEventListener('click', (event) => {
    if (event.target === els.syncUpdateModal) {
      dismissSyncUpdate();
    }
  });

  // 监听来自主进程的同步更新事件
  if (api.onSyncUpdate) {
    api.onSyncUpdate((payload) => {
      showSyncUpdateNotification(payload);
    });
  }

  if (api.onUpdate) {
    api.onUpdate((payload) => {
      if (payload?.type === 'update-available' && payload.update) {
        showUpdateModal(payload.update);
      }
    });
  }
}

async function init() {
  applySavedTheme();
  loadDownloadHistory();
  document.body.dataset.view = state.view;
  updateFileViewModeControls();
  renderTransfers();
  updateActionBar();
  state.update.appInfo = await api.getAppInfo?.().catch(() => null);
  state.config = await api.getConfig();
  await loadBackupConfig();
  renderConfig();
  showPendingUpdateIfAvailable();

  // 首次使用：显示引导配置向导
  if (!state.config.baseUrl) {
    showSetupWizard();
    return;
  }

  await Promise.allSettled([loadStorage(), loadFiles(''), loadQuick(), refreshClipboardState()]);
  await maybeShowSyncBootstrap();
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('r2drive-theme') || 'light';
  document.documentElement.dataset.theme = savedTheme;
}

function renderConfig() {
  const baseUrl = state.config?.baseUrl || '';
  els.baseUrlInput.value = baseUrl;
  els.authBaseUrl.value = baseUrl;
  els.downloadDirInput.value = state.config?.downloadDir || '';
  els.transferDownloadDirInput.value = state.config?.downloadDir || '';
  els.brandHtmlInput.value = state.config?.customBrandHtml || '';
  els.brandCssInput.value = state.config?.customBrandCss || '';
  if (els.closeBehaviorSelect) {
    els.closeBehaviorSelect.value = state.config?.closeBehavior || 'ask';
  }
  if (els.minimizeBehaviorSelect) {
    els.minimizeBehaviorSelect.value = state.config?.minimizeBehavior || 'taskbar';
  }
  if (els.startHiddenToTrayInput) {
    els.startHiddenToTrayInput.checked = Boolean(state.config?.startHiddenToTray);
  }
  if (els.autoLaunchInput) {
    els.autoLaunchInput.checked = Boolean(state.config?.autoLaunch);
  }
  if (els.uploadBatchNotifyInput) {
    els.uploadBatchNotifyInput.checked = state.config?.uploadBatchNotify !== false;
  }
  if (els.downloadBatchNotifyInput) {
    els.downloadBatchNotifyInput.checked = state.config?.downloadBatchNotify !== false;
  }
  renderUpdateSettings();
  els.serverStatus.textContent = displayBaseUrlHost(baseUrl) || '未连接';
  applyBrandCustomization();
}

function renderUpdateSettings(message) {
  if (els.updateAutoCheckInput) {
    els.updateAutoCheckInput.checked = state.config?.updateAutoCheck !== false;
  }
  const currentVersion = state.update.appInfo?.version || '';
  if (els.updateVersionText) {
    els.updateVersionText.textContent = `v${currentVersion || '未知'}`;
  }
  if (!els.updateStatus) {
    return;
  }

  if (message) {
    els.updateStatus.textContent = message;
    return;
  }

  const skipped = state.config?.updateSkippedVersion ? `，已跳过 v${state.config.updateSkippedVersion}` : '';
  const autoText = state.config?.updateAutoCheck === false ? '自动检查已关闭' : '自动检查已开启';
  els.updateStatus.textContent = `当前版本 v${currentVersion || '未知'}，${autoText}${skipped}`;
}

async function saveBaseUrl(baseUrl) {
  state.config = await api.setConfig({ baseUrl });
  renderConfig();
  toast('地址已保存');
}

async function testConnection() {
  await runTask(async () => {
    const baseUrl = els.baseUrlInput.value.trim();
    if (baseUrl && baseUrl !== state.config?.baseUrl) {
      state.config = await api.setConfig({ baseUrl });
      renderConfig();
    }
    const result = await api.testConnection();
    toast(`连接正常，延迟 ${Math.max(1, Math.round(result.latencyMs || 0))} ms`);
  });
}

async function saveBrandCustomization() {
  state.config = await api.setConfig({
    customBrandHtml: els.brandHtmlInput.value,
    customBrandCss: els.brandCssInput.value
  });
  renderConfig();
  toast('外观已保存');
}

async function saveDesktopBehavior() {
  const autoLaunch = els.autoLaunchInput?.checked ?? false;
  const uploadBatchNotify = els.uploadBatchNotifyInput?.checked ?? true;
  const downloadBatchNotify = els.downloadBatchNotifyInput?.checked ?? true;

  // 开机自启动单独调用
  if (els.autoLaunchInput) {
    await api.setAutoLaunch(autoLaunch).catch(() => {});
  }

  state.config = await api.setConfig({
    closeBehavior: els.closeBehaviorSelect.value,
    minimizeBehavior: els.minimizeBehaviorSelect.value,
    startHiddenToTray: els.startHiddenToTrayInput.checked,
    autoLaunch,
    uploadBatchNotify,
    downloadBatchNotify
  });
  renderConfig();
  toast('桌面行为已保存');
}

async function saveUpdateAutoCheck() {
  state.config = await api.setConfig({
    updateAutoCheck: Boolean(els.updateAutoCheckInput?.checked)
  });
  renderConfig();
  toast(state.config.updateAutoCheck === false ? '已关闭自动检查更新' : '已开启自动检查更新');
}

async function checkForUpdatesManually() {
  if (state.update.checking) {
    return;
  }

  state.update.checking = true;
  if (els.updateCheckButton) {
    els.updateCheckButton.disabled = true;
  }
  renderUpdateSettings('正在检查 GitHub 更新...');

  try {
    const result = await api.checkForUpdates({ manual: true, notify: false });
    if (!result?.ok) {
      renderUpdateSettings(`检查更新失败：${result?.error || '未知错误'}`);
      toast('检查更新失败');
      return;
    }
    if (result.hasUpdate && result.update) {
      state.update.pending = result.update;
      renderUpdateSettings(`发现新版本 v${result.update.version}`);
      showUpdateModal(result.update, { skipped: result.skipped });
      return;
    }
    renderUpdateSettings(`当前已是最新版本 v${result.currentVersion || state.update.appInfo?.version || ''}`);
    toast('当前已是最新版本');
  } catch (error) {
    renderUpdateSettings(`检查更新失败：${error.message}`);
    toast('检查更新失败');
  } finally {
    state.update.checking = false;
    if (els.updateCheckButton) {
      els.updateCheckButton.disabled = false;
    }
  }
}

async function showPendingUpdateIfAvailable() {
  const result = await api.getPendingUpdate?.().catch(() => null);
  if (result?.update) {
    state.update.pending = result.update;
    showUpdateModal(result.update);
  }
}

function showUpdateModal(update, options = {}) {
  if (!els.updateModal || !update) {
    return;
  }

  state.update.pending = update;
  const currentVersion = update.currentVersion || state.update.appInfo?.version || '';
  els.updateModalTitle.textContent = `发现新版本 v${update.version}`;
  els.updateModalDesc.textContent = [
    currentVersion ? `当前版本 v${currentVersion}` : '',
    update.publishedAt ? `发布时间 ${formatDate(update.publishedAt)}` : '',
    options.skipped ? '这个版本已被标记为跳过，仍可手动打开更新页面。' : ''
  ].filter(Boolean).join('，');
  els.updateReleaseNotes.textContent = (update.body || '暂无更新说明').trim().slice(0, 4000);
  els.updateOpenButton.disabled = !update.downloadUrl && !update.htmlUrl;
  els.updateModal.classList.remove('hidden');
}

function closeUpdateModal() {
  els.updateModal?.classList.add('hidden');
}

async function openUpdateDownloadPage() {
  const update = state.update.pending;
  const url = update?.downloadUrl || update?.htmlUrl;
  if (!url) {
    return;
  }
  await api.openExternal(url);
}

async function skipCurrentUpdateVersion() {
  const version = state.update.pending?.version;
  if (!version) {
    closeUpdateModal();
    return;
  }
  state.config = await api.skipUpdateVersion(version);
  renderConfig();
  closeUpdateModal();
  toast(`已跳过 v${version}`);
}

async function disableAutoUpdateCheck() {
  state.config = await api.setConfig({ updateAutoCheck: false });
  renderConfig();
  closeUpdateModal();
  toast('已关闭自动检查更新');
}

function applyBrandCustomization() {
  const customHtml = state.config?.customBrandHtml || '';
  const customCss = state.config?.customBrandCss || '';
  const brandHtml = customHtml.trim() || 'R2';
  els.brandMark.innerHTML = brandHtml;
  els.titlebarMark.innerHTML = brandHtml;
  els.customBrandStyle.textContent = customCss;
}

function setupAboutPanel() {
  const settingsPanel = document.querySelector('#settingsView .settings-panel');
  if (!settingsPanel || settingsPanel.querySelector('.about-panel')) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'about-panel';
  section.setAttribute('aria-label', '关于');
  section.innerHTML = [
    '<div class="section-head"><h2>关于</h2></div>',
    '<div class="about-profile">',
    '<div class="about-avatar" aria-hidden="true"><img src="https://q.qlogo.cn/headimg_dl?dst_uin=1792063643&spec=640&img_type=jpg" alt="头像" style="width:100%; height:100%; object-fit:cover;"></div>',
    '<div class="about-copy">',
    '<strong class="about-name">俊臻是真俊</strong>',
    '<span class="about-signature">Hello帅1,点个star支持一下呗⬇️</span>',
    '<a class="about-github" href="https://github.com/HandsomeMJZ" target="_blank" rel="noreferrer">GitHub: HandsomeMJZ</a>',
    '</div>',
    '</div>',
    '<div class="about-profile">',
    '<div class="about-avatar" aria-hidden="true"><img src="https://q.qlogo.cn/headimg_dl?dst_uin=3291074897&spec=640&img_type=jpg" alt="头像" style="width:100%; height:100%; object-fit:cover;"></div>',
    '<div class="about-copy">',
    '<strong class="about-name">沐春时</strong>',
    '<span class="about-signature">“这一次我想改写航线！”</span>',
    '<span class="about-signature">   </span>',
    '</div>',
    '</div>'
  ].join('');
  settingsPanel.append(section);
}

async function selectDownloadDir() {
  await runTask(async () => {
    const result = await api.selectDownloadDir();
    if (result?.canceled || !result?.filePath) {
      return;
    }
    els.downloadDirInput.value = result.filePath;
    els.transferDownloadDirInput.value = result.filePath;
    await saveDownloadDir(result.filePath);
  });
}

async function saveDownloadDir(downloadDir) {
  state.config = await api.setConfig({ downloadDir: downloadDir || '' });
  renderConfig();
  toast(downloadDir ? '下载路径已保存' : '已清除下载路径');
}

async function clearDownloadDir() {
  els.downloadDirInput.value = '';
  els.transferDownloadDirInput.value = '';
  await saveDownloadDir('');
}

async function toggleWindowMaximize() {
  const isMaximized = await api.toggleMaximizeWindow();
  document.body.classList.toggle('window-maximized', Boolean(isMaximized));
}

async function login(password) {
  await runTask(async () => {
    await api.login(password || '');
    hideAuth();
    els.passwordInput.value = '';
    els.authPassword.value = '';
    await Promise.allSettled([loadStorage(), loadFiles(state.currentPath), loadQuick()]);
    await loadBackupConfig();
    await maybeShowSyncBootstrap();
    toast('登录成功');
  });
}

async function logout() {
  await runTask(async () => {
    await api.logout();
    showAuth();
    toast('已登出');
  });
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  els.driveView.classList.toggle('hidden', view !== 'drive');
  els.albumView.classList.toggle('hidden', view !== 'album');
  els.quickView.classList.toggle('hidden', view !== 'quick');
  els.backupView.classList.toggle('hidden', view !== 'backup');
  els.transfersView.classList.toggle('hidden', view !== 'transfers');
  els.nodesView.classList.toggle('hidden', view !== 'nodes');
  els.settingsView.classList.toggle('hidden', view !== 'settings');
  els.driveToolbar.classList.toggle('hidden', view !== 'drive');
  els.albumToolbar.classList.toggle('hidden', view !== 'album');

  const titles = {
    drive: '我的云盘',
    album: '相册',
    quick: '快速访问',
    transfers: '传输列表',
    nodes: '存储节点查看',
    settings: '设置'
  };
  els.viewTitle.textContent = titles[view];
  if (view === 'backup') {
    els.viewTitle.textContent = '自动同步';
  }
  renderBreadcrumb();
  renderCurrentView();

  if (view === 'album' && !state.albumFolders.length && !state.albumFiles.length) {
    loadAlbum(state.albumPath);
  }
  if (view === 'quick') {
    loadQuick();
  }
  if (view === 'backup') {
    loadBackupConfig();
    checkBackupSyncStatus();
  }
  if (view === 'transfers') {
    renderTransferView();
  }
  if (view === 'nodes') {
    loadNodes();
  }
}

function refreshCurrentView() {
  if (state.view === 'drive') {
    loadFiles(state.currentPath);
  } else if (state.view === 'album') {
    loadAlbum(state.albumPath);
  } else if (state.view === 'quick') {
    loadQuick();
  } else if (state.view === 'backup') {
    loadBackupConfig();
    checkBackupSyncStatus();
  } else if (state.view === 'transfers') {
    renderTransferView();
  } else if (state.view === 'nodes') {
    loadNodes();
  }
  loadStorage();
}

function renderCurrentView() {
  if (state.view === 'drive') {
    renderFiles();
  } else if (state.view === 'album') {
    renderAlbum();
  } else if (state.view === 'quick') {
    renderQuick();
  } else if (state.view === 'backup') {
    renderBackup();
  } else if (state.view === 'transfers') {
    renderTransferView();
  }
}

async function loadFiles(remotePath) {
  await runTask(async () => {
    const data = await api.list(remotePath || '');
    state.currentPath = remotePath || '';
    state.folders = data.folders || [];
    state.files = hideKeepFiles(data.files || []);
    state.selectedItems.clear();
    renderFiles();
    renderBreadcrumb();
    updateActionBar();
    loadStorage();
  });
}

async function loadAlbum(remotePath = ALBUM_ROOT) {
  await runTask(async () => {
    const targetPath = ensureAlbumPath(remotePath);
    const data = await api.list(targetPath);
    state.albumPath = targetPath;
    state.albumFolders = data.folders || [];
    state.albumFiles = hideKeepFiles(data.files || []);
    renderAlbum();
    renderBreadcrumb();
  });
}

async function loadQuick() {
  await runTask(async () => {
    const data = await api.list('');
    state.quickFolders = data.folders || [];
    state.quickFiles = hideKeepFiles(data.files || [])
      .slice()
      .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0))
      .slice(0, 12);
    renderQuick();
  });
}

async function loadBackupConfig() {
  try {
    const config = await api.getBackupConfig();
    state.backup.jobs = Array.isArray(config.jobs) ? config.jobs : [];
    state.backup.intervalMinutes = Number(config.intervalMinutes) || 15;
    state.backup.autoStart = Boolean(config.autoStart);
    renderBackup();
  } catch (error) {
    handleError(error);
  }
}

async function maybeShowSyncBootstrap() {
  if (!els.syncBootstrapModal || state.config?.backupSyncPromptDismissed) {
    return;
  }
  if (!state.config?.baseUrl || state.backup.jobs.length > 0) {
    return;
  }
  if (!api.getRemoteBackupDirs) {
    return;
  }

  try {
    const result = await api.getRemoteBackupDirs();
    const remoteDirs = uniqueRemoteDirs(result?.dirs || []);
    if (!remoteDirs.length) {
      return;
    }

    state.syncBootstrap.remoteDirs = remoteDirs;
    renderSyncBootstrap();
    els.syncBootstrapModal.classList.remove('hidden');
  } catch (error) {
    // Older Worker deployments may not expose the new API yet; avoid blocking normal login.
    console.warn('Failed to load remote backup dirs:', error);
  }
}

function renderSyncBootstrap() {
  const remoteDirs = state.syncBootstrap.remoteDirs;
  els.syncRemoteList.replaceChildren();
  els.syncRemoteCount.textContent = `${remoteDirs.length} 个远端文件夹`;
  els.syncSelectAll.checked = remoteDirs.length > 0;

  for (const remoteDir of remoteDirs) {
    const row = document.createElement('label');
    row.className = 'sync-remote-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'sync-remote-check';
    checkbox.value = remoteDir;
    checkbox.checked = true;
    checkbox.addEventListener('change', updateSyncBootstrapSelectionState);

    const icon = makeFileBadge({ type: 'folder', name: remoteDir });
    icon.classList.add('sync-remote-icon');

    const copy = document.createElement('span');
    copy.className = 'sync-remote-copy';
    const title = document.createElement('strong');
    title.textContent = remoteDir.split('/').filter(Boolean).pop() || remoteDir;
    const path = document.createElement('span');
    path.className = 'muted';
    path.textContent = `/${remoteDir}`;
    copy.append(title, path);

    row.append(checkbox, icon, copy);
    els.syncRemoteList.append(row);
  }

  updateSyncBootstrapSelectionState();
}

function toggleSyncBootstrapSelection() {
  const checked = Boolean(els.syncSelectAll.checked);
  els.syncRemoteList.querySelectorAll('.sync-remote-check').forEach((checkbox) => {
    checkbox.checked = checked;
  });
  updateSyncBootstrapSelectionState();
}

function updateSyncBootstrapSelectionState() {
  const checks = [...els.syncRemoteList.querySelectorAll('.sync-remote-check')];
  const selected = checks.filter((checkbox) => checkbox.checked);
  els.syncSelectAll.checked = checks.length > 0 && selected.length === checks.length;
  els.syncSelectAll.indeterminate = selected.length > 0 && selected.length < checks.length;
  els.syncBootstrapConfirmButton.disabled = selected.length === 0;
}

function selectedSyncBootstrapDirs() {
  return [...els.syncRemoteList.querySelectorAll('.sync-remote-check:checked')]
    .map((checkbox) => checkbox.value)
    .filter(Boolean);
}

async function dismissSyncBootstrap() {
  await runTask(async () => {
    state.config = await api.dismissBackupSyncPrompt();
    els.syncBootstrapModal.classList.add('hidden');
    renderConfig();
    toast('已暂不启用多端同步');
  });
}

async function confirmSyncBootstrap() {
  const remoteDirs = selectedSyncBootstrapDirs();
  if (!remoteDirs.length) {
    toast('请至少选择一个同步文件夹');
    return;
  }

  await runTask(async () => {
    els.syncBootstrapConfirmButton.disabled = true;
    els.syncBootstrapSkipButton.disabled = true;
    try {
      const result = await api.syncRemoteBackupFolders(remoteDirs);
      if (result?.canceled) {
        return;
      }

      state.config = await api.getConfig();
      await loadBackupConfig();
      renderConfig();
      els.syncBootstrapModal.classList.add('hidden');
      setView('backup');
      toast('多端同步已开启');
    } finally {
      if (!els.syncBootstrapModal.classList.contains('hidden')) {
        els.syncBootstrapConfirmButton.disabled = false;
        els.syncBootstrapSkipButton.disabled = false;
        updateSyncBootstrapSelectionState();
      }
    }
  });
}

// --- 跨端同步比较 ---

function extractLocalRemoteDirs() {
  const seen = new Set();
  const dirs = [];
  for (const job of state.backup.jobs) {
    const remotePath = joinRemote(job.remotePath || '');
    if (!remotePath || seen.has(remotePath)) {
      continue;
    }
    seen.add(remotePath);
    dirs.push(remotePath);
  }
  return dirs;
}

async function checkBackupSyncStatus() {
  if (!els.backupSyncStatus || !state.config?.baseUrl) {
    return;
  }
  if (!api.getRemoteBackupDirs) {
    return;
  }

  await runTask(async () => {
    try {
      const result = await api.getRemoteBackupDirs();
      const remoteDirs = uniqueRemoteDirs(result?.dirs || []);
      const localDirs = extractLocalRemoteDirs();

      const remoteSet = new Set(remoteDirs);
      const localSet = new Set(localDirs);

      const synced = localDirs.filter((d) => remoteSet.has(d));
      const localOnly = localDirs.filter((d) => !remoteSet.has(d));
      const remoteOnly = remoteDirs.filter((d) => !localSet.has(d));

      state.backupSyncDiff = { localOnly, remoteOnly, synced, checked: true };
      renderBackupSyncDiff();
    } catch (error) {
      console.warn('Failed to check backup sync status:', error);
      state.backupSyncDiff.checked = false;
      els.backupSyncStatus.classList.add('hidden');
    }
  });
}

function renderBackupSyncDiff() {
  if (!els.backupSyncStatus) {
    return;
  }

  const { localOnly, remoteOnly, synced, checked } = state.backupSyncDiff;
  if (!checked) {
    els.backupSyncStatus.classList.add('hidden');
    return;
  }

  els.backupSyncStatus.classList.remove('hidden');
  const isInSync = localOnly.length === 0 && remoteOnly.length === 0;

  els.backupSyncInSync.classList.toggle('hidden', !isInSync);
  els.backupSyncDiff.classList.toggle('hidden', isInSync);

  if (isInSync) {
    return;
  }

  // Render local-only dirs
  els.backupSyncLocalOnly.classList.toggle('hidden', localOnly.length === 0);
  if (localOnly.length > 0) {
    els.backupSyncLocalOnlyList.replaceChildren();
    for (const dir of localOnly) {
      els.backupSyncLocalOnlyList.append(makeSyncDiffItem(dir, 'local'));
    }
  }

  // Render remote-only dirs
  els.backupSyncRemoteOnly.classList.toggle('hidden', remoteOnly.length === 0);
  if (remoteOnly.length > 0) {
    els.backupSyncRemoteOnlyList.replaceChildren();
    for (const dir of remoteOnly) {
      els.backupSyncRemoteOnlyList.append(makeSyncDiffItem(dir, 'remote'));
    }
  }
}

function makeSyncDiffItem(dirPath, source) {
  const row = document.createElement('div');
  row.className = 'sync-diff-item';

  const icon = document.createElement('span');
  icon.className = 'material-icons-round';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = source === 'local' ? 'computer' : 'cloud';

  const copy = document.createElement('span');
  copy.className = 'sync-diff-copy';
  const name = document.createElement('strong');
  name.textContent = dirPath.split('/').filter(Boolean).pop() || dirPath;
  const pathEl = document.createElement('span');
  pathEl.className = 'muted';
  pathEl.textContent = `/${dirPath}`;
  pathEl.title = dirPath;
  copy.append(name, pathEl);

  const actions = document.createElement('div');
  actions.className = 'sync-diff-actions';

  if (source === 'local') {
    const pushBtn = document.createElement('button');
    pushBtn.className = 'secondary small';
    pushBtn.title = '推送到远端';
    pushBtn.innerHTML = '<span class="material-icons-round" aria-hidden="true">cloud_upload</span><span>推送</span>';
    pushBtn.addEventListener('click', () => pushSingleDirToRemote(dirPath));
    actions.append(pushBtn);
  } else {
    const pullBtn = document.createElement('button');
    pullBtn.className = 'secondary small';
    pullBtn.title = '同步到本机';
    pullBtn.innerHTML = '<span class="material-icons-round" aria-hidden="true">cloud_download</span><span>同步</span>';
    pullBtn.addEventListener('click', () => pullSingleRemoteDir(dirPath));
    actions.append(pullBtn);
  }

  row.append(icon, copy, actions);
  return row;
}

async function pushLocalDirsToRemote() {
  const localOnly = state.backupSyncDiff.localOnly;
  if (!localOnly.length) {
    toast('没有需要推送的文件夹');
    return;
  }

  await runTask(async () => {
    const allRemoteDirs = uniqueRemoteDirs([
      ...extractLocalRemoteDirs(),
      ...localOnly
    ]);
    await api.pushBackupDirsToRemote(allRemoteDirs);
    toast(`已推送 ${localOnly.length} 个文件夹配置到远端`);
    await checkBackupSyncStatus();
  });
}

async function pushSingleDirToRemote(dirPath) {
  await runTask(async () => {
    const allRemoteDirs = extractLocalRemoteDirs();
    await api.pushBackupDirsToRemote(allRemoteDirs);
    toast(`已推送 "${dirPath.split('/').filter(Boolean).pop() || dirPath}" 到远端`);
    await checkBackupSyncStatus();
  });
}

async function pullRemoteDirsToLocal() {
  const remoteOnly = state.backupSyncDiff.remoteOnly;
  if (!remoteOnly.length) {
    toast('没有需要同步的远端文件夹');
    return;
  }

  await runTask(async () => {
    els.backupSyncPullRemoteButton.disabled = true;
    try {
      const result = await api.syncRemoteBackupFolders(remoteOnly);
      if (result?.canceled) {
        return;
      }
      await loadBackupConfig();
      toast(`已同步 ${remoteOnly.length} 个远端文件夹到本机`);
      await checkBackupSyncStatus();
    } finally {
      els.backupSyncPullRemoteButton.disabled = false;
    }
  });
}

async function pullSingleRemoteDir(dirPath) {
  await runTask(async () => {
    const result = await api.syncRemoteBackupFolders([dirPath]);
    if (result?.canceled) {
      return;
    }
    await loadBackupConfig();
    toast(`已同步 "${dirPath.split('/').filter(Boolean).pop() || dirPath}" 到本机`);
    await checkBackupSyncStatus();
  });
}

async function loadStorage() {
  try {
    state.storage = await api.storage();
    renderStorage();
  } catch (error) {
    if (!String(error.message || error).includes('401')) {
      console.warn(error);
    }
  }
}

async function loadNodes() {
  await runTask(async () => {
    const [nodesResult, storageResult] = await Promise.allSettled([
      api.nodesList(),
      api.storage()
    ]);
    const nodeConfigs = nodesResult.status === 'fulfilled' ? nodesResult.value.nodes || [] : [];
    if (storageResult.status === 'fulfilled') {
      state.storage = storageResult.value;
      renderStorage();
    }
    state.nodes = buildNodeRows(nodeConfigs, state.storage);
    renderNodes();
  });
}

// ── Clipboard ──────────────────────────────────────────────

async function copySelectedToClipboard(action) {
  const items = selectedItems();
  if (!items.length) {
    return;
  }

  await setClipboardItems(items, action, state.currentPath);
  toast(action === 'copy'
    ? `已复制 ${items.length} 项，请进入目标文件夹后粘贴`
    : `已剪切 ${items.length} 项，请进入目标文件夹后粘贴`);
}

async function copyToClipboard(item, parentPath, action) {
  const items = [{
    name: item.name,
    type: item.type === 'folder' ? 'folder' : 'file'
  }];
  await setClipboardItems(items, action, parentPath);
  toast(action === 'copy' ? '已复制到剪贴板' : '已剪切到剪贴板');
}

async function setClipboardItems(items, action, parentPath) {
  state.clipboard = { items, action, sourcePath: parentPath };
  updateActionBar();

  try {
    await api.clipboardSet(items.map((entry) => entry.name), action, parentPath);
  } catch (error) {
    console.warn('Clipboard API unavailable:', error);
  }
}

async function pasteFromClipboard() {
  if (state.view !== 'drive') {
    setView('drive');
  }

  let clipData;
  try {
    clipData = await api.clipboardGet();
  } catch (error) {
    // clipboard API may not be available (e.g. server doesn't support it)
  }

  const items = mergeClipboardItems(clipData, state.clipboard);
  const action = clipData?.action || state.clipboard?.action || 'copy';
  const sourcePath = clipData?.sourcePath ?? state.clipboard?.sourcePath ?? '';
  const targetPath = state.currentPath;
  const itemNames = clipboardPasteItemNames(items);

  if (!itemNames.length) {
    toast('剪贴板为空');
    return;
  }

  if (action === 'cut' && sourcePath === targetPath) {
    toast('源路径和目标路径相同，无需操作');
    return;
  }

  await runTask(async () => {
    const result = await api.clipboardPaste({
      action,
      items: itemNames,
      sourcePath,
      targetPath
    });
    const failed = clipboardPasteFailures(result);
    const done = Math.max(0, itemNames.length - failed.length);

    if (action === 'cut' && !failed.length) {
      await api.clipboardDelete().catch(() => {});
      state.clipboard = null;
      updateActionBar();
    }

    if (failed.length) {
      toast(`${action === 'cut' ? '移动' : '复制'}完成 ${done}/${itemNames.length} 项，${failed.length} 项失败`);
    } else if (action === 'cut') {
      toast(`已移动 ${done} 个项目`);
    } else if (done) {
      toast(`已复制 ${done} 个项目`);
    }

    await refreshAfterMutation();
  });
}

async function refreshClipboardState() {
  try {
    const clipData = await api.clipboardGet();
    if (Array.isArray(clipData?.items) && clipData.items.length) {
      state.clipboard = {
        items: clipData.items,
        action: clipData.action || 'copy',
        sourcePath: clipData.sourcePath || ''
      };
    }
  } catch {
    // Older server builds may not expose the clipboard API.
  } finally {
    updateActionBar();
  }
}

// ── Render ─────────────────────────────────────────────────

function renderFiles() {
  els.fileRows.replaceChildren();
  els.fileGrid.replaceChildren();
  const folders = filterNamed(state.folders);
  const files = filterNamed(state.files);
  const hasItems = folders.length + files.length > 0;

  renderRows({
    tbody: els.fileRows,
    folders,
    files,
    parentPath: state.currentPath,
    onFolder: (name) => navigateFiles(joinRemote(state.currentPath, name)),
    onDownload: (file) => downloadFile(joinRemote(state.currentPath, file.name), file.name),
    onPreview: (file) => openFilePreview(joinRemote(state.currentPath, file.name), file),
    onRename: (item) => renameItem(item, state.currentPath),
    onDelete: (item) => deleteItem(item, state.currentPath),
    onCopy: (item) => copyToClipboard(item, state.currentPath, 'copy'),
    onCut: (item) => copyToClipboard(item, state.currentPath, 'cut')
  });

  renderFileCards({
    container: els.fileGrid,
    folders,
    files,
    parentPath: state.currentPath,
    onFolder: (name) => navigateFiles(joinRemote(state.currentPath, name)),
    onDownload: (file) => downloadFile(joinRemote(state.currentPath, file.name), file.name),
    onPreview: (file) => openFilePreview(joinRemote(state.currentPath, file.name), file),
    onRename: (item) => renameItem(item, state.currentPath),
    onDelete: (item) => deleteItem(item, state.currentPath),
    onCopy: (item) => copyToClipboard(item, state.currentPath, 'copy'),
    onCut: (item) => copyToClipboard(item, state.currentPath, 'cut')
  });

  els.fileEmpty.classList.toggle('hidden', hasItems);
  updateFileViewModeControls();
  updateFileViewVisibility(hasItems);
}

function setFileViewMode(mode) {
  state.fileViewMode = mode === 'grid' ? 'grid' : 'list';
  localStorage.setItem(FILE_VIEW_STORAGE_KEY, state.fileViewMode);
  updateFileViewModeControls();
  updateFileViewVisibility(filterNamed(state.folders).length + filterNamed(state.files).length > 0);
}

function updateFileViewModeControls() {
  els.fileListModeButton.classList.toggle('active', state.fileViewMode === 'list');
  els.fileGridModeButton.classList.toggle('active', state.fileViewMode === 'grid');
  els.fileListModeButton.setAttribute('aria-pressed', String(state.fileViewMode === 'list'));
  els.fileGridModeButton.setAttribute('aria-pressed', String(state.fileViewMode === 'grid'));
}

function updateFileViewVisibility(hasItems) {
  const showGrid = state.fileViewMode === 'grid' && hasItems;
  const showList = state.fileViewMode === 'list' && hasItems;
  els.driveTableWrap.classList.toggle('hidden', !showList);
  els.fileGrid.classList.toggle('hidden', !showGrid);
}

function renderAlbum() {
  els.albumGrid.replaceChildren();
  const folders = filterNamed(state.albumFolders);
  const files = filterNamed(state.albumFiles);
  let tileIndex = 0;

  for (const folderName of folders) {
    els.albumGrid.append(makeAlbumTile({
      type: 'folder',
      name: folderName,
      meta: '相册文件夹',
      onOpen: () => navigateAlbum(joinRemote(state.albumPath, folderName)),
      contextActions: () => folderContextActions({
        name: folderName,
        parentPath: state.albumPath,
        onOpen: () => navigateAlbum(joinRemote(state.albumPath, folderName))
      })
    }, tileIndex));
    tileIndex += 1;
  }

  for (const file of files) {
    const remotePath = joinRemote(state.albumPath, file.name);
    const kind = mediaKind(file.name);
    els.albumGrid.append(makeAlbumTile({
      type: kind,
      name: file.name,
      meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`,
      remotePath,
      file,
      onOpen: () => openAlbumItem(remotePath, file, kind),
      contextActions: () => albumFileContextActions({
        file,
        parentPath: state.albumPath,
        onOpen: () => openAlbumItem(remotePath, file, kind)
      })
    }, tileIndex));
    tileIndex += 1;
  }

  els.albumEmpty.classList.toggle('hidden', folders.length + files.length > 0);
}

function makeAlbumTile(item, index = 0) {
  const tile = document.createElement('article');
  tile.className = `album-tile ${albumTileSize(index, item.type)}`;
  tile.tabIndex = 0;
  tile.title = item.name;
  tile.addEventListener('click', item.onOpen);
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      item.onOpen();
    }
  });
  tile.addEventListener('contextmenu', (event) => {
    if (!item.contextActions) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    markContextElement(tile);
    showContextMenu(event, item.contextActions());
  });

  const preview = document.createElement('div');
  preview.className = `album-preview ${item.type === 'folder' ? 'folder' : ''}`;

  if (item.type === 'image') {
    const placeholder = mediaPlaceholder('IMG');
    preview.append(placeholder);
    loadAlbumPreview(item.remotePath, preview, placeholder);
  } else if (item.type === 'video') {
    preview.append(mediaPlaceholder('VIDEO'));
  } else if (item.type === 'folder') {
    preview.append(mediaPlaceholder('DIR'));
  } else {
    preview.append(mediaPlaceholder('FILE'));
  }

  const label = document.createElement('div');
  label.className = 'album-label';
  const name = document.createElement('strong');
  name.textContent = item.name;
  name.title = item.name;
  const meta = document.createElement('span');
  meta.textContent = item.meta;
  label.append(name, meta);

  tile.append(preview, label);
  return tile;
}

function albumTileSize(index, type) {
  if (type === 'folder') {
    return 'album-tile-folder';
  }

  const pattern = index % 11;
  if (pattern === 0 || pattern === 7) {
    return 'album-tile-large';
  }
  if (pattern === 3) {
    return 'album-tile-wide';
  }
  if (pattern === 5) {
    return 'album-tile-tall';
  }
  return '';
}

function mediaPlaceholder(text) {
  const placeholder = document.createElement('div');
  placeholder.className = 'media-placeholder';
  placeholder.textContent = text;
  return placeholder;
}

async function loadAlbumPreview(remotePath, preview, placeholder) {
  preview.classList.add('is-loading');

  if (state.previewCache.has(remotePath)) {
    const cached = state.previewCache.get(remotePath);
    if (cached) {
      showPreviewImage(preview, placeholder, cached);
    } else {
      preview.classList.remove('is-loading');
    }
    return;
  }

  try {
    const result = await api.previewFile(remotePath);
    const dataUrl = result?.ok ? result.dataUrl : '';
    state.previewCache.set(remotePath, dataUrl);
    if (dataUrl) {
      showPreviewImage(preview, placeholder, dataUrl);
    } else {
      preview.classList.remove('is-loading');
    }
  } catch (error) {
    state.previewCache.set(remotePath, '');
    preview.classList.remove('is-loading');
  }
}

function showPreviewImage(preview, placeholder, dataUrl) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('load', () => {
    preview.classList.remove('is-loading');
    img.classList.add('is-loaded');
  });
  img.addEventListener('error', () => {
    preview.classList.remove('is-loading');
  });
  img.src = dataUrl;
  placeholder.replaceWith(img);
}

function openAlbumItem(remotePath, file, kind) {
  const items = filterNamed(state.albumFiles).map((albumFile) => ({
    file: albumFile,
    name: albumFile.name,
    remotePath: joinRemote(state.albumPath, albumFile.name),
    kind: mediaKind(albumFile.name),
    meta: `${formatBytes(albumFile.size)} · ${formatDate(albumFile.uploaded)}`
  }));
  const index = Math.max(0, items.findIndex((item) => item.remotePath === remotePath));

  openMediaViewer(items.length ? items : [{
    file,
    name: file.name,
    remotePath,
    kind,
    meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`
  }], index);
}

// 双击文件预览（支持图片、视频、音频、纯文本）
async function openFilePreview(remotePath, file) {
  const kind = mediaKind(file.name);

  // 可预览类型：图片、视频、音频、纯文本
  const previewable = ['image', 'video', 'audio', 'document', 'code'].includes(kind) ||
    ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'csv', 'ini', 'cfg', 'conf'].includes(extension(file.name));

  if (!previewable) {
    toast('此文件类型暂不支持预览');
    return;
  }

  const item = {
    file,
    name: file.name,
    remotePath,
    kind,
    meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`
  };

  openMediaViewer([item], 0);
}

function openMediaViewer(items, index = 0) {
  state.viewer.items = items;
  state.viewer.index = Math.min(Math.max(index, 0), items.length - 1);
  els.mediaViewer.classList.remove('hidden');
  document.body.classList.add('viewer-open');
  hideContextMenu();
  renderMediaViewer();
}

function closeMediaViewer() {
  state.viewer.token += 1;
  state.viewer.items = [];
  state.viewer.index = 0;
  els.mediaViewer.classList.add('hidden');
  document.body.classList.remove('viewer-open');
  els.viewerStage.replaceChildren();
}

function stepMediaViewer(delta) {
  if (!state.viewer.items.length) {
    return;
  }
  const nextIndex = state.viewer.index + delta;
  if (nextIndex < 0 || nextIndex >= state.viewer.items.length) {
    return;
  }
  state.viewer.index = nextIndex;
  renderMediaViewer();
}

async function renderMediaViewer() {
  const item = state.viewer.items[state.viewer.index];
  if (!item) {
    closeMediaViewer();
    return;
  }

  const token = state.viewer.token + 1;
  state.viewer.token = token;
  els.viewerTitle.textContent = item.name;
  els.viewerTitle.title = item.name;
  els.viewerMeta.textContent = item.meta || '';
  els.viewerPrevButton.disabled = state.viewer.index <= 0;
  els.viewerNextButton.disabled = state.viewer.index >= state.viewer.items.length - 1;
  els.viewerStage.replaceChildren(makeViewerLoader());

  const dataUrl = await loadFullPreviewDataUrl(item.remotePath);
  if (state.viewer.token !== token) {
    return;
  }

  els.viewerStage.replaceChildren(makeViewerContent(item, dataUrl));
}

async function loadFullPreviewDataUrl(remotePath) {
  const thumbnail = state.previewCache.get(remotePath);
  if (thumbnail) {
    return thumbnail;
  }

  if (state.fullPreviewCache.has(remotePath)) {
    return state.fullPreviewCache.get(remotePath);
  }

  try {
    const result = await api.previewFile(remotePath, FULL_PREVIEW_LIMIT);
    const dataUrl = result?.ok ? result.dataUrl : '';
    state.fullPreviewCache.set(remotePath, dataUrl);
    return dataUrl;
  } catch (error) {
    state.fullPreviewCache.set(remotePath, '');
    return '';
  }
}

function makeViewerLoader() {
  const loader = document.createElement('div');
  loader.className = 'viewer-loader';
  loader.append(mediaPlaceholder(''));
  return loader;
}

function makeViewerContent(item, dataUrl) {
  if (dataUrl && item.kind === 'image') {
    const img = document.createElement('img');
    img.alt = item.name;
    img.src = dataUrl;
    return img;
  }

  if (dataUrl && item.kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.src = dataUrl;
    return video;
  }

  if (dataUrl && item.kind === 'audio') {
    const wrapper = document.createElement('div');
    wrapper.className = 'viewer-audio-wrap';
    const icon = document.createElement('div');
    icon.className = 'viewer-audio-icon';
    icon.append(mediaPlaceholder('AUDIO'));
    const name = document.createElement('div');
    name.className = 'viewer-audio-name';
    name.textContent = item.name;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.src = dataUrl;
    wrapper.append(icon, name, audio);
    return wrapper;
  }

  if (dataUrl && (item.kind === 'document' || item.kind === 'code')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'viewer-text-wrap';
    const pre = document.createElement('pre');
    pre.className = 'viewer-text-content';
    try {
      const base64 = dataUrl.split(',')[1] || '';
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pre.textContent = new TextDecoder('utf-8').decode(bytes);
    } catch {
      pre.textContent = '[无法解码文本内容]';
    }
    wrapper.append(pre);
    return wrapper;
  }

  const empty = document.createElement('div');
  empty.className = 'viewer-empty';
  empty.append(mediaPlaceholder(item.kind === 'video' ? 'VIDEO' : item.kind === 'audio' ? 'AUDIO' : 'FILE'));
  const text = document.createElement('strong');
  text.textContent = '暂不支持预览';
  empty.append(text);
  return empty;
}

async function downloadCurrentViewerItem() {
  const item = state.viewer.items[state.viewer.index];
  if (!item) {
    return;
  }
  await downloadFile(item.remotePath, item.name);
}

function renderQuick() {
  els.quickFolders.replaceChildren();
  els.quickFiles.replaceChildren();

  const folders = filterNamed(state.quickFolders).slice(0, 8);
  const files = filterNamed(state.quickFiles);

  for (const folderName of folders) {
    els.quickFolders.append(makeQuickItem({
      type: 'folder',
      name: folderName,
      meta: '根目录文件夹',
      action: '打开',
      onAction: () => {
        setView('drive');
        navigateFiles(folderName);
      },
      contextActions: () => [
        menuAction('打开', 'open-icon', () => {
          setView('drive');
          navigateFiles(folderName);
        }),
        menuAction('刷新', 'refresh-icon', loadQuick)
      ]
    }));
  }

  for (const file of files) {
    els.quickFiles.append(makeQuickItem({
      type: 'file',
      name: file.name,
      meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`,
      action: '预览',
      onAction: () => openFilePreview(file.name, file),
      contextActions: () => [
        menuAction('预览', 'preview-icon', () => openFilePreview(file.name, file)),
        menuAction('下载', 'download-icon', () => downloadFile(file.name, file.name)),
        menuAction('刷新', 'refresh-icon', loadQuick)
      ]
    }));
  }

  els.quickEmpty.classList.toggle('hidden', folders.length + files.length > 0);
}

function makeQuickItem(item) {
  const row = document.createElement('article');
  row.className = 'quick-item';
  row.addEventListener('contextmenu', (event) => {
    if (!item.contextActions) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    markContextElement(row);
    showContextMenu(event, item.contextActions());
  });
  const badge = makeFileBadge(item);

  const copy = document.createElement('div');
  copy.className = 'ellipsis';
  const name = document.createElement('strong');
  name.textContent = item.name;
  name.title = item.name;
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = item.meta;
  copy.append(name, meta);

  row.append(badge, copy, actionButton(item.action, item.onAction));
  return row;
}

function renderBackup() {
  if (!els.backupJobList) {
    return;
  }

  els.backupIntervalInput.value = state.backup.intervalMinutes || 15;
  els.backupAutoStart.checked = Boolean(state.backup.autoStart);
  els.backupJobList.replaceChildren();

  const jobs = filterNamed(state.backup.jobs);
  for (const job of jobs) {
    els.backupJobList.append(makeBackupJobItem(job));
  }

  els.backupEmpty.classList.toggle('hidden', jobs.length > 0);
}

function makeBackupJobItem(job) {
  const status = state.backup.statuses.get(job.id);
  const item = document.createElement('article');
  item.className = 'backup-job';
  item.classList.toggle('is-running', status?.status === 'running');

  const icon = makeFileBadge({ type: 'folder', name: job.name });

  const content = document.createElement('div');
  content.className = 'backup-job-content';

  const title = document.createElement('div');
  title.className = 'backup-job-title';
  const name = document.createElement('strong');
  name.textContent = job.name || job.localPath;
  name.title = job.localPath;
  const kindBadge = document.createElement('span');
  kindBadge.className = 'badge';
  kindBadge.textContent = job.kind === 'album' ? '相册' : '普通';
  const stateBadge = document.createElement('span');
  stateBadge.className = `badge ${job.enabled === false ? 'off' : ''}`;
  stateBadge.textContent = job.enabled === false ? '已停用' : '已启用';
  title.append(name, kindBadge, stateBadge);

  const paths = document.createElement('div');
  paths.className = 'backup-job-paths muted';
  paths.textContent = `${job.localPath} -> /${job.remotePath}`;
  paths.title = paths.textContent;

  const meta = document.createElement('div');
  meta.className = 'backup-job-meta muted';
  const stats = status?.stats;
  const statText = stats
    ? `扫描 ${stats.scanned || 0}，上传 ${stats.uploaded || 0}，跳过 ${stats.skipped || 0}，失败 ${stats.failed || 0}`
    : (job.lastMessage || '等待首次同步');
  const timeText = job.lastRunAt ? `上次：${formatDate(job.lastRunAt)}` : '尚未运行';
  meta.textContent = status?.phase ? `${status.phase} · ${statText}` : `${timeText} · ${statText}`;

  if (status?.fileName) {
    const file = document.createElement('div');
    file.className = 'backup-job-file muted';
    file.textContent = status.fileName;
    file.title = status.remotePath || status.fileName;
    content.append(title, paths, meta, file);
  } else {
    content.append(title, paths, meta);
  }

  const actions = document.createElement('div');
  actions.className = 'backup-job-actions';
  actions.append(
    actionButton('立即同步', () => runBackupNow(job.id)),
    actionButton(job.enabled === false ? '启用' : '停用', () => toggleBackupJob(job)),
    actionButton('删除', () => removeBackupJob(job), 'danger')
  );

  item.append(icon, content, actions);
  return item;
}

function renderFileCards(options) {
  for (const folderName of options.folders) {
    options.container.append(makeFileCard({
      item: { type: 'folder', name: folderName },
      meta: '文件夹',
      parentPath: options.parentPath,
      onOpen: () => options.onFolder(folderName),
      onRename: options.onRename,
      onDelete: options.onDelete,
      onCopy: options.onCopy,
      onCut: options.onCut
    }));
  }

  for (const file of options.files) {
    options.container.append(makeFileCard({
      item: { ...file, type: 'file' },
      meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`,
      parentPath: options.parentPath,
      onOpen: () => options.onPreview(file),
      onDownload: () => options.onDownload(file),
      onRename: options.onRename,
      onDelete: options.onDelete,
      onCopy: options.onCopy,
      onCut: options.onCut
    }));
  }
}

function makeFileCard(options) {
  const card = document.createElement('article');
  card.className = 'file-card';
  card.tabIndex = 0;
  card.classList.toggle('selected', isSelected(options.item));
  card.addEventListener('click', (event) => {
    handleDriveItemClick(event, options.item, card, options.onOpen);
  });
  card.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    options.onOpen();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      options.onOpen();
    } else if (event.key === ' ') {
      event.preventDefault();
      toggleSelection(options.item, card);
    }
  });
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markContextElement(card);
    showItemContextMenu(event, {
      item: options.item,
      parentPath: options.parentPath,
      onOpen: options.onOpen,
      onDownload: options.onDownload,
      onRename: () => options.onRename(options.item),
      onDelete: () => options.onDelete(options.item)
    });
  });

  const row = document.createElement('div');
  row.className = 'file-card-row';

  const badge = makeFileBadge(options.item);

  const textCol = document.createElement('div');
  textCol.className = 'file-card-text';

  const name = document.createElement('strong');
  name.className = 'file-card-name';
  name.textContent = options.item.name;
  name.title = options.item.name;

  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = options.meta;

  textCol.append(name, meta);

  // Three-dot menu button (shown on hover)
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'card-menu-btn';
  menuBtn.setAttribute('aria-label', '更多操作');
  menuBtn.append(materialIcon('more_vert'));
  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hideContextMenu();
    showContextMenu(event, buildGridCardActions(options));
  });

  row.append(badge, textCol, menuBtn);
  card.append(row);
  return card;
}

function buildGridCardActions(options) {
  const isFolder = options.item.type === 'folder';
  const actions = [];

  if (isFolder) {
    actions.push(menuAction('打开', 'open-icon', options.onOpen));
  } else {
    actions.push(menuAction('预览', 'preview-icon', options.onOpen));
    actions.push(menuAction('下载', 'download-icon', options.onDownload));
  }
  actions.push(menuSeparator());
  actions.push(menuAction('重命名', 'rename-icon', () => options.onRename(options.item)));
  if (options.onCopy) {
    actions.push(menuAction('复制', 'copy-icon', () => options.onCopy(options.item)));
  }
  if (options.onCut) {
    actions.push(menuAction('剪切', 'cut-icon', () => options.onCut(options.item)));
  }
  actions.push(menuSeparator());
  actions.push(menuAction('删除', 'trash-icon', () => options.onDelete(options.item), 'danger'));

  return actions;
}

function renderRows(options) {
  for (const folderName of options.folders) {
    const row = makeRow({
      item: { type: 'folder', name: folderName },
      size: '--',
      uploaded: '--',
      parentPath: options.parentPath,
      onOpen: () => options.onFolder(folderName),
      onRename: options.onRename,
      onDelete: options.onDelete,
      onCopy: options.onCopy,
      onCut: options.onCut
    });
    options.tbody.append(row);
  }

  for (const file of options.files) {
    const row = makeRow({
      item: { ...file, type: 'file' },
      size: formatBytes(file.size),
      uploaded: formatDate(file.uploaded),
      parentPath: options.parentPath,
      onOpen: () => options.onPreview(file),
      onDownload: () => options.onDownload(file),
      onRename: options.onRename,
      onDelete: options.onDelete,
      onCopy: options.onCopy,
      onCut: options.onCut
    });
    options.tbody.append(row);
  }
}

function makeRow(options) {
  const row = document.createElement('tr');
  row.classList.toggle('selected', isSelected(options.item));
  row.addEventListener('click', (event) => {
    handleDriveItemClick(event, options.item, row, options.onOpen);
  });
  row.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    options.onOpen();
  });
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markContextElement(row);
    showItemContextMenu(event, {
      item: options.item,
      parentPath: options.parentPath,
      onOpen: options.onOpen,
      onDownload: options.onDownload,
      onRename: () => options.onRename(options.item),
      onDelete: () => options.onDelete(options.item)
    });
  });

  const nameCell = document.createElement('td');
  const nameWrap = document.createElement('div');
  nameWrap.className = 'name-cell';
  const icon = makeFileBadge(options.item);
  const name = document.createElement('span');
  name.className = 'file-name';
  name.title = options.item.name;
  name.textContent = options.item.name;
  nameWrap.append(icon, name);
  nameCell.append(nameWrap);

  const sizeCell = document.createElement('td');
  sizeCell.textContent = options.size;

  const uploadedCell = document.createElement('td');
  uploadedCell.textContent = options.uploaded;

  const actionsCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  // 主操作
  if (options.item.type === 'folder') {
    actions.append(actionButton('打开', options.onOpen));
  } else {
    actions.append(actionButton('预览', options.onOpen));
  }

  // 更多操作按钮
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'secondary';
  moreBtn.title = '更多操作';
  moreBtn.append(materialIcon('more_horiz'));
  moreBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hideContextMenu();
    markContextElement(row);
    showItemContextMenu(event, {
      item: options.item,
      parentPath: options.parentPath,
      onOpen: options.onOpen,
      onDownload: options.onDownload,
      onRename: () => options.onRename(options.item),
      onDelete: () => options.onDelete(options.item)
    });
  });
  actions.append(moreBtn);

  actionsCell.append(actions);
  row.append(nameCell, sizeCell, uploadedCell, actionsCell);
  return row;
}

function actionButton(label, handler, variant = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'danger' ? 'danger' : 'secondary';
  const iconName = MATERIAL_ICON_BY_ACTION[label];
  if (iconName) {
    button.append(materialIcon(iconName));
  }
  const text = document.createElement('span');
  text.textContent = label;
  button.append(text);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function selectedItems() {
  return [...state.selectedItems.values()];
}

function selectedItemKey(item) {
  return `${item?.type || 'file'}:${item?.name || ''}`;
}

function isSelected(item) {
  return state.selectedItems.has(selectedItemKey(item));
}

function toggleSelection(item, element) {
  const key = selectedItemKey(item);
  const selected = !state.selectedItems.has(key);
  if (selected) {
    state.selectedItems.set(key, {
      name: item.name,
      type: item.type === 'folder' ? 'folder' : 'file'
    });
  } else {
    state.selectedItems.delete(key);
  }
  element?.classList.toggle('selected', selected);
  updateActionBar();
}

function handleDriveItemClick(event, item, element, onOpen) {
  if (event.target.closest('button')) {
    return;
  }
  // 单击切换选中状态（多选模式）
  toggleSelection(item, element);
}

function updateActionBar() {
  const count = state.selectedItems.size;
  const clipCount = Array.isArray(state.clipboard?.items) ? state.clipboard.items.length : 0;
  const canPaste = state.view === 'drive' && clipCount > 0;

  els.actionBarCount.textContent = count
    ? `已选中 ${count} 项`
    : clipCount
      ? `${state.clipboard.action === 'cut' ? '剪切' : '复制'} ${clipCount} 项待粘贴`
      : '单击选择文件，双击预览';
  els.copySelectedButton.disabled = count === 0;
  els.cutSelectedButton.disabled = count === 0;
  els.renameSelectedButton.disabled = count !== 1;
  els.downloadSelectedButton.disabled = count === 0;
  // 删除按钮始终可用：无选中时打开孤儿文件扫描
  els.deleteSelectedButton.disabled = false;
  els.pasteButton.disabled = !canPaste;
}

function selectAllVisible() {
  const items = getCurrentViewItems();
  for (const item of items) {
    const key = selectedItemKey(item);
    if (!state.selectedItems.has(key)) {
      state.selectedItems.set(key, {
        name: item.name,
        type: item.type === 'folder' ? 'folder' : 'file'
      });
    }
  }
  updateSelectionVisuals();
  updateActionBar();
}

function getCurrentViewItems() {
  const items = [];
  if (state.view === 'drive') {
    for (const name of filterNamed(state.folders)) {
      items.push({ type: 'folder', name });
    }
    for (const file of filterNamed(state.files)) {
      items.push({ type: 'file', name: file.name });
    }
  } else if (state.view === 'album') {
    for (const name of filterNamed(state.albumFolders)) {
      items.push({ type: 'folder', name });
    }
    for (const file of filterNamed(state.albumFiles)) {
      items.push({ type: 'file', name: file.name });
    }
  }
  return items;
}

function updateSelectionVisuals() {
  // 更新列表视图中的行
  els.fileRows.querySelectorAll('tr').forEach((row) => {
    const nameEl = row.querySelector('.file-name');
    if (nameEl) {
      const name = nameEl.textContent;
      const isFolder = row.querySelector('.file-kind-folder');
      const key = selectedItemKey({ type: isFolder ? 'folder' : 'file', name });
      row.classList.toggle('selected', state.selectedItems.has(key));
    }
  });
  // 更新网格视图中的卡片
  els.fileGrid.querySelectorAll('.file-card').forEach((card) => {
    const nameEl = card.querySelector('.file-card-name');
    if (nameEl) {
      const name = nameEl.textContent;
      const isFolder = card.querySelector('.file-kind-folder');
      const key = selectedItemKey({ type: isFolder ? 'folder' : 'file', name });
      card.classList.toggle('selected', state.selectedItems.has(key));
    }
  });
}

async function renameSelectedItem() {
  const [item] = selectedItems();
  if (!item) {
    return;
  }
  await renameItem(item, state.currentPath);
}

async function downloadSelectedItems() {
  const files = selectedItems().filter((item) => item.type !== 'folder');
  if (!files.length) {
    toast('请选择要下载的文件');
    return;
  }
  const batchKey = makeClientBatchKey('download');
  const batchNames = files.map((item) => item.name);
  let done = 0;
  for (const item of files) {
    const result = await downloadFile(joinRemote(state.currentPath, item.name), item.name, {
      batchKey,
      batchTotal: files.length,
      batchNames
    });
    if (!result?.canceled) {
      done += 1;
    }
  }
  toast(done === files.length ? `已下载 ${done} 个文件` : `下载完成 ${done}/${files.length} 个文件`);
}

async function deleteSelectedItems() {
  const items = selectedItems();
  if (!items.length) {
    // 无选中文件时，打开孤儿文件扫描清理
    showOrphanCleanup();
    return;
  }
  const ok = await openConfirmDialog({
    title: '删除项目',
    message: `确定删除选中的 ${items.length} 个项目吗？此操作无法在客户端撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) {
    return;
  }

  await runTask(async () => {
    const paths = items.map((item) => joinRemote(state.currentPath, item.name));
    if (typeof api.deleteBatch === 'function') {
      await api.deleteBatch(paths);
    } else {
      for (const remotePath of paths) {
        await api.deletePath(remotePath);
      }
    }
    state.selectedItems.clear();
    await refreshAfterMutation();
    updateActionBar();
    toast('已删除');
  });
}

function makeFileBadge(item) {
  const badge = document.createElement('span');
  const kind = fileKind(item);
  badge.className = `file-badge file-kind-${kind}`;
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

function fileKind(item) {
  if (item?.type === 'folder') {
    return 'folder';
  }

  const ext = extension(item?.name || item);
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'opus'].includes(ext)) {
    return 'audio';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv'].includes(ext)) {
    return 'video';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
    return 'archive';
  }
  if (['exe', 'msi', 'bat', 'cmd', 'com', 'appx', 'appxbundle', 'dmg', 'deb', 'rpm'].includes(ext)) {
    return 'executable';
  }
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) {
    return 'document';
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return 'sheet';
  }
  if (['ppt', 'pptx', 'key'].includes(ext)) {
    return 'presentation';
  }
  if (['db', 'sqlite', 'sql', 'mdb'].includes(ext)) {
    return 'database';
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'py', 'go', 'rs', 'java', 'cpp', 'c'].includes(ext)) {
    return 'code';
  }
  return 'generic';
}

function materialIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-icons-round';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

function materialIconName(key) {
  return MATERIAL_ICON_BY_KEY[key] || key || 'more_horiz';
}

function menuAction(label, icon, handler, variant = '') {
  return { label, icon, handler, variant };
}

function menuSeparator() {
  return { separator: true };
}

function folderContextActions({ name, parentPath, onOpen }) {
  const item = { type: 'folder', name };
  return [
    menuAction('打开', 'open-icon', onOpen),
    menuSeparator(),
    menuAction('重命名', 'rename-icon', () => renameItem(item, parentPath)),
    menuAction('删除', 'trash-icon', () => deleteItem(item, parentPath), 'danger')
  ];
}

function fileContextActions({ file, parentPath, remotePath }) {
  const item = { ...file, type: 'file' };
  return [
    menuAction('预览', 'preview-icon', () => openFilePreview(remotePath, file)),
    menuAction('下载', 'download-icon', () => downloadFile(remotePath, file.name)),
    menuSeparator(),
    menuAction('重命名', 'rename-icon', () => renameItem(item, parentPath)),
    menuAction('删除', 'trash-icon', () => deleteItem(item, parentPath), 'danger')
  ];
}

function albumFileContextActions({ file, parentPath, onOpen }) {
  const item = { ...file, type: 'file' };
  return [
    menuAction('全屏查看', 'open-icon', onOpen),
    menuSeparator(),
    menuAction('重命名', 'rename-icon', () => renameItem(item, parentPath)),
    menuAction('删除', 'trash-icon', () => deleteItem(item, parentPath), 'danger')
  ];
}

function showItemContextMenu(event, options) {
  const isFolder = options.item.type === 'folder';
  const actions = [];

  if (isFolder) {
    actions.push(menuAction('打开', 'open-icon', options.onOpen));
  } else {
    actions.push(menuAction('预览', 'preview-icon', options.onOpen));
    actions.push(menuAction('下载', 'download-icon', options.onDownload));
  }
  actions.push(menuSeparator());
  actions.push(menuAction('重命名', 'rename-icon', options.onRename));

  if (state.view === 'drive') {
    actions.push(menuAction('复制', 'copy-icon', () => copyToClipboard(options.item, options.parentPath, 'copy')));
    actions.push(menuAction('剪切', 'cut-icon', () => copyToClipboard(options.item, options.parentPath, 'cut')));
  }

  actions.push(menuSeparator());
  actions.push(menuAction('删除', 'trash-icon', options.onDelete, 'danger'));

  showContextMenu(event, actions);
}

function showViewContextMenu(event) {
  if (!['drive', 'album'].includes(state.view)) {
    return;
  }

  if (event.target.closest('tr, .file-card, .album-tile, button, input, label, .surface-menu, .modal, .media-viewer')) {
    return;
  }

  event.preventDefault();
  clearContextElement();

  const menuItems = [
    menuAction('上传文件', 'upload-icon', uploadFiles),
    menuAction('新建文件夹', 'folder-plus-icon', createFolder),
    menuSeparator()
  ];

  if (state.view === 'drive') {
    menuItems.push(menuAction('粘贴', 'paste-icon', pasteFromClipboard));
    menuItems.push(menuSeparator());
  } else if (state.view === 'album') {
    menuItems.push(menuAction('相册同步', 'backup', selectAlbumBackupFolder));
    menuItems.push(menuSeparator());
  }

  menuItems.push(menuAction('刷新', 'refresh-icon', refreshCurrentView));

  showContextMenu(event, menuItems);
}

function showContextMenu(event, actions) {
  hideNewMenu();
  els.contextMenu.replaceChildren();

  for (const action of actions) {
    if (action.separator) {
      const separator = document.createElement('div');
      separator.className = 'menu-separator';
      separator.setAttribute('role', 'separator');
      els.contextMenu.append(separator);
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = `menu-item ${action.variant === 'danger' ? 'danger-item' : ''}`.trim();

    if (action.icon) {
      button.append(materialIcon(materialIconName(action.icon)));
    }

    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(label);
    button.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation();
      hideContextMenu();
      action.handler?.();
    });
    els.contextMenu.append(button);
  }

  els.contextMenu.classList.remove('hidden');
  positionFloatingMenu(els.contextMenu, event.clientX, event.clientY);
}

function hideContextMenu() {
  els.contextMenu.classList.add('hidden');
  clearContextElement();
}

function markContextElement(element) {
  clearContextElement();
  state.contextElement = element;
  element.classList.add('is-context-selected');
}

function clearContextElement() {
  state.contextElement?.classList.remove('is-context-selected');
  state.contextElement = null;
}

function toggleNewMenu(event) {
  event.stopPropagation();
  hideContextMenu();

  if (!els.newMenu.classList.contains('hidden')) {
    hideNewMenu();
    return;
  }

  els.newButton.setAttribute('aria-expanded', 'true');
  els.newMenu.classList.remove('hidden');
  const rect = els.newButton.getBoundingClientRect();
  positionFloatingMenu(els.newMenu, rect.left, rect.bottom + 8);
}

function hideNewMenu() {
  els.newMenu.classList.add('hidden');
  els.newButton.setAttribute('aria-expanded', 'false');
}

function positionFloatingMenu(menu, x, y) {
  const margin = 10;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function submitDialog(event) {
  event.preventDefault();
  if (!state.dialogResolve) {
    return;
  }

  const needsInput = !els.dialogInputWrap.classList.contains('hidden');
  if (!needsInput) {
    closeDialog(true);
    return;
  }

  const value = els.dialogInput.value.trim();
  if (els.dialogInput.required && !value) {
    els.dialogInput.focus();
    return;
  }
  closeDialog(value);
}

function openTextDialog(options) {
  return openDialog({
    ...options,
    input: true,
    required: options.required !== false
  });
}

async function openConfirmDialog(options) {
  const result = await openDialog({
    ...options,
    input: false
  });
  return Boolean(result);
}

function openDialog(options) {
  closeDialog(null);
  return new Promise((resolve) => {
    state.dialogResolve = resolve;
    els.dialogTitle.textContent = options.title || '操作确认';
    els.dialogMessage.textContent = options.message || '';
    els.dialogMessage.classList.toggle('hidden', !options.message);
    els.dialogInputWrap.classList.toggle('hidden', !options.input);
    els.dialogInputLabel.textContent = options.label || '名称';
    els.dialogInput.value = options.value || '';
    els.dialogInput.placeholder = options.placeholder || '';
    els.dialogInput.required = Boolean(options.required);
    els.dialogConfirmButton.textContent = options.confirmText || '确定';
    els.dialogConfirmButton.className = options.danger ? 'danger-action' : 'primary';
    els.dialogModal.classList.remove('hidden');

    window.setTimeout(() => {
      if (options.input) {
        els.dialogInput.focus();
        els.dialogInput.select();
      } else {
        els.dialogConfirmButton.focus();
      }
    }, 0);
  });
}

function closeDialog(value) {
  if (!state.dialogResolve) {
    return;
  }

  const resolve = state.dialogResolve;
  state.dialogResolve = null;
  els.dialogModal.classList.add('hidden');
  resolve(value);
}

function renderBreadcrumb() {
  els.breadcrumb.replaceChildren();

  if (state.view === 'drive') {
    renderPathBreadcrumb('我的云盘', state.currentPath, navigateFiles);
    els.backButton.disabled = !state.currentPath;
    return;
  }

  if (state.view === 'album') {
    const relativePath = state.albumPath === ALBUM_ROOT ? '' : state.albumPath.slice(ALBUM_ROOT.length + 1);
    renderPathBreadcrumb('相册', relativePath, (pathValue) => navigateAlbum(joinRemote(ALBUM_ROOT, pathValue)));
    els.albumBackButton.disabled = state.albumPath === ALBUM_ROOT;
    return;
  }

  const descriptions = {
    quick: '根目录中的常用入口和最近文件',
    transfers: '实时任务、下载记录与下载路径',
    nodes: '查看和维护分布式上传节点',
    settings: '客户端连接与认证'
  };
  els.breadcrumb.textContent = descriptions[state.view] || '';
}

function renderPathBreadcrumb(rootLabel, pathValue, navigate) {
  const rootButton = document.createElement('button');
  rootButton.textContent = rootLabel;
  rootButton.addEventListener('click', () => navigate(''));
  els.breadcrumb.append(rootButton);

  const parts = pathValue ? pathValue.split('/') : [];
  let cursor = '';
  for (const part of parts) {
    const sep = document.createElement('span');
    sep.textContent = '/';
    els.breadcrumb.append(sep);

    cursor = joinRemote(cursor, part);
    const targetPath = cursor;
    const button = document.createElement('button');
    button.textContent = part;
    button.addEventListener('click', () => navigate(targetPath));
    els.breadcrumb.append(button);
  }
}

function renderStorage() {
  const storage = state.storage;
  if (!storage) {
    return;
  }

  const used = Number(storage.used || 0);
  const total = Number(storage.total || 0);
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  els.storageText.textContent = `${formatBytes(used)} / ${formatBytes(total)}`;
  els.storageMeter.style.width = `${percent}%`;

  const nodes = storage.nodes || [];
  const online = nodes.filter((node) => node.online).length;
  els.nodeSummary.textContent = nodes.length ? `${online}/${nodes.length} 个节点在线` : '单主控存储';
  renderStorageDetails();
}

function renderStorageDetails() {
  els.storageNodeList.replaceChildren();
  const storage = state.storage;
  if (!storage) {
    return;
  }

  const nodes = storage.nodes?.length ? storage.nodes : [{
    id: 'main',
    name: '主控账号',
    used: storage.used,
    total: storage.total,
    online: true
  }];

  for (const node of nodes) {
    const used = Number(node.used || 0);
    const total = Number(node.total || 0);
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

    const item = document.createElement('article');
    item.className = 'storage-node';

    const head = document.createElement('div');
    head.className = 'storage-node-head';
    const title = document.createElement('strong');
    title.textContent = node.name || node.id || '未命名节点';
    const badge = document.createElement('span');
    badge.className = `badge ${node.online ? '' : 'off'}`;
    badge.textContent = node.online ? '在线' : '离线';
    head.append(title, badge);

    const usage = document.createElement('div');
    usage.className = 'muted';
    usage.textContent = `${formatBytes(used)} / ${formatBytes(total)}`;

    const meter = document.createElement('div');
    meter.className = 'meter';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.width = `${percent}%`;
    meter.append(fill);

    item.append(head, usage, meter);
    els.storageNodeList.append(item);
  }
}

function buildNodeRows(nodeConfigs, storage) {
  const rows = [];
  const capacityById = new Map((storage?.nodes || []).map((node) => [node.id || 'main', node]));
  const mainCapacity = capacityById.get('main') || {
    id: 'main',
    name: '主控账号',
    used: storage?.used,
    total: storage?.total,
    online: true
  };

  rows.push({
    ...mainCapacity,
    id: 'main',
    name: mainCapacity.name || '主控账号',
    isMain: true,
    enabled: true,
    displayUrl: displayBaseUrlHost(state.config?.baseUrl || '') || '主账号节点'
  });

  for (const config of nodeConfigs) {
    const capacity = capacityById.get(config.id) || {};
    rows.push({
      ...capacity,
      ...config,
      id: config.id || capacity.id,
      name: config.name || capacity.name || config.id || '未命名节点',
      used: capacity.used,
      total: capacity.total,
      online: capacity.online,
      displayUrl: displayBaseUrlHost(config.url)
    });
  }

  for (const capacity of storage?.nodes || []) {
    if (!capacity.id || capacity.id === 'main' || rows.some((node) => node.id === capacity.id)) {
      continue;
    }
    rows.push({
      ...capacity,
      enabled: capacity.online !== false,
      displayUrl: displayBaseUrlHost(capacity.url)
    });
  }

  return rows;
}

function renderNodes() {
  els.nodesList.replaceChildren();

  if (!state.nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-message muted';
    empty.textContent = '暂无存储节点';
    els.nodesList.append(empty);
    return;
  }

  for (const node of state.nodes) {
    const item = document.createElement('article');
    item.className = `node-item ${node.isMain ? 'main-node' : ''}`.trim();

    const head = document.createElement('div');
    head.className = 'node-item-head';

    const title = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = node.name || node.id;
    const url = document.createElement('div');
    url.className = 'muted ellipsis';
    url.textContent = node.displayUrl || displayBaseUrlHost(node.url) || '主账号节点';
    title.append(name, url);

    const badge = document.createElement('span');
    badge.className = `badge ${node.online === false || node.enabled === false ? 'off' : ''}`;
    badge.textContent = node.isMain
      ? '主账号'
      : node.online === false
        ? '离线'
        : node.enabled === false
          ? '停用'
          : '在线';
    head.append(title, badge);

    const used = Number(node.used || 0);
    const total = Number(node.total || 0);
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `ID: ${node.id || 'main'}，容量: ${formatBytes(used)} / ${total ? formatBytes(total) : '未知'}`;

    const meter = document.createElement('div');
    meter.className = 'meter';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.width = `${percent}%`;
    meter.append(fill);

    const actions = document.createElement('div');
    actions.className = 'node-actions';
    if (!node.isMain) {
      actions.append(
        actionButton('编辑', () => fillNodeForm(node)),
        actionButton('测试', () => testNode(node.id)),
        actionButton('删除', () => deleteNode(node.id), 'danger')
      );
    }

    item.append(head, meta, meter);
    if (actions.children.length) {
      item.append(actions);
    }
    els.nodesList.append(item);
  }
}

function renderTransfers() {
  renderTransferBubble();
  if (state.view === 'transfers') {
    renderTransferView();
  }
}

function scheduleRenderTransfers() {
  if (transferRenderQueued) {
    return;
  }
  transferRenderQueued = true;
  window.requestAnimationFrame(() => {
    transferRenderQueued = false;
    renderTransfers();
  });
}

function toggleStoragePopover() {
  renderStorageDetails();
  els.storagePopover.classList.toggle('hidden');
}

function hideStoragePopover() {
  els.storagePopover.classList.add('hidden');
}

function renderTransferBubble() {
  const transfers = [...state.transfers.values()];
  const total = transfers.length;
  const done = transfers.filter((transfer) => transfer.status === 'done').length;
  const failed = transfers.filter((transfer) => transfer.status === 'error').length;
  const canceled = transfers.filter((transfer) => transfer.status === 'canceled').length;
  const running = transfers
    .filter((transfer) => transfer.status === 'running')
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const current = running[0] || null;
  const currentPercent = current ? progressPercent(current) : 0;
  const totalPercent = aggregateProgressPercent(transfers);
  const visiblePercent = running.length > 1 ? totalPercent : currentPercent;
  const hasActiveUpload = running.some((transfer) => transfer.type === 'upload');
  const hasActiveDownload = running.some((transfer) => transfer.type === 'download');
  const isIdle = total === 0 || (!running.length && done !== total);
  const isDone = total > 0 && !running.length && done === total;
  const isSingle = running.length === 1 && total === 1;
  const hasProblem = failed > 0;

  let labelText = '传输列表';
  let countText = '空闲';
  let progressText = '待命';

  if (running.length) {
    labelText = isSingle ? (current?.type === 'upload' ? '上传中' : '下载中') : '传输中';
    countText = isSingle ? '1/1' : `${done}/${total}`;
    progressText = `${visiblePercent}%`;
  } else if (isDone) {
    labelText = '已完成';
    countText = `${done}/${total}`;
    progressText = '100%';
  } else if (hasProblem) {
    labelText = '有异常';
    countText = `${done}/${total}`;
    progressText = `${totalPercent}%`;
  } else if (canceled > 0) {
    labelText = '已停止';
    countText = `${done}/${total}`;
    progressText = `${totalPercent}%`;
  }

  els.transferBubbleLabel.textContent = labelText;
  els.transferBubbleCount.textContent = countText;
  els.transferBubbleProgress.textContent = progressText;
  els.transferBubble.style.setProperty('--bubble-bar', `${Math.max(0, Math.min(100, running.length ? visiblePercent : totalPercent))}%`);
  els.transferBubble.classList.toggle('has-upload', hasActiveUpload);
  els.transferBubble.classList.toggle('has-download', hasActiveDownload);
  els.transferBubble.classList.toggle('is-active', hasActiveUpload || hasActiveDownload);
  els.transferBubble.classList.toggle('is-idle', isIdle);
  els.transferBubble.classList.toggle('is-empty', total === 0);
  els.transferBubble.classList.toggle('is-done', isDone);
  els.transferBubble.classList.toggle('is-single', isSingle);
  els.transferBubble.classList.toggle('has-problem', hasProblem);
}

function renderTransferView() {
  const transfers = [...state.transfers.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderTransferList(
    els.uploadTransferList,
    transfers.filter((transfer) => transfer.type === 'upload'),
    '暂无上传任务'
  );
  renderTransferList(
    els.downloadTransferList,
    transfers.filter((transfer) => transfer.type === 'download'),
    '暂无下载任务'
  );
  renderDownloadHistory();
}

function renderTransferList(container, items, emptyText) {
  container.replaceChildren();
  if (!items.length) {
    container.append(emptyMessage(emptyText));
    return;
  }

  for (const transfer of items) {
    container.append(makeTransferItem(transfer));
  }
}

function makeTransferItem(transfer) {
  const item = document.createElement('div');
  item.className = `transfer-item transfer-${transfer.type || 'task'}`;

  const title = document.createElement('div');
  title.className = 'transfer-title ellipsis';
  title.textContent = transfer.name || transfer.remotePath || '未命名任务';
  title.title = transfer.remotePath || transfer.name || '';

  const status = document.createElement('div');
  status.className = 'transfer-meta';
  status.textContent = transferStatusText(transfer);

  const meta = document.createElement('div');
  meta.className = 'transfer-meta';
  meta.textContent = transfer.message || transfer.phase || '';

  const progress = document.createElement('div');
  progress.className = 'progress';
  const fill = document.createElement('div');
  fill.style.width = `${progressPercent(transfer)}%`;
  progress.append(fill);

  item.append(title, status, meta);
  if (transfer.type === 'download' && transfer.status === 'running' && transfer.phase !== '正在取消') {
    item.append(actionButton('取消', () => cancelDownload(transfer.id), 'danger'));
  }
  if (transfer.status === 'error' && canRetryTransfer(transfer)) {
    item.append(actionButton('重试', () => retryTransfer(transfer)));
  }
  if (transfer.localPath && transfer.status === 'done') {
    item.append(actionButton('定位', () => api.openPath(transfer.localPath)));
  }
  item.append(progress);
  return item;
}

function canRetryTransfer(transfer) {
  if (transfer.type === 'upload') {
    return Boolean(transfer.filePath && transfer.remotePath);
  }
  if (transfer.type === 'download') {
    return Boolean(transfer.remotePath && transfer.name);
  }
  return false;
}

async function retryTransfer(transfer) {
  state.transfers.delete(transfer.id);
  renderTransfers();

  if (transfer.type === 'upload') {
    const parent = parentPath(transfer.remotePath || '');
    const results = await api.uploadFiles([transfer.filePath], parent);
    const failed = results.filter((result) => !result.ok);
    toast(failed.length ? '重试上传失败' : '已重新开始上传');
    if (!failed.length) {
      await refreshAfterMutation();
    }
    return;
  }

  if (transfer.type === 'download') {
    await downloadFile(transfer.remotePath, transfer.name);
  }
}

async function retryFailedTransfers(type) {
  const failed = [...state.transfers.values()]
    .filter((transfer) => transfer.type === type && transfer.status === 'error' && canRetryTransfer(transfer));

  if (!failed.length) {
    toast('暂无可重试的失败任务');
    return;
  }

  for (const transfer of failed) {
    await retryTransfer(transfer);
  }
}

function renderDownloadHistory() {
  els.downloadHistoryList.replaceChildren();
  if (!state.downloadHistory.length) {
    els.downloadHistoryList.append(emptyMessage('暂无已下载文件'));
    return;
  }

  for (const record of state.downloadHistory) {
    const item = document.createElement('div');
    item.className = 'transfer-item history-item';

    const title = document.createElement('div');
    title.className = 'transfer-title ellipsis';
    title.textContent = record.name || record.remotePath || '已下载文件';
    title.title = record.localPath || record.remotePath || '';

    const status = document.createElement('div');
    status.className = 'transfer-meta';
    status.textContent = record.completedAt ? formatDate(record.completedAt) : '已下载';

    const meta = document.createElement('div');
    meta.className = 'transfer-meta ellipsis';
    meta.textContent = record.localPath || '';
    meta.title = record.localPath || '';

    item.append(title, status, meta);
    if (record.localPath) {
      item.append(actionButton('定位', () => api.openPath(record.localPath)));
    }
    els.downloadHistoryList.append(item);
  }
}

function emptyMessage(text) {
  const empty = document.createElement('div');
  empty.className = 'empty-message muted';
  empty.textContent = text;
  return empty;
}

function clearDoneTransfers(type) {
  for (const [id, transfer] of state.transfers.entries()) {
    if ((type ? transfer.type === type : true) && ['done', 'error', 'canceled'].includes(transfer.status)) {
      state.transfers.delete(id);
    }
  }
  renderTransfers();
}

function loadDownloadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(DOWNLOAD_HISTORY_STORAGE_KEY) || '[]');
    state.downloadHistory = Array.isArray(saved) ? saved : [];
  } catch {
    state.downloadHistory = [];
  }
}

function saveDownloadHistory() {
  localStorage.setItem(DOWNLOAD_HISTORY_STORAGE_KEY, JSON.stringify(state.downloadHistory.slice(0, MAX_DOWNLOAD_HISTORY)));
}

function persistDownloadedFile(transfer) {
  const record = {
    id: transfer.id,
    name: transfer.name || transfer.remotePath,
    remotePath: transfer.remotePath || '',
    localPath: transfer.localPath || '',
    completedAt: new Date().toISOString()
  };
  state.downloadHistory = [
    record,
    ...state.downloadHistory.filter((item) => item.id !== record.id && item.localPath !== record.localPath)
  ].slice(0, MAX_DOWNLOAD_HISTORY);
  saveDownloadHistory();
}

function clearDownloadHistory() {
  state.downloadHistory = [];
  saveDownloadHistory();
  renderDownloadHistory();
  toast('已清空下载记录');
}

async function cancelDownload(transferId) {
  const transfer = state.transfers.get(transferId);
  if (transfer) {
    state.transfers.set(transferId, {
      ...transfer,
      phase: '正在取消',
      message: ''
    });
    scheduleRenderTransfers();
  }

  try {
    await api.cancelDownload(transferId);
  } catch (error) {
    handleError(error);
  }
}

function navigateFiles(remotePath) {
  setView('drive');
  loadFiles(remotePath);
}

function navigateAlbum(remotePath) {
  setView('album');
  loadAlbum(remotePath);
}

async function uploadFiles() {
  if (!['drive', 'album'].includes(state.view)) {
    setView('drive');
  }

  await runTask(async () => {
    const filePaths = await api.selectUploadFiles();
    if (!filePaths.length) {
      return;
    }
    const targetPath = state.view === 'album' ? state.albumPath : state.currentPath;
    const results = await api.uploadFiles(filePaths, targetPath);
    const failed = results.filter((result) => !result.ok);
    toast(failed.length ? `${failed.length} 个文件上传失败` : '上传完成');
    await refreshAfterMutation();
  });
}

async function saveBackupSettings() {
  await runTask(async () => {
    const intervalMinutes = Math.max(1, Number(els.backupIntervalInput.value) || 15);
    const config = await api.setBackupConfig({
      intervalMinutes,
      autoStart: els.backupAutoStart.checked
    });
    state.backup.intervalMinutes = Number(config.intervalMinutes) || intervalMinutes;
    state.backup.autoStart = Boolean(config.autoStart);
    renderBackup();
    toast('自动同步设置已保存');
  });
}

async function selectBackupFolder() {
  await runTask(async () => {
    const result = await api.selectBackupFolder();
    if (result?.canceled || !result?.filePath) {
      return;
    }
    const config = await api.addBackupFolder(result.filePath);
    state.backup.jobs = Array.isArray(config.jobs) ? config.jobs : [];
    state.backup.intervalMinutes = Number(config.intervalMinutes) || state.backup.intervalMinutes;
    state.backup.autoStart = Boolean(config.autoStart);
    renderBackup();
    checkBackupSyncStatus();
    toast('已添加自动同步文件夹');
  });
}

async function selectAlbumBackupFolder() {
  await runTask(async () => {
    const result = await api.selectAlbumBackupFolder();
    if (result?.canceled || !result?.filePath) {
      return;
    }
    const config = await api.addAlbumBackupFolder(result.filePath);
    state.backup.jobs = Array.isArray(config.jobs) ? config.jobs : [];
    state.backup.intervalMinutes = Number(config.intervalMinutes) || state.backup.intervalMinutes;
    state.backup.autoStart = Boolean(config.autoStart);
    renderBackup();
    checkBackupSyncStatus();
    toast('已添加相册同步，将同步图片和视频到相册');
    await loadAlbum(state.albumPath);
  });
}

async function runBackupNow(jobId) {
  await runTask(async () => {
    await api.runBackupNow(jobId || undefined);
    await loadBackupConfig();
    toast('同步任务已执行');
  });
}

async function toggleBackupJob(job) {
  await runTask(async () => {
    const config = await api.setBackupEnabled(job.id, job.enabled === false);
    state.backup.jobs = Array.isArray(config.jobs) ? config.jobs : [];
    renderBackup();
  });
}

async function removeBackupJob(job) {
  const ok = await openConfirmDialog({
    title: '删除自动同步',
    message: `确定删除“${job.name || job.localPath}”的自动同步任务吗？远端已同步文件不会被删除。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) {
    return;
  }

  await runTask(async () => {
    const config = await api.removeBackupJob(job.id);
    state.backup.jobs = Array.isArray(config.jobs) ? config.jobs : [];
    state.backup.statuses.delete(job.id);
    renderBackup();
    checkBackupSyncStatus();
    toast('已删除自动同步任务');
  });
}

async function downloadFile(remotePath, name, options = {}) {
  let downloadResult = null;
  await runTask(async () => {
    const result = await api.downloadFile(remotePath, name, options);
    downloadResult = result;
    if (!result?.canceled && !options.batchKey) {
      toast('下载完成');
    }
  });
  return downloadResult;
}

function makeClientBatchKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createFolder() {
  if (!['drive', 'album'].includes(state.view)) {
    setView('drive');
  }

  const parent = state.view === 'album' ? state.albumPath : state.currentPath;
  const name = await openTextDialog({
    title: '新建文件夹',
    message: `将在“${displayPath(parent)}”中创建文件夹。`,
    label: '文件夹名称',
    placeholder: '未命名文件夹',
    confirmText: '创建'
  });
  if (!name) {
    return;
  }
  if (/[\\/]/.test(name)) {
    toast('文件夹名称不能包含斜杠');
    return;
  }

  await runTask(async () => {
    await api.mkdir(joinRemote(parent, name));
    await refreshAfterMutation();
    toast('文件夹已创建');
  });
}

async function renameItem(item, parent) {
  const nextName = await openTextDialog({
    title: '重命名',
    message: `修改“${item.name}”的名称。`,
    label: '新的名称',
    value: item.name,
    confirmText: '保存'
  });
  if (!nextName || nextName === item.name) {
    return;
  }
  if (/[\\/]/.test(nextName)) {
    toast('名称不能包含斜杠');
    return;
  }

  await runTask(async () => {
    await api.rename(joinRemote(parent, item.name), joinRemote(parent, nextName));
    await refreshAfterMutation();
    toast('已重命名');
  });
}

async function deleteItem(item, parent) {
  const ok = await openConfirmDialog({
    title: '删除项目',
    message: `确定删除“${item.name}”吗？此操作无法在客户端撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) {
    return;
  }

  await runTask(async () => {
    await api.deletePath(joinRemote(parent, item.name));
    await refreshAfterMutation();
    toast('已删除');
  });
}

async function refreshAfterMutation() {
  if (state.view === 'album') {
    await loadAlbum(state.albumPath);
  } else {
    await loadFiles(state.currentPath);
  }
  await Promise.allSettled([loadQuick(), loadStorage()]);
}

function scheduleUploadListRefresh() {
  clearTimeout(scheduleUploadListRefresh.timer);
  scheduleUploadListRefresh.timer = setTimeout(() => {
    if (state.view === 'album') {
      loadAlbum(state.albumPath);
    } else if (state.view === 'drive') {
      loadFiles(state.currentPath);
    }
    Promise.allSettled([loadQuick(), loadStorage()]);
  }, 500);
}

async function saveNode(event) {
  event.preventDefault();
  await runTask(async () => {
    const node = {
      id: els.nodeId.value || undefined,
      name: els.nodeName.value.trim(),
      url: els.nodeUrl.value.trim(),
      token: els.nodeToken.value.trim() || undefined,
      enabled: els.nodeEnabled.checked
    };
    await api.nodesSave(node);
    resetNodeForm();
    await loadNodes();
    toast('节点已保存');
  });
}

function fillNodeForm(node) {
  els.nodeFormTitle.textContent = '编辑节点';
  els.nodeId.value = node.id || '';
  els.nodeName.value = node.name || '';
  els.nodeUrl.value = node.url || '';
  els.nodeToken.value = '';
  els.nodeEnabled.checked = Boolean(node.enabled);
}

function resetNodeForm() {
  els.nodeFormTitle.textContent = '新增节点';
  els.nodeForm.reset();
  els.nodeId.value = '';
  els.nodeEnabled.checked = true;
}

async function testNode(id) {
  await runTask(async () => {
    const result = await api.nodesTest(id);
    toast(result.ok ? `节点可用，容量 ${formatBytes(result.used)} / ${formatBytes(result.total)}` : '节点测试失败');
  });
}

async function deleteNode(id) {
  const ok = await openConfirmDialog({
    title: '删除存储节点',
    message: '确定删除这个节点吗？',
    confirmText: '删除',
    danger: true
  });
  if (!ok) {
    return;
  }

  await runTask(async () => {
    await api.nodesDelete(id);
    await loadNodes();
    toast('节点已删除');
  });
}

function openSharedPage() {
  const baseUrl = state.config?.baseUrl || els.baseUrlInput.value;
  if (!baseUrl) {
    toast('请先填写 API 地址');
    return;
  }
  api.openExternal(`${baseUrl.replace(/\/+$/, '')}/shared`);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.add('theme-changing');
  document.documentElement.dataset.theme = next;
  localStorage.setItem('r2drive-theme', next);

  window.clearTimeout(toggleTheme.timer);
  toggleTheme.timer = window.setTimeout(() => {
    document.documentElement.classList.remove('theme-changing');
  }, 260);
}

async function runTask(task) {
  setBusy(true);
  try {
    return await task();
  } catch (error) {
    handleError(error);
    return null;
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  state.busyCount = Math.max(0, state.busyCount + (isBusy ? 1 : -1));
  document.documentElement.classList.toggle('is-busy', state.busyCount > 0);
}

function handleError(error) {
  const message = friendlyErrorMessage(error);
  if (message.includes('401') && !state.config?.baseUrl) {
    showSetupWizard();
    return;
  }
  if (message.includes('401')) {
    showAuth();
  }
  toast(message);
}

function friendlyErrorMessage(error) {
  const raw = error?.message || String(error);
  if (/401/.test(raw)) {
    return '登录状态已失效，请重新登录';
  }
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout|timed out|连接服务器超时/i.test(raw)) {
    return '连接服务器超时，请检查 API 地址、网络代理、防火墙或存储节点配置';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|无法解析服务器地址/i.test(raw)) {
    return '无法解析服务器地址，请检查 API 地址和 DNS 网络';
  }
  if (/ECONNREFUSED|服务器拒绝连接/i.test(raw)) {
    return '服务器拒绝连接，请确认服务端已启动且端口可访问';
  }
  if (/fetch failed|network|socket hang up|ECONNRESET|网络连接中断/i.test(raw)) {
    return '网络请求失败，请检查 API 地址、网络连接或存储节点配置';
  }
  return raw;
}

function showAuth() {
  els.authModal.classList.remove('hidden');
}

function hideAuth() {
  els.authModal.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
// 首次使用引导配置向导
// ═══════════════════════════════════════════════════════════

function showSetupWizard() {
  els.setupWizard.classList.remove('hidden');
  els.authModal.classList.add('hidden');
  els.setupStep1.classList.remove('hidden');
  els.setupStep2.classList.add('hidden');
  els.setupStep3.classList.add('hidden');
  updateSetupStepDots(1);
  els.setupBaseUrl.value = state.config?.baseUrl || '';
}

function hideSetupWizard() {
  els.setupWizard.classList.add('hidden');
}

function updateSetupStepDots(step) {
  const dots = els.setupWizard.querySelectorAll('.setup-step-dot');
  dots.forEach((dot) => {
    const dotStep = parseInt(dot.dataset.step, 10);
    dot.classList.remove('active', 'done');
    if (dotStep < step) {
      dot.classList.add('done');
    } else if (dotStep === step) {
      dot.classList.add('active');
    }
  });
}

// 切换步骤时触发动画
function transitionSetupStep(fromEl, toEl, direction) {
  if (!fromEl || !toEl) return;
  fromEl.style.animation = `stepSlideOut${direction === 'forward' ? 'Left' : 'Right'} 200ms cubic-bezier(0.22, 1, 0.36, 1) both`;
  fromEl.addEventListener('animationend', function handler() {
    fromEl.removeEventListener('animationend', handler);
    fromEl.classList.add('hidden');
    fromEl.style.animation = '';
    toEl.classList.remove('hidden');
    toEl.style.animation = 'stepSlideIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both';
    toEl.addEventListener('animationend', function h2() {
      toEl.removeEventListener('animationend', h2);
      toEl.style.animation = '';
    });
  });
}

async function setupStep1Submit(event) {
  event.preventDefault();
  const baseUrl = els.setupBaseUrl.value.trim();
  if (!baseUrl) {
    toast('请输入 API 基准地址');
    return;
  }

  await runTask(async () => {
    state.config = await api.setConfig({ baseUrl });
    renderConfig();

    // 尝试无密码登录以检查连接
    try {
      const result = await api.testConnection();
      if (result?.ok) {
        transitionSetupStep(els.setupStep1, els.setupStep2, 'forward');
        updateSetupStepDots(2);
      } else {
        toast('连接测试未通过，请检查 API 地址');
      }
    } catch {
      // 即使测试失败也允许继续
      transitionSetupStep(els.setupStep1, els.setupStep2, 'forward');
      updateSetupStepDots(2);
    }
  });
}

async function setupStep2Submit(event) {
  event.preventDefault();
  const password = els.setupPassword.value || '';

  await runTask(async () => {
    try {
      const result = await api.login(password);
      if (result?.ok === false) {
        els.setupLoginStatus.classList.remove('hidden');
        els.setupLoginStatus.textContent = '登录失败，请检查密码或服务端配置';
        els.setupLoginStatus.className = 'setup-status error';
        return;
      }

      els.setupLoginStatus.classList.add('hidden');
      transitionSetupStep(els.setupStep2, els.setupStep3, 'forward');
      updateSetupStepDots(3);

      // 更新摘要
      els.setupSummaryUrl.textContent = displayBaseUrlHost(state.config?.baseUrl || '');
      els.setupSummaryDownload.textContent = state.config?.downloadDir || '默认下载文件夹';
    } catch (error) {
      els.setupLoginStatus.classList.remove('hidden');
      els.setupLoginStatus.textContent = `连接失败：${error.message}`;
      els.setupLoginStatus.className = 'setup-status error';
    }
  });
}

function setupGoToStep1() {
  transitionSetupStep(els.setupStep2, els.setupStep1, 'back');
  updateSetupStepDots(1);
}

async function skipSetupWizard() {
  hideSetupWizard();
  state.config = await api.getConfig();
  await Promise.allSettled([loadStorage(), loadFiles(''), loadQuick(), refreshClipboardState()]);
  await maybeShowSyncBootstrap();
}

async function setupSelectDownloadDir() {
  const result = await api.selectDownloadDir();
  if (result?.canceled) {
    return;
  }
  if (result?.filePath) {
    state.config = await api.setConfig({ downloadDir: result.filePath });
    renderConfig();
    els.setupSummaryDownload.textContent = result.filePath;
  }
}

async function finishSetupWizard() {
  await runTask(async () => {
    state.config = await api.getConfig();
    hideSetupWizard();
    renderConfig();
    await Promise.allSettled([loadStorage(), loadFiles(''), loadQuick(), refreshClipboardState()]);
    await loadBackupConfig();
    await maybeShowSyncBootstrap();
    toast('欢迎使用 R2 Cloud Drive！');
  });
}

// ═══════════════════════════════════════════════════════════
// 重置应用数据
// ═══════════════════════════════════════════════════════════

async function resetAppData() {
  const confirmed = await openConfirmDialog({
    title: '重置应用数据',
    message: '确定要清除所有本地配置、登录状态和缓存数据吗？应用将恢复为首次使用状态并重新启动。此操作不可撤销。',
    confirmText: '确定重置',
    danger: true
  });
  if (!confirmed) {
    return;
  }

  await runTask(async () => {
    try {
      // 清除 localStorage
      localStorage.clear();
      // 调用主进程清除配置文件
      await api.resetClearAll();
      toast('数据已清除，应用即将重启...');
      // 延迟重启以确保 toast 可见
      setTimeout(async () => {
        try {
          await api.relaunchApp();
        } catch {
          // 如果 relaunch 不可用，关闭窗口
          api.closeWindow();
        }
      }, 1500);
    } catch (error) {
      toast(`重置失败：${error.message}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 多端同步更新通知
// ═══════════════════════════════════════════════════════════

function showSyncUpdateNotification(payload) {
  if (!els.syncUpdateModal || !payload?.updates?.length) {
    return;
  }

  const updates = payload.updates;
  state.pendingSyncUpdates = updates;

  // 更新描述
  els.syncUpdateDesc.textContent =
    `检测到 ${updates.length} 个文件在云端有更新（可能来自其他设备），是否同步到本机？`;

  // 渲染文件列表
  els.syncUpdateFileList.replaceChildren();
  const maxShow = Math.min(updates.length, 10);
  for (let i = 0; i < maxShow; i++) {
    const update = updates[i];
    const item = document.createElement('div');
    item.className = 'sync-update-file-item';

    const iconWrap = makeFileBadge({ name: update.relativePath || update.fileName });
    iconWrap.classList.add('sync-update-file-icon');

    const info = document.createElement('div');
    info.className = 'sync-update-file-info';
    const name = document.createElement('strong');
    name.textContent = update.fileName;
    name.title = update.fileName;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `${update.jobName || update.remotePath} · ${formatBytes(update.fileSize || 0)} · ${formatDate(update.uploaded)}`;

    info.append(name, meta);
    item.append(iconWrap, info);
    els.syncUpdateFileList.append(item);
  }

  if (updates.length > maxShow) {
    const more = document.createElement('div');
    more.className = 'sync-update-file-item muted';
    more.textContent = `…以及另外 ${updates.length - maxShow} 个文件`;
    els.syncUpdateFileList.append(more);
  }

  els.syncUpdateModal.classList.remove('hidden');
}

async function dismissSyncUpdate() {
  els.syncUpdateModal.classList.add('hidden');
  state.pendingSyncUpdates = [];
  await api.dismissSyncUpdate().catch(() => {});
}

async function enableAutoSyncAndApply() {
  await runTask(async () => {
    // 启用自动同步
    state.config = await api.setConfig({ autoSyncEnabled: true });
    await api.setAutoSyncEnabled(true).catch(() => {});

    let updates = state.pendingSyncUpdates;
    if (!updates.length) {
      const result = await api.checkRemoteFileUpdates().catch(() => null);
      updates = result?.updates || [];
    }

    let applyResult = null;
    try {
      if (updates.length && api.applySyncUpdates) {
        applyResult = await api.applySyncUpdates(updates);
      }

      if (applyResult?.failed) {
        toast(`已启用多端自动同步，${applyResult.applied || 0} 个文件已同步，${applyResult.failed} 个失败`);
      } else if (applyResult?.applied) {
        toast(`已启用多端自动同步，已同步 ${applyResult.applied} 个文件`);
      } else {
        toast('已启用多端自动同步');
      }
    } catch (error) {
      console.warn('Apply sync updates failed:', error);
      toast('已启用多端自动同步');
    }

    state.pendingSyncUpdates = [];
    renderConfig();
    els.syncUpdateModal.classList.add('hidden');
    await refreshCurrentView();
  });
}

// 显示确认对话框（复用现有 dialogModal）

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 3200);
}

function parentPath(remotePath) {
  const parts = (remotePath || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function albumParentPath(remotePath) {
  if (!remotePath || remotePath === ALBUM_ROOT) {
    return ALBUM_ROOT;
  }
  return parentPath(remotePath) || ALBUM_ROOT;
}

function ensureAlbumPath(remotePath) {
  const clean = joinRemote(remotePath || ALBUM_ROOT);
  if (!clean || clean === ALBUM_ROOT) {
    return ALBUM_ROOT;
  }
  return clean.startsWith(`${ALBUM_ROOT}/`) ? clean : joinRemote(ALBUM_ROOT, clean);
}

function joinRemote(...segments) {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
}

function uniqueRemoteDirs(dirs) {
  const seen = new Set();
  const normalized = [];

  for (const dir of Array.isArray(dirs) ? dirs : []) {
    const remotePath = joinRemote(dir);
    if (!remotePath || seen.has(remotePath)) {
      continue;
    }
    seen.add(remotePath);
    normalized.push(remotePath);
  }

  return normalized;
}

function clipboardPasteItemNames(items) {
  const names = [];
  const seen = new Set();

  for (const item of items) {
    const name = clipboardTargetName(item);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

function clipboardPasteFailures(result) {
  if (!Array.isArray(result?.results)) {
    return [];
  }
  return result.results.filter((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    return entry.ok === false || Boolean(entry.error) || Number(entry.status || 0) >= 400;
  });
}

function mergeClipboardItems(serverClipboard, localClipboard) {
  const serverItems = Array.isArray(serverClipboard?.items) ? serverClipboard.items : [];
  const localItems = Array.isArray(localClipboard?.items) ? localClipboard.items : [];

  if (!serverItems.length) {
    return localItems;
  }
  if (!localItems.length) {
    return serverItems;
  }

  const sameClipboard =
    (serverClipboard?.action || 'copy') === (localClipboard?.action || 'copy') &&
    (serverClipboard?.sourcePath || '') === (localClipboard?.sourcePath || '');
  if (!sameClipboard) {
    return serverItems;
  }

  return serverItems.map((item) => {
    const name = clipboardTargetName(item);
    const localMatch = localItems.find((entry) => clipboardTargetName(entry) === name);
    return localMatch ? { ...localMatch, name } : item;
  });
}

function clipboardTargetName(item) {
  const pathValue = joinRemote(clipboardItemPath(item));
  const parts = pathValue.split('/').filter(Boolean);
  return parts.pop() || pathValue;
}

function clipboardItemPath(item) {
  if (typeof item === 'string') {
    return item;
  }
  return item?.path || item?.remotePath || item?.name || '';
}

function displayPath(remotePath) {
  return remotePath || '我的云盘';
}

function displayBaseUrlHost(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.host;
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
  }
}

function hideKeepFiles(files) {
  return files.filter((file) => file.name !== '.keep');
}

function filterNamed(items) {
  if (!state.search) {
    return items;
  }
  return items.filter((item) => {
    const name = typeof item === 'string' ? item : item.name;
    return String(name || '').toLowerCase().includes(state.search);
  });
}

function mediaKind(fileName) {
  const ext = extension(fileName);
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'opus'].includes(ext)) {
    return 'audio';
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'hpp'].includes(ext)) {
    return 'code';
  }
  if (['txt', 'md', 'log', 'csv', 'ini', 'cfg', 'conf', 'rtf'].includes(ext)) {
    return 'document';
  }
  return 'file';
}

function extension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleString();
}

function progressPercent(transfer) {
  if (transfer.status === 'done') {
    return 100;
  }
  if (!transfer.total) {
    return 0;
  }
  return Math.min(100, Math.round((transfer.transferred / transfer.total) * 100));
}

function aggregateProgressPercent(transfers) {
  if (!transfers.length) {
    return 0;
  }
  const totalBytes = transfers.reduce((sum, transfer) => sum + Number(transfer.total || 0), 0);
  if (totalBytes > 0) {
    const transferredBytes = transfers.reduce((sum, transfer) => {
      return sum + (transfer.status === 'done' ? Number(transfer.total || 0) : Number(transfer.transferred || 0));
    }, 0);
    return Math.min(100, Math.round((transferredBytes / totalBytes) * 100));
  }
  const totalPercent = transfers.reduce((sum, transfer) => sum + progressPercent(transfer), 0);
  return Math.round(totalPercent / transfers.length);
}

function transferStatusText(transfer) {
  if (transfer.status === 'done') {
    return '完成';
  }
  if (transfer.status === 'error') {
    return '失败';
  }
  if (transfer.status === 'canceled') {
    return '已取消';
  }
  return formatProgress(transfer);
}

function formatProgress(transfer) {
  const speed = transfer.speed ? ` · ${formatBytes(transfer.speed)}/s` : '';
  if (!transfer.total) {
    return `${transfer.phase || '处理中'}${speed}`;
  }
  return `${progressPercent(transfer)}% · ${formatBytes(transfer.transferred)} / ${formatBytes(transfer.total)}${speed}`;
}

// ── 孤儿文件扫描清理 ──

let orphanScanResult = null;

function showOrphanCleanup() {
  orphanScanResult = null;
  els.orphanTitle.textContent = '孤儿文件扫描';
  els.orphanDesc.classList.remove('hidden');
  els.orphanStatus.innerHTML = '<span class="orphan-status-text">点击下方按钮开始扫描</span>';
  els.orphanListWrap.classList.add('hidden');
  els.orphanList.replaceChildren();
  els.orphanScanButton.classList.remove('hidden');
  els.orphanCleanButton.classList.add('hidden');
  els.orphanModal.classList.remove('hidden');
}

function closeOrphanModal() {
  els.orphanModal.classList.add('hidden');
  orphanScanResult = null;
}

async function scanAndShowOrphans() {
  els.orphanScanButton.disabled = true;
  els.orphanStatus.innerHTML = '<span class="orphan-status-text">正在扫描孤儿文件…</span>';

  try {
    const result = await api.scanOrphans();
    orphanScanResult = result;

    const orphans = Array.isArray(result?.orphans) ? result.orphans : [];
    const totalSize = Number(result?.totalSize || 0);

    if (!orphans.length) {
      els.orphanStatus.innerHTML = '<span class="orphan-status-text" style="color:var(--green)">✅ 未发现孤儿文件，系统状态良好</span>';
      els.orphanListWrap.classList.add('hidden');
      els.orphanScanButton.classList.remove('hidden');
      els.orphanCleanButton.classList.add('hidden');
    } else {
      els.orphanStatus.innerHTML = '<span class="orphan-status-text">发现 <strong>' + orphans.length + '</strong> 个孤儿文件，共占用 <strong>' + formatBytes(totalSize) + '</strong></span>';
      els.orphanListWrap.classList.remove('hidden');
      els.orphanScanButton.classList.add('hidden');
      els.orphanCleanButton.classList.remove('hidden');
      renderOrphanList(orphans);
    }
  } catch (error) {
    els.orphanStatus.innerHTML = '<span class="orphan-status-text" style="color:var(--danger)">扫描失败：' + friendlyErrorMessage(error) + '</span>';
  } finally {
    els.orphanScanButton.disabled = false;
  }
}

function renderOrphanList(orphans) {
  els.orphanList.replaceChildren();
  els.orphanCount.textContent = '共 ' + orphans.length + ' 项';
  els.orphanSelectAll.checked = true;

  for (let i = 0; i < orphans.length; i++) {
    const item = orphans[i];
    const key = item?.key || item?.name || '';
    const size = Number(item?.size || 0);
    const lastModified = item?.lastModified || '';

    const row = document.createElement('label');
    row.className = 'orphan-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'orphan-item-check';
    checkbox.checked = true;
    checkbox.dataset.key = key;
    checkbox.addEventListener('change', function () {
      const all = els.orphanList.querySelectorAll('.orphan-item-check');
      const checked = els.orphanList.querySelectorAll('.orphan-item-check:checked');
      els.orphanSelectAll.checked = checked.length === all.length;
    });

    const info = document.createElement('div');
    info.className = 'orphan-item-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'orphan-item-name ellipsis';
    nameEl.textContent = key;

    const meta = document.createElement('span');
    meta.className = 'orphan-item-meta muted';
    meta.textContent = formatBytes(size) + (lastModified ? ' · ' + formatDate(lastModified) : '');

    info.append(nameEl, meta);
    row.append(checkbox, info);
    els.orphanList.appendChild(row);
  }
}

async function executeOrphanCleanup() {
  const checkboxes = els.orphanList.querySelectorAll('.orphan-item-check:checked');
  if (!checkboxes.length) {
    toast('请至少选择一个孤儿文件');
    return;
  }

  const keys = [];
  for (let i = 0; i < checkboxes.length; i++) {
    const key = checkboxes[i].dataset.key;
    if (key) {
      keys.push(key);
    }
  }
  if (!keys.length) {
    return;
  }

  // 暂时隐藏孤儿弹窗，避免遮挡确认对话框（两个 modal-backdrop z-index 相同，后出现的会遮挡先出现的）
  els.orphanModal.classList.add('hidden');

  const ok = await openConfirmDialog({
    title: '清理孤儿文件',
    message: '确定要删除选中的 ' + keys.length + ' 个孤儿文件吗？此操作不可撤销。',
    confirmText: '删除',
    danger: true
  });

  // 恢复孤儿弹窗
  els.orphanModal.classList.remove('hidden');

  if (!ok) {
    return;
  }

  els.orphanCleanButton.disabled = true;
  els.orphanStatus.innerHTML = '<span class="orphan-status-text">正在清理孤儿文件…</span>';

  try {
    const result = await api.cleanOrphans(keys);
    const cleaned = Number(result?.cleaned || result?.deleted || keys.length);
    toast('已清理 ' + cleaned + ' 个孤儿文件');

    await scanAndShowOrphans();
  } catch (error) {
    els.orphanStatus.innerHTML = '<span class="orphan-status-text" style="color:var(--danger)">清理失败：' + friendlyErrorMessage(error) + '</span>';
  } finally {
    els.orphanCleanButton.disabled = false;
  }
}
