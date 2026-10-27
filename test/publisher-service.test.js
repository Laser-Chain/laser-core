'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PublisherSettings, validateEndpoint, validateToken } = require('../explorer-publisher-settings');
const { PublisherService } = require('../explorer-publisher-service');
const { ExplorerPublisher, sendSnapshot } = require('../explorer-publisher');

const url = 'https://explorer.invalid/api/ingest';
const token = 'fixture-only-token';
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-publisher-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('laser-publisher-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const encrypted = new Map();
  const options = { userData: root, appDir: root, env: {}, resourcesPath: path.join(root, 'extract-1'),
    network: 'shadow', datadir: path.join(root, 'chain'), exists: candidate => candidate.includes(path.join('bin', 'explorer')),
    safeStorage: { isEncryptionAvailable: () => true,
      encryptString: text => { const id = Buffer.from('ciphertext-' + encrypted.size); encrypted.set(id.toString(), text); return id; },
      decryptString: bytes => { if (!encrypted.has(bytes.toString())) throw new Error('unreadable'); return encrypted.get(bytes.toString()); } },
    ...extra };
  const jobs = [];
  options.makePublisher = (config, datadir, network, callbacks) => {
    const job = { config, datadir, network, callbacks, starts: 0, stops: 0,
      start() { this.starts++; callbacks.onStatus({ state: 'exporting' }); }, stop() { this.stops++; } };
    jobs.push(job); return job;
  };
  const service = new PublisherService(options);
  return { root, options, jobs, service };
}

test('launch credentials migrate once and survive an environment-free portable restart', t => {
  const h = fixture(t, { env: { LASER_EXPLORER_URL: url, LASER_EXPLORER_TOKEN: token } });
  h.service.initialize(true);
  assert.equal(h.jobs.length, 1);
  const saved = fs.readFileSync(path.join(h.root, 'explorer-publisher.json'), 'utf8');
  assert.ok(!saved.includes(token));
  assert.ok(!saved.includes('extract-1'));
  assert.ok(!JSON.stringify(h.service.status()).includes(token));
  const next = new PublisherService({ ...h.options, env: {}, resourcesPath: path.join(h.root, 'extract-2') });
  next.initialize(true);
  assert.equal(h.jobs[1].config.token, token);
  assert.ok(h.jobs[1].config.lxe.includes('extract-2'));
  assert.equal(next.status().enabled, true);
});

test('legacy file settings migrate, with explicit corrupt and missing-file errors', t => {
  const h = fixture(t);
  fs.writeFileSync(path.join(h.root, 'explorer-publish.json'), JSON.stringify({ url, token }));
  h.service.initialize(true);
  assert.equal(h.jobs[0].config.token, token);
  fs.writeFileSync(path.join(h.root, 'explorer-publisher.json'), '{broken');
  const next = new PublisherService(h.options);
  assert.equal(next.initialize(true).state, 'error');
  next.setNodeReady(false); next.setNodeReady(true);
  assert.equal(next.status().state, 'error');
  assert.equal(h.jobs.length, 1);
  next.save({ enabled: true, url, token });
  assert.equal(h.jobs.length, 2);
  assert.throws(() => new PublisherSettings({ ...h.options, userData: path.join(h.root, 'new'),
    env: { LASER_EXPLORER_CONFIG: path.join(h.root, 'missing') } }).load(), /file is missing/);
});

test('fresh installations expose an unconfigured publisher and disabling persists over old launch credentials', t => {
  const h = fixture(t);
  assert.equal(h.service.initialize(true).state, 'unconfigured');
  assert.equal(h.service.status().helperAvailable, true);
  h.service.save({ enabled: true, url, token });
  h.service.save({ enabled: false });
  assert.equal(h.jobs[0].stops, 1);
  const next = new PublisherService({ ...h.options, env: { LASER_EXPLORER_URL: url, LASER_EXPLORER_TOKEN: token } });
  assert.equal(next.initialize(true).enabled, false);
  assert.equal(h.jobs.length, 1);
  assert.ok(!fs.readFileSync(path.join(h.root, 'explorer-publisher.json'), 'utf8').includes('token'));
});

