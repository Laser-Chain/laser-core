const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const mainSource = source('main.js');
const preloadSource = source('preload.js');
const rendererSource = source(path.join('renderer', 'app.js'));
const htmlSource = source(path.join('renderer', 'index.html'));

test('wallet operations are separated across the isolated IPC boundary', () => {
  for (const operation of ['list', 'open', 'create', 'restore']) {
    assert.match(mainSource, new RegExp("laser:wallet-" + operation));
  }
  assert.doesNotMatch(preloadSource, /ipcRenderer\.invoke\('laser:wallet',/);
  assert.match(preloadSource, /walletOpen:/);
  assert.match(preloadSource, /walletCreate:/);
  assert.match(preloadSource, /walletRestore:/);
});

test('wallet UI selects existing files and presents explicit actions', () => {
  assert.match(htmlSource, /id="ov-wallet-select"/);
  assert.match(htmlSource, /id="btn-wallet-open"/);
  assert.match(htmlSource, /id="btn-wallet-create"/);
  assert.match(htmlSource, /id="btn-wallet-restore"/);
  assert.doesNotMatch(htmlSource, /Open \/ Create/);
  assert.match(rendererSource, /window\.laser\.walletList\(\)/);
  assert.match(rendererSource, /window\.laser\.walletOpen\(/);
  assert.match(rendererSource, /window\.laser\.walletCreate\(/);
  assert.match(rendererSource, /window\.laser\.walletRestore\(/);
});
