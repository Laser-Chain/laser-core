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
    resourcesPath: 'C:\\app\\resources'
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

test('snapshot builder exports the complete active chain and details tx blocks', async () => {
  const calls = [];
  const run = async (_binary, _datadir, _network, args) => {
    calls.push(args);
    if (args[0] === 'tip') {
      return { network: 'shadow', height: 2, tip: 'tip-2' };
    }
    if (args[0] === 'blocks') {
      return {
        height: 2,
        blocks: [
          { height: 2, hash: 'tip-2', tx_count: 0 },
          { height: 1, hash: 'block-1', tx_count: 1 },
          { height: 0, hash: 'genesis', tx_count: 0 }
        ]
      };
    }
    if (args[0] === 'block') {
      return {
        height: 1,
        hash: 'block-1',
        tx_count: 1,
        transactions: [{ nonce: 0 }]
      };
    }
    if (args[0] === 'accounts') return { count: 1, accounts: [] };
    if (args[0] === 'economics') return { tip_height: 2 };
    throw new Error(`Unexpected command ${args.join(' ')}`);
  };

  const snapshot = await buildSnapshot(
    { lxe: 'lxe' },
    'node-shadow',
    'shadow',
    run
  );
  assert.equal(snapshot.schema, 1);
  assert.deepEqual(snapshot.blocks.map(block => block.height), [2, 1, 0]);
  assert.deepEqual(snapshot.blocks[0].transactions, []);
  assert.equal(snapshot.blocks[1].transactions.length, 1);
  assert.equal(calls.filter(args => args[0] === 'block').length, 1);
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
