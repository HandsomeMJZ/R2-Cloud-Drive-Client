const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream');

const DEFAULT_BASE_URL = '';
const DEFAULT_BACKUP_SYNC_CLIENT_ID = 'r2drive-default';
const DIRECT_UPLOAD_LIMIT = 512 * 1024;
const DISTRIBUTED_UPLOAD_LIMIT = DIRECT_UPLOAD_LIMIT;
const CHUNK_SIZE = 32 * 1024 * 1024;
const MAX_CHUNK_SIZE = 90 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10000;
const DOWNLOAD_MAX_RETRIES = 6;
const DOWNLOAD_CONCURRENT_CHUNKS = 4;
const UPLOAD_MAX_RETRIES = 3;

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

class R2DriveClient {
  constructor(configFile) {
    this.configFile = configFile;
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      sessionCookie: '',
      downloadDir: '',
      backupJobs: [],
      backupIntervalMinutes: 15,
      backupAutoStart: false,
      backupSyncClientId: DEFAULT_BACKUP_SYNC_CLIENT_ID,
      backupSyncPromptDismissed: false,
      closeBehavior: 'ask',
      minimizeBehavior: 'taskbar',
      startHiddenToTray: false,
      autoLaunch: false,
      uploadBatchNotify: true,
      downloadBatchNotify: true,
      autoSyncEnabled: false,
      updateAutoCheck: true,
      updateSkippedVersion: '',
      updatePromptedVersions: [],
      customBrandHtml: '',
      customBrandCss: ''
    };
    this.loadConfig();
  }

  loadConfig() {
    try {
      const raw = fs.readFileSync(this.configFile, 'utf8');
      const saved = JSON.parse(raw);
      this.config = {
        ...this.config,
        ...saved,
        baseUrl: normalizeBaseUrl(saved.baseUrl || '')
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Failed to load config:', error.message);
      }
    }
  }

  saveConfig() {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
  }

  getConfig() {
    return {
      baseUrl: this.config.baseUrl,
      downloadDir: this.config.downloadDir || '',
      backupJobs: Array.isArray(this.config.backupJobs) ? this.config.backupJobs : [],
      backupIntervalMinutes: Number(this.config.backupIntervalMinutes) || 15,
      backupAutoStart: Boolean(this.config.backupAutoStart),
      backupSyncClientId: this.config.backupSyncClientId || DEFAULT_BACKUP_SYNC_CLIENT_ID,
      backupSyncPromptDismissed: Boolean(this.config.backupSyncPromptDismissed),
      closeBehavior: this.config.closeBehavior || 'ask',
      minimizeBehavior: this.config.minimizeBehavior || 'taskbar',
      startHiddenToTray: Boolean(this.config.startHiddenToTray),
      autoLaunch: Boolean(this.config.autoLaunch),
      uploadBatchNotify: this.config.uploadBatchNotify !== false,
      downloadBatchNotify: this.config.downloadBatchNotify !== false,
      autoSyncEnabled: Boolean(this.config.autoSyncEnabled),
      updateAutoCheck: this.config.updateAutoCheck !== false,
      updateSkippedVersion: this.config.updateSkippedVersion || '',
      updatePromptedVersions: Array.isArray(this.config.updatePromptedVersions) ? this.config.updatePromptedVersions : [],
      customBrandHtml: this.config.customBrandHtml || '',
      customBrandCss: this.config.customBrandCss || '',
      hasSession: Boolean(this.config.sessionCookie)
    };
  }

  setConfig(nextConfig) {
    if (typeof nextConfig.baseUrl === 'string') {
      this.config.baseUrl = normalizeBaseUrl(nextConfig.baseUrl);
    }
    if (typeof nextConfig.downloadDir === 'string') {
      this.config.downloadDir = nextConfig.downloadDir.trim();
    }
    if (Array.isArray(nextConfig.backupJobs)) {
      this.config.backupJobs = nextConfig.backupJobs;
    }
    if (nextConfig.backupIntervalMinutes !== undefined) {
      const minutes = Number(nextConfig.backupIntervalMinutes);
      if (Number.isFinite(minutes) && minutes >= 1) {
        this.config.backupIntervalMinutes = Math.min(1440, Math.round(minutes));
      }
    }
    if (typeof nextConfig.backupAutoStart === 'boolean') {
      this.config.backupAutoStart = nextConfig.backupAutoStart;
    }
    if (typeof nextConfig.backupSyncClientId === 'string') {
      const clientId = nextConfig.backupSyncClientId.trim();
      if (clientId) {
        this.config.backupSyncClientId = clientId;
      }
    }
    if (typeof nextConfig.backupSyncPromptDismissed === 'boolean') {
      this.config.backupSyncPromptDismissed = nextConfig.backupSyncPromptDismissed;
    }
    if (['ask', 'tray', 'quit'].includes(nextConfig.closeBehavior)) {
      this.config.closeBehavior = nextConfig.closeBehavior;
    }
    if (['taskbar', 'tray'].includes(nextConfig.minimizeBehavior)) {
      this.config.minimizeBehavior = nextConfig.minimizeBehavior;
    }
    if (typeof nextConfig.startHiddenToTray === 'boolean') {
      this.config.startHiddenToTray = nextConfig.startHiddenToTray;
    }
    if (typeof nextConfig.autoLaunch === 'boolean') {
      this.config.autoLaunch = nextConfig.autoLaunch;
    }
    if (typeof nextConfig.uploadBatchNotify === 'boolean') {
      this.config.uploadBatchNotify = nextConfig.uploadBatchNotify;
    }
    if (typeof nextConfig.downloadBatchNotify === 'boolean') {
      this.config.downloadBatchNotify = nextConfig.downloadBatchNotify;
    }
    if (typeof nextConfig.autoSyncEnabled === 'boolean') {
      this.config.autoSyncEnabled = nextConfig.autoSyncEnabled;
    }
    if (typeof nextConfig.updateAutoCheck === 'boolean') {
      this.config.updateAutoCheck = nextConfig.updateAutoCheck;
    }
    if (typeof nextConfig.updateSkippedVersion === 'string') {
      this.config.updateSkippedVersion = sanitizeVersion(nextConfig.updateSkippedVersion);
    }
    if (Array.isArray(nextConfig.updatePromptedVersions)) {
      this.config.updatePromptedVersions = nextConfig.updatePromptedVersions
        .map((version) => sanitizeVersion(version))
        .filter(Boolean)
        .slice(-30);
    }
    if (typeof nextConfig.customBrandHtml === 'string') {
      this.config.customBrandHtml = nextConfig.customBrandHtml;
    }
    if (typeof nextConfig.customBrandCss === 'string') {
      this.config.customBrandCss = nextConfig.customBrandCss;
    }
    this.saveConfig();
    return this.getConfig();
  }

  async login(password) {
    const response = await this.requestJson('/api/login', {
      method: 'POST',
      body: { password: password || '' }
    });
    return {
      ...response,
      hasSession: Boolean(this.config.sessionCookie)
    };
  }

  async logout() {
    try {
      await this.requestJson('/api/logout', { method: 'POST' });
    } finally {
      this.config.sessionCookie = '';
      this.saveConfig();
    }
    return {};
  }

  list(remotePath = '') {
    return this.requestJson(`/api/list?path=${encodeURIComponent(toApiPath(remotePath, { allowEmpty: true }))}`);
  }

  sharedList(remotePath = '') {
    return this.requestJson(`/api/shared-list?path=${encodeURIComponent(toApiPath(remotePath, { allowEmpty: true }))}`, {
      includeCookie: false
    });
  }

  storage() {
    return this.requestJson('/api/storage');
  }

  backupDirs(clientId = this.config.backupSyncClientId) {
    return this.requestJson(`/api/backup-dirs?clientId=${encodeURIComponent(normalizeClientId(clientId))}`);
  }

  saveBackupDirs(dirs, clientId = this.config.backupSyncClientId) {
    return this.requestJson('/api/backup-dirs', {
      method: 'POST',
      body: {
        clientId: normalizeClientId(clientId),
        dirs: normalizeRemoteDirList(dirs)
      }
    });
  }

  addBackupDir(remotePath, clientId = this.config.backupSyncClientId) {
    return this.requestJson('/api/backup-dirs/add', {
      method: 'POST',
      body: {
        clientId: normalizeClientId(clientId),
        path: toApiPath(remotePath)
      }
    });
  }

  deleteBackupDir(remotePath, clientId = this.config.backupSyncClientId) {
    const query = new URLSearchParams({ clientId: normalizeClientId(clientId) });
    if (remotePath) {
      query.set('path', toApiPath(remotePath));
    }
    return this.requestJson(`/api/backup-dirs?${query.toString()}`, {
      method: 'DELETE'
    });
  }

  async testConnection() {
    const startedAt = Date.now();
    const storage = await this.storage();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      storage
    };
  }

  mkdir(remotePath) {
    return this.requestJson('/api/mkdir', {
      method: 'POST',
      body: { path: toApiPath(remotePath) }
    });
  }

  delete(remotePath) {
    return this.requestJson(`/api/delete?path=${encodeURIComponent(toApiPath(remotePath))}`, {
      method: 'DELETE'
    });
  }

  deleteBatch(paths) {
    const normalized = (Array.isArray(paths) ? paths : [paths])
      .map((item) => toApiPath(item))
      .filter(Boolean);

    return this.requestJson('/api/delete-batch', {
      method: 'POST',
      body: { paths: normalized }
    });
  }

  rename(from, to) {
    return this.requestJson('/api/rename', {
      method: 'POST',
      body: {
        from: toApiPath(from),
        to: toApiPath(to)
      }
    });
  }

  storageNodes() {
    return this.requestJson('/api/storage-nodes');
  }

  saveStorageNode(node) {
    return this.requestJson('/api/storage-nodes', {
      method: 'POST',
      body: node
    });
  }

  deleteStorageNode(id) {
    return this.requestJson(`/api/storage-nodes?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }

  testStorageNode(id) {
    return this.requestJson(`/api/storage-nodes/test?id=${encodeURIComponent(id)}`, {
      method: 'POST'
    });
  }

  scanOrphans() {
    return this.requestJson('/api/orphan-cleanup', {
      method: 'POST',
      body: { action: 'scan' }
    });
  }

  cleanOrphans(keys) {
    return this.requestJson('/api/orphan-cleanup', {
      method: 'POST',
      body: {
        action: 'clean',
        keys: Array.isArray(keys) ? keys : [keys]
      }
    });
  }

  // Clipboard API
  async clipboardGet(id = 'default') {
    return this.requestJson(`/api/clipboard?id=${encodeURIComponent(id)}`, {
      includeCookie: false
    });
  }

  async clipboardSet(items, action = 'copy', sourcePath = '', id = 'default') {
    return this.requestJson(`/api/clipboard?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      includeCookie: false,
      body: {
        items: Array.isArray(items) ? items : [items],
        action: action || 'copy',
        sourcePath: sourcePath || ''
      }
    });
  }

  async clipboardDelete(id = 'default') {
    return this.requestJson(`/api/clipboard?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      includeCookie: false
    });
  }

  async clipboardPaste(payload = {}) {
    const action = payload.action === 'cut' ? 'cut' : 'copy';
    const items = Array.isArray(payload.items) ? payload.items : [payload.items];

    return this.requestJson('/api/clipboard/paste', {
      method: 'POST',
      body: {
        action,
        items: items.map((item) => path.posix.basename(normalizeRemotePath(item))).filter(Boolean),
        sourcePath: toApiPath(payload.sourcePath || '', { allowEmpty: true }),
        targetPath: toApiPath(payload.targetPath || '', { allowEmpty: true })
      }
    });
  }

  async downloadToFile(remotePath, outputPath, onProgress, options = {}) {
    const url = this.makeUrl(`/api/download?path=${encodeURIComponent(toApiPath(remotePath))}`);
    const headers = this.cookieHeaders(url);

    try {
      return await downloadWithRangeRetry(url, headers, outputPath, onProgress, options);
    } catch (error) {
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
      throw makeDownloadError(error);
    }
  }

  async previewDataUrl(remotePath, maxBytes = 6 * 1024 * 1024) {
    let url = this.makeUrl(`/api/download?path=${encodeURIComponent(toApiPath(remotePath))}`);
    let headers = this.cookieHeaders(url);

    for (let redirect = 0; redirect < 5; redirect += 1) {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual'
      });

      this.captureCookie(response.headers);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new HttpError('服务器返回了无效重定向', response.status, '');
        }
        const nextUrl = new URL(location, url);
        headers = headersForRedirect(headers, url, nextUrl);
        url = nextUrl;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new HttpError(readableHttpError(response.status, text), response.status, text);
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        return { ok: false, reason: 'too_large' };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        return { ok: false, reason: 'too_large' };
      }

      const contentType = response.headers.get('content-type') || getContentType(remotePath);
      return {
        ok: true,
        dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`
      };
    }

    throw new Error('预览重定向次数过多');
  }

  async uploadFile(localFilePath, remotePath, onProgress) {
    const stat = await fs.promises.stat(localFilePath);
    const targetPath = toApiPath(remotePath);
    const contentType = getContentType(localFilePath);
    const plan = createUploadPlan(stat.size);

    onProgress?.({
      transferred: 0,
      total: stat.size,
      phase: '准备上传',
      strategy: plan.strategy
    });

    if (stat.size <= DIRECT_UPLOAD_LIMIT) {
      return this.uploadSimple(localFilePath, targetPath, stat.size, onProgress);
    }

    if (stat.size > DISTRIBUTED_UPLOAD_LIMIT) {
      try {
        return await this.uploadDistributed(localFilePath, targetPath, stat.size, contentType, plan, onProgress);
      } catch (error) {
        if (!isDistributedFallbackError(error)) {
          throw error;
        }
      }
    }

    return this.uploadMultipart(localFilePath, targetPath, stat.size, contentType, plan, onProgress);
  }

  async uploadSimple(localFilePath, remotePath, size, onProgress) {
    const url = this.makeUrl(`/api/upload?path=${encodeURIComponent(remotePath)}`);
    const response = await requestStreamWithRetry((attempt) => ({
      method: 'POST',
      url,
      headers: {
        ...this.cookieHeaders(url),
        'Content-Type': 'application/octet-stream'
      },
      bodyStream: fs.createReadStream(localFilePath),
      contentLength: size,
      onProgress: (progress) => onProgress?.({
        ...progress,
        phase: attempt > 1 ? `普通上传（重试 ${attempt}/${UPLOAD_MAX_RETRIES + 1}）` : '普通上传',
        strategy: 'simple'
      })
    }));
    return parseJsonResponse(response.body);
  }

  async uploadDistributed(localFilePath, remotePath, size, contentType, plan, onProgress) {
    const partCount = plan.partCount;
    const chunkSize = plan.chunkSize;
    let sessionId = '';

    try {
      const init = await this.requestJson('/api/distributed/init', {
        method: 'POST',
        body: {
          path: remotePath,
          size,
          contentType,
          chunkSize,
          parts: partCount
        }
      });

      sessionId = init.sessionId;
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

        const start = (partNumber - 1) * chunkSize;
        const end = start + partSize - 1;
        const url = this.makeUrl(part.uploadUrl);
        const headers = {
          ...this.cookieHeaders(url),
          'Content-Type': 'application/octet-stream'
        };
        if (part.token) {
          headers.Authorization = `Bearer ${part.token}`;
        }

        const response = await requestStreamWithRetry((attempt) => ({
          method: 'PUT',
          url,
          headers,
          bodyStream: fs.createReadStream(localFilePath, { start, end }),
          contentLength: partSize,
          onProgress: (progress) => onProgress?.({
            transferred: completed + progress.transferred,
            total: size,
            phase: attempt > 1
              ? `分布式上传 ${partNumber}/${partCount}（重试 ${attempt}/${UPLOAD_MAX_RETRIES + 1}）`
              : `分布式上传 ${partNumber}/${partCount}`,
            strategy: 'distributed',
            partNumber,
            partCount
          })
        }));
        parseJsonResponse(response.body);
        completed += partSize;
      }

      onProgress?.({
        transferred: size,
        total: size,
        phase: '完成分布式上传',
        strategy: 'distributed'
      });

      await this.requestJson('/api/distributed/complete', {
        method: 'POST',
        body: { sessionId }
      });

      return { ok: true, strategy: 'distributed' };
    } catch (error) {
      if (sessionId) {
        await this.requestJson('/api/distributed/abort', {
          method: 'POST',
          body: { sessionId }
        }).catch(() => {});
      }
      throw error;
    }
  }

  async uploadMultipart(localFilePath, remotePath, size, contentType, plan, onProgress) {
    const init = await this.requestJson('/api/multipart/init', {
      method: 'POST',
      body: {
        path: remotePath,
        contentType
      }
    });

    const uploadId = init.uploadId;
    if (!uploadId) {
      throw new Error('R2 分片上传初始化响应无效');
    }

    const partCount = plan.partCount;
    const chunkSize = plan.chunkSize;
    const parts = [];
    let completed = 0;

    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const start = (partNumber - 1) * chunkSize;
        const partSize = Math.min(chunkSize, size - start);
        const end = start + partSize - 1;
        const url = this.makeUrl(`/api/multipart/part?path=${encodeURIComponent(remotePath)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`);

        const response = await requestStreamWithRetry((attempt) => ({
          method: 'POST',
          url,
          headers: {
            ...this.cookieHeaders(url),
            'Content-Type': 'application/octet-stream'
          },
          bodyStream: fs.createReadStream(localFilePath, { start, end }),
          contentLength: partSize,
          onProgress: (progress) => onProgress?.({
            transferred: completed + progress.transferred,
            total: size,
            phase: attempt > 1
              ? `R2 分片上传 ${partNumber}/${partCount}（重试 ${attempt}/${UPLOAD_MAX_RETRIES + 1}）`
              : `R2 分片上传 ${partNumber}/${partCount}`,
            strategy: 'multipart',
            partNumber,
            partCount
          })
        }));

        parts.push(parseJsonResponse(response.body));
        completed += partSize;
      }

      onProgress?.({
        transferred: size,
        total: size,
        phase: '完成 R2 分片上传',
        strategy: 'multipart'
      });

      return this.requestJson('/api/multipart/complete', {
        method: 'POST',
        body: {
          path: remotePath,
          uploadId,
          parts
        }
      });
    } catch (error) {
      await this.requestJson('/api/multipart/abort', {
        method: 'POST',
        body: {
          path: remotePath,
          uploadId
        }
      }).catch(() => {});
      throw error;
    }
  }

  async requestJson(route, options = {}) {
    const method = options.method || 'GET';
    const url = this.makeUrl(route);
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {})
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.includeCookie !== false) {
      Object.assign(headers, this.cookieHeaders(url));
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        redirect: 'follow'
      });
    } catch (error) {
      throw makeNetworkError(error, url);
    }

    this.captureCookie(response.headers);

    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(readableHttpError(response.status, text), response.status, text);
    }

    if (!text) {
      return {};
    }

    return parseJsonResponse(text);
  }

  makeUrl(route) {
    if (route instanceof URL) {
      return route;
    }
    if (/^https?:\/\//i.test(route)) {
      return new URL(route);
    }
    return new URL(route, this.config.baseUrl);
  }

  cookieHeaders(url) {
    const base = new URL(this.config.baseUrl);
    if (url.origin !== base.origin || !this.config.sessionCookie) {
      return {};
    }
    return {
      Cookie: this.config.sessionCookie
    };
  }

  captureCookie(headers) {
    const cookies = getSetCookieHeaders(headers);
    let changed = false;

    for (const cookie of cookies) {
      if (!/^r2drive_session=/i.test(cookie)) {
        continue;
      }

      const pair = cookie.split(';')[0];
      if (/Max-Age=0/i.test(cookie) || /^r2drive_session=$/i.test(pair)) {
        this.config.sessionCookie = '';
      } else {
        this.config.sessionCookie = pair;
      }
      changed = true;
    }

    if (changed) {
      this.saveConfig();
    }
  }
}

