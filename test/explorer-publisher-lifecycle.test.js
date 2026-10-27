const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ExplorerPublisher, readNodeStatus, sendHeartbeat, runLxe } = require('../explorer-publisher');

const tip = (height = 3, hash = 'ab'.repeat(32)) => ({ network: 'shadow', height, tip: hash, chain_work: '01'.repeat(32) });
function publisher(options = {}) {
  const p = new ExplorerPublisher({ heartbeatMs: 30000, intervalMs: 3000 }, 'fixture', 'shadow', options);
  p.stopped = false;
  p.schedule = () => {};
  return p;
}

test('unchanged chain skips expensive exports while independently renewing freshness', async () => {
  let time = 100000, builds = 0, uploads = 0, heartbeats = 0;
  const p = publisher({ now: () => time, status: async () => tip(),
    build: async () => { builds++; return { tip: tip() }; },
    send: async () => uploads++, heartbeat: async () => heartbeats++ });
  for (let i = 0; i < 21; i++) { await p.tick(); time += 3000; }
  assert.equal(builds, 1);
  assert.equal(uploads, 1);
  assert.equal(heartbeats, 3);
});

test('same-height reorg and chain reset both invalidate the publisher cursor', async () => {
  let current = tip(), builds = 0;
  const p = publisher({ status: async () => current, heartbeat: async () => {},
    build: async () => { builds++; return { tip: current }; }, send: async () => {} });
  await p.tick();
  current = tip(3, 'cd'.repeat(32)); await p.tick();
  current = tip(0, 'ef'.repeat(32)); await p.tick();
  assert.equal(builds, 3);
});

test('failed upload is retried and an unavailable node never produces a freshness claim', async () => {
  let uploads = 0, builds = 0, offline = false, heartbeats = 0;
  const p = publisher({ status: async () => { if (offline) throw new Error('offline fixture'); return tip(); },
    build: async () => { builds++; return { tip: tip() }; },
    send: async () => { if (++uploads === 1) throw new Error('network fixture'); },
    heartbeat: async () => heartbeats++ });
  await p.tick(); assert.equal(p.lastTip, '');
  await p.tick(); assert.equal(builds, 2); assert.equal(heartbeats, 1);
  offline = true; await p.tick();
  assert.equal(builds, 2); assert.equal(heartbeats, 1);
});

test('receiver cursor loss causes a new snapshot on the next cycle', async () => {
  let time = 100000, builds = 0, conflict = false;
  const p = publisher({ now: () => time, status: async () => tip(),
    build: async () => { builds++; return { tip: tip() }; }, send: async () => {},
    heartbeat: async () => { if (conflict) throw Object.assign(new Error('lost receiver state'), { status: 409 }); } });
  await p.tick(); time += 30000; conflict = true; await p.tick();
  assert.equal(p.lastTip, '');
  conflict = false; await p.tick(); assert.equal(builds, 2);
});

test('authoritative server index stops optional desktop publishing without retry work', async () => {
  let builds = 0;
  const p = publisher({ status: async () => tip(),
    build: async () => { builds++; return { tip: tip() }; },
    send: async () => { throw Object.assign(new Error('server index'), { status: 409, authoritative: true }); } });
  await p.tick(); await p.tick();
  assert.equal(p.stopped, true);
  assert.equal(builds, 1);
});

test('stop aborts in-flight work and prevents upload after a completed build', async () => {
  let release, receivedSignal, uploads = 0;
  const p = publisher({ status: async () => tip(),
    build: async config => { receivedSignal = config.signal; return new Promise(resolve => { release = resolve; }); },
    send: async () => uploads++, heartbeat: async () => {} });
  const running = p.tick();
  await new Promise(resolve => setImmediate(resolve));
  p.stop(); assert.equal(receivedSignal.aborted, true);
  release({ tip: tip() }); await running;
  assert.equal(uploads, 0);
});

test('read-only STATUS uses only its scoped token and refuses remote endpoints', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laser-status-test-'));
  const credential = Buffer.alloc(32, 0x42);
  await fs.writeFile(path.join(dir, 'rpc.read.token'), credential);
  await fs.writeFile(path.join(dir, 'rpc.token'), Buffer.alloc(32, 0x43));
  let request;
  const server = net.createServer(socket => socket.once('data', bytes => {
    request = bytes.toString();
    socket.end(`OK network=shadow height=3 tip=${tip().tip} chain_work=${tip().chain_work}\n`);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true }); });
  const result = await readNodeStatus({ rpc: `127.0.0.1:${server.address().port}` }, dir, 'shadow');
  assert.deepEqual(result, tip());
  assert.equal(request, `${credential.toString('hex')} STATUS\n`);
  await assert.rejects(readNodeStatus({ rpc: '192.0.2.1:19544' }, dir, 'shadow'), /loopback/);
  await assert.rejects(readNodeStatus({ rpc: `127.0.0.1:${server.address().port}` }, dir, 'regtest'), /identity/);
});

test('heartbeat is authenticated, bounded and rejects redirects and stale receiver identity', async () => {
  let call;
  await sendHeartbeat({ url: 'https://example.invalid/api/ingest', token: 'fixture' }, tip(), async (url, options) => {
    call = { url, options }; return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.equal(call.url, 'https://example.invalid/api/heartbeat');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers.Authorization, 'Bearer fixture');
  assert.equal(JSON.parse(call.options.body).tip.tip, tip().tip);
  assert.ok(call.options.signal);
  await assert.rejects(sendHeartbeat({ url: 'https://example.invalid', token: 'fixture' }, tip(), async () => ({ ok: false, status: 409 })), error => error.status === 409);
});

test('native snapshot integers survive the helper JSON boundary exactly', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laser-exact-snapshot-'));
  t.after(() => fs.rm(dir, { recursive: true }));
  const fixture = path.join(dir, 'output.cjs');
  await fs.writeFile(fixture, 'process.stdout.write(\'{"nonce":18446744073709551615,"balance_photons":9007199254740993}\')');
  const parsed = await runLxe(process.execPath, dir, 'shadow', [fixture]);
  assert.equal(parsed.nonce, '18446744073709551615');
  assert.equal(parsed.balance_photons, '9007199254740993');
});
