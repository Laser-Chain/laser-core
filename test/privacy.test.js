'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { privacyConfig, requireProxyCapability, restrictBrowserNetworking, blockWebRequests } = require('../privacy');
const { resolveRuntime, buildNodeArgs } = require('../runtime-config');
const { PublisherService } = require('../explorer-publisher-service');

function runtime(extra = {}) {
  return resolveRuntime({ appDir: path.resolve('fixture-app'), isPackaged: true,
    userData: path.resolve('fixture-profile'), exists: () => true,
    readFile: () => { const e = new Error(); e.code = 'ENOENT'; throw e; },
    env: { LASER_PRIVACY: 'tor', ...extra } });
}

test('Tor configuration is opt-in and rejects ambiguous or remote proxies', () => {
  assert.equal(privacyConfig({}).enabled, false);
  for (const proxy of ['127.0.0.1:9050', '[::1]:9150']) assert.equal(privacyConfig({ LASER_PRIVACY: 'tor', LASER_TOR_PROXY: proxy }).error, null);
  for (const proxy of ['localhost:9050', '127.0.0.1:0', '127.0.0.1:65536', '192.0.2.1:9050', '127.0.0.1:9050x']) {
    assert.ok(runtime({ LASER_TOR_PROXY: proxy }).error);
    assert.throws(() => buildNodeArgs(runtime({ LASER_TOR_PROXY: proxy })));
  }
  assert.ok(privacyConfig({ LASER_TOR_PROXY: '127.0.0.1:9050' }).error);
  assert.ok(privacyConfig({ LASER_PRIVACY: 'tor', LASER_ONION_ONLY: 'yes' }).error);
  assert.equal(privacyConfig({ LASER_PRIVACY: 'typo' }).enabled, true);
});

test('Tor runtime has its own chain directory and no inbound or advertised address', () => {
  const r = runtime();
  assert.equal(r.error, null);
  assert.equal(path.basename(r.dataDir), 'shadownet-tor');
  assert.equal(r.listen, 'none'); assert.equal(r.advertise, null);
  assert.equal(r.rpc, '127.0.0.1:29544');
  const args = buildNodeArgs(r);
  assert.equal(args[args.indexOf('--proxy') + 1], '127.0.0.1:9050');
  assert.equal(args[args.indexOf('--listen') + 1], 'none');
  assert.ok(!args.includes('--advertise'));
  for (const extra of [{ LASER_LISTEN: '0.0.0.0:19333' }, { LASER_ADVERTISE: 'home.example:19333' },
    { LASER_RPC: 'localhost:19544' }, { LASER_RPC: '192.0.2.1:19544' }, { LASER_CHANNEL: 'sandbox-v2' }]) {
    assert.ok(runtime(extra).error, JSON.stringify(extra));
  }
});

test('onion-only mode requires explicit onion peers, with no clearnet seed fallback', () => {
  assert.ok(runtime({ LASER_ONION_ONLY: '1' }).error);
  assert.ok(runtime({ LASER_ONION_ONLY: '1', LASER_PEERS: '' }).error);
  const r = runtime({ LASER_ONION_ONLY: '1', LASER_PEERS: 'a'.repeat(56) + '.onion:19333' });
  assert.equal(r.error, null);
  assert.ok(buildNodeArgs(r).includes('--onion-only'));
  assert.equal(r.peers.length, 1);
});

test('old or failing runtimes cannot silently drop Tor configuration', () => {
  const r = runtime(); let calls = 0;
  requireProxyCapability(r, (_file, args, options) => {
    calls++; assert.deepEqual(args, ['--capabilities']); assert.equal(options.timeout, 5000);
    return 'proxy=socks5-isolated-v1\n';
  });
  assert.equal(calls, 1);
  for (const output of ['', 'proxy=socks5-isolated-v0\n', 'prefix proxy=socks5-isolated-v1\n']) {
    assert.throws(() => requireProxyCapability(r, () => output), /No node was started/);
  }
  assert.throws(() => requireProxyCapability(r, () => { throw new Error('old runtime'); }), /No node was started/);
  requireProxyCapability({ privacy: { enabled: false } }, () => assert.fail('direct mode must not require new native flags'));
});

test('Tor publisher policy runs before loading or migrating stored credentials', () => {
  const service = new PublisherService({ privacy: { enabled: true }, appDir: '.', userData: '.',
    exists: () => false,
    settings: { load() { assert.fail('credentials must not be loaded'); }, save() { assert.fail('settings must not change'); } },
    makePublisher() { assert.fail('network publisher must not be created'); } });
  assert.equal(service.initialize(true).privacyBlocked, true);
  service.setNodeReady(false); service.setNodeReady(true); service.restart();
  assert.equal(service.status().enabled, false);
  assert.throws(() => service.save({ enabled: true }), /unavailable in Tor mode/);
  assert.throws(() => service.save({ enabled: false }), /Saved settings have been left alone/);
  service.stop();
});

test('private browser sessions block network requests and hostname resolution before windows open', () => {
  let listener, created, switchValue;
  const browserSession = { webRequest: { onBeforeRequest(fn) { listener = fn; } } };
  const app = { commandLine: { appendSwitch(key, value) { assert.equal(key, 'host-resolver-rules'); switchValue = value; } },
    on(event, fn) { assert.equal(event, 'session-created'); created = fn; } };
  restrictBrowserNetworking(app, {}, { enabled: true });
  assert.equal(switchValue, 'MAP * ~NOTFOUND'); created(browserSession);
  for (const url of ['https://public.invalid/', 'http://127.0.0.1:1234/', 'ws://public.invalid/', 'wss://public.invalid/', 'ftp://public.invalid/', 'invalid']) {
    listener({ url }, result => assert.equal(result.cancel, true, url));
  }
  blockWebRequests(browserSession);
  for (const url of ['laser-core://app/index.html', 'file:///fixture.css', 'data:text/plain,hello', 'blob:laser-core://app/id']) {
    listener({ url }, result => assert.equal(result.cancel, false, url));
  }
});

test('distributed app includes the Tor policy and visibly distinguishes it from anonymity', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('privacy.js'));
  const ui = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  assert.ok(ui.includes('Tor mode'));
  assert.ok(ui.includes('Mining rewards and account activity remain public'));
});
