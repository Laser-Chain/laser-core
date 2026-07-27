class WalletSecretStore {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.entries = new Map();
  }

  lock(name) {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.timer) this.clearTimer(entry.timer);
    entry.secret.fill(0);
    this.entries.delete(name);
  }

  schedule(name, entry) {
    if (entry.timer) this.clearTimer(entry.timer);
    const remaining = Math.max(0, entry.expiresAt - this.now());
    entry.timer = this.setTimer(() => {
      const current = this.entries.get(name);
      if (current !== entry) return;
      if (current.expiresAt <= this.now()) {
        this.lock(name);
      } else {
        this.schedule(name, current);
      }
    }, remaining);
    if (entry.timer && typeof entry.timer.unref === 'function')
      entry.timer.unref();
  }

  remember(name, passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < 1 ||
        Buffer.byteLength(passphrase, 'utf8') > 511 ||
        /[\r\n\0]/.test(passphrase)) {
      throw new Error('Enter a wallet passphrase between 1 and 511 UTF-8 bytes.');
    }
    this.lock(name);
    const entry = {
      secret: Buffer.from(passphrase, 'utf8'),
      expiresAt: this.now() + this.ttlMs,
      timer: null
    };
    this.entries.set(name, entry);
    this.schedule(name, entry);
  }

  get(name) {
    const entry = this.entries.get(name);
    if (!entry || entry.expiresAt <= this.now()) {
      this.lock(name);
      throw new Error('Wallet is locked. Enter its passphrase to continue.');
    }
    entry.expiresAt = this.now() + this.ttlMs;
    this.schedule(name, entry);
    return entry.secret;
  }

  has(name) {
    const entry = this.entries.get(name);
    if (!entry || entry.expiresAt <= this.now()) {
      this.lock(name);
      return false;
    }
    return true;
  }

  clear() {
    for (const name of [...this.entries.keys()])
      this.lock(name);
  }
}

module.exports = { WalletSecretStore };