function requestStream(options) {
  const {
    method,
    url,
    headers = {},
    bodyStream,
    contentLength,
    outputPath,
    onProgress,
    signal,
    maxRedirects = 5
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const target = url instanceof URL ? url : new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const requestHeaders = { ...headers };
    let settled = false;

    if (contentLength !== undefined) {
      requestHeaders['Content-Length'] = String(contentLength);
    }

    const req = transport.request(target, {
      method,
      headers: requestHeaders
    }, (res) => {
      const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
      if (isRedirect && res.headers.location && maxRedirects > 0) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, target);
        resolve(requestStream({
          ...options,
          method: res.statusCode === 303 ? 'GET' : method,
          url: redirectUrl,
          headers: headersForRedirect(headers, target, redirectUrl),
          maxRedirects: maxRedirects - 1
        }));
        return;
      }

      if (outputPath) {
        handleDownloadResponse(res, outputPath, onProgress, resolve, reject);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new HttpError(readableHttpError(res.statusCode, body), res.statusCode, body));
          return;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      bodyStream?.destroy?.();
      reject(error);
    };
    const onAbort = () => {
      req.destroy(makeAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', finishReject);

    if (bodyStream) {
      let sent = 0;
      bodyStream.on('data', (chunk) => {
        sent += chunk.length;
        onProgress?.({
          transferred: sent,
          total: contentLength
        });
      });
      bodyStream.on('error', finishReject);
      bodyStream.pipe(req);
    } else {
      req.end();
    }
  });
}

