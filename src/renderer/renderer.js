const api = window.r2Drive;
const ALBUM_ROOT = '相册';
const FILE_VIEW_STORAGE_KEY = 'r2drive-file-view';
const FULL_PREVIEW_LIMIT = 32 * 1024 * 1024;
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
  transfers: new Map(),
  previewCache: new Map(),
  fullPreviewCache: new Map(),
  search: '',
  contextElement: null,
  dialogResolve: null,
  busyCount: 0,
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
    backButton: document.querySelector('#backButton'),
    refreshButton: document.querySelector('#refreshButton'),
    uploadButton: document.querySelector('#uploadButton'),
    mkdirButton: document.querySelector('#mkdirButton'),
    albumBackButton: document.querySelector('#albumBackButton'),
    albumRefreshButton: document.querySelector('#albumRefreshButton'),
    albumUploadButton: document.querySelector('#albumUploadButton'),
    configForm: document.querySelector('#configForm'),
    baseUrlInput: document.querySelector('#baseUrlInput'),
    downloadForm: document.querySelector('#downloadForm'),
    downloadDirInput: document.querySelector('#downloadDirInput'),
    selectDownloadDirButton: document.querySelector('#selectDownloadDirButton'),
    clearDownloadDirButton: document.querySelector('#clearDownloadDirButton'),
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
    transferList: document.querySelector('#transferList'),
    clearDoneButton: document.querySelector('#clearDoneButton'),
    nodesRefreshButton: document.querySelector('#nodesRefreshButton'),
    nodesList: document.querySelector('#nodesList'),
    nodeForm: document.querySelector('#nodeForm'),
    nodeFormTitle: document.querySelector('#nodeFormTitle'),
    nodeFormReset: document.querySelector('#nodeFormReset'),
    nodeId: document.querySelector('#nodeId'),
    nodeName: document.querySelector('#nodeName'),
    nodeUrl: document.querySelector('#nodeUrl'),
    nodeToken: document.querySelector('#nodeToken'),
    nodeWeight: document.querySelector('#nodeWeight'),
    nodeEnabled: document.querySelector('#nodeEnabled')
  });
}

function bindEvents() {
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

  els.albumBackButton.addEventListener('click', () => navigateAlbum(albumParentPath(state.albumPath)));
  els.albumRefreshButton.addEventListener('click', refreshCurrentView);
  els.albumUploadButton.addEventListener('click', uploadFiles);
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

  els.clearDoneButton.addEventListener('click', clearDoneTransfers);
  els.dialogCancelButton.addEventListener('click', () => closeDialog(null));
  els.dialogModal.addEventListener('click', (event) => {
    if (event.target === els.dialogModal) {
      closeDialog(null);
    }
  });
  els.dialogForm.addEventListener('submit', submitDialog);
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

    if (event.key === 'Escape') {
      hideNewMenu();
      hideContextMenu();
      closeDialog(null);
      hideStoragePopover();
    }
  });

  els.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveBaseUrl(els.baseUrlInput.value);
  });

  els.downloadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveDownloadDir(els.downloadDirInput.value);
  });
  els.selectDownloadDirButton.addEventListener('click', selectDownloadDir);
  els.clearDownloadDirButton.addEventListener('click', clearDownloadDir);

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
    state.transfers.set(payload.id, {
      ...current,
      ...payload,
      updatedAt: Date.now()
    });
    scheduleRenderTransfers();
  });
}

async function init() {
  applySavedTheme();
  document.body.dataset.view = state.view;
  updateFileViewModeControls();
  renderTransfers();
  state.config = await api.getConfig();
  renderConfig();

  if (!state.config.baseUrl) {
    showAuth();
    return;
  }

  await Promise.allSettled([loadStorage(), loadFiles(''), loadQuick()]);
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
  els.serverStatus.textContent = baseUrl || '未连接';
}

async function saveBaseUrl(baseUrl) {
  state.config = await api.setConfig({ baseUrl });
  renderConfig();
  toast('地址已保存');
}

