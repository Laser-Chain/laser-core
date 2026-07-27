const fs = require('fs');
const path = require('path');

const WALLET_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const MAX_WALLET_FILE_BYTES = 1024 * 1024;

function normalizeWalletName(value) {
  const name = String(value || '').trim();
  if (!WALLET_NAME_PATTERN.test(name)) {
    throw new Error(
      'Wallet names may contain only letters, numbers, and underscore.'
    );
  }
  return name;
}

function walletDirectory(workingDirectory) {
  return path.join(workingDirectory, 'wallets');
}

function walletFilePath(workingDirectory, value) {
  return path.join(
    walletDirectory(workingDirectory),
    normalizeWalletName(value) + '.key'
  );
}

function listWallets(workingDirectory) {
  try {
    return fs.readdirSync(walletDirectory(workingDirectory), {
      withFileTypes: true
    })
      .filter(entry => entry.isFile() && /^[A-Za-z0-9_]{1,64}\.key$/.test(entry.name))
      .map(entry => entry.name.slice(0, -4))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function validateEncryptedWalletBackup(data) {
  if (!Buffer.isBuffer(data) || data.length < 63 ||
      data.length > MAX_WALLET_FILE_BYTES ||
      data.subarray(0, 4).toString('ascii') !== 'LKEY' ||
      data[4] !== 3 || data[5] !== 1 || data[6] !== 1) {
    throw new Error('The selected file is not an encrypted Laser wallet.');
  }
  const secretLength = data.readUInt32LE(39);
  const publicLength = data.readUInt32LE(43);
  const expectedLength = 47 + secretLength + publicLength + 16;
  if (secretLength === 0 || publicLength === 0 ||
      expectedLength !== data.length) {
    throw new Error('The selected wallet file is malformed or incomplete.');
  }
}

function restoreEncryptedWallet(workingDirectory, sourcePath, value) {
  const name = normalizeWalletName(value);
  const data = fs.readFileSync(sourcePath);
  validateEncryptedWalletBackup(data);
  const directory = walletDirectory(workingDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = walletFilePath(workingDirectory, name);
  fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
  return { name, destination };
}

module.exports = {
  listWallets,
  normalizeWalletName,
  restoreEncryptedWallet,
  validateEncryptedWalletBackup,
  walletFilePath
};
