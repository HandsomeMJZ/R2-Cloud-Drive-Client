const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeRemotePath } = require('./apiClient');

const DEFAULT_BACKUP_ROOT = '备份';
const DEFAULT_ALBUM_ROOT = '相册';
const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.heif', '.svg',
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.wmv', '.flv', '.3gp'
]);
const BACKUP_UPLOAD_CONCURRENCY = 8;
const SCAN_CONCURRENCY = 16;

class BackupManager {
  constructor(client, emitBackup, emitTransfer) {
    this.client = client;
    this.emitBackup = emitBackup;
    this.emitTransfer = emitTransfer || (() => {});
    this.runningJobs = new Set();
    this.remoteDirs = new Set();
    this.timer = null;
  }

  getConfig() {
    const config = this.client.getConfig();
    return {
      jobs: sanitizeJobs(config.backupJobs),
      intervalMinutes: Number(config.backupIntervalMinutes) || 15,
      autoStart: Boolean(config.backupAutoStart),
      runningJobIds: [...this.runningJobs]
    };
  }

  setConfig(nextConfig = {}) {
    const current = this.getConfig();
    const patch = {};

    if (Array.isArray(nextConfig.jobs)) {
      patch.backupJobs = sanitizeJobs(nextConfig.jobs);
    }
    if (nextConfig.intervalMinutes !== undefined) {
      patch.backupIntervalMinutes = nextConfig.intervalMinutes;
    }
    if (typeof nextConfig.autoStart === 'boolean') {
      patch.backupAutoStart = nextConfig.autoStart;
    }

    const updated = this.client.setConfig(patch);
    this.restartTimer();
    return {
      jobs: sanitizeJobs(updated.backupJobs || current.jobs),
      intervalMinutes: Number(updated.backupIntervalMinutes) || current.intervalMinutes,
      autoStart: Boolean(updated.backupAutoStart),
      runningJobIds: [...this.runningJobs]
    };
  }

  addJob(localPath, options = {}) {
    const sourcePath = expandHome(localPath);
    const stat = fs.statSync(sourcePath);
    if (!stat.isDirectory()) {
      throw new Error('请选择一个本机文件夹');
    }

    const jobs = this.getConfig().jobs;
    const normalizedSource = path.resolve(sourcePath);
    const kind = options.kind === 'album' ? 'album' : 'folder';
    const root = kind === 'album' ? DEFAULT_ALBUM_ROOT : DEFAULT_BACKUP_ROOT;
    const name = safeRemoteName(path.basename(normalizedSource) || 'folder');
    const remotePath = normalizeRemotePath(options.remotePath || `${root}/${name}`);
    const existing = jobs.find((job) => samePath(job.localPath, normalizedSource) && job.remotePath === remotePath);
    if (existing) {
      return this.getConfig();
    }

    jobs.push({
      id: makeJobId(),
      name,
      localPath: normalizedSource,
      remotePath,
      kind,
      mediaOnly: kind === 'album' || Boolean(options.mediaOnly),
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRunAt: '',
      lastStatus: 'idle',
      lastMessage: ''
    });

    return this.setConfig({ jobs });
  }

  addAlbumJob(localPath) {
    return this.addJob(localPath, {
      kind: 'album',
      mediaOnly: true
    });
  }

  removeJob(id) {
    const jobs = this.getConfig().jobs.filter((job) => job.id !== id);
    return this.setConfig({ jobs });
  }

  updateJob(id, patch = {}) {
    const jobs = this.getConfig().jobs.map((job) => {
      if (job.id !== id) {
        return job;
      }
      return {
        ...job,
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : job.enabled
      };
    });
    return this.setConfig({ jobs });
  }

