const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream');

const DEFAULT_BASE_URL = 'https://cloud.junzhen.qzz.io';
const SIMPLE_UPLOAD_LIMIT = 90 * 1024 * 1024;
const CHUNK_SIZE = 32 * 1024 * 1024;
const DOWNLOAD_MAX_RETRIES = 6;

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
      downloadDir: ''
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
        baseUrl: normalizeBaseUrl(saved.baseUrl || this.config.baseUrl)
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
    return this.requestJson(`/api/list?path=${encodeURIComponent(remotePath)}`);
  }

  sharedList(remotePath = '') {
    return this.requestJson(`/api/shared-list?path=${encodeURIComponent(remotePath)}`, {
      includeCookie: false
    });
  }

  storage() {
    return this.requestJson('/api/storage');
  }

  mkdir(remotePath) {
    return this.requestJson('/api/mkdir', {
      method: 'POST',
      body: { path: normalizeRemotePath(remotePath) }
    });
  }

  delete(remotePath) {
    return this.requestJson(`/api/delete?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`, {
      method: 'DELETE'
    });
  }

  rename(from, to) {
    return this.requestJson('/api/rename', {
      method: 'POST',
      body: {
        from: normalizeRemotePath(from),
        to: normalizeRemotePath(to)
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

  async downloadToFile(remotePath, outputPath, onProgress, options = {}) {
    const url = this.makeUrl(`/api/download?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`);
    const headers = this.cookieHeaders(url);

    try {
      return await downloadWithRangeRetry(url, headers, outputPath, onProgress, options);
    } catch (error) {
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
      throw makeDownloadError(error);
    }
  }

  async previewDataUrl(remotePath, maxBytes = 6 * 1024 * 1024) {
    let url = this.makeUrl(`/api/download?path=${encodeURIComponent(normalizeRemotePath(remotePath))}`);
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
    const targetPath = normalizeRemotePath(remotePath);
    const contentType = getContentType(localFilePath);

    if (stat.size <= SIMPLE_UPLOAD_LIMIT) {
      return this.uploadSimple(localFilePath, targetPath, stat.size, onProgress);
    }

    try {
      return await this.uploadDistributed(localFilePath, targetPath, stat.size, contentType, onProgress);
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }
      return this.uploadMultipart(localFilePath, targetPath, stat.size, contentType, onProgress);
    }
  }

  async uploadSimple(localFilePath, remotePath, size, onProgress) {
    const url = this.makeUrl(`/api/upload?path=${encodeURIComponent(remotePath)}`);
    const response = await requestStream({
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
        phase: '普通上传',
        strategy: 'simple'
      })
    });
    return parseJsonResponse(response.body);
  }

  async uploadDistributed(localFilePath, remotePath, size, contentType, onProgress) {
    const partCount = Math.ceil(size / CHUNK_SIZE);
    let sessionId = '';

    try {
      const init = await this.requestJson('/api/distributed/init', {
        method: 'POST',
        body: {
          path: remotePath,
          size,
          contentType,
          chunkSize: CHUNK_SIZE,
          parts: partCount
        }
      });

      sessionId = init.sessionId;
      let completed = 0;

      for (const part of init.parts || []) {
        const start = (part.partNumber - 1) * CHUNK_SIZE;
        const end = start + part.size - 1;

        const response = await requestStream({
          method: 'PUT',
          url: new URL(part.uploadUrl),
          headers: {
            Authorization: `Bearer ${part.token}`,
            'Content-Type': 'application/octet-stream'
          },
          bodyStream: fs.createReadStream(localFilePath, { start, end }),
          contentLength: part.size,
          onProgress: (progress) => onProgress?.({
            transferred: completed + progress.transferred,
            total: size,
            phase: `分布式上传 ${part.partNumber}/${partCount}`,
            strategy: 'distributed',
            partNumber: part.partNumber,
            partCount
          })
        });
        parseJsonResponse(response.body);
        completed += part.size;
      }

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

  async uploadMultipart(localFilePath, remotePath, size, contentType, onProgress) {
    const init = await this.requestJson('/api/multipart/init', {
      method: 'POST',
      body: {
        path: remotePath,
        contentType
      }
    });

    const uploadId = init.uploadId;
    const partCount = Math.ceil(size / CHUNK_SIZE);
    const parts = [];
    let completed = 0;

    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const partSize = Math.min(CHUNK_SIZE, size - start);
        const end = start + partSize - 1;
        const url = this.makeUrl(`/api/multipart/part?path=${encodeURIComponent(remotePath)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`);

        const response = await requestStream({
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
            phase: `R2 分片上传 ${partNumber}/${partCount}`,
            strategy: 'multipart',
            partNumber,
            partCount
          })
        });

        parts.push(parseJsonResponse(response.body));
        completed += partSize;
      }

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

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      redirect: 'follow'
    });

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
      bodyStream.on('error', reject);
      bodyStream.pipe(req);
    } else {
      req.end();
    }
  });
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

  let downloaded = 0;
  let retries = 0;

  while (downloaded < info.total) {
    throwIfAborted(options.signal);
    const start = downloaded;
    const end = Math.min(info.total - 1, start + DOWNLOAD_CHUNK_SIZE - 1);

    try {
      const result = await downloadRange(url, headers, outputPath, start, end, info.total, onProgress, options);
      downloaded += result.bytes;
      retries = 0;

      if (result.bytes !== end - start + 1) {
        throw new Error(`分段下载不完整：已接收 ${result.bytes} 字节，预期 ${end - start + 1} 字节`);
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const existingSize = await fileSize(outputPath);
      downloaded = Math.min(existingSize, info.total);

      if (!isRetryableDownloadError(error) || retries >= DOWNLOAD_MAX_RETRIES) {
        throw error;
      }

      retries += 1;
      await delay(Math.min(8000, 500 * (2 ** (retries - 1))), options.signal);
    }
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

function makeDownloadError(error) {
  if (isAbortError(error)) {
    return error;
  }

  if (!isRetryableDownloadError(error)) {
    return error;
  }

  const message = error?.message && error.message !== 'aborted'
    ? error.message
    : '下载连接中途断开，已自动重试但仍未完成';
  return new Error(message);
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

function normalizeBaseUrl(value) {
  const trimmed = String(value || DEFAULT_BASE_URL).trim();
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

function parseJsonResponse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`服务器返回的 JSON 无法解析：${text.slice(0, 160)}`);
  }
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
    '.md': 'text/markdown',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
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
