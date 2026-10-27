const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { parseExactJSON } = require('./exact-json');
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
          resolve(parseExactJSON(stdout));
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
    const error = new Error(`Explorer ingest failed (HTTP ${response.status}).`);
    error.status = response.status;
    if (response.status === 409) {
      try { error.authoritative = (await response.json()).code === 'INDEX_AUTHORITATIVE'; } catch (_) {}
    }
    throw error;
  }
  const result = await response.json();
  if (result?.ok !== true) throw new Error('Explorer did not acknowledge the upload.');
  return result;
}

// Read capability only. Never read rpc.token or send an operator command.
async function readNodeStatus(config, datadir, network) {
  const endpoint = /^(127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/.exec(config.rpc || '127.0.0.1:19544');
  if (!endpoint || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535) {
    throw new Error('Explorer STATUS requires a loopback RPC endpoint');
  }
  const token = await fs.promises.readFile(path.join(datadir, 'rpc.read.token'));
  if (token.length !== 32) throw new Error('Invalid explorer read credential');
  const line = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint[1].replace(/[\[\]]/g, ''), port: Number(endpoint[2]) });
    let data = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      config.signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error('Explorer STATUS cancelled'));
    config.signal?.addEventListener('abort', abort, { once: true });
    if (config.signal?.aborted) return abort();
    socket.setTimeout(3000, () => finish(new Error('Explorer STATUS timed out')));
    socket.on('error', () => finish(new Error('Explorer STATUS unavailable')));
    socket.on('connect', () => socket.write(`${token.toString('hex')} STATUS\n`));
    socket.on('data', chunk => {
      data += chunk.toString('utf8');
      if (data.length > 4096) return finish(new Error('Explorer STATUS exceeds limit'));
      const newline = data.indexOf('\n');
      if (newline >= 0) finish(null, data.slice(0, newline));
    });
    socket.on('end', () => finish(new Error('Incomplete explorer STATUS')));
  }).finally(() => token.fill(0));
  if (!line.startsWith('OK ')) throw new Error('Explorer STATUS rejected');
  const fields = Object.fromEntries(line.slice(3).split(' ').map(field => field.split('=')));
  const height = Number(fields.height);
  if (fields.network !== network || !/^(0|[1-9][0-9]*)$/.test(fields.height || '') ||
      !Number.isSafeInteger(height) || !/^[0-9a-f]{64}$/.test(fields.tip || '') ||
      !/^[0-9a-f]{64}$/.test(fields.chain_work || '')) {
    throw new Error('Invalid explorer STATUS identity');
  }
  return { network, height, tip: fields.tip, chain_work: fields.chain_work };
}

async function sendHeartbeat(config, status, request = globalThis.fetch) {
  const response = await request(new URL('/api/heartbeat', config.url).href, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(config.signal ? [config.signal] : [])]),
    body: JSON.stringify({ schema: 1, tip: status })
  });
  if (!response.ok) {
    const error = new Error(`Explorer heartbeat failed (${response.status})`);
    error.status = response.status;
    if (response.status === 409) {
      try { error.authoritative = (await response.json()).code === 'INDEX_AUTHORITATIVE'; } catch (_) {}
    }
    throw error;
  }
  return response.json();
}

class ExplorerPublisher {
  constructor(config, datadir, network, options = {}) {
    this.config = config;
    this.datadir = datadir;
    this.network = network;
    this.build = options.build || buildSnapshot;
    this.send = options.send || sendSnapshot;
    this.readStatus = options.status || readNodeStatus;
    this.heartbeat = options.heartbeat || sendHeartbeat;
    this.now = options.now || Date.now;
    this.lastHeartbeatAt = 0;
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
    const config = { ...this.config, signal: this.controller.signal };
    let phase = 'status';
    try {
      const status = await this.readStatus(config, this.datadir, this.network);
      if (this.stopped) return;
      const identity = `${status.height}:${status.tip}`;
      if (identity !== this.lastTip) {
        phase = 'snapshot';
        this.report({ state: 'exporting' });
        const snapshot = await this.build(config, this.datadir, this.network, undefined, this.controller.signal);
        if (this.stopped) return;
        phase = 'upload';
        this.report({ state: 'uploading' });
        await this.send(this.config, snapshot, undefined, this.controller.signal);
        if (this.stopped) return;
        this.lastTip = `${snapshot.tip.height}:${snapshot.tip.tip}`;
        this.report({ lastPublishedAt: Date.now(), lastHeight: snapshot.tip.height });
      }
      if (!this.stopped && identity === this.lastTip && this.now() - this.lastHeartbeatAt >= (this.config.heartbeatMs || 30000)) {
        phase = 'heartbeat';
        await this.heartbeat(config, status);
        this.lastHeartbeatAt = this.now();
      }
      this.report({ state: 'current', error: null });
    } catch (error) {
      if (!this.stopped) {
        if (error.authoritative) {
          this.stop();
          this.report({ state: 'delegated', error: null });
          return;
        }
        if (error.status === 409) this.lastTip = '';
        const http = /^Explorer ingest failed \(HTTP \d{3}\)\.$/.test(error.message) ? error.message : '';
        this.report({ state: 'error', error: http || (phase === 'status'
          ? 'Read-only node status is unavailable. Publishing is waiting for the local node.' : phase === 'snapshot'
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
  sendSnapshot,
  readNodeStatus,
  sendHeartbeat
};