  start() {
    this.restartTimer();
    windowSetTimeout(() => this.runAll({ reason: 'startup' }), 2500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  restartTimer() {
    this.stop();
    const intervalMinutes = Math.max(1, Number(this.client.getConfig().backupIntervalMinutes) || 15);
    this.timer = setInterval(() => {
      this.runAll({ reason: 'schedule' });
    }, intervalMinutes * 60 * 1000);
  }

  async runAll(options = {}) {
    const jobs = this.getConfig().jobs.filter((job) => job.enabled !== false);
    for (const job of jobs) {
      await this.runJob(job.id, options).catch(() => {});
    }
    return this.getConfig();
  }

  async runJob(id, options = {}) {
    const job = this.getConfig().jobs.find((entry) => entry.id === id);
    if (!job) {
      throw new Error('备份任务不存在');
    }
    if (this.runningJobs.has(job.id)) {
      return { skipped: true, reason: 'running' };
    }

    this.runningJobs.add(job.id);
    const startedAt = new Date().toISOString();
    const stats = {
      scanned: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0
    };

    this.emitStatus(job, {
      status: 'running',
      phase: options.reason === 'schedule' ? '定时备份中' : '备份中',
      startedAt,
      stats
    });

    try {
      const uploadPlan = [];
      await this.scanDirectory(job, '', uploadPlan, stats);
      this.emitStatus(job, {
        status: 'running',
        phase: 'Scan complete, uploading',
        stats: {
          ...stats,
          pending: uploadPlan.length
        }
      });
      await runWithConcurrency(uploadPlan, BACKUP_UPLOAD_CONCURRENCY, (item) => this.uploadBackupItem(job, item, stats));
      this.patchJobResult(job.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: stats.failed ? 'warning' : 'done',
        lastMessage: stats.failed
          ? `完成，${stats.failed} 个文件失败`
          : `完成，上传 ${stats.uploaded} 个，跳过 ${stats.skipped} 个`
      });
      this.emitStatus(job, {
        status: stats.failed ? 'warning' : 'done',
        phase: '备份完成',
        stats
      });
      return { ok: true, stats };
    } catch (error) {
      this.patchJobResult(job.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'error',
        lastMessage: error.message
      });
      this.emitStatus(job, {
        status: 'error',
        phase: '备份失败',
        message: error.message,
        stats
      });
      throw error;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  async scanDirectory(job, relativeDir, uploadPlan, stats) {
    const localDir = path.join(job.localPath, relativeDir);
    const remoteDir = joinRemote(job.remotePath, toRemotePath(relativeDir));

    await this.ensureRemoteDir(remoteDir);
    const remoteFiles = await this.listRemoteFiles(remoteDir);
    const entries = await fs.promises.readdir(localDir, { withFileTypes: true });

    const subDirs = [];
    const files = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const nextRelative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        subDirs.push(nextRelative);
      } else if (entry.isFile()) {
        files.push(nextRelative);
      }
    }

    // Scan subdirectories in parallel with concurrency limit
    await runWithConcurrency(subDirs, SCAN_CONCURRENCY, (nextRelative) =>
      this.scanDirectory(job, nextRelative, uploadPlan, stats)
    );

    // Plan backup for all files in this directory in parallel
    await runWithConcurrency(files, SCAN_CONCURRENCY, (nextRelative) =>
      this.planBackupFile(job, nextRelative, remoteFiles, uploadPlan, stats)
    );
  }

  async planBackupFile(job, relativeFile, remoteFiles, uploadPlan, stats) {
    if (job.mediaOnly && !isMediaFile(relativeFile)) {
      return;
    }

    const localFile = path.join(job.localPath, relativeFile);
    const localStat = await fs.promises.stat(localFile);
    const remoteName = path.basename(relativeFile);
    const remoteFile = remoteFiles.get(remoteName);
    const localMtime = localStat.mtimeMs;
    const remoteUploaded = remoteFile?.uploaded ? new Date(remoteFile.uploaded).getTime() : 0;

    stats.scanned += 1;

    if (remoteFile && Number.isFinite(remoteUploaded) && remoteUploaded >= localMtime) {
      stats.skipped += 1;
      this.emitStatus(job, {
        status: 'running',
        phase: 'Scanning, skipped unchanged file',
        fileName: remoteName,
        stats
      });
      return;
    }

    const plannedRemotePath = joinRemote(job.remotePath, toRemotePath(relativeFile));
    uploadPlan.push({
      localFile,
      remotePath: plannedRemotePath,
      remoteName,
      isModified: Boolean(remoteFile)
    });
    this.emitStatus(job, {
      status: 'running',
      phase: 'Scanning',
      fileName: remoteName,
      remotePath: plannedRemotePath,
      stats: {
        ...stats,
        pending: uploadPlan.length
      }
    });
  }

