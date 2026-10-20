const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.join(__dirname, '..', 'main.js'),
  'utf8'
);
const rendererSource = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'app.js'),
  'utf8'
);

test('startup leaves encrypted wallets locked until an explicit user action', () => {
  const startup = rendererSource.slice(rendererSource.indexOf('async openMain()'), rendererSource.indexOf('async poll()'));
  assert.match(startup, /refreshWallets/);
  assert.doesNotMatch(startup, /walletOpen\(/);
  assert.doesNotMatch(startup, /mineStart\(/);
});

test('splash and main windows open centered', () => {
  const centeredWindows = [...mainSource.matchAll(/center: true/g)];

  assert.equal(centeredWindows.length, 2);
  assert.match(mainSource, /mainWindow\.center\(\);\s+mainWindow\.show\(\)/);
});