test('missing helpers and offline nodes are actionable and publishing starts once the node recovers', t => {
  const h = fixture(t);
  h.service.initialize(false);
  assert.equal(h.service.save({ enabled: true, url, token }).state, 'waiting-node');
  assert.equal(h.jobs.length, 0);
  h.service.setNodeReady(true); h.service.setNodeReady(true);
  assert.equal(h.jobs.length, 1);
  h.service.setNodeReady(false);
  assert.equal(h.jobs[0].stops, 1);
  h.jobs[0].callbacks.onStatus({ state: 'current' });
  assert.equal(h.service.status().state, 'waiting-node');
  h.service.setNodeReady(true);
  assert.equal(h.jobs.length, 2);
  const missing = new PublisherService({ ...h.options, exists: () => false });
  assert.match(missing.initialize(true).error, /helper is missing/);
});

test('endpoint changes require a new token and invalid edits preserve the working configuration', t => {
  const h = fixture(t); h.service.initialize(true);
  h.service.save({ enabled: true, url, token });
  h.service.save({ enabled: true, url, token: '' });
  assert.equal(h.jobs[1].config.token, token);
  assert.throws(() => h.service.save({ enabled: true, url: 'https://other.invalid/ingest', token: '' }), /token/);
  assert.equal(h.service.status().url, url);
  assert.equal(h.jobs[1].stops, 0);
  for (const endpoint of ['http://explorer.invalid', 'https://user:secret@explorer.invalid', url + '?token=x', url + '#secret']) {
    assert.throws(() => validateEndpoint(endpoint), /HTTPS ingest URL/);
  }
  for (const invalid of ['', 'a\nb', 'has space', 'x'.repeat(4097), {}]) assert.throws(() => validateToken(invalid), /token/);
});

test('unavailable encryption fails without writing plaintext and tokens cannot migrate across networks', t => {
  const h = fixture(t); h.service.initialize(true);
  h.options.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => h.service.save({ enabled: true, url, token }), /Secure credential storage/);
  assert.equal(fs.existsSync(path.join(h.root, 'explorer-publisher.json')), false);
  h.options.safeStorage.isEncryptionAvailable = () => true;
  h.options.safeStorage.getSelectedStorageBackend = () => 'basic_text';
  assert.throws(() => h.service.save({ enabled: true, url, token }), /Secure credential storage/);
  delete h.options.safeStorage.getSelectedStorageBackend;
  h.service.save({ enabled: true, url, token });
  const next = new PublisherService({ ...h.options, network: 'regtest' });
  assert.match(next.initialize(true).error, /different network/);
  assert.equal(h.jobs.length, 1);
});

function publisher(t, callbacks) {
  const p = new ExplorerPublisher({ url, token, intervalMs: 3000 }, 'fixture-chain', 'shadow', {
    status: async () => ({height: 4, tip: 'hash-4'}), heartbeat: async () => {}, ...callbacks });
  p.schedule = delay => { p.scheduled = delay; };
  p.start(); t.after(() => p.stop()); return p;
}
const snapshot = { tip: { height: 4, tip: 'hash-4' } };

test('publisher retries failed uploads, reports delivery separately, and avoids duplicate successful snapshots', async t => {
  let sends = 0;
  const p = publisher(t, { build: async () => snapshot, send: async () => { if (++sends === 1) throw new Error(token); } });
  await p.tick();
  assert.equal(p.status.state, 'error'); assert.equal(p.lastTip, '');
  assert.ok(!p.status.error.includes(token)); assert.equal(p.scheduled, 3000);
  await p.tick();
  assert.equal(p.status.state, 'current'); assert.equal(p.status.lastHeight, 4); assert.ok(p.status.lastPublishedAt);
  await p.tick(); assert.equal(sends, 2);
});

test('stopping during an export aborts work and prevents a late upload', async t => {
  let finish, signal, sends = 0;
  const p = publisher(t, { build: (_c, _d, _n, _r, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); }, send: async () => sends++ });
  const pending = p.tick(); await new Promise(resolve => setImmediate(resolve)); p.stop(); finish(snapshot); await pending;
  assert.equal(signal.aborted, true); assert.equal(sends, 0); assert.equal(p.status.state, 'stopped');
});

test('uploads reject redirects, accept cancellation, and never surface response bodies or false acknowledgements', async () => {
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(sendSnapshot({ url, token }, snapshot, async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.signal.aborted, true);
    return { ok: false, status: 401, text: async () => token };
  }, cancel.signal), error => error.message === 'Explorer ingest failed (HTTP 401).');
  await assert.rejects(sendSnapshot({ url, token }, snapshot, async () => ({ ok: true, json: async () => ({ ok: false }) })), /acknowledge/);
});
