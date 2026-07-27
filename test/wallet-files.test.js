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

function encryptedWalletFixture(secretLength = 32, publicLength = 48) {
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
    assert.throws(
      () => restoreEncryptedWallet(root, source, 'restored'),
      error => error && error.code === 'EEXIST'
    );

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