async function requestStreamWithRetry(createOptions, maxRetries = UPLOAD_MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      return await requestStream(createOptions(attempt));
    } catch (error) {
      lastError = error;
      if (!isRetryableUploadError(error) || attempt > maxRetries) {
        throw error;
      }
      await delay(Math.min(6000, 450 * (2 ** (attempt - 1))));
    }
  }

  throw lastError;
}

function handleDownloadResponse(res, outputPath, onProgress, resolve, reject) {
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      reject(new HttpError(readableHttpError(res.statusCode, body), res.statusCode, body));
    });
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const total = Number(res.headers['content-length']) || undefined;
  let transferred = 0;
  const file = fs.createWriteStream(outputPath);

  res.on('data', (chunk) => {
    transferred += chunk.length;
    onProgress?.({
      transferred,
      total
    });
  });

  pipeline(res, file, (error) => {
    if (error) {
      reject(error);
      return;
    }
    if (total !== undefined && transferred !== total) {
      reject(new Error(`下载不完整：已接收 ${transferred} 字节，预期 ${total} 字节`));
      return;
    }
    resolve({
      statusCode: res.statusCode,
      headers: res.headers,
      bytes: transferred
    });
  });
}

async function downloadWithRangeRetry(url, headers, outputPath, onProgress, options = {}) {
  throwIfAborted(options.signal);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await fs.promises.rm(outputPath, { force: true }).catch(() => {});

  const info = await getDownloadInfo(url, headers, options);
  if (!info.acceptRanges || !info.total) {
    return downloadWholeFile(url, headers, outputPath, onProgress, options);
  }

  // 小文件或仅一个分片时，直接用单连接下载更高效
  if (info.total <= CHUNK_SIZE) {
    return downloadWholeFile(url, headers, outputPath, onProgress, options);
  }

  // 预分配文件到完整大小
  const fd = await fs.promises.open(outputPath, 'w');
  await fd.truncate(info.total);
  await fd.close();

  // 构建分片计划
  const chunks = [];
  let offset = 0;
  while (offset < info.total) {
    const end = Math.min(info.total - 1, offset + CHUNK_SIZE - 1);
    chunks.push({ start: offset, end, index: chunks.length });
    offset = end + 1;
  }

  const downloadedBytes = { value: 0 };
  const maxConcurrent = Math.min(DOWNLOAD_CONCURRENT_CHUNKS, chunks.length);

  // 带重试的单个分片下载
  async function downloadOneChunk(chunk) {
    let retries = 0;
    while (true) {
      throwIfAborted(options.signal);
      try {
        const bytes = await downloadRangeChunk(
          url, headers, outputPath,
          chunk.start, chunk.end, info.total,
          options
        );
        downloadedBytes.value += bytes;
        onProgress?.({
          transferred: downloadedBytes.value,
          total: info.total,
          phase: '下载中'
        });

        if (bytes !== chunk.end - chunk.start + 1) {
          throw new Error(`分段下载不完整：已接收 ${bytes} 字节，预期 ${chunk.end - chunk.start + 1} 字节`);
        }
        return;
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (!isRetryableDownloadError(error) || retries >= DOWNLOAD_MAX_RETRIES) {
          throw error;
        }
        retries += 1;
        await delay(Math.min(8000, 500 * (2 ** (retries - 1))), options.signal);
      }
    }
  }

  // 并发下载分片（带并发数限制）
  const running = new Set();
  try {
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const task = downloadOneChunk(chunk).finally(() => running.delete(task));
      running.add(task);

      // 达到并发上限时，等待至少一个完成
      if (running.size >= maxConcurrent) {
        await Promise.race(running);
      }
    }
    // 等待所有剩余分片完成
    await Promise.all([...running]);
  } catch (error) {
    // 发生错误时等待已启动的分片结束再抛出
    await Promise.allSettled([...running]);
    throw error;
  }

  const finalSize = await fileSize(outputPath);
  if (finalSize !== info.total) {
    throw new Error(`下载不完整：已接收 ${finalSize} 字节，预期 ${info.total} 字节`);
  }

  onProgress?.({
    transferred: finalSize,
    total: info.total,
    phase: '下载完成'
  });

  return {
    statusCode: 206,
    headers: info.headers,
    bytes: finalSize
  };
}

