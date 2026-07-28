const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildSnapshot,
  resolvePublisherConfig,
  sendSnapshot
} = require('../explorer-publisher');

test('packaged publisher resolves the bundled explorer binary', () => {
  const config = resolvePublisherConfig({
    env: {
      LASER_EXPLORER_URL: 'https://explorer.invalid/api/ingest',
      LASER_EXPLORER_TOKEN: 'secret'
    },
    appDir: 'C:\\app\\resources\\app.asar',
    resourcesPath: 'C:\\app\\resources',
    exists: candidate => candidate.includes(path.join('bin', 'explorer'))
  });
  assert.equal(
    config.lxe,
    path.join(
      'C:\\app\\resources',
      'bin',
      'explorer',
      process.platform === 'win32' ? 'lxe.exe' : 'lxe'
    )
  );
});

test('publisher rejects plaintext endpoints and missing helper binaries', () => {
  const base = {
    LASER_EXPLORER_TOKEN: 'secret',
    LXE_BIN: 'lxe'
  };
  assert.equal(resolvePublisherConfig({
    env: { ...base, LASER_EXPLORER_URL: 'http://explorer.invalid/ingest' },
    exists: () => true
  }), null);
  assert.equal(resolvePublisherConfig({
    env: { ...base, LASER_EXPLORER_URL: 'https://explorer.invalid/ingest' },
    exists: () => false
  }), null);
});

test('publisher bounds its schedule and rejects non-numeric intervals', () => {
  const options = {
    env: {
      LASER_EXPLORER_URL: 'https://explorer.invalid/ingest',
      LASER_EXPLORER_TOKEN: 'secret',
      LASER_EXPLORER_INTERVAL_MS: 'not-a-number',
      LXE_BIN: 'lxe'
    },
    exists: () => true
  };
  assert.equal(resolvePublisherConfig(options).intervalMs, 3000);
  options.env.LASER_EXPLORER_INTERVAL_MS = '1';
  assert.equal(resolvePublisherConfig(options).intervalMs, 3000);
  options.env.LASER_EXPLORER_INTERVAL_MS = '9999999';
  assert.equal(resolvePublisherConfig(options).intervalMs, 600000);
});

test('snapshot builder exports the complete chain with one helper invocation', async () => {
  const calls = [];
  const expected = {
    schema: 1,
    generated_at: 123,
    tip: { network: 'shadow', height: 2, tip: 'tip-2' },
    blocks: [
      { height: 2, hash: 'tip-2', transactions: [] },
      { height: 1, hash: 'block-1', transactions: [{ nonce: 0 }] },
      { height: 0, hash: 'genesis', transactions: [] }
    ],
    accounts: { count: 1, accounts: [] },
    economics: { tip_height: 2 }
  };
  const run = async (_binary, _datadir, _network, args) => {
    calls.push(args);
    return expected;
  };

  const snapshot = await buildSnapshot(
    { lxe: 'lxe' },
    'node-shadow',
    'shadow',
    run
  );
  assert.deepEqual(snapshot, expected);
  assert.deepEqual(calls, [['snapshot']]);
});

test('snapshot builder rejects incomplete single-pass output', async () => {
  await assert.rejects(
    buildSnapshot(
      { lxe: 'lxe' },
      'node-shadow',
      'shadow',
      async () => ({
        schema: 1,
        tip: { network: 'shadow', height: 2 },
        blocks: [{ height: 2 }],
        accounts: {},
        economics: {}
      })
    ),
    /Invalid explorer snapshot/
  );
});

test('snapshot upload uses bearer authentication', async () => {
  let request;
  const response = await sendSnapshot(
    { url: 'https://explorer.invalid/api/ingest', token: 'secret' },
    { schema: 1 },
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ ok: true })
      };
    }
  );
  assert.equal(request.url, 'https://explorer.invalid/api/ingest');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(response, { ok: true });
});
