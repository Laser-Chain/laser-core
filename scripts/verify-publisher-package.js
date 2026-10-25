'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MODULES = ['explorer-publisher.js', 'explorer-publisher-settings.js', 'explorer-publisher-service.js'];
const digest = data => createHash('sha256').update(data).digest('hex');

function verifyRuntime(directory) {
  const binary = path.join(directory, 'lxe.exe');
  const info = path.join(directory, 'BUILDINFO.txt');
  if (!fs.existsSync(binary) || !fs.existsSync(info)) {
    throw new Error('Explorer publisher runtime is incomplete. Run npm run prepare:v3 with LASER_EXPLORER_SOURCE_DIR set.');
  }
  const data = fs.readFileSync(binary);
  const header = data.length >= 64 ? data.readUInt32LE(0x3c) : -1;
  if (data.toString('ascii', 0, 2) !== 'MZ' || header < 64 || header + 6 > data.length ||
      data.toString('ascii', header, header + 4) !== 'PE\0\0' || data.readUInt16LE(header + 4) !== 0x8664) {
    throw new Error('Explorer helper must be a Windows x64 executable.');
  }
  const expected = /^lxe_sha256=([0-9a-f]{64})\r?$/m.exec(fs.readFileSync(info, 'utf8'))?.[1];
  const actual = digest(data);
  if (!expected || expected !== actual) throw new Error('Explorer helper does not match its staged BUILDINFO.txt. Run npm run prepare:v3 again.');
  return actual;
}

function beforePack(context) {
  if (context.electronPlatformName !== 'win32' || context.arch !== 1) {
    throw new Error('Laser Core currently ships Windows x64 runtimes. Stage and validate native publisher support before adding another platform.');
  }
  return verifyRuntime(path.join(context.packager.info.appDir, '.runtime', 'explorer'));
}

function verifyArchive(files, readFile) {
  const names = files.map(file => file.replace(/\\/g, '/').replace(/^\//, ''));
  for (const file of [...MODULES, 'main.js', 'preload.js']) {
    if (!names.includes(file)) throw new Error(`Packaged publisher module is missing: ${file}`);
  }
  const forbidden = /(^|\/)(explorer-publish(?:er)?\.json(?:\..*)?|\.env(?:\..*)?|\.npmrc|wallets)(\/|$)/i;
  if (names.some(file => forbidden.test(file))) throw new Error('Publisher credentials or local settings must not be packaged.');
  if (!readFile('main.js').toString().includes("require('./explorer-publisher-service')")) {
    throw new Error('Packaged main process does not load the explorer publisher service.');
  }
}

async function afterPack(context) {
  const asar = require('@electron/asar');
  const resources = path.join(context.appOutDir, 'resources');
  const expected = verifyRuntime(path.join(context.packager.info.appDir, '.runtime', 'explorer'));
  const actual = verifyRuntime(path.join(resources, 'bin', 'explorer'));
  if (actual !== expected) throw new Error('Packaged explorer helper differs from the staged runtime.');
  const archive = path.join(resources, 'app.asar');
  verifyArchive(asar.listPackage(archive), file => asar.extractFile(archive, file));
  console.log('Verified bundled explorer publisher, native helper, and credential exclusions.');
}

module.exports = { beforePack, afterPack, verifyRuntime, verifyArchive, MODULES };
