/* ================================================================
   Laser Core — Renderer Logic
   Bitcoin Core-style behavior: explicit wallet lifecycle, live updates,
   transaction-style activity log
   ================================================================ */

(function () {
  'use strict';

  let activeWallet = null;
  let lastHeight = null;
  let nodeOnline = false;
  let latestMinerMetrics = null;
  let latestMiningState = null;
  const activity = [];
  const MAX_ACTIVITY = 40;
  const CONTACTS_KEY = 'laser-core.contacts.v1';
  const PREFS_KEY = 'laser-core.preferences.v1';
  let contacts = loadStoredObject(CONTACTS_KEY);
  let preferences = loadStoredObject(PREFS_KEY);

  // ── Tab Navigation ─────────────────────────────────────────────

  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
    });
  });

  // ── Helpers ────────────────────────────────────────────────────

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function loadStoredObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  }

  function storeObject(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function savePreferences(patch) {
    preferences = { ...preferences, ...patch };
    storeObject(PREFS_KEY, preferences);
  }

  function parseLaser(value) {
    const normalized = String(value).trim();
    if (!/^[0-9]+(?:\.[0-9]{1,9})?$/.test(normalized)) return null;
    const [whole, fraction = ''] = normalized.split('.');
    return BigInt(whole) * 1000000000n +
      BigInt(fraction.padEnd(9, '0'));
  }

  function formatLaserValue(photons) {
    const whole = photons / 1000000000n;
    const fraction = (photons % 1000000000n).toString().padStart(9, '0');
    return whole.toString() + '.' + fraction;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, '0'))
      .join(':');
  }

  function formatSignedLaser(photons) {
    const value = BigInt(photons);
    if (value === 0n) return '0.000000000 LASER';
    const prefix = value > 0n ? '+' : '−';
    const absolute = value > 0n ? value : -value;
    return prefix + formatLaser(absolute);
  }

  function showResult(kind, message) {
    const result = document.getElementById('send-result');
    result.style.display = '';
    result.className = 'result-box ' + kind;
    setText('send-result-text', message);
  }

  function confirmSend(details) {
    const dialog = document.getElementById('send-confirm-dialog');
    setText('confirm-from', details.from);
    setText('confirm-to', details.to);
    setText('confirm-amount', details.amount + ' LASER');
    setText('confirm-fee', details.fee + ' LASER');
    setText('confirm-total', details.total + ' LASER');
    dialog.returnValue = 'cancel';

    return new Promise(resolve => {
      const onClose = () => resolve(dialog.returnValue === 'confirm');
      dialog.addEventListener('close', onClose, { once: true });
      dialog.showModal();
    });
  }

  function formatLaser(photons) {
    // Use integer math to avoid floating-point precision issues
    const p = BigInt(photons);
    const whole = p / 1000000000n;
    const frac = p % 1000000000n;
    const fracStr = frac.toString().padStart(9, '0');
    return whole.toString() + '.' + fracStr + ' LASER';
  }

  function timeStr() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addActivity(msg, type, amount) {
    activity.unshift({ ts: timeStr(), msg, type, amount: amount || '' });
    if (activity.length > MAX_ACTIVITY) activity.pop();
    renderActivity();
  }

  function renderActivity() {
    const el = document.getElementById('recent-list');
    if (!el) return;
    el.replaceChildren();
    if (activity.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tx-empty';
      empty.textContent = 'No transactions yet. Load a wallet and mine or receive blocks.';
      el.append(empty);
      return;
    }
    for (const entry of activity) {
      let iconClass = 'info';
      let iconChar = 'i';
      let amountClass = 'neutral';
      if (entry.type === 'mined') { iconClass = 'mined'; iconChar = '⛏'; amountClass = 'positive'; }
      else if (entry.type === 'sent') { iconClass = 'sent'; iconChar = '↑'; amountClass = 'negative'; }
      else if (entry.type === 'recv') { iconClass = 'recv'; iconChar = '↓'; amountClass = 'positive'; }
      const row = document.createElement('div');
      row.className = 'tx-entry';
      const icon = document.createElement('div');
      icon.className = `tx-icon ${iconClass}`;
      icon.textContent = iconChar;
      const time = document.createElement('span');
      time.className = 'tx-time';
      time.textContent = entry.ts;
      const description = document.createElement('span');
      description.className = 'tx-desc';
      description.textContent = entry.msg;
      const amount = document.createElement('span');
      amount.className = `tx-amount ${amountClass}`;
      amount.textContent = entry.amount;
      row.append(icon, time, description, amount);
      el.append(row);
    }
  }

  function renderAddressBook() {
    const list = document.getElementById('address-book-list');
    const suggestions = document.getElementById('address-book-suggestions');
    const entries = Object.entries(contacts)
      .sort((a, b) => a[1].localeCompare(b[1]));

    list.replaceChildren();
    suggestions.replaceChildren();

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'address-book-empty';
      empty.textContent = 'No saved contacts.';
      list.appendChild(empty);
      return;
    }

    for (const [address, label] of entries) {
      const option = document.createElement('option');
      option.value = address;
      option.label = label;
      suggestions.appendChild(option);

      const row = document.createElement('div');
      row.className = 'address-book-entry';

      const identity = document.createElement('div');
      const name = document.createElement('strong');
      const code = document.createElement('code');
      name.textContent = label;
      code.textContent = address;
      identity.append(name, code);

      const use = document.createElement('button');
      use.className = 'qt-btn';
      use.textContent = 'Use';
      use.addEventListener('click', () => {
        document.getElementById('send-to').value = address;
        document.getElementById('send-label').value = label;
      });

      const remove = document.createElement('button');
      remove.className = 'qt-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        delete contacts[address];
        storeObject(CONTACTS_KEY, contacts);
        renderAddressBook();
      });

      const actions = document.createElement('div');
      actions.append(use, remove);
      row.append(identity, actions);
      list.appendChild(row);
    }
  }

  function saveContact(showFeedback = true) {
    const address = document.getElementById('send-to').value.trim().toLowerCase();
    const label = document.getElementById('send-label').value.trim();

    if (!/^[0-9a-f]{64}$/.test(address) || !label) {
      if (showFeedback) showResult('error', 'Enter a valid 64-character address and a contact label.');
      return false;
    }

    contacts[address] = label;
    storeObject(CONTACTS_KEY, contacts);
    renderAddressBook();
    if (showFeedback) showResult('success', 'Contact saved to the local address book.');
    return true;
  }

  // ── Polling ────────────────────────────────────────────────────

  function renderSessionMetrics() {
    const state = latestMiningState;
    const session = state && state.session ? state.session : {};
    setText('mine-session-wallet', state && state.wallet ? state.wallet : '—');
    setText('mine-count-display', session.blocks || 0);
    setText('mine-session-errors', session.errors || 0);
    const elapsed = session.started_at ? Date.now() - session.started_at : 0;
    setText('mine-session-elapsed', formatDuration(elapsed));
    const average = session.blocks > 0
      ? Number(session.total_solve_ms || 0) / session.blocks
      : null;
    setText('mine-session-average', average === null
      ? '—'
      : (average < 1000
        ? Math.round(average) + ' ms'
        : (average / 1000).toFixed(2) + ' s'));
    if (state && state.mining) {
      setText('mine-session-next', session.next_run_at
        ? Math.max(0, Math.ceil((session.next_run_at - Date.now()) / 1000)) + ' s'
        : 'Mining now');
    } else {
      setText('mine-session-next', '—');
    }
    if (latestMinerMetrics && session.baseline_total_photons !== null &&
        session.baseline_total_photons !== undefined) {
      const earned = BigInt(latestMinerMetrics.total_mined_photons) -
        BigInt(session.baseline_total_photons);
      setText('mine-session-earned', formatSignedLaser(earned));
    } else {
      setText('mine-session-earned', '—');
    }
  }

  function renderMinerMetrics(metrics) {
    latestMinerMetrics = metrics;
    const confirmed = BigInt(metrics.confirmed_photons);
    const projected = BigInt(metrics.projected_photons);
    const pendingReceived = BigInt(metrics.pending_received_photons);
    const pendingSpent = BigInt(metrics.pending_spent_photons);
    const pendingNet = projected - confirmed;

    setText('ov-balance', formatLaser(confirmed));
    setText('ov-pending', formatSignedLaser(pendingNet));
    setText('ov-total', formatLaser(projected));
    const pending = document.getElementById('ov-pending');
    pending.title = 'Mempool effect: +' + formatLaser(pendingReceived) +
      ' incoming, −' + formatLaser(pendingSpent) + ' outgoing including fees.';

    setText('mine-lifetime-blocks', metrics.blocks_mined);
    setText('mine-lifetime-total', formatLaser(metrics.total_mined_photons));
    setText('mine-lifetime-subsidy', formatLaser(metrics.subsidy_photons));
    setText('mine-lifetime-fees', formatLaser(metrics.fee_photons));
    setText('mine-lifetime-last', metrics.has_last
      ? 'Height ' + metrics.last_height
      : 'No active-chain blocks');
    setText('mine-next-reward', formatLaser(metrics.next_reward_photons));
    renderSessionMetrics();
  }

  async function pollMinerMetrics() {
    if (!activeWallet) return;
    const walletName = activeWallet.name;
    try {
      const [metrics, state] = await Promise.all([
        window.laser.minerMetrics(walletName),
        window.laser.mineStatus()
      ]);
      if (!activeWallet || activeWallet.name !== walletName) return;
      latestMiningState = state;
      renderMinerMetrics(metrics);
    } catch (_) {
      latestMinerMetrics = null;
      setText('ov-pending', 'Unavailable');
      const pending = document.getElementById('ov-pending');
      pending.title = 'This node runtime does not expose wallet mempool metrics.';
      ['mine-lifetime-blocks', 'mine-lifetime-total', 'mine-lifetime-subsidy',
        'mine-lifetime-fees', 'mine-lifetime-last', 'mine-next-reward']
        .forEach(id => setText(id, 'Unavailable'));
      renderSessionMetrics();
    }
  }

  async function pollStatus() {
    try {
      const s = await window.laser.status();
      nodeOnline = true;
      const banner = document.getElementById('node-banner');
      banner.hidden = true;

      // Overview chain info
      setText('ov-height', s.height);
      setText('ov-network', s.network === 'shadow' ? 'Shadownet' : s.network);
      const shadowState = s.shadow && s.shadow.state ? s.shadow.state : 'unavailable';
      const shadowLabel = shadowState === 'active' ? 'Active (non-consensus)' : shadowState;
      setText('ov-shadow', shadowLabel);
      setText('net-shadow', shadowLabel);
      setText('ov-blocks', s.blocks);
      setText('ov-peers', s.peers);
      setText('ov-mempool', s.mempool);

      // Mining tab
      setText('mine-height', s.height);
      setText('mine-mempool', s.mempool);
      setText('mine-orphans', s.orphans);
      const backend = s.mining_backend === 'cuda'
        ? 'CUDA accelerated'
        : 'CPU';
      setText('mine-backend', backend);
      setText('mine-pow-profile',
        s.pow_profile === 'photonhash-v02' ? 'PhotonHash v0.2' : s.pow_profile);
      setText('mine-fallback', s.cuda_available
        ? 'CPU oracle + automatic fallback'
        : 'CPU-only (CUDA not available)');

      // Status bar
      setText('sb-blocks', s.blocks + ' blocks');
      setText('sb-last-block', 'Height ' + s.height);

      const connIcon = document.getElementById('sb-conn-icon');
      const statusIcon = document.getElementById('sb-status-icon');
      connIcon.classList.toggle('connected', s.peers > 0);
      connIcon.classList.toggle('disconnected', s.peers === 0);
      statusIcon.classList.toggle('connected', s.state === 'online');
      statusIcon.classList.toggle('disconnected', s.state !== 'online');

      const bar = document.getElementById('sb-sync-bar');
      bar.style.width = '100%';
      bar.title = 'Local node ready at height ' + s.height;

      // Track new blocks in activity log
      if (lastHeight !== null && s.height > lastHeight) {
        const diff = s.height - lastHeight;
        addActivity(
          `Mined ${diff} block${diff > 1 ? 's' : ''} — height ${s.height}`,
          'mined',
          `+${diff} blk`
        );
      }
      lastHeight = s.height;

      if (activeWallet) {
        await refreshBalance();
        await pollMinerMetrics();
      }
    } catch (e) {
      nodeOnline = false;
      setText('sb-blocks', 'offline');
      setText('sb-last-block', 'Local node unavailable');
      const banner = document.getElementById('node-banner');
      banner.hidden = false;
      let message = e.message ||
        'Wallet, send, and mining actions will resume when RPC reconnects.';
      try {
        const startup = await window.laser.startup();
        if (startup.error) {
          message = `Node startup failed [${startup.channel}]: ${startup.error}`;
        } else if (!startup.ready) {
          message = `Verifying the ${startup.channel} chain and waiting for RPC...`;
        }
      } catch (_) {}
      setText('node-banner-text', message);
      const bar = document.getElementById('sb-sync-bar');
      bar.style.width = '0%';
      bar.title = message;
      const statusIcon = document.getElementById('sb-status-icon');
      statusIcon.classList.remove('connected');
      statusIcon.classList.add('disconnected');
    }
  }

  async function pollPeers() {
    try {
      const p = await window.laser.peers();
      setText('sb-connections', p.peers + ' active connection' + (p.peers !== 1 ? 's' : '') + ' to Laser network');
      setText('net-peers', p.peers);
      setText('net-connecting', p.connecting);
      setText('net-inbound', p.inbound);
      setText('net-outbound', p.outbound);
      setText('net-known', p.known);
      setText('net-discovery', p.discovery ? 'Yes' : 'No');
      setText('net-penalties', p.penalties);
      setText('net-bans', p.bans);
      setText('net-rejects-sent', p.rejects_sent);
      setText('net-rejects-recv', p.rejects_received);
      setText('net-queued-in', p.queued_in);
      setText('net-queued-out', p.queued_out);
    } catch (_) {
      setText('sb-connections', 'Peer data unavailable');
    }
  }

  // ── Wallet ─────────────────────────────────────────────────────

  function requestWalletName(action) {
    const dialog = document.getElementById('wallet-name-dialog');
    const title = document.getElementById('wallet-name-title');
    const message = document.getElementById('wallet-name-message');
    const input = document.getElementById('wallet-new-name');
    const error = document.getElementById('wallet-name-error');
    const submit = document.getElementById('wallet-name-submit');
    const restoring = action === 'restore';
    title.textContent = restoring ? 'Restore wallet' : 'Create wallet';
    message.textContent = restoring
      ? 'Choose the local name for the encrypted wallet backup.'
      : 'Choose a unique name for the new encrypted wallet.';
    submit.textContent = restoring ? 'Choose Backup' : 'Continue';
    error.textContent = 'Use letters, numbers, and underscore only.';
    error.classList.remove('error');
    input.value = '';

    return new Promise(resolve => {
      const cleanup = () => {
        submit.removeEventListener('click', onSubmit);
        dialog.removeEventListener('close', onClose);
        input.value = '';
      };
      const onClose = () => {
        const value = dialog.returnValue === 'accept'
          ? input.value.trim()
          : null;
        cleanup();
        resolve(value);
      };
      const onSubmit = async event => {
        event.preventDefault();
        const name = input.value.trim();
        if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
          error.textContent =
            'Wallet names may contain only letters, numbers, and underscore.';
          error.classList.add('error');
          input.focus();
          return;
        }
        try {
          if (await window.laser.walletExists(name)) {
            error.textContent = 'A wallet with that name already exists.';
            error.classList.add('error');
            input.focus();
            return;
          }
        } catch (failure) {
          error.textContent = failure.message;
          error.classList.add('error');
          return;
        }
        dialog.close('accept');
      };
      submit.addEventListener('click', onSubmit);
      dialog.addEventListener('close', onClose);
      dialog.returnValue = 'cancel';
      dialog.showModal();
      input.focus();
    });
  }

  async function refreshWalletList(preferredName = '') {
    const select = document.getElementById('ov-wallet-select');
    const openButton = document.getElementById('btn-wallet-open');
    const names = await window.laser.walletList();
    select.replaceChildren();
    if (names.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No wallets found';
      select.appendChild(option);
      select.disabled = true;
      openButton.disabled = true;
      return names;
    }
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.disabled = false;
    openButton.disabled = false;
    select.value = names.includes(preferredName) ? preferredName : names[0];
    return names;
  }

  function requestWalletPassphrase(name, exists) {
    const dialog = document.getElementById('wallet-passphrase-dialog');
    const title = document.getElementById('wallet-passphrase-title');
    const passphrase = document.getElementById('wallet-passphrase');
    const confirmation = document.getElementById('wallet-passphrase-confirm');
    const confirmationRow = document.getElementById('wallet-passphrase-confirm-row');
    const message = document.getElementById('wallet-passphrase-message');
    const error = document.getElementById('wallet-passphrase-error');
    const submit = document.getElementById('wallet-passphrase-submit');
    const creating = !exists;
    title.textContent = creating ? 'Create encrypted wallet' : 'Unlock encrypted wallet';
    message.textContent = creating
      ? 'Choose and confirm a passphrase for the new wallet "' + name + '".'
      : 'Enter the passphrase for the existing wallet "' + name + '".';
    confirmationRow.hidden = !creating;
    passphrase.autocomplete = creating ? 'new-password' : 'current-password';
    confirmation.autocomplete = 'new-password';
    submit.textContent = creating ? 'Create Wallet' : 'Unlock';
    error.textContent = creating
      ? 'Store this passphrase securely. It cannot be recovered. It stays in local process memory and is never placed in command arguments or environment variables.'
      : 'The passphrase stays in local process memory and is never placed in command arguments or environment variables.';
    error.classList.remove('error');
    passphrase.value = '';
    confirmation.value = '';

    return new Promise(resolve => {
      const cleanup = () => {
        submit.removeEventListener('click', onSubmit);
        dialog.removeEventListener('close', onClose);
        passphrase.value = '';
        confirmation.value = '';
      };
      const onClose = () => {
        const accepted = dialog.returnValue === 'accept';
        const value = accepted ? passphrase.value : null;
        cleanup();
        resolve(value);
      };
      const onSubmit = event => {
        event.preventDefault();
        if (!passphrase.value) {
          error.textContent = 'Enter a non-empty passphrase.';
          error.classList.add('error');
          passphrase.focus();
          return;
        }
        if (creating && passphrase.value !== confirmation.value) {
          error.textContent = 'Passphrases must match exactly.';
          error.classList.add('error');
          confirmation.focus();
          return;
        }
        dialog.close('accept');
      };
      submit.addEventListener('click', onSubmit);
      dialog.addEventListener('close', onClose);
      dialog.returnValue = 'cancel';
      dialog.showModal();
      passphrase.focus();
    });
  }

  async function activateWallet(w) {
    activeWallet = w;
    latestMinerMetrics = null;
    savePreferences({ wallet: w.name });
    setText('ov-balance', formatLaser(w.balance_photons));
    setText('ov-total', formatLaser(w.balance_photons));
    setText('ov-wnonce', w.nonce);
    document.getElementById('send-from').value = w.name;
    if (!lockedMiningWallet) {
      document.getElementById('mine-wallet').value = w.name;
    }
    document.getElementById('ov-wallet-select').value = w.name;
    document.getElementById('recv-wallet').value = w.name;
    document.getElementById('recv-address').value = w.address;
    document.getElementById('btn-wallet-lock').disabled = false;
    await pollMinerMetrics();
  }

  async function openWallet(name) {
    let passphrase = null;
    try {
      if (!await window.laser.walletUnlocked(name)) {
        passphrase = await requestWalletPassphrase(name, true);
        if (passphrase === null) return;
      }
      const w = await window.laser.walletOpen(name, passphrase);
      passphrase = null;
      await activateWallet(w);

      addActivity('Wallet "' + w.name + '" loaded — ' + w.address.substring(0, 16) + '…', 'info', '');
    } catch (e) {
      passphrase = null;
      addActivity('Failed to load wallet: ' + e.message, 'info', '');
    }
  }

  async function createWallet() {
    let passphrase = null;
    const name = await requestWalletName('create');
    if (name === null) return;
    try {
      passphrase = await requestWalletPassphrase(name, false);
      if (passphrase === null) return;
      const wallet = await window.laser.walletCreate(name, passphrase);
      passphrase = null;
      await refreshWalletList(name);
      await activateWallet(wallet);
      addActivity('Created encrypted wallet "' + name + '".', 'info', '');
    } catch (error) {
      passphrase = null;
      addActivity('Failed to create wallet: ' + error.message, 'info', '');
    }
  }

  async function restoreWallet() {
    const name = await requestWalletName('restore');
    if (name === null) return;
    try {
      const restored = await window.laser.walletRestore(name);
      if (!restored) return;
      await refreshWalletList(restored.name);
      addActivity(
        'Restored encrypted wallet "' + restored.name +
          '". Choose Open to unlock it.',
        'info',
        ''
      );
    } catch (error) {
      addActivity('Failed to restore wallet: ' + error.message, 'info', '');
    }
  }

  async function refreshBalance() {
    if (!activeWallet) return;
    try {
      const w = await window.laser.walletOpen(activeWallet.name);
      activeWallet = w;
      if (!latestMinerMetrics) {
        setText('ov-balance', formatLaser(w.balance_photons));
        setText('ov-total', formatLaser(w.balance_photons));
      }
      setText('ov-wnonce', w.nonce);
    } catch (_) {}
  }

  document.getElementById('btn-wallet-open').addEventListener('click', () => {
    const name = document.getElementById('ov-wallet-select').value;
    if (name) openWallet(name);
  });

  document.getElementById('btn-wallet-create')
    .addEventListener('click', createWallet);

  document.getElementById('btn-wallet-restore')
    .addEventListener('click', restoreWallet);

  document.getElementById('btn-wallet-lock').addEventListener('click', async () => {
    if (!activeWallet) return;
    const name = activeWallet.name;
    await window.laser.walletLock(name);
    activeWallet = null;
    latestMinerMetrics = null;
    document.getElementById('btn-wallet-lock').disabled = true;
    document.getElementById('recv-wallet').value = '';
    document.getElementById('recv-address').value = '';
    setText('ov-balance', formatLaser(0));
    setText('ov-total', formatLaser(0));
    setText('ov-wnonce', '—');
    addActivity('Wallet "' + name + '" locked and mining stopped.', 'info', '');
    await updateMineUI(false, await window.laser.mineStatus());
  });

  document.getElementById('btn-copy-addr').addEventListener('click', async () => {
    const addr = document.getElementById('recv-address').value;
    if (addr) {
      await window.laser.copyAddress(addr);
      const btn = document.getElementById('btn-copy-addr');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  });

  // ── Mining ─────────────────────────────────────────────────────

  let isMining = false;
  let miningStoppable = true;
  let lockedMiningWallet = null;
  let minedCount = 0;

  async function updateMineUI(mining, state = {}) {
    isMining = mining;
    latestMiningState = state;
    miningStoppable = state.stoppable !== false;
    lockedMiningWallet = mining && state.wallet ? state.wallet : null;
    const btn = document.getElementById('btn-mine-toggle');
    const indicator = document.getElementById('mine-indicator');
    const walletInput = document.getElementById('mine-wallet');
    const intervalInput = document.getElementById('mine-interval');
    const mineOnce = document.getElementById('btn-mine-once');
    if (lockedMiningWallet) walletInput.value = lockedMiningWallet;
    walletInput.disabled = mining;
    intervalInput.disabled = mining;
    mineOnce.disabled = mining;
    if (mining) {
      btn.textContent = miningStoppable ? 'Stop Mining' : 'Mining Active';
      btn.classList.add('mining');
      btn.disabled = !miningStoppable;
      btn.title = miningStoppable
        ? 'Stop continuous mining'
        : 'Auto-mining stops when Laser Core closes.';
      mineOnce.title = miningStoppable
        ? ''
        : 'One-shot mining is unavailable while auto-mining is active.';
      indicator.textContent = miningStoppable
        ? 'Mining active'
        : 'Auto-mining active — closes with Laser Core';
      indicator.classList.add('active');
    } else {
      btn.textContent = 'Start Mining';
      btn.classList.remove('mining');
      btn.disabled = false;
      btn.title = '';
      mineOnce.title = '';
      indicator.textContent = '';
      indicator.classList.remove('active');
    }
    renderSessionMetrics();
  }

  document.getElementById('btn-mine-toggle').addEventListener('click', async () => {
    const btn = document.getElementById('btn-mine-toggle');
    btn.disabled = true;

    if (!isMining) {
      const wallet = document.getElementById('mine-wallet').value.trim();
      if (!wallet) {
        const result = document.getElementById('mine-result');
        const resultText = document.getElementById('mine-result-text');
        result.style.display = '';
        result.className = 'result-box error';
        resultText.textContent = 'Enter a wallet name first.';
        btn.disabled = false;
        return;
      }
      const interval = parseInt(document.getElementById('mine-interval').value, 10) || 10;
      savePreferences({ mineInterval: interval });
      try {
        const state = await window.laser.mineStart(wallet, interval * 1000);
        updateMineUI(true, state);
        minedCount = 0;
        addActivity('Mining started — ' + wallet + ' (every ' + interval + 's)', 'mined', '');
      } catch (e) {
        const result = document.getElementById('mine-result');
        result.style.display = '';
        result.className = 'result-box error';
        document.getElementById('mine-result-text').textContent = e.message;
      }
    } else {
      try {
        const state = await window.laser.mineStop();
        updateMineUI(false, state);
        addActivity('Mining stopped — ' + minedCount + ' blocks mined', 'info', '');
      } catch (e) {
        const result = document.getElementById('mine-result');
        result.style.display = '';
        result.className = 'result-box error';
        document.getElementById('mine-result-text').textContent = e.message;
      }
    }
    btn.disabled = isMining && !miningStoppable;
  });

  document.getElementById('btn-mine-once').addEventListener('click', async () => {
    const wallet = document.getElementById('mine-wallet').value.trim();
    const countInput = document.getElementById('mine-once-count');
    const count = Number(countInput.value);
    const btn = document.getElementById('btn-mine-once');
    const result = document.getElementById('mine-result');
    const resultText = document.getElementById('mine-result-text');

    result.style.display = '';

    if (!nodeOnline) {
      result.className = 'result-box error';
      resultText.textContent = 'The local node is offline. Wait for RPC to reconnect.';
      return;
    }
    if (!wallet) {
      result.className = 'result-box error';
      resultText.textContent = 'Load or enter a mining wallet first.';
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      result.className = 'result-box error';
      resultText.textContent = 'Block count must be an integer from 1 to 100.';
      return;
    }
    if (isMining) {
      result.className = 'result-box error';
      resultText.textContent = 'Stop continuous mining before mining a one-shot batch.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Mining...';
    try {
      const message = await window.laser.mine(wallet, count);
      minedCount += count;
      setText('mine-count-display', minedCount);
      result.className = 'result-box success';
      resultText.textContent = message;
      addActivity(
        'Mined ' + count + ' block' + (count === 1 ? '' : 's') + ' for ' + wallet,
        'mined',
        '+' + count + ' blk'
      );
      await pollStatus();
    } catch (e) {
      result.className = 'result-box error';
      resultText.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Mine Now';
    }
  });

  // Listen for mined blocks from main process
  window.laser.onBlockMined((state) => {
    latestMiningState = state;
    minedCount = state && state.session ? state.session.blocks : minedCount + 1;
    renderSessionMetrics();
    pollStatus();
  });

  window.laser.onMineError((msg, state) => {
    if (state) latestMiningState = state;
    renderSessionMetrics();
    const result = document.getElementById('mine-result');
    result.style.display = '';
    result.className = 'result-box error';
    document.getElementById('mine-result-text').textContent = msg;
  });

  // Check if mining was already running (in case of reload)
  window.laser.mineStatus().then(s => updateMineUI(Boolean(s.mining), s));

  // ── Send ───────────────────────────────────────────────────────

  document.getElementById('btn-send').addEventListener('click', async () => {
    const from = document.getElementById('send-from').value.trim();
    const to = document.getElementById('send-to').value.trim();
    let amount = document.getElementById('send-amount').value.trim();
    let fee = document.getElementById('send-fee').value.trim();
    const result = document.getElementById('send-result');
    const resultText = document.getElementById('send-result-text');

    if (!from || !to || !amount) {
      result.style.display = '';
      result.className = 'result-box error';
      resultText.textContent = 'Fill in Pay To, Amount, and From Wallet.';
      return;
    }

    if (!nodeOnline) {
      showResult('error', 'The local node is offline. Wait for RPC to reconnect before sending.');
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(to)) {
      showResult('error', 'Pay To must be a valid 64-character hexadecimal Laser address.');
      return;
    }

    const enteredAmount = parseLaser(amount);
    const feePhotons = parseLaser(fee || '0.01');
    if (enteredAmount === null || enteredAmount <= 0n) {
      showResult('error', 'Amount must be greater than zero with no more than 9 decimal places.');
      return;
    }
    if (feePhotons === null || feePhotons < 0n) {
      showResult('error', 'Fee must be zero or greater with no more than 9 decimal places.');
      return;
    }

    const subtractFee = document.getElementById('send-subtract-fee').checked;
    if (subtractFee && enteredAmount <= feePhotons) {
      showResult('error', 'The amount must be greater than the fee when subtracting it.');
      return;
    }

    const recipientPhotons = subtractFee
      ? enteredAmount - feePhotons
      : enteredAmount;
    const totalPhotons = subtractFee
      ? enteredAmount
      : enteredAmount + feePhotons;
    if (totalPhotons > 18446744073709551615n) {
      showResult('error', 'Amount and fee exceed the protocol maximum.');
      return;
    }
    amount = formatLaserValue(recipientPhotons);
    fee = formatLaserValue(feePhotons);

    if (activeWallet && activeWallet.name === from &&
        BigInt(activeWallet.balance_photons) < totalPhotons) {
      showResult('error', 'Insufficient wallet balance for the amount and transaction fee.');
      return;
    }

    const confirmed = await confirmSend({
      from,
      to: to.toLowerCase(),
      amount,
      fee,
      total: formatLaserValue(totalPhotons)
    });
    if (!confirmed) return;

    const btn = document.getElementById('btn-send');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const msg = await window.laser.send(from, to, amount, fee || null);
      result.style.display = '';
      result.className = 'result-box success';
      resultText.textContent = msg;
      if (document.getElementById('send-label').value.trim()) saveContact(false);
      addActivity('Sent ' + amount + ' LASER → ' + to.substring(0, 12) + '…', 'sent', '-' + amount);
      pollStatus();
    } catch (e) {
      result.style.display = '';
      result.className = 'result-box error';
      resultText.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  });

  document.getElementById('btn-clear-send').addEventListener('click', () => {
    document.getElementById('send-to').value = '';
    document.getElementById('send-label').value = '';
    document.getElementById('send-amount').value = '';
    document.getElementById('send-fee').value = '0.01';
    document.getElementById('send-result').style.display = 'none';
    document.getElementById('fee-recommended').checked = true;
    document.getElementById('send-fee').disabled = true;
    document.getElementById('fee-target').disabled = false;
    document.getElementById('send-subtract-fee').checked = false;
  });

  document.getElementById('btn-save-contact').addEventListener('click', () => {
    saveContact(true);
  });

  const sendToInput = document.getElementById('send-to');
  sendToInput.setAttribute('list', 'address-book-suggestions');
  sendToInput.addEventListener('change', () => {
    const label = contacts[sendToInput.value.trim().toLowerCase()];
    if (label) document.getElementById('send-label').value = label;
  });

  // Fee mode toggle: recommended vs custom
  document.getElementById('fee-recommended').addEventListener('change', () => {
    document.getElementById('send-fee').disabled = true;
    document.getElementById('fee-target').disabled = false;
    const val = document.getElementById('fee-target').value;
    document.getElementById('send-fee').value = val;
    document.getElementById('fee-rate-display').textContent = parseFloat(val).toFixed(9) + ' LASER flat fee';
  });

  document.getElementById('fee-custom').addEventListener('change', () => {
    document.getElementById('send-fee').disabled = false;
    document.getElementById('fee-target').disabled = true;
    document.getElementById('send-fee').focus();
  });

  document.getElementById('fee-target').addEventListener('change', (e) => {
    document.getElementById('send-fee').value = e.target.value;
    document.getElementById('fee-rate-display').textContent = parseFloat(e.target.value).toFixed(9) + ' LASER flat fee';
    savePreferences({ feeTarget: e.target.value });
  });

  document.getElementById('fee-pay-only').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.getElementById('send-fee').value = '0.001';
      document.getElementById('fee-recommended').checked = false;
      document.getElementById('fee-custom').checked = true;
      document.getElementById('send-fee').disabled = true;
      document.getElementById('fee-target').disabled = true;
    } else {
      document.getElementById('fee-recommended').checked = true;
      document.getElementById('send-fee').disabled = true;
      document.getElementById('fee-target').disabled = false;
      const val = document.getElementById('fee-target').value;
      document.getElementById('send-fee').value = val;
    }
  });

  // ── Init ───────────────────────────────────────────────────────

  const preferredWallet = preferences.wallet || '';
  refreshWalletList(preferredWallet).catch(error => {
    addActivity('Unable to list wallets: ' + error.message, 'info', '');
  });

  const preferredInterval = Number(preferences.mineInterval);
  if (Number.isInteger(preferredInterval) && preferredInterval >= 1 && preferredInterval <= 120) {
    document.getElementById('mine-interval').value = String(preferredInterval);
  }

  if (preferences.feeTarget) {
    const feeTarget = document.getElementById('fee-target');
    const matchingOption = Array.from(feeTarget.options)
      .some(option => option.value === preferences.feeTarget);
    if (matchingOption) {
      feeTarget.value = preferences.feeTarget;
      document.getElementById('send-fee').value = preferences.feeTarget;
      setText('fee-rate-display', parseFloat(preferences.feeTarget).toFixed(9) + ' LASER flat fee');
    }
  }

  document.querySelector('.fee-confirm-label').textContent = 'Fee preset:';
  const feePresetLabels = {
    '0.05': 'Priority (0.05 LASER)',
    '0.02': 'High (0.02 LASER)',
    '0.01': 'Standard (0.01 LASER)',
    '0.005': 'Low (0.005 LASER)',
    '0.001': 'Minimum (0.001 LASER)'
  };
  Array.from(document.getElementById('fee-target').options).forEach(option => {
    option.textContent = feePresetLabels[option.value] || option.textContent;
  });
  const currentFee = document.getElementById('send-fee').value;
  setText('fee-rate-display', parseFloat(currentFee).toFixed(9) + ' LASER flat fee');

  renderAddressBook();
  pollStatus();
  pollPeers();
  setInterval(() => { pollStatus(); pollPeers(); }, 3000);
  setInterval(renderSessionMetrics, 1000);

})();
