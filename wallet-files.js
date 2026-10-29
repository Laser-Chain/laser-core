const fs = require('fs');
const path = require('path');

const WALLET_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const MAX_WALLET_FILE_BYTES = 1024 * 1024;
const SECRET_KEY_BYTES = 4032;
const PUBLIC_KEY_BYTES = 1952;

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
  const iterations = data.readUInt32LE(7);
  const expectedLength = 47 + secretLength + publicLength + 16;
  if (secretLength !== SECRET_KEY_BYTES || publicLength !== PUBLIC_KEY_BYTES ||
      iterations < 100000 || iterations > 5000000 ||
      expectedLength !== data.length) {
    throw new Error('The selected wallet file is malformed or incomplete.');
  }
}

function restoreEncryptedWallet(workingDirectory, sourcePath, value) {
  const name = normalizeWalletName(value);
  // Open once and bound the read even if the selected file grows. Never reopen
  // the source path after validation: it may then refer to different bytes.
  const source = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  let data;
  try {
    const stat = fs.fstatSync(source);
    if (!stat.isFile() || stat.size > MAX_WALLET_FILE_BYTES) {
      throw new Error('Select a regular encrypted wallet file of at most 1 MiB.');
    }
    const buffer = Buffer.alloc(MAX_WALLET_FILE_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(source, buffer, used, buffer.length - used, null);
      if (count === 0) break;
      used += count;
    }
    data = buffer.subarray(0, used);
    validateEncryptedWalletBackup(data);
  } finally {
    fs.closeSync(source);
  }
  const directory = walletDirectory(workingDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = walletFilePath(workingDirectory, name);
  // Exclusive creation preserves an existing wallet, including a dangling
  // symlink. POSIX permissions are owner-only; Windows inherits directory ACLs.
  const output = fs.openSync(destination, 'wx', 0o600);
  let complete = false;
  try {
    fs.writeFileSync(output, data);
    fs.fsyncSync(output);
    complete = true;
  } finally {
    try {
      fs.closeSync(output);
    } finally {
      if (!complete) fs.unlinkSync(destination);
    }
  }
  return { name, destination };
}

module.exports = {
  listWallets,
  normalizeWalletName,
  restoreEncryptedWallet,
  validateEncryptedWalletBackup,
  walletFilePath
};