async function selectDownloadDir() {
  await runTask(async () => {
    const result = await api.selectDownloadDir();
    if (result?.canceled || !result?.filePath) {
      return;
    }
    els.downloadDirInput.value = result.filePath;
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
  els.nodesView.classList.toggle('hidden', view !== 'nodes');
  els.settingsView.classList.toggle('hidden', view !== 'settings');
  els.driveToolbar.classList.toggle('hidden', view !== 'drive');
  els.albumToolbar.classList.toggle('hidden', view !== 'album');

  const titles = {
    drive: '我的云盘',
    album: '相册',
    quick: '快速访问',
    nodes: '存储节点查看',
    settings: '设置'
  };
  els.viewTitle.textContent = titles[view];
  renderBreadcrumb();
  renderCurrentView();

  if (view === 'album' && !state.albumFolders.length && !state.albumFiles.length) {
    loadAlbum(state.albumPath);
  }
  if (view === 'quick') {
    loadQuick();
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
  }
}

async function loadFiles(remotePath) {
  await runTask(async () => {
    const data = await api.list(remotePath || '');
    state.currentPath = remotePath || '';
    state.folders = data.folders || [];
    state.files = hideKeepFiles(data.files || []);
    renderFiles();
    renderBreadcrumb();
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
    const data = await api.nodesList();
    state.nodes = data.nodes || [];
    renderNodes();
  });
}

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
    onRename: (item) => renameItem(item, state.currentPath),
    onDelete: (item) => deleteItem(item, state.currentPath)
  });

  renderFileCards({
    container: els.fileGrid,
    folders,
    files,
    parentPath: state.currentPath,
    onFolder: (name) => navigateFiles(joinRemote(state.currentPath, name)),
    onDownload: (file) => downloadFile(joinRemote(state.currentPath, file.name), file.name),
    onRename: (item) => renameItem(item, state.currentPath),
    onDelete: (item) => deleteItem(item, state.currentPath)
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

  const empty = document.createElement('div');
  empty.className = 'viewer-empty';
  empty.append(mediaPlaceholder(item.kind === 'video' ? 'VIDEO' : 'FILE'));
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
      action: '下载',
      onAction: () => downloadFile(file.name, file.name),
      contextActions: () => [
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

function renderFileCards(options) {
  for (const folderName of options.folders) {
    options.container.append(makeFileCard({
      item: { type: 'folder', name: folderName },
      meta: '文件夹',
      parentPath: options.parentPath,
      onOpen: () => options.onFolder(folderName),
      onRename: options.onRename,
      onDelete: options.onDelete
    }));
  }

  for (const file of options.files) {
    options.container.append(makeFileCard({
      item: { ...file, type: 'file' },
      meta: `${formatBytes(file.size)} · ${formatDate(file.uploaded)}`,
      parentPath: options.parentPath,
      onOpen: () => options.onDownload(file),
      onDownload: () => options.onDownload(file),
      onRename: options.onRename,
      onDelete: options.onDelete
    }));
  }
}

function makeFileCard(options) {
  const card = document.createElement('article');
  card.className = 'file-card';
  card.tabIndex = 0;
  card.addEventListener('dblclick', options.onOpen);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      options.onOpen();
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

  const badge = makeFileBadge(options.item);

  const name = document.createElement('strong');
  name.className = 'file-card-name';
  name.textContent = options.item.name;
  name.title = options.item.name;

  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = options.meta;

  const actions = document.createElement('div');
  actions.className = 'file-card-actions';
  actions.append(
    actionButton(options.item.type === 'folder' ? '打开' : '下载', options.item.type === 'folder' ? options.onOpen : options.onDownload),
    actionButton('重命名', () => options.onRename(options.item)),
    actionButton('删除', () => options.onDelete(options.item), 'danger')
  );

  card.append(badge, name, meta, actions);
  return card;
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
      onDelete: options.onDelete
    });
    options.tbody.append(row);
  }

  for (const file of options.files) {
    const row = makeRow({
      item: { ...file, type: 'file' },
      size: formatBytes(file.size),
      uploaded: formatDate(file.uploaded),
      parentPath: options.parentPath,
      onOpen: () => options.onDownload(file),
      onDownload: () => options.onDownload(file),
      onRename: options.onRename,
      onDelete: options.onDelete
    });
    options.tbody.append(row);
  }
}

function makeRow(options) {
  const row = document.createElement('tr');
  row.addEventListener('dblclick', options.onOpen);
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

  if (options.item.type === 'folder') {
    actions.append(actionButton('打开', options.onOpen));
  } else {
    actions.append(actionButton('下载', options.onDownload));
  }

  actions.append(actionButton('重命名', () => options.onRename(options.item)));
  actions.append(actionButton('删除', () => options.onDelete(options.item), 'danger'));

  actionsCell.append(actions);
  row.append(nameCell, sizeCell, uploadedCell, actionsCell);
  return row;
}

