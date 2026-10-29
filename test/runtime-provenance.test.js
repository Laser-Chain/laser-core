'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const p = require('../scripts/runtime-provenance');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-build-receipt-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('laser-build-receipt-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const binary = Buffer.alloc(256);
  binary.write('MZ'); binary.writeUInt32LE(128, 60); binary.write('PE\0\0', 128); binary.writeUInt16LE(0x8664, 132);
  const receipt = {
    format: p.FORMAT, component: 'explorer',
    sources: [{ commit: 'a'.repeat(40), content_sha256: 'b'.repeat(64), files: 3 }],
    tools: [{ name: 'gcc.exe', sha256: 'c'.repeat(64), version: 'test compiler' }],
    commands: [['gcc', 'src/lxe.c']],
    outputs: [{ file: 'lxe.exe', bytes: binary.length, sha256: p.sha256(binary) }]
  };
  fs.writeFileSync(path.join(root, 'lxe.exe'), binary);
  function save() {
    fs.writeFileSync(path.join(root, p.RECEIPT), JSON.stringify(receipt));
    fs.writeFileSync(path.join(root, 'BUILDINFO.txt'), 'source_commit=' + receipt.sources[0].commit + '\n' +
      'lxe_sha256=' + receipt.outputs[0].sha256 + '\nprovenance_sha256=' + p.fileHash(path.join(root, p.RECEIPT)) + '\n');
  }
  save();
  return { root, receipt, binary, save };
}

test('build receipts bind binary bytes, inventory and Windows architecture', t => {
  const f = fixture(t);
  assert.equal(p.verifyDirectory(f.root, 'explorer').receipt.component, 'explorer');
  f.binary[200] = 1;
  fs.writeFileSync(path.join(f.root, 'lxe.exe'), f.binary);
  assert.throws(() => p.verifyDirectory(f.root, 'explorer'), /differs/);
  f.receipt.outputs[0].sha256 = p.sha256(f.binary); f.save();
  f.binary.writeUInt16LE(0x14c, 132);
  fs.writeFileSync(path.join(f.root, 'lxe.exe'), f.binary);
  f.receipt.outputs[0].sha256 = p.sha256(f.binary); f.save();
  assert.throws(() => p.verifyDirectory(f.root, 'explorer'), /Windows x64/);
});

test('receipts reject missing identities, traversal, duplicate outputs and component confusion', t => {
  const { receipt } = fixture(t);
  for (const mutate of [r => r.sources[0].commit = '', r => r.sources[0].files = 0,
    r => r.outputs[0].file = '../lxe.exe', r => r.outputs.push(r.outputs[0]),
    r => r.tools[0].sha256 = '', r => r.commands[0].push('bad\ncommand'),
    r => r.patches = [{ file: '../secret.patch', sha256: 'd'.repeat(64) }]]) {
    const copy = structuredClone(receipt); mutate(copy);
    assert.throws(() => p.verifyReceipt(copy, 'explorer'), /Invalid runtime provenance/);
  }
  assert.throws(() => p.verifyReceipt(receipt, 'v3'), /component/);
});

test('unrecorded runtime files and changed receipt bindings stop packaging', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'BUILDINFO.txt'), 'provenance_sha256=' + 'f'.repeat(64));
  assert.throws(() => p.verifyDirectory(f.root, 'explorer'), /does not bind/);
  f.save(); fs.writeFileSync(path.join(f.root, 'unexpected.exe'), f.binary);
  assert.throws(() => p.verifyDirectory(f.root, 'explorer'), /inventory/);
});

test('source input digests are deterministic and change with file contents', t => {
  const { root } = fixture(t);
  const first = p.sourceManifest(root);
  assert.deepEqual(first, p.sourceManifest(root));
  fs.appendFileSync(path.join(root, 'BUILDINFO.txt'), 'changed');
  assert.notEqual(p.sha256(JSON.stringify(first)), p.sha256(JSON.stringify(p.sourceManifest(root))));
});