async function getDownloadInfo(url, headers, options = {}) {
  try {
    const head = await requestHeaders({
      method: 'HEAD',
      url,
      headers,
      signal: options.signal
    });

    if (head.statusCode >= 200 && head.statusCode < 300) {
      const total = Number(head.headers['content-length']) || 0;
      return {
        headers: head.headers,
        total,
        acceptRanges: /bytes/i.test(String(head.headers['accept-ranges'] || ''))
      };
    }
  } catch (error) {
    // Some deployments do not expose HEAD consistently; fall back to a tiny range probe.
  }

  const probe = await requestHeaders({
    method: 'GET',
    url,
    headers: {
      ...headers,
      Range: 'bytes=0-0'
    },
    signal: options.signal
  });

  if (probe.statusCode === 206) {
    return {
      headers: probe.headers,
      total: parseContentRangeTotal(probe.headers['content-range']) || Number(probe.headers['content-length']) || 0,
      acceptRanges: true
    };
  }

  return {
    headers: probe.headers,
    total: Number(probe.headers['content-length']) || 0,
    acceptRanges: false
  };
}

async function downloadWholeFile(url, headers, outputPath, onProgress, options = {}) {
  const result = await requestStream({
    method: 'GET',
    url,
    headers,
    outputPath,
    onProgress,
    signal: options.signal
  });

  return result;
}