function actionButton(label, handler, variant = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'danger' ? 'danger' : 'secondary';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
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
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) {
    return 'document';
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return 'sheet';
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'py', 'go', 'rs', 'java', 'cpp', 'c'].includes(ext)) {
    return 'code';
  }
  return 'generic';
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
  const actions = options.item.type === 'folder'
    ? [
        menuAction('打开', 'open-icon', options.onOpen),
        menuSeparator(),
        menuAction('重命名', 'rename-icon', options.onRename),
        menuAction('删除', 'trash-icon', options.onDelete, 'danger')
      ]
    : [
        menuAction('下载', 'download-icon', options.onDownload),
        menuSeparator(),
        menuAction('重命名', 'rename-icon', options.onRename),
        menuAction('删除', 'trash-icon', options.onDelete, 'danger')
      ];
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
  showContextMenu(event, [
    menuAction('上传文件', 'upload-icon', uploadFiles),
    menuAction('新建文件夹', 'folder-plus-icon', createFolder),
    menuSeparator(),
    menuAction('刷新', 'refresh-icon', refreshCurrentView)
  ]);
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
      const icon = document.createElement('span');
      icon.className = `icon ${action.icon}`;
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
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
    item.className = 'node-item';

    const head = document.createElement('div');
    head.className = 'node-item-head';

    const title = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = node.name || node.id;
    const url = document.createElement('div');
    url.className = 'muted ellipsis';
    url.textContent = node.url;
    title.append(name, url);

    const badge = document.createElement('span');
    badge.className = `badge ${node.enabled ? '' : 'off'}`;
    badge.textContent = node.enabled ? '启用' : '停用';
    head.append(title, badge);

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `ID: ${node.id}，权重: ${node.weight || 1}`;

    const actions = document.createElement('div');
    actions.className = 'node-actions';
    actions.append(
      actionButton('编辑', () => fillNodeForm(node)),
      actionButton('测试', () => testNode(node.id)),
      actionButton('删除', () => deleteNode(node.id), 'danger')
    );

    item.append(head, meta, actions);
    els.nodesList.append(item);
  }
}

function renderTransfers() {
  els.transferList.replaceChildren();

  if (!state.transfers.size) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无传输任务';
    els.transferList.append(empty);
    return;
  }

  const items = [...state.transfers.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const transfer of items) {
    const item = document.createElement('div');
    item.className = 'transfer-item';

    const title = document.createElement('div');
    title.className = 'transfer-title ellipsis';
    title.textContent = `${transfer.type === 'upload' ? '上传' : '下载'} ${transfer.name || transfer.remotePath}`;
    title.title = transfer.remotePath || transfer.name;

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
    if (transfer.localPath && transfer.status === 'done') {
      item.append(actionButton('定位', () => api.openPath(transfer.localPath)));
    }
    item.append(progress);
    els.transferList.append(item);
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

function clearDoneTransfers() {
  for (const [id, transfer] of state.transfers.entries()) {
    if (['done', 'error', 'canceled'].includes(transfer.status)) {
      state.transfers.delete(id);
    }
  }
  renderTransfers();
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

async function downloadFile(remotePath, name) {
  await runTask(async () => {
    const result = await api.downloadFile(remotePath, name);
    if (!result?.canceled) {
      toast('下载完成');
    }
  });
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

async function saveNode(event) {
  event.preventDefault();
  await runTask(async () => {
    const node = {
      id: els.nodeId.value || undefined,
      name: els.nodeName.value.trim(),
      url: els.nodeUrl.value.trim(),
      token: els.nodeToken.value.trim() || undefined,
      enabled: els.nodeEnabled.checked,
      weight: Number(els.nodeWeight.value || 1)
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
  els.nodeWeight.value = node.weight || 1;
  els.nodeEnabled.checked = Boolean(node.enabled);
}

function resetNodeForm() {
  els.nodeFormTitle.textContent = '新增节点';
  els.nodeForm.reset();
  els.nodeId.value = '';
  els.nodeWeight.value = '1';
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
  const message = error?.message || String(error);
  if (message.includes('401')) {
    showAuth();
  }
  toast(message);
}

function showAuth() {
  els.authModal.classList.remove('hidden');
}

function hideAuth() {
  els.authModal.classList.add('hidden');
}

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

function displayPath(remotePath) {
  return remotePath || '我的云盘';
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
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) {
    return 'video';
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
