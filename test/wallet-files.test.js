const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  listWallets,
  normalizeWalletName,
  restoreEncryptedWallet,
  validateEncryptedWalletBackup
} = require('../wallet-files');

function encryptedWalletFixture(secretLength = 4032, publicLength = 1952) {
  const data = Buffer.alloc(47 + secretLength + publicLength + 16);
  data.write('LKEY', 0, 'ascii');
  data[4] = 3;
  data[5] = 1;
  data[6] = 1;
  data.writeUInt32LE(600000, 7);
  data.writeUInt32LE(secretLength, 39);
  data.writeUInt32LE(publicLength, 43);
  return data;
}

test('wallet names match the core filename rules', () => {
  assert.equal(normalizeWalletName('Lightman_1'), 'Lightman_1');
  assert.throws(() => normalizeWalletName('wallet-name'), /only letters/);
  assert.throws(() => normalizeWalletName('../wallet'), /only letters/);
});

test('restore writes the validated bytes when the source changes afterwards', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-snapshot-'));
  const source = path.join(root, 'backup.key');
  const original = encryptedWalletFixture();
  fs.writeFileSync(source, original);
  const mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (...args) => {
    fs.writeFileSync(source, Buffer.from('replaced after validation'));
    return mkdir(...args);
  });
  try {
    const { destination } = restoreEncryptedWallet(root, source, 'restored');
    assert.deepEqual(fs.readFileSync(destination), original);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    }
  } finally {
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore rejects oversized and non-regular files before reading', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-bounds-'));
  const source = path.join(root, 'oversized.key');
  fs.writeFileSync(source, Buffer.alloc(1024 * 1024 + 1));
  const read = t.mock.method(fs, 'readSync', () => {
    throw new Error('unexpected read');
  });
  try {
    assert.throws(() => restoreEncryptedWallet(root, source, 'large'), /at most 1 MiB/);
    assert.throws(() => restoreEncryptedWallet(root, root, 'directory'));
    assert.equal(read.mock.callCount(), 0);
    assert.equal(fs.existsSync(path.join(root, 'wallets')), false);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore removes a new destination on flush failure and preserves the backup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-flush-'));
  const source = path.join(root, 'backup.key');
  const data = encryptedWalletFixture();
  fs.writeFileSync(source, data);
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture flush failure'); });
  try {
    assert.throws(() => restoreEncryptedWallet(root, source, 'restored'), /flush failure/);
    assert.deepEqual(listWallets(root), []);
    assert.deepEqual(fs.readFileSync(source), data);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup structure enforces the supported key profile and bounded KDF', () => {
  for (const iterations of [0, 99999, 5000001, 0xffffffff]) {
    const data = encryptedWalletFixture();
    data.writeUInt32LE(iterations, 7);
    assert.throws(() => validateEncryptedWalletBackup(data), /malformed/);
  }
  for (const iterations of [100000, 600000, 5000000]) {
    const data = encryptedWalletFixture();
    data.writeUInt32LE(iterations, 7);
    assert.doesNotThrow(() => validateEncryptedWalletBackup(data));
  }
  assert.throws(() => validateEncryptedWalletBackup(encryptedWalletFixture(32, 48)), /malformed/);
  assert.throws(() => validateEncryptedWalletBackup(Buffer.concat([encryptedWalletFixture(), Buffer.alloc(1)])), /malformed/);
  assert.throws(() => validateEncryptedWalletBackup(encryptedWalletFixture().subarray(0, 62)), /encrypted/);
});

test('restore handles short reads without dropping validated bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-short-read-'));
  const source = path.join(root, 'backup.key');
  const data = encryptedWalletFixture();
  fs.writeFileSync(source, data);
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) =>
    read(fd, buffer, offset, Math.min(length, 17), position));
  try {
    const { destination } = restoreEncryptedWallet(root, source, 'restored');
    assert.deepEqual(fs.readFileSync(destination), data);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore bounds a file that grows after its initial size check', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-growth-'));
  const source = path.join(root, 'backup.key');
  fs.writeFileSync(source, encryptedWalletFixture());
  const stat = fs.fstatSync;
  const read = fs.readSync;
  let bytes = 0;
  t.mock.method(fs, 'fstatSync', fd => {
    const result = stat(fd);
    fs.appendFileSync(source, Buffer.alloc(2 * 1024 * 1024));
    return result;
  });
  t.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    bytes += count;
    return count;
  });
  try {
    assert.throws(() => restoreEncryptedWallet(root, source, 'restored'), /encrypted/);
    assert.equal(bytes, 1024 * 1024 + 1);
    assert.deepEqual(listWallets(root), []);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wallet listing exposes only valid local key filenames', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-list-'));
  try {
    const directory = path.join(root, 'wallets');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'bravo.key'), '');
    fs.writeFileSync(path.join(directory, 'alpha.key'), '');
    fs.writeFileSync(path.join(directory, 'ignored.txt'), '');
    assert.deepEqual(listWallets(root), ['alpha', 'bravo']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore accepts encrypted wallets and refuses overwrite or malformed data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'laser-wallet-restore-'));
  try {
    const source = path.join(root, 'backup.key');
    fs.writeFileSync(source, encryptedWalletFixture());
    assert.doesNotThrow(() =>
      validateEncryptedWalletBackup(fs.readFileSync(source))
    );
    restoreEncryptedWallet(root, source, 'restored');
    assert.deepEqual(listWallets(root), ['restored']);
    const destination = path.join(root, 'wallets', 'restored.key');
    const original = fs.readFileSync(destination);
    fs.writeFileSync(source, Buffer.from(original).fill(0x55, 47, 63));
    assert.throws(
      () => restoreEncryptedWallet(root, source, 'restored'),
      error => error && error.code === 'EEXIST'
    );
    assert.deepEqual(fs.readFileSync(destination), original);

    const malformed = encryptedWalletFixture();
    malformed.writeUInt32LE(999, 39);
    assert.throws(
      () => validateEncryptedWalletBackup(malformed),
      /malformed or incomplete/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