function downloadRange(url, headers, outputPath, start, end, total, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const target = url instanceof URL ? url : new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    let received = 0;
    let settled = false;

    const req = transport.request(target, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `bytes=${start}-${end}`
      }
    }, (res) => {
      if (res.statusCode !== 206) {
        readErrorBody(res, (body) => {
          reject(new HttpError(readableHttpError(res.statusCode, body), res.statusCode, body));
        });
        return;
      }

      const expectedTotal = parseContentRangeTotal(res.headers['content-range']);
      if (expectedTotal && total && expectedTotal !== total) {
        res.resume();
        reject(new Error(`文件大小变化：当前 ${expectedTotal} 字节，预期 ${total} 字节`));
        return;
      }

      const file = fs.createWriteStream(outputPath, { flags: start === 0 ? 'w' : 'a' });

      res.on('data', (chunk) => {
        received += chunk.length;
        onProgress?.({
          transferred: start + received,
          total,
          phase: '下载中'
        });
      });

      pipeline(res, file, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          bytes: received
        });
      });
    });

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      req.destroy(makeAbortError());
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    req.end();
  });
}

// 在预分配文件中写入指定偏移的分片（用于并发下载）
function downloadRangeChunk(url, headers, outputPath, start, end, total, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const target = url instanceof URL ? url : new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    let received = 0;
    let settled = false;

    const req = transport.request(target, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `bytes=${start}-${end}`
      }
    }, (res) => {
      if (res.statusCode !== 206) {
        readErrorBody(res, (body) => {
          reject(new HttpError(readableHttpError(res.statusCode, body), res.statusCode, body));
        });
        return;
      }

      const expectedTotal = parseContentRangeTotal(res.headers['content-range']);
      if (expectedTotal && total && expectedTotal !== total) {
        res.resume();
        reject(new Error(`文件大小变化：当前 ${expectedTotal} 字节，预期 ${total} 字节`));
        return;
      }

      // 在预分配文件的正确偏移位置写入
      const file = fs.createWriteStream(outputPath, { flags: 'r+', start });

      res.on('data', (chunk) => {
        received += chunk.length;
      });

      pipeline(res, file, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(received);
      });
    });

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      req.destroy(makeAbortError());
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    req.end();
  });
}

