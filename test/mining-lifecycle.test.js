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

test('wallet loading never starts mining', () => {
  const calls = [...rendererSource.matchAll(/window\.laser\.mineStart\(/g)];
  const explicitToggle = rendererSource.indexOf(
    "document.getElementById('btn-mine-toggle').addEventListener"
  );

  assert.equal(calls.length, 1);
  assert.ok(explicitToggle >= 0);
  assert.ok(calls[0].index > explicitToggle);
});

test('continuous mining is explicitly stoppable and cancels the daemon job', () => {
  assert.match(mainSource, /automatic: false,\s+stoppable: true/);
  assert.match(
    mainSource,
    /registerMainHandler\('laser:mine-stop'[\s\S]*?'node', 'mine-stop'/
  );
});
