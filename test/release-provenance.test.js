'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const p = require('../scripts/runtime-provenance');
const { verify } = require('../scripts/release-provenance');

function fixture() {
  const components = Object.fromEntries(Object.entries(p.REQUIRED).map(([component, files]) => {
    const receipt = { format: p.FORMAT, component,
      sources: [{ commit: 'a'.repeat(40), content_sha256: 'b'.repeat(64), files: 5 }],
      tools: [{ name: 'compiler.exe', sha256: 'c'.repeat(64), version: 'fixture' }],
      commands: [['compiler', 'input.c']],
      outputs: files.map(file => ({ file, bytes: 256, sha256: 'd'.repeat(64) })) };
    return [component, { receipt, sha256: p.sha256(JSON.stringify(receipt, null, 2) + '\n') }];
  }));
  const record = { format: 'laser-core-provenance-v1', desktop_commit: 'e'.repeat(40), package_lock_sha256: 'f'.repeat(64),
    app_asar_sha256: '1'.repeat(64), components,
    app_files: Array.from({ length: 12 }, (_, i) => ({ file: 'renderer/' + i + '.js', sha256: '2'.repeat(64) })) };
  const info = { source_commit: record.desktop_commit, source_dirty: 'false', node_source_commit: 'a'.repeat(40),
    sandbox_source_commit: 'a'.repeat(40), cuda_miner_sha256: 'd'.repeat(64), explorer_helper_sha256: 'd'.repeat(64),
    runtime_provenance_sha256: components.v3.sha256 };
  return { record, info };
}

test('release provenance cross-checks all native components and clean desktop identity', () => {
  const { record, info } = fixture();
  assert.equal(verify(record, info), record);
  for (const key of ['source_commit', 'source_dirty', 'node_source_commit', 'sandbox_source_commit', 'cuda_miner_sha256', 'explorer_helper_sha256', 'runtime_provenance_sha256']) {
    assert.throws(() => verify(record, { ...info, [key]: 'wrong' }), /differs|identity/);
  }
});

test('release provenance rejects missing or changed receipts and unsafe application inventories', () => {
  const { record, info } = fixture();
  for (const mutate of [r => delete r.components.explorer, r => r.components.v3.receipt.commands[0].push('unrecorded'),
    r => r.components.v3.receipt.outputs.pop(), r => r.app_files[0].file = '../wallet.key',
    r => r.app_files[0].file = '/absolute', r => r.app_files[1] = r.app_files[0]]) {
    const copy = structuredClone(record); mutate(copy);
    assert.throws(() => verify(copy, info), /provenance|receipt|inventory/);
  }
});