function requestHeaders(options) {
  const {
    method,
    url,
    headers = {},
    signal,
    maxRedirects = 5
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const target = url instanceof URL ? url : new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    let settled = false;

    const req = transport.request(target, {
      method,
      headers
    }, (res) => {
      const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
      if (isRedirect && res.headers.location && maxRedirects > 0) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, target);
        resolve(requestHeaders({
          ...options,
          url: redirectUrl,
          headers: headersForRedirect(headers, target, redirectUrl),
          maxRedirects: maxRedirects - 1
        }));
        return;
      }

      res.resume();
      res.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          statusCode: res.statusCode,
          headers: res.headers
        });
      });
    });

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      req.destroy(makeAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    req.end();
  });
}

function readErrorBody(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(Buffer.concat(chunks).toString('utf8')));
}

function parseContentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fileSize(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

function isRetryableDownloadError(error) {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof HttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  }

  const code = error?.code || '';
  const message = String(error?.message || error || '').toLowerCase();
  return [
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNABORTED',
    'UND_ERR_ABORTED'
  ].includes(code) || message.includes('aborted') || message.includes('socket hang up');
}

function isRetryableUploadError(error) {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof HttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  }

  const code = error?.code || '';
  const message = String(error?.message || error || '').toLowerCase();
  return [
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNABORTED',
    'UND_ERR_ABORTED'
  ].includes(code) || message.includes('socket hang up') || message.includes('aborted');
}