  async uploadBackupItem(job, item, stats) {
    const transferId = makeTransferId('backup');
    const baseTransferPayload = {
      id: transferId,
      type: 'upload',
      name: item.remoteName,
      filePath: item.localFile,
      remotePath: item.remotePath,
      status: 'running'
    };

    // Emit transfer start
    this.emitTransfer({
      ...baseTransferPayload,
      phase: '准备上传',
      transferred: 0,
      total: 0
    });

    this.emitStatus(job, {
      status: 'running',
      phase: item.isModified ? 'Uploading modified file' : 'Uploading new file',
      fileName: item.remoteName,
      remotePath: item.remotePath,
      stats
    });

    // Throttled progress emitter for transfer events (max ~120ms interval)
    let lastTransferEmit = 0;
    let transferTimer = null;
    let pendingTransferPayload = null;

    const flushTransfer = () => {
      if (transferTimer) {
        clearTimeout(transferTimer);
        transferTimer = null;
      }
      if (pendingTransferPayload) {
        this.emitTransfer(pendingTransferPayload);
        pendingTransferPayload = null;
        lastTransferEmit = Date.now();
      }
    };

    const emitTransferProgress = (payload) => {
      const now = Date.now();
      if (now - lastTransferEmit >= 120) {
        if (transferTimer) {
          clearTimeout(transferTimer);
          transferTimer = null;
        }
        this.emitTransfer(payload);
        lastTransferEmit = now;
        pendingTransferPayload = null;
      } else {
        pendingTransferPayload = payload;
        if (!transferTimer) {
          transferTimer = setTimeout(flushTransfer, Math.max(16, 120 - (now - lastTransferEmit)));
        }
      }
    };

    try {
      await this.client.uploadFile(item.localFile, item.remotePath, (progress) => {
        // Emit backup status (existing behavior)
        this.emitStatus(job, {
          status: 'running',
          phase: progress.phase || 'Uploading',
          fileName: item.remoteName,
          remotePath: item.remotePath,
          transferred: progress.transferred,
          total: progress.total,
          stats
        });

        // Emit transfer progress (throttled, for transfer list + bubble)
        emitTransferProgress({
          ...baseTransferPayload,
          phase: progress.phase || '上传中',
          transferred: progress.transferred,
          total: progress.total
        });
      });

      flushTransfer();
      stats.uploaded += 1;

      // Emit transfer done
      this.emitTransfer({
        ...baseTransferPayload,
        status: 'done',
        phase: '上传完成'
      });
    } catch (error) {
      flushTransfer();
      stats.failed += 1;

      this.emitStatus(job, {
        status: 'running',
        phase: 'Upload failed',
        fileName: item.remoteName,
        remotePath: item.remotePath,
        message: error.message,
        stats
      });

      // Emit transfer error
      this.emitTransfer({
        ...baseTransferPayload,
        status: 'error',
        phase: '上传失败',
        message: error.message
      });
    }
  }

  async listRemoteFiles(remoteDir) {
    try {
      const data = await this.client.list(remoteDir);
      const files = Array.isArray(data.files) ? data.files : [];
      return new Map(files.map((file) => [file.name, file]));
    } catch (error) {
      return new Map();
    }
  }

  async ensureRemoteDir(remoteDir) {
    const parts = normalizeRemotePath(remoteDir).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = joinRemote(current, part);
      if (this.remoteDirs.has(current)) {
        continue;
      }
      try {
        await this.client.mkdir(current);
      } catch (error) {
        const message = String(error?.message || error);
        if (!/exist|already|409|已存在/.test(message)) {
          // A following list/upload will surface real permission or network errors.
        }
      }
      this.remoteDirs.add(current);
    }
  }

  patchJobResult(id, patch) {
    const jobs = this.getConfig().jobs.map((job) => (
      job.id === id ? { ...job, ...patch } : job
    ));
    this.client.setConfig({ backupJobs: jobs });
  }

  emitStatus(job, payload) {
    this.emitBackup({
      type: 'backup',
      jobId: job.id,
      jobName: job.name,
      localPath: job.localPath,
      remotePath: job.remotePath,
      updatedAt: new Date().toISOString(),
      ...payload
    });
  }
}

function sanitizeJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job && typeof job.localPath === 'string')
    .map((job) => ({
      id: job.id || makeJobId(),
      name: job.name || safeRemoteName(path.basename(job.localPath) || 'folder'),
      localPath: path.resolve(expandHome(job.localPath)),
      remotePath: normalizeRemotePath(job.remotePath || `${DEFAULT_BACKUP_ROOT}/${safeRemoteName(path.basename(job.localPath) || 'folder')}`),
      kind: job.kind === 'album' ? 'album' : 'folder',
      mediaOnly: Boolean(job.mediaOnly || job.kind === 'album'),
      enabled: job.enabled !== false,
      createdAt: job.createdAt || new Date().toISOString(),
      lastRunAt: job.lastRunAt || '',
      lastStatus: job.lastStatus || 'idle',
      lastMessage: job.lastMessage || ''
    }));
}

function expandHome(value) {
  const text = String(value || '').trim();
  if (text === '~') {
    return os.homedir();
  }
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function safeRemoteName(name) {
  return String(name || 'folder')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'folder';
}

function toRemotePath(value) {
  return String(value || '').split(path.sep).filter(Boolean).join('/');
}

function joinRemote(...segments) {
  return normalizeRemotePath(segments.filter(Boolean).join('/'));
}

function isMediaFile(filePath) {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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

function makeJobId() {
  return `backup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTransferId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function windowSetTimeout(handler, ms) {
  return setTimeout(handler, ms);
}

module.exports = {
  BackupManager
};
