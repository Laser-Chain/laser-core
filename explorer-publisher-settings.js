'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateEndpoint(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  } catch (_) {
    throw new Error('Use an HTTPS ingest URL without credentials, query parameters, or a fragment.');
  }
}

function validateToken(value) {
  if (typeof value !== 'string' || !value.length || value.length > 4096 || /[^\x21-\x7e]/.test(value)) {
    throw new Error('Enter a valid explorer publisher token (up to 4096 printable characters, without spaces).');
  }
  return value;
}

function interval(value) {
  const n = Number(value ?? 3000);
  return Number.isFinite(n) ? Math.max(3000, Math.min(n, 600000)) : 3000;
}

// Legacy launch configuration remains supported for operators. Never put it in
// app.asar or a release. A complete pair is required for environment overrides.
function readLegacy(options = {}) {
  const env = options.env || process.env;
  if (env.LASER_EXPLORER_URL || env.LASER_EXPLORER_TOKEN) {
    return { url: env.LASER_EXPLORER_URL, token: env.LASER_EXPLORER_TOKEN,
      lxe: env.LXE_BIN, interval_ms: env.LASER_EXPLORER_INTERVAL_MS };
  }
  const candidates = [env.LASER_EXPLORER_CONFIG,
    options.userData && path.join(options.userData, 'explorer-publish.json'),
    path.join(options.appDir || __dirname, 'explorer-publish.json')].filter(Boolean);
  for (const file of candidates) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read the legacy explorer publisher configuration.');
      if (file === env.LASER_EXPLORER_CONFIG) throw new Error('The configured explorer publisher file is missing.');
    }
  }
  return null;
}

class PublisherSettings {
  constructor(options) {
    this.options = options;
    this.file = path.join(options.userData, 'explorer-publisher.json');
    this.storage = options.safeStorage;
  }

  requireEncryption() {
    if (!this.storage?.isEncryptionAvailable() || this.storage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Secure credential storage is unavailable. Restore the operating system credential store and try again.');
    }
  }

  load() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read saved publisher settings. Save the settings again to repair them.');
    }
    if (saved !== undefined) {
      if (saved?.version !== 1 || typeof saved.enabled !== 'boolean') throw new Error('Unsupported publisher settings. Save the settings again to repair them.');
      if (!saved.enabled) return null;
      try {
        this.requireEncryption();
        return { url: validateEndpoint(saved.url), token: validateToken(this.storage.decryptString(Buffer.from(saved.token_encrypted, 'base64'))),
          intervalMs: interval(saved.interval_ms), network: saved.network };
      } catch (_) { throw new Error('Cannot decrypt saved publisher settings. Enter the publisher token again on this computer.'); }
    }
    const legacy = readLegacy(this.options);
    if (!legacy) return null;
    return this.save({ enabled: true, url: legacy.url, token: legacy.token, interval_ms: legacy.interval_ms });
  }

  save(input, previous = null) {
    if (!input || typeof input.enabled !== 'boolean') throw new Error('Choose whether explorer publishing is enabled.');
    let config = null;
    let saved = { version: 1, enabled: false };
    if (input.enabled) {
      const url = validateEndpoint(input.url);
      // Never reuse a credential when the recipient changes.
      const token = validateToken(input.token || (previous?.url === url ? previous.token : ''));
      this.requireEncryption();
      config = { url, token, intervalMs: interval(input.interval_ms ?? previous?.intervalMs), network: this.options.network };
      saved = { version: 1, enabled: true, url, network: config.network, interval_ms: config.intervalMs,
        token_encrypted: this.storage.encryptString(token).toString('base64') };
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } catch (_) { throw new Error('Could not save publisher settings. Check access to the Laser Core user data directory.'); }
    finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    return config;
  }
}

module.exports = { PublisherSettings, validateEndpoint, validateToken, interval, readLegacy };