function makeDownloadError(error) {
  if (isAbortError(error)) {
    return error;
  }

  if (!isRetryableDownloadError(error)) {
    return makeNetworkError(error);
  }

  const message = error?.message && error.message !== 'aborted'
    ? error.message
    : '下载连接中途断开，已自动重试但仍未完成';
  return new Error(message);
}

function makeNetworkError(error, url) {
  if (error instanceof HttpError || isAbortError(error)) {
    return error;
  }

  const message = String(error?.message || error || '');
  const code = error?.code || error?.cause?.code || '';
  const host = url ? `（${new URL(url).host}）` : '';
  let friendly = message || '网络请求失败';

  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || /timed?out|timeout/i.test(message)) {
    friendly = `连接服务器超时${host}，请检查 API 地址、网络代理、防火墙或存储节点配置`;
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    friendly = `无法解析服务器地址${host}，请检查 API 地址和 DNS 网络`;
  } else if (['ECONNREFUSED'].includes(code) || /ECONNREFUSED/i.test(message)) {
    friendly = `服务器拒绝连接${host}，请确认服务端已启动且端口可访问`;
  } else if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(code) || /socket hang up|network|fetch failed/i.test(message)) {
    friendly = `网络连接中断${host}，请稍后重试或检查存储节点`;
  }

  const next = new Error(friendly);
  next.name = 'NetworkError';
  next.code = code || error?.code;
  next.cause = error;
  return next;
}

