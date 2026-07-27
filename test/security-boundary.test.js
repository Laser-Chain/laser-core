const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('public package excludes development HTTP and external explorer surfaces', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'UNLICENSED');
  assert.ok(pkg.build.files.includes('NOTICE.txt'));
  assert.ok(!pkg.build.files.some(file => file.startsWith('public/')));
  assert.ok(!pkg.build.files.includes('server.js'));
  assert.ok(!pkg.build.extraResources.some(resource =>
    String(resource.from).includes('laser-explorer')));
  assert.ok(!pkg.build.extraResources.some(resource =>
    String(resource.from).startsWith('../')));
  assert.ok(pkg.build.extraResources.some(resource =>
    Array.isArray(resource.filter) && resource.filter.includes('BUILDINFO.txt')));
  assert.deepEqual(pkg.build.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false
  });
});

test('renderer stays local, sandboxed, and protected by CSP', () => {
  const main = read('main.js');
  const index = read('renderer/index.html');
  const splash = read('renderer/splash.html');

  assert.match(main, /sandbox:\s*true/g);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /Rejected untrusted IPC sender/);
  assert.match(index, /Content-Security-Policy/);
  assert.match(splash, /Content-Security-Policy/);
  assert.doesNotMatch(index, /https?:\/\//);
  assert.doesNotMatch(splash, /<script>(.|\n)*<\/script>/);
  assert.doesNotMatch(read('renderer/app.js'), /navigator\.clipboard/);
  assert.match(read('preload.js'), /laser:copy-address/);
});

test('activity messages are rendered as text, never interpolated HTML', () => {
  const renderer = read('renderer/app.js');
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
  assert.match(renderer, /description\.textContent = entry\.msg/);
});

test('privileged IPC revalidates mining and transaction arguments', () => {
  const main = read('main.js');
  assert.match(main, /const requestedCount = blockCount\(count\)/);
  assert.match(main, /const requestedWallet = walletName\(wallet\)/);
  assert.match(main, /const recipient = laserAddress\(to\)/);
  assert.match(main, /const sendAmount = laserValue\(amount, 'Amount', false\)/);
});
