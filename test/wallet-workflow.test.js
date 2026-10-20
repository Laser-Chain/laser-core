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
const htmlSource = source(path.join('ui-src', 'app.template.html'));

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
  assert.match(htmlSource, /<select[^>]+value="\{\{ selected \}\}"/);
  assert.match(htmlSource, /onClick="\{\{ openSelected \}\}"/);
  assert.match(htmlSource, /onClick="\{\{ openCreate \}\}"/);
  assert.match(htmlSource, /onClick="\{\{ openRestore \}\}"/);
  assert.doesNotMatch(htmlSource, /Open \/ Create/);
  assert.match(rendererSource, /this\.m=window\.laser/);
  assert.match(rendererSource, /this\.m\.walletList\(\)/);
  assert.match(rendererSource, /\.walletOpen\(/);
  assert.match(rendererSource, /\.walletCreate\(/);
  assert.match(rendererSource, /\.walletRestore\(/);
});
