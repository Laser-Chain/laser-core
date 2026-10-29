'use strict';
const fs = require('node:fs');
const path = require('node:path');
const publisher = require('./verify-publisher-package');
const { verifySet, fileHash } = require('./runtime-provenance');

function beforePack(context) {
  publisher.beforePack(context);
  return verifySet(path.join(context.packager.info.appDir, '.runtime'));
}

async function afterPack(context) {
  await publisher.afterPack(context);
  const source = context.packager.info.appDir;
  const resources = path.join(context.appOutDir, 'resources');
  if (JSON.stringify(fs.readdirSync(path.join(resources, 'bin')).sort()) !== JSON.stringify(['explorer', 'sandbox-v2', 'v3'])) {
    throw new Error('Unexpected packaged native component.');
  }
  const staged = verifySet(path.join(source, '.runtime'));
  const packaged = verifySet(path.join(resources, 'bin'));
  for (const name of Object.keys(staged)) {
    if (staged[name].sha256 !== packaged[name].sha256) throw new Error('Packaged build receipt differs: ' + name);
  }
  const asar = require('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const expectedPackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const actualPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  for (const key of ['name', 'version', 'main', 'license']) {
    if (actualPackage[key] !== expectedPackage[key]) throw new Error('Packaged application metadata differs: ' + key);
  }
  for (const name of asar.listPackage(archive)) {
    const relative = name.replaceAll('\\', '/').replace(/^\//, '');
    if (asar.statFile(archive, relative).files) continue;
    if (relative === 'package.json') continue; // electron-builder normalizes metadata.
    if (!fs.existsSync(path.join(source, relative)) || fileHash(path.join(source, relative)) !==
        require('./runtime-provenance').sha256(asar.extractFile(archive, relative))) {
      throw new Error('Packaged application differs from source: ' + relative);
    }
  }
  console.log('Verified all native build receipts and application file bytes.');
}

module.exports = { beforePack, afterPack };
