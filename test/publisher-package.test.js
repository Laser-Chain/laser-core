'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { beforePack, verifyArchive, verifyRuntime, MODULES } = require('../scripts/verify-publisher-package');

test('every package target runs publisher checks and ships its modules, helper and identity', () => {
  const pkg = require('../package.json');
  assert.equal(require('../' + pkg.build.beforePack), beforePack);
  assert.equal(require('../' + pkg.build.afterPack), require('../scripts/verify-publisher-package').afterPack);
  for (const module of MODULES) assert.ok(pkg.build.files.includes(module));
  for (const name of ['lxe.exe', 'BUILDINFO.txt']) assert.ok(pkg.build.extraResources.some(r => r.to === 'bin/explorer/' + name));
});

test('packaging rejects missing, tampered, or wrong-platform native helpers', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-publisher-package-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('laser-publisher-package-')); fs.rmSync(root, { recursive: true, force: true }); });
  const dir = path.join(root, '.runtime', 'explorer'); fs.mkdirSync(dir, { recursive: true });
  const context = { packager: { info: { appDir: root } }, electronPlatformName: 'win32', arch: 1 };
  assert.throws(() => beforePack(context), /incomplete/);
  const exe = Buffer.alloc(256); exe.write('MZ'); exe.writeUInt32LE(128, 0x3c); exe.write('PE\0\0', 128); exe.writeUInt16LE(0x8664, 132);
  fs.writeFileSync(path.join(dir, 'lxe.exe'), exe);
  const hash = createHash('sha256').update(exe).digest('hex');
  fs.writeFileSync(path.join(dir, 'BUILDINFO.txt'), 'lxe_sha256=' + hash + '\n');
  assert.equal(beforePack(context), hash);
  exe[200] = 1; fs.writeFileSync(path.join(dir, 'lxe.exe'), exe);
  assert.throws(() => verifyRuntime(dir), /does not match/);
  exe.writeUInt16LE(0x14c, 132); fs.writeFileSync(path.join(dir, 'lxe.exe'), exe);
  assert.throws(() => verifyRuntime(dir), /Windows x64/);
  assert.throws(() => beforePack({ ...context, electronPlatformName: 'linux' }), /another platform/);
});

test('archive verification rejects omitted publisher modules and credential files', () => {
  const files = [...MODULES, 'main.js', 'preload.js'];
  const read = () => Buffer.from("require('./explorer-publisher-service')");
  verifyArchive(files, read);
  assert.throws(() => verifyArchive(files.filter(f => f !== MODULES[0]), read), /missing/);
  for (const forbidden of ['explorer-publish.json', 'explorer-publisher.json', '.env', 'renderer/.env.local', 'explorer-publisher.json.x.tmp']) {
    assert.throws(() => verifyArchive([...files, forbidden], read), /must not be packaged/);
  }
  assert.throws(() => verifyArchive(files, () => Buffer.from('old main process')), /does not load/);
});
