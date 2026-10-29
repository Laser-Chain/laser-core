'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const p = require('./runtime-provenance');
const FORMAT = 'laser-core-provenance-v1';

function verify(record, info) {
  if (!record || record.format !== FORMAT || !/^[0-9a-f]{40}$/.test(record.desktop_commit) ||
      !/^[0-9a-f]{64}$/.test(record.package_lock_sha256) || !/^[0-9a-f]{64}$/.test(record.app_asar_sha256)) {
    throw new Error('Invalid release provenance identity.');
  }
  if (record.desktop_commit !== info.source_commit || info.source_dirty !== 'false') throw new Error('Release source differs from provenance.');
  if (JSON.stringify(Object.keys(record.components || {}).sort()) !== JSON.stringify(Object.keys(p.REQUIRED).sort())) throw new Error('Incomplete component provenance.');
  for (const [name, value] of Object.entries(record.components)) {
    p.verifyReceipt(value.receipt, name);
    if (p.sha256(JSON.stringify(value.receipt, null, 2) + '\n') !== value.sha256) throw new Error('Component receipt digest differs.');
  }
  const v3 = record.components.v3.receipt;
  if (v3.sources[0].commit !== info.node_source_commit || record.components['sandbox-v2'].receipt.sources[0].commit !== info.sandbox_source_commit ||
      v3.outputs.find(o => o.file === 'laser-cuda-miner.exe').sha256 !== info.cuda_miner_sha256 ||
      record.components.explorer.receipt.outputs[0].sha256 !== info.explorer_helper_sha256 ||
      info.runtime_provenance_sha256 !== record.components.v3.sha256) throw new Error('Runtime identity differs from release metadata.');
  if (!Array.isArray(record.app_files) || record.app_files.length < 10 ||
      record.app_files.some(f => !f || !/^[A-Za-z0-9_./-]+$/.test(f.file) || f.file.split('/').includes('..') || f.file.startsWith('/') || !/^[0-9a-f]{64}$/.test(f.sha256)) ||
      new Set(record.app_files.map(f => f.file)).size !== record.app_files.length) throw new Error('Invalid application inventory.');
  return record;
}

function create(app, commit) {
  const asar = require('@electron/asar');
  const archive = path.join(app, 'dist/win-unpacked/resources/app.asar');
  const files = asar.listPackage(archive).map(f => f.replaceAll('\\', '/').replace(/^\//, ''))
    .filter(f => !asar.statFile(archive, f).files).sort();
  return { format: FORMAT, desktop_commit: commit, package_lock_sha256: p.fileHash(path.join(app, 'package-lock.json')),
    node_version: process.version, electron_builder_version: require('electron-builder/package.json').version,
    app_asar_sha256: p.fileHash(archive),
    app_files: files.map(file => ({ file, sha256: p.sha256(asar.extractFile(archive, file)) })),
    components: p.verifySet(path.join(app, '.runtime')) };
}

module.exports = { create, verify };
if (require.main === module) {
  try {
    if (process.argv[2] === 'create') {
      const app = path.resolve(__dirname, '..');
      const commit = execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
      fs.writeFileSync(process.argv[3], JSON.stringify(create(app, commit), null, 2) + '\n', { flag: 'wx' });
    } else if (process.argv[2] === 'verify') {
      const directory = path.resolve(process.argv[3]);
      const file = path.join(directory, 'BUILD-PROVENANCE.json');
      if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw new Error('Invalid provenance file size/type.');
      const info = Object.fromEntries(fs.readFileSync(path.join(directory, 'BUILDINFO.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
      verify(JSON.parse(fs.readFileSync(file, 'utf8')), info);
      console.log('Verified release source, runtime and application provenance inventory.');
    } else throw new Error('Usage: release-provenance.js create <output> | verify <release-directory>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
