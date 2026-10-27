'use strict';
const { PublisherSettings } = require('./explorer-publisher-settings');
const { ExplorerPublisher, resolvePublisherBinary } = require('./explorer-publisher');

class PublisherService {
  constructor(options) {
    this.options = options;
    this.settings = options.settings || new PublisherSettings(options);
    this.makePublisher = options.makePublisher || ((...args) => new ExplorerPublisher(...args));
    this.publisher = null;
    this.config = null;
    this.nodeReady = false;
    this.configError = null;
    this.state = { state: 'unconfigured', error: null, lastPublishedAt: null, lastHeight: null };
  }

  initialize(ready) {
    this.nodeReady = ready;
    try { this.config = this.settings.load(); this.restart(); }
    catch (error) { this.configError = error.message; this.state = { ...this.state, state: 'error', error: this.configError }; }
    return this.status();
  }

  setNodeReady(ready) {
    if (ready === this.nodeReady) return;
    this.nodeReady = ready;
    this.restart();
  }

  save(input) {
    const config = this.settings.save(input, this.config);
    this.config = config;
    this.configError = null;
    this.restart();
    return this.status();
  }

  restart() {
    this.stop();
    this.state = { state: 'unconfigured', error: null, lastPublishedAt: null, lastHeight: null };
    if (this.configError) { this.state.state = 'error'; this.state.error = this.configError; return; }
    if (!this.config) return;
    if (this.config.network !== this.options.network) {
      this.state = { ...this.state, state: 'error', error: 'Publisher settings belong to a different network. Save settings for this network before publishing.' };
      return;
    }
    const lxe = resolvePublisherBinary(this.options);
    if (!lxe) {
      this.state = { ...this.state, state: 'error', error: 'Explorer helper is missing. Reinstall a complete Laser Core distribution.' };
      return;
    }
    if (!this.nodeReady) { this.state.state = 'waiting-node'; return; }
    const publisher = this.makePublisher({ ...this.config, lxe, rpc: this.options.rpc || '127.0.0.1:19544' }, this.options.datadir, this.options.network, {
      onStatus: state => { if (this.publisher === publisher) this.state = state; }
    });
    this.publisher = publisher;
    publisher.start();
  }

  status() {
    return { ...this.state, enabled: !!this.config, url: this.config?.url || '',
      intervalMs: this.config?.intervalMs || 3000, helperAvailable: !!resolvePublisherBinary(this.options) };
  }

  stop() {
    const publisher = this.publisher;
    this.publisher = null;
    publisher?.stop();
  }
}

module.exports = { PublisherService };
