const ALBUM_TARGET = '相册/手机相册';
const els = {
  baseUrlInput: document.querySelector('#baseUrlInput'),
  passwordInput: document.querySelector('#passwordInput'),
  saveButton: document.querySelector('#saveButton'),
  targetInput: document.querySelector('#targetInput'),
  mediaInput: document.querySelector('#mediaInput'),
  selectedText: document.querySelector('#selectedText'),
  syncButton: document.querySelector('#syncButton'),
  statusText: document.querySelector('#statusText'),
  progressFill: document.querySelector('#progressFill'),
  logList: document.querySelector('#logList')
};

const state = {
  baseUrl: '',
  cookie: '',
  files: []
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  state.baseUrl = await getPref('baseUrl');
  state.cookie = await getPref('cookie');
  els.baseUrlInput.value = state.baseUrl;
  els.targetInput.value = await getPref('albumTarget') || ALBUM_TARGET;
  els.saveButton.addEventListener('click', saveAndLogin);
  els.mediaInput.addEventListener('change', selectFiles);
  els.syncButton.addEventListener('click', backupSelectedFiles);
  setStatus(state.cookie ? '已保存登录状态，可以选择媒体文件备份。' : '请先保存并登录。');
}

async function saveAndLogin() {
  try {
    state.baseUrl = normalizeBaseUrl(els.baseUrlInput.value);
    await setPref('baseUrl', state.baseUrl);
    await setPref('albumTarget', normalizeRemotePath(els.targetInput.value || ALBUM_TARGET));
    const result = await requestJson('/api/login', {
      method: 'POST',
      body: { password: els.passwordInput.value || '' },
      includeCookie: false
    });
    await setPref('cookie', state.cookie);
    els.passwordInput.value = '';
    setStatus(result?.ok === false ? '登录响应异常，请检查服务端。' : '登录成功。');
    log('登录成功');
  } catch (error) {
    log(error.message, true);
    setStatus('登录失败');
  }
}

function selectFiles() {
  state.files = [...els.mediaInput.files].filter((file) => /^image\/|^video\//.test(file.type));
  els.selectedText.textContent = state.files.length ? `已选择 ${state.files.length} 个文件` : '尚未选择文件';
}

async function backupSelectedFiles() {
  if (!state.files.length) {
    setStatus('请先选择照片或视频。');
    return;
  }

  try {
    state.baseUrl = normalizeBaseUrl(els.baseUrlInput.value || state.baseUrl);
    const target = normalizeRemotePath(els.targetInput.value || ALBUM_TARGET);
    await setPref('albumTarget', target);
    await ensureRemoteDir(target);
    const remoteFiles = await listRemoteFiles(target);
    let uploaded = 0;
    let skipped = 0;

    for (let index = 0; index < state.files.length; index += 1) {
      const file = state.files[index];
      const remoteFile = remoteFiles.get(file.name);
      const remoteUploaded = remoteFile?.uploaded ? new Date(remoteFile.uploaded).getTime() : 0;
      if (remoteFile && remoteUploaded >= file.lastModified) {
        skipped += 1;
        updateProgress(index + 1, state.files.length);
        log(`跳过：${file.name}`);
        continue;
      }

      await uploadFile(file, joinRemote(target, file.name));
      uploaded += 1;
      updateProgress(index + 1, state.files.length);
      log(`已备份：${file.name}`);
    }

    setStatus(`完成：上传 ${uploaded} 个，跳过 ${skipped} 个。`);
  } catch (error) {
    log(error.message, true);
    setStatus('备份失败');
  }
}

async function ensureRemoteDir(remoteDir) {
  const parts = normalizeRemotePath(remoteDir).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = joinRemote(current, part);
    await requestJson('/api/mkdir', {
      method: 'POST',
      body: { path: current }
    }).catch(() => {});
  }
}

async function listRemoteFiles(remoteDir) {
  try {
    const data = await requestJson(`/api/list?path=${encodeURIComponent(remoteDir)}`);
    return new Map((data.files || []).map((file) => [file.name, file]));
  } catch {
    return new Map();
  }
}

async function uploadFile(file, remotePath) {
  const url = makeUrl(`/api/upload?path=${encodeURIComponent(remotePath)}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: state.cookie,
      'Content-Type': 'application/octet-stream'
    },
    body: file,
    credentials: 'include'
  });
  captureCookie(response);
  if (!response.ok) {
    throw new Error(`上传失败 ${response.status}: ${await response.text()}`);
  }
}

async function requestJson(route, options = {}) {
  const response = await fetch(makeUrl(route), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.includeCookie === false ? {} : { Cookie: state.cookie })
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include'
  });
  captureCookie(response);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  return text ? JSON.parse(text) : {};
}

function captureCookie(response) {
  const cookie = response.headers.get('set-cookie');
  const match = cookie?.match(/r2drive_session=[^;]*/i);
  if (match) {
    state.cookie = match[0];
    setPref('cookie', state.cookie);
  }
}

function updateProgress(done, total) {
  els.progressFill.style.width = `${Math.round((done / total) * 100)}%`;
}

function log(message, isError = false) {
  const item = document.createElement('div');
  item.className = `log-item ${isError ? 'error' : ''}`.trim();
  item.textContent = message;
  els.logList.prepend(item);
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function makeUrl(route) {
  return new URL(route, state.baseUrl).toString();
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('请填写 API 地址');
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

async function getPref(key) {
  return localStorage.getItem(`r2mobile:${key}`) || '';
}

async function setPref(key, value) {
  localStorage.setItem(`r2mobile:${key}`, String(value || ''));
}
