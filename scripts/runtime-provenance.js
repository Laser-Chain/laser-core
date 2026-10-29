'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RECEIPT = 'BUILD-PROVENANCE.json';
const FORMAT = 'laser-runtime-build-v1';
const REQUIRED = {
  v3: ['laser.exe', 'laserd.exe', 'laser-shadow.exe', 'laser-cuda-miner.exe'],
  'sandbox-v2': ['laser.exe', 'laserd.exe'],
  explorer: ['lxe.exe']
};
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function sourceManifest(root) {
  const result = [];
  function visit(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else {
      if (!stat.isFile()) throw new Error('Build source must contain only regular files.');
      result.push({ file: relative.replaceAll('\\', '/'), bytes: stat.size, sha256: fileHash(full) });
    }
  }
  for (const name of fs.readdirSync(root).sort()) visit(name);
  return result;
}

function verifyReceipt(receipt, component) {
  const fail = message => { throw new Error('Invalid runtime provenance: ' + message); };
  if (!receipt || receipt.format !== FORMAT || receipt.component !== component || !REQUIRED[component]) fail('format/component');
  if (!Array.isArray(receipt.sources) || !receipt.sources.length) fail('sources');
  for (const source of receipt.sources) {
    if (!source || !/^[0-9a-f]{40}$/.test(source.commit) || !isHash(source.content_sha256) ||
        !Number.isSafeInteger(source.files) || source.files < 1) fail('source identity');
  }
  if (!Array.isArray(receipt.tools) || !receipt.tools.length || receipt.tools.some(tool =>
    !tool || !/^[A-Za-z0-9._-]+$/.test(tool.name) || !isHash(tool.sha256) ||
    typeof tool.version !== 'string' || !tool.version.trim())) fail('toolchain');
  if (!Array.isArray(receipt.commands) || !receipt.commands.length || receipt.commands.some(command =>
    !Array.isArray(command) || !command.length || command.some(arg => typeof arg !== 'string' || /[\r\n\0]/.test(arg)))) fail('commands');
  if (!Array.isArray(receipt.outputs) || receipt.outputs.length !== REQUIRED[component].length) fail('output inventory');
  const names = new Set();
  for (const output of receipt.outputs) {
    if (!output || !REQUIRED[component].includes(output.file) || names.has(output.file) ||
        !isHash(output.sha256) || !Number.isSafeInteger(output.bytes) || output.bytes < 64) fail('output identity');
    names.add(output.file);
  }
  if (receipt.patches !== undefined && (!Array.isArray(receipt.patches) || receipt.patches.some(patch =>
    !patch || !/^compat\/[A-Za-z0-9._-]+\.patch$/.test(patch.file) || !isHash(patch.sha256)))) fail('patches');
  return receipt;
}

function verifyDirectory(directory, component) {
  const receiptFile = path.join(directory, RECEIPT);
  if (!fs.lstatSync(receiptFile).isFile() || fs.statSync(receiptFile).size > 1024 * 1024) {
    throw new Error('Runtime receipt must be a bounded regular file.');
  }
  const receipt = verifyReceipt(JSON.parse(fs.readFileSync(receiptFile, 'utf8')), component);
  const actual = fs.readdirSync(directory).sort();
  const expected = [...REQUIRED[component], RECEIPT, 'BUILDINFO.txt'].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected runtime file inventory: ' + component);
  const infoFile = path.join(directory, 'BUILDINFO.txt');
  if (!fs.lstatSync(infoFile).isFile() || fs.statSync(infoFile).size > 16384 ||
      !fs.readFileSync(infoFile, 'utf8').split(/\r?\n/).includes('provenance_sha256=' + fileHash(receiptFile))) {
    throw new Error('Runtime BUILDINFO does not bind its receipt.');
  }
  const lines = fs.readFileSync(infoFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const pairs = lines.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]);
  const info = Object.fromEntries(pairs);
  if (pairs.some(([key]) => !/^[a-z0-9_]+$/.test(key)) || new Set(pairs.map(([key]) => key)).size !== pairs.length ||
      info.source_commit !== receipt.sources[0].commit) throw new Error('Runtime source identity differs from receipt.');
  const hashKeys = { 'laser.exe': 'laser_sha256', 'laserd.exe': 'laserd_sha256', 'laser-shadow.exe': 'laser_shadow_sha256',
    'laser-cuda-miner.exe': 'laser_cuda_miner_sha256', 'lxe.exe': 'lxe_sha256' };
  for (const output of receipt.outputs) {
    if (info[hashKeys[output.file]] !== output.sha256) throw new Error('Runtime BUILDINFO binary identity differs from receipt.');
    const full = path.join(directory, output.file);
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.size !== output.bytes || fileHash(full) !== output.sha256) {
      throw new Error('Runtime binary differs from build receipt: ' + output.file);
    }
    const fd = fs.openSync(full, 'r');
    try {
      const head = Buffer.alloc(64);
      if (fs.readSync(fd, head, 0, 64, 0) !== 64 || head.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Windows runtime.');
      const offset = head.readUInt32LE(60);
      const pe = Buffer.alloc(6);
      if (offset < 64 || offset > stat.size - 6 || fs.readSync(fd, pe, 0, 6, offset) !== 6 ||
          pe.toString('ascii', 0, 4) !== 'PE\0\0' || pe.readUInt16LE(4) !== 0x8664) throw new Error('Runtime must be Windows x64.');
    } finally { fs.closeSync(fd); }
  }
  return { receipt, sha256: fileHash(receiptFile) };
}

function verifySet(root) {
  return Object.fromEntries(Object.keys(REQUIRED).map(component => [component, verifyDirectory(path.join(root, component), component)]));
}

module.exports = { RECEIPT, FORMAT, REQUIRED, sha256, fileHash, sourceManifest, verifyReceipt, verifyDirectory, verifySet };
if (require.main === module) {
  try {
    const result = verifySet(path.resolve(process.argv[2] || '.runtime'));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([name, value]) => [name, value.sha256]))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