function makeAbortError() {
  const error = new Error('下载已取消');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw makeAbortError();
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function headersForRedirect(headers, fromUrl, toUrl) {
  const nextHeaders = { ...headers };
  if (fromUrl.origin !== toUrl.origin) {
    delete nextHeaders.Cookie;
    delete nextHeaders.cookie;
    delete nextHeaders.Authorization;
    delete nextHeaders.authorization;
  }
  return nextHeaders;
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
    throw new Error(`文件过大：分片数超过 ${MAX_MULTIPART_PARTS} 或单片超过 ${formatByteCount(MAX_CHUNK_SIZE)}`);
  }

  return {
    strategy,
    chunkSize,
    partCount
  };
}

function isDistributedFallbackError(error) {
  if (!(error instanceof HttpError)) {
    return false;
  }
  return error.status === 409 || (error.status === 400 && /distributed|threshold|below/i.test(String(error.body || error.message || '')));
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
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

function toApiPath(value, options = {}) {
  const normalized = normalizeRemotePath(value);
  validateRemotePath(normalized, options);
  return normalized;
}

function normalizeClientId(value) {
  const clientId = String(value || DEFAULT_BACKUP_SYNC_CLIENT_ID).trim();
  return clientId || DEFAULT_BACKUP_SYNC_CLIENT_ID;
}

function sanitizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[^0-9A-Za-z.+-]/g, '');
}

function normalizeRemoteDirList(dirs) {
  const seen = new Set();
  const normalized = [];

  for (const dir of Array.isArray(dirs) ? dirs : []) {
    const remotePath = toApiPath(dir);
    if (seen.has(remotePath)) {
      continue;
    }
    seen.add(remotePath);
    normalized.push(remotePath);
  }

  return normalized;
}

function validateRemotePath(remotePath, options = {}) {
  if (!remotePath) {
    if (options.allowEmpty) {
      return;
    }
    throw new Error('缺少远端路径');
  }

  if (/[\u0000-\u001f]/.test(remotePath)) {
    throw new Error('远端路径不能包含控制字符');
  }

  const segments = remotePath.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '')) {
    throw new Error('远端路径不能包含 .、.. 或空路径段');
  }
}

function parseJsonResponse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`服务器返回的 JSON 无法解析：${text.slice(0, 160)}`);
  }
}

function formatByteCount(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = Number(value || 0);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get?.('set-cookie');
  if (!value) {
    return [];
  }

  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim());
}

function readableHttpError(status, body) {
  const detail = body ? `：${body.slice(0, 240)}` : '';
  return `HTTP ${status}${detail}`;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.aac': 'audio/aac',
    '.avi': 'video/x-msvideo',
    '.bmp': 'image/bmp',
    '.cfg': 'text/plain',
    '.conf': 'text/plain',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.m4a': 'audio/mp4',
    '.md': 'text/markdown',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip'
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  R2DriveClient,
  HttpError,
  normalizeRemotePath
};
