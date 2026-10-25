const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readLegacy, validateEndpoint, validateToken, interval } = require('./explorer-publisher-settings');

function resolvePublisherBinary(options = {}) {
  const env = options.env || process.env;
  const appDir = options.appDir || __dirname;
  const resourcesPath = options.resourcesPath || '';
  const exists = options.exists || fs.existsSync;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    env.LXE_BIN,
    options.legacyBinary,
    resourcesPath && path.join(resourcesPath, 'bin', 'explorer', 'lxe' + suffix),
    path.join(appDir, '.runtime', 'explorer', 'lxe' + suffix)
  ].filter(Boolean);
  return candidates.find(candidate => exists(candidate)) || null;
}

function resolvePublisherConfig(options = {}) {
  try {
    const legacy = readLegacy(options);
    if (!legacy) return null;
    const lxe = resolvePublisherBinary({ ...options, legacyBinary: legacy.lxe });
    if (!lxe) return null;
    return { url: validateEndpoint(legacy.url), token: validateToken(legacy.token), lxe, intervalMs: interval(legacy.interval_ms) };
  } catch (_) {
    return null;
  }
}

function runLxe(binary, datadir, network, args, timeout = 120000, signal) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [...args, '--datadir', datadir, '--network', network],
      {
        encoding: 'utf8',
        timeout,
        signal,
        windowsHide: true,
        maxBuffer: 128 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(new Error(`Invalid explorer JSON: ${parseError.message}`));
        }
      }
    );
  });
}

async function buildSnapshot(config, datadir, network, run = runLxe, signal) {
  const snapshot = await run(config.lxe, datadir, network, ['snapshot'], 120000, signal);
  const height = Number(snapshot?.tip?.height);
  if (
    snapshot?.schema !== 1 ||
    snapshot?.tip?.network !== network ||
    !Number.isSafeInteger(height) ||
    height < 0 ||
    !Array.isArray(snapshot.blocks) ||
    snapshot.blocks.length !== height + 1 ||
    !snapshot.accounts ||
    !snapshot.economics
  ) {
    throw new Error('Invalid explorer snapshot');
  }
  return snapshot;
}

async function sendSnapshot(config, snapshot, request = globalThis.fetch, signal) {
  if (typeof request !== 'function') throw new Error('HTTPS fetch is unavailable');
  const response = await request(config.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    // Do not reflect server content (which could echo the bearer token) into IPC/logs.
    throw new Error(`Explorer ingest failed (HTTP ${response.status}).`);
  }
  const result = await response.json();
  if (result?.ok !== true) throw new Error('Explorer did not acknowledge the upload.');
  return result;
}

class ExplorerPublisher {
  constructor(config, datadir, network, options = {}) {
    this.config = config;
    this.datadir = datadir;
    this.network = network;
    this.build = options.build || buildSnapshot;
    this.send = options.send || sendSnapshot;
    this.timer = null;
    this.stopped = true;
    this.running = false;
    this.lastTip = '';
    this.onStatus = options.onStatus || (() => {});
    this.controller = null;
    this.status = { state: 'stopped', lastPublishedAt: null, lastHeight: null, error: null };
  }

  report(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus({ ...this.status });
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.report({ state: 'waiting', error: null });
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.report({ state: 'stopped' });
  }

  schedule(delay) {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (this.stopped || this.running) return;
    this.running = true;
    this.controller = new AbortController();
    let phase = 'snapshot';
    try {
      this.report({ state: 'exporting' });
      const snapshot = await this.build(this.config, this.datadir, this.network, undefined, this.controller.signal);
      if (this.stopped) return;
      const identity = `${snapshot.tip.height}:${snapshot.tip.tip}`;
      if (identity !== this.lastTip) {
        phase = 'upload';
        this.report({ state: 'uploading' });
        await this.send(this.config, snapshot, undefined, this.controller.signal);
        if (this.stopped) return;
        this.lastTip = identity;
        this.report({ lastPublishedAt: Date.now(), lastHeight: snapshot.tip.height });
      }
      this.report({ state: 'current', error: null });
    } catch (error) {
      if (!this.stopped) {
        const http = /^Explorer ingest failed \(HTTP \d{3}\)\.$/.test(error.message) ? error.message : '';
        this.report({ state: 'error', error: http || (phase === 'snapshot'
          ? 'Snapshot export failed. Check the local node and bundled explorer helper.'
          : 'Upload failed or timed out. Check the endpoint, token, and network connection.') });
      }
    } finally {
      this.running = false;
      this.controller = null;
      this.schedule(this.config.intervalMs);
    }
  }
}

module.exports = {
  ExplorerPublisher,
  buildSnapshot,
  resolvePublisherConfig,
  resolvePublisherBinary,
  runLxe,
  sendSnapshot
};
