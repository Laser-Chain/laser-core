const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolvePublisherConfig(options = {}) {
  const env = options.env || process.env;
  const appDir = options.appDir || __dirname;
  const userData = options.userData || '';
  const resourcesPath = options.resourcesPath || '';
  const exists = options.exists || fs.existsSync;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const fileConfig = [
    env.LASER_EXPLORER_CONFIG,
    userData && path.join(userData, 'explorer-publish.json'),
    path.join(appDir, 'explorer-publish.json')
  ].filter(Boolean).map(readJson).find(Boolean) || {};
  const url = env.LASER_EXPLORER_URL || fileConfig.url || '';
  const token = env.LASER_EXPLORER_TOKEN || fileConfig.token || '';
  const candidates = [
    env.LXE_BIN,
    fileConfig.lxe,
    resourcesPath && path.join(resourcesPath, 'bin', 'explorer', 'lxe' + suffix)
  ].filter(Boolean);
  const lxe = candidates.find(candidate => exists(candidate));
  const requestedInterval = Number(
    fileConfig.interval_ms || env.LASER_EXPLORER_INTERVAL_MS || 10000
  );
  const intervalMs = Number.isFinite(requestedInterval)
    ? Math.max(3000, Math.min(requestedInterval, 600000))
    : 10000;
  if (!url || !token || !lxe) return null;
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:') return null;
    return { url: endpoint.href, token, lxe, intervalMs };
  } catch (_) {
    return null;
  }
}

function runLxe(binary, datadir, network, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [...args, '--datadir', datadir, '--network', network],
      { encoding: 'utf8', timeout, windowsHide: true },
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

async function buildSnapshot(config, datadir, network, run = runLxe) {
  const tip = await run(config.lxe, datadir, network, ['tip']);
  const blocks = [];
  let from = Number(tip.height);
  while (from >= 0) {
    const page = await run(
      config.lxe,
      datadir,
      network,
      ['blocks', '--limit', '500', '--from', String(from)]
    );
    if (!Array.isArray(page.blocks) || page.blocks.length === 0) break;
    for (const header of page.blocks) {
      const block = Number(header.tx_count) > 0
        ? await run(config.lxe, datadir, network, ['block', String(header.height)])
        : { ...header, transactions: [] };
      blocks.push(block);
    }
    const oldest = Math.min(...page.blocks.map(block => Number(block.height)));
    if (oldest <= 0) break;
    from = oldest - 1;
  }
  const expected = Number(tip.height) + 1;
  const heights = new Set(blocks.map(block => Number(block.height)));
  if (blocks.length !== expected || heights.size !== expected) {
    throw new Error(`Incomplete explorer snapshot: expected ${expected} blocks, got ${blocks.length}`);
  }
  const [accounts, economics] = await Promise.all([
    run(config.lxe, datadir, network, ['accounts']),
    run(config.lxe, datadir, network, ['economics'])
  ]);
  return { schema: 1, generated_at: Date.now(), tip, blocks, accounts, economics };
}

async function sendSnapshot(config, snapshot, request = globalThis.fetch) {
  if (typeof request !== 'function') throw new Error('HTTPS fetch is unavailable');
  const response = await request(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Explorer ingest failed (${response.status}): ${body.slice(0, 240)}`);
  }
  return await response.json();
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
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delay) {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const snapshot = await this.build(this.config, this.datadir, this.network);
      const identity = `${snapshot.tip.height}:${snapshot.tip.tip}`;
      if (identity !== this.lastTip) {
        await this.send(this.config, snapshot);
        this.lastTip = identity;
        console.log(`[explorer-publisher] mirrored height ${snapshot.tip.height}`);
      }
    } catch (error) {
      console.warn('[explorer-publisher]', error.message);
    } finally {
      this.running = false;
      this.schedule(this.config.intervalMs);
    }
  }
}

module.exports = {
  ExplorerPublisher,
  buildSnapshot,
  resolvePublisherConfig,
  runLxe,
  sendSnapshot
};
