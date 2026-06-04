const ALBUM_TARGET = '相册/手机相册';
const DIRECT_UPLOAD_LIMIT = 512 * 1024;
const DISTRIBUTED_UPLOAD_LIMIT = DIRECT_UPLOAD_LIMIT;
const CHUNK_SIZE = 32 * 1024 * 1024;
const MAX_CHUNK_SIZE = 90 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10000;
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
  setStatus(state.cookie ? '已保存登录状态，可以选择媒体文件同步。' : '请先保存并登录。');
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
      log(`已同步：${file.name}`);
    }

    setStatus(`完成：上传 ${uploaded} 个，跳过 ${skipped} 个。`);
  } catch (error) {
    log(error.message, true);
    setStatus('同步失败');
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
  const targetPath = normalizeRemotePath(remotePath);
  const plan = createUploadPlan(file.size || 0);

  if ((file.size || 0) <= DIRECT_UPLOAD_LIMIT) {
    return uploadSimpleFile(file, targetPath);
  }

  if ((file.size || 0) > DISTRIBUTED_UPLOAD_LIMIT) {
    try {
      return await uploadDistributedFile(file, targetPath, plan);
    } catch (error) {
      if (!isDistributedFallbackError(error)) {
        throw error;
      }
    }
  }

  return uploadMultipartFile(file, targetPath, plan);
}

async function uploadSimpleFile(file, remotePath) {
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
    throw httpError(response.status, await response.text());
  }
  return response.text();
}

async function uploadDistributedFile(file, remotePath, plan) {
  let sessionId = '';
  try {
    const init = await requestJson('/api/distributed/init', {
      method: 'POST',
      body: {
        path: remotePath,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        chunkSize: plan.chunkSize,
        parts: plan.partCount
      }
    });

    sessionId = init.sessionId || '';
    const parts = Array.isArray(init.parts) ? init.parts.slice().sort((a, b) => a.partNumber - b.partNumber) : [];
    if (!init.ok || !sessionId || !parts.length) {
      throw new Error('分布式上传初始化响应无效');
    }

    for (const part of parts) {
      const partNumber = Number(part.partNumber);
      const partSize = Number(part.size || 0);
      if (!partNumber || partSize <= 0 || !part.uploadUrl) {
        throw new Error('分布式上传分片信息无效');
      }

      const start = (partNumber - 1) * plan.chunkSize;
      const response = await fetch(makeUrl(part.uploadUrl), {
        method: 'PUT',
        headers: {
          Cookie: state.cookie,
          'Content-Type': 'application/octet-stream'
        },
        body: file.slice(start, start + partSize),
        credentials: 'include'
      });
      captureCookie(response);
      if (!response.ok) {
        throw httpError(response.status, await response.text());
      }
    }

    return requestJson('/api/distributed/complete', {
      method: 'POST',
      body: { sessionId }
    });
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

async function uploadMultipartFile(file, remotePath, plan) {
  const init = await requestJson('/api/multipart/init', {
    method: 'POST',
    body: {
      path: remotePath,
      contentType: file.type || 'application/octet-stream'
    }
  });
  if (!init.uploadId) {
    throw new Error('R2 分片上传初始化响应无效');
  }

  const parts = [];
  try {
    for (let partNumber = 1; partNumber <= plan.partCount; partNumber += 1) {
      const start = (partNumber - 1) * plan.chunkSize;
      const partSize = Math.min(plan.chunkSize, file.size - start);
      const response = await fetch(makeUrl(`/api/multipart/part?path=${encodeURIComponent(remotePath)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`), {
        method: 'POST',
        headers: {
          Cookie: state.cookie,
          'Content-Type': 'application/octet-stream'
        },
        body: file.slice(start, start + partSize),
        credentials: 'include'
      });
      captureCookie(response);
      const text = await response.text();
      if (!response.ok) {
        throw httpError(response.status, text);
      }
      parts.push(text ? JSON.parse(text) : {});
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
    throw httpError(response.status, text);
  }
  return text ? JSON.parse(text) : {};
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

  return { strategy, chunkSize, partCount };
}

function httpError(status, body) {
  const error = new Error(`HTTP ${status}${body ? `: ${String(body).slice(0, 160)}` : ''}`);
  error.status = status;
  error.body = body || '';
  return error;
}

function isDistributedFallbackError(error) {
  return error?.status === 409 || (error?.status === 400 && /distributed|threshold|below/i.test(String(error.body || error.message || '')));
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
