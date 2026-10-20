const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  net,
  protocol,
  session
} = require('electron');
const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseExactJSON } = require('./exact-json');
const { pathToFileURL } = require('url');
const {
  buildNodeArgs,
  discoverBuildCandidates,
  resolveRuntime
} = require('./runtime-config');
const { WalletSecretStore } = require('./wallet-secret-store');
const {
  listWallets,
  normalizeWalletName,
  restoreEncryptedWallet,
  walletFilePath
} = require('./wallet-files');
const {
  ExplorerPublisher,
  resolvePublisherConfig
} = require('./explorer-publisher');
const {
  blockCount,
  laserAddress,
  laserValue,
  MAX_PROTOCOL_PHOTONS
} = require('./ipc-validation');

const LASER_RENDERER_SCHEME = 'laser-core';
protocol.registerSchemesAsPrivileged([{
  scheme: LASER_RENDERER_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    bypassCSP: false,
    allowServiceWorkers: false,
    supportFetchAPI: false,
    corsEnabled: false,
    codeCache: false,
    allowExtensions: false
  }
}]);

// Configuration
const runtime = resolveRuntime({
  appDir: __dirname,
  resourcesPath: process.resourcesPath,
  isPackaged: app.isPackaged,
  userData: app.getPath('userData')
});
const LASERD_BIN = runtime.laserd;
const LASER_BIN = runtime.laser;
const LASER_SHADOW_BIN = runtime.shadow;
const LASER_CUDA_MINER_BIN = runtime.cudaMiner;
const LASER_RPC = runtime.rpc;
const LASER_LISTEN = runtime.listen;
const LASER_ADVERTISE = runtime.advertise;
const LASER_DATADIR = runtime.dataDir;
const LASER_NETWORK = runtime.network;
const LASER_CWD = runtime.workingDir;
const LASER_PEERS = runtime.peers;
const LASER_SHADOW_DIR = path.join(path.dirname(LASER_DATADIR), 'shadownet-evidence');
const LASER_SHADOW_OUTPUT = path.join(LASER_SHADOW_DIR, 'laser-shadow.jsonl');
const LASER_APP_ICON = path.join(__dirname, 'renderer', 'logo.png');
const LASER_RENDERER_URL = 'laser-core://app/index.html';
const LASER_SPLASH_URL = 'laser-core://app/splash.html';
const LASER_RENDERER_RESOURCES = new Map([
  ['/index.html', 'index.html'],
  ['/splash.html', 'splash.html'],
  ['/style.css', 'style.css'],
  ['/app.js', 'app.js'],
  ['/template.js', 'template.js'],
  ['/vendor/react-18.3.1.min.js', 'vendor/react-18.3.1.min.js'],
  ['/vendor/react-dom-18.3.1.min.js', 'vendor/react-dom-18.3.1.min.js'],
  ['/assets/laser-vector.svg', 'assets/laser-vector.svg'],
  ['/assets/Michroma-Regular.ttf', 'assets/Michroma-Regular.ttf'],
  ['/assets/Geist-Regular.ttf', 'assets/Geist-Regular.ttf'],
  ['/assets/Geist-Medium.ttf', 'assets/Geist-Medium.ttf'],
  ['/assets/Geist-Semibold.ttf', 'assets/Geist-Semibold.ttf'],
  ['/assets/GeistMono-Regular.ttf', 'assets/GeistMono-Regular.ttf'],
  ['/assets/GeistMono-Medium.ttf', 'assets/GeistMono-Medium.ttf'],
  ['/splash.js', 'splash.js'],
  ['/logo.png', 'logo.png']
]);

function registerRendererProtocol() {
  protocol.handle(LASER_RENDERER_SCHEME, async request => {
    const requestUrl = new URL(request.url);
    const fileName = requestUrl.host === 'app' &&
      request.method === 'GET' &&
      !requestUrl.search &&
      !requestUrl.hash &&
      LASER_RENDERER_RESOURCES.get(requestUrl.pathname);
    if (!fileName) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    const response = await net.fetch(pathToFileURL(
      path.join(__dirname, 'renderer', fileName)
    ).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  });
}

function hardenLocalWindow(window, expectedUrl) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== expectedUrl) event.preventDefault();
  });
}

function registerTrustedIpcHandler(channel, expectedUrl, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || event.senderFrame.url !== expectedUrl) {
      throw new Error('Rejected untrusted IPC sender.');
    }
    return listener(event, ...args);
  });
}

function registerMainHandler(channel, listener) {
  registerTrustedIpcHandler(channel, LASER_RENDERER_URL, listener);
}

function registerSplashHandler(channel, listener) {
  registerTrustedIpcHandler(channel, LASER_SPLASH_URL, listener);
}

let mainWindow;
let splashWindow = null;
let laserdProcess = null;
let shadowProcess = null;
let shadowStopping = false;
let nodeStartupError = runtime.error;
let shadowError = null;
let shadowStartedAt = null;
let nodeStderr = [];
let nodeReady = false;
let activeNodeVersion = null;
let explorerPublisher = null;
let miningBackend = 'cpu';
let cudaAvailable = false;
let powProfile = 'photonhash-v02';

function updateMiningBackend(status) {
  if (!status) return;
  if (status.mining_backend === 'cuda' || status.mining_backend === 'cpu') {
    miningBackend = status.mining_backend;
  }
  cudaAvailable = status.cuda_available === true ||
    status.cuda_available === 1;
  if (typeof status.pow_profile === 'string' && status.pow_profile) {
    powProfile = status.pow_profile;
  }
}

function readBuildInfo(directory) {
  const file = path.join(directory, 'BUILDINFO.txt');
  try {
    const result = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0) {
        result[line.slice(0, separator)] = line.slice(separator + 1);
      }
    }
    return result;
  } catch (_) {
    return {};
  }
}

function inspectBuild(candidate) {
  const info = readBuildInfo(candidate.directory);
  let nodeVersion = 'unknown node version';
  try {
    nodeVersion = execFileSync(candidate.laserd, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim();
  } catch (_) {}
  const version = nodeVersion.replace(/^laserd\s+/i, '');
  const storeFormat = info.store_format ||
    (candidate.channel === 'sandbox-v2' ? '1' : '3');
  const protocol = info.wire_protocol || info.protocol ||
    (candidate.channel === 'sandbox-v2' ? '2' : '3');
  return {
    ...candidate,
    version,
    nodeVersion,
    protocol,
    storeFormat,
    sourceCommit: info.source_commit || null,
    patches: info.compat_patches ?
      info.compat_patches.split(',').filter(Boolean) : [],
    label: version + ' - ' + candidate.channel
  };
}

function installedBuilds() {
  return discoverBuildCandidates(runtime, {
    appDir: __dirname,
    resourcesPath: process.resourcesPath
  }).map(inspectBuild);
}

function activeBuildIdentity() {
  return installedBuilds().find(build => build.active) || {
    channel: runtime.channel,
    version: activeNodeVersion ?
      activeNodeVersion.replace(/^laserd\s+/i, '') : 'unknown',
    nodeVersion: activeNodeVersion || 'unknown',
    protocol: runtime.channel === 'sandbox-v2' ? '2' : '3',
    storeFormat: runtime.storeVersion || 'new',
    sourceCommit: null,
    patches: [],
    active: true,
    compatible: true,
    laser: LASER_BIN,
    laserd: LASERD_BIN
  };
}

// ── Node management ────────────────────────────────────────────

function startNode() {
  if (laserdProcess) return true;
  if (nodeStartupError) {
    console.error('[laser-core]', nodeStartupError);
    return false;
  }

  try {
    const actualVersion = execFileSync(LASERD_BIN, ['--version'], {
      cwd: LASER_CWD,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim();
    activeNodeVersion = actualVersion;
    if (runtime.expectedNodeVersion &&
        actualVersion !== runtime.expectedNodeVersion) {
      nodeStartupError =
        `Expected ${runtime.expectedNodeVersion}, found ${actualVersion}.`;
      console.error('[laser-core]', nodeStartupError);
      return false;
    }
  } catch (error) {
    nodeStartupError = `Node preflight failed: ${error.message}`;
    console.error('[laser-core]', nodeStartupError);
    return false;
  }

  const args = buildNodeArgs(runtime);

  console.log('[laser-core] Starting node:', LASERD_BIN, args.join(' '));

  laserdProcess = spawn(LASERD_BIN, args, {
    cwd: LASER_CWD,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  laserdProcess.stdout.on('data', (data) => {
    console.log('[laserd]', data.toString().trim());
  });

  laserdProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      nodeStderr.push(message);
      nodeStderr = nodeStderr.slice(-8);
      console.error('[laserd]', message);
    }
  });

  laserdProcess.on('exit', (code) => {
    console.log('[laser-core] Node exited with code', code);
    if (!nodeReady && code !== 0) {
      nodeStartupError = nodeStderr.join('\n') ||
        `Node exited before RPC became ready (code ${code}).`;
      updateSplash('Node failed: ' + nodeStartupError, 100);
    }
    laserdProcess = null;
    if (shadowProcess && !hasProcessExited(shadowProcess)) shadowProcess.kill();
  });

  laserdProcess.on('error', (err) => {
    console.error('[laser-core] Failed to start node:', err.message);
    nodeStartupError = `Failed to start node: ${err.message}`;
    updateSplash(nodeStartupError, 100);
    laserdProcess = null;
  });
  return true;
}

function currentShadowState() {
  const enabled = runtime.channel === 'v3' && LASER_NETWORK === 'shadow';
  return {
    enabled,
    state: !enabled ? 'disabled' :
      (shadowProcess && !hasProcessExited(shadowProcess) ? 'active' :
        (shadowError ? 'error' : 'stopped')),
    protocol: enabled ? 'photonhash-shadow/1' : null,
    candidate: enabled ? 'PhotonHash v0.4.0-shadow.1 LF2-K8' : null,
    startedAt: shadowStartedAt,
    error: shadowError
  };
}

function startShadow() {
  if (runtime.channel !== 'v3' || LASER_NETWORK !== 'shadow') return true;
  if (shadowProcess && !hasProcessExited(shadowProcess)) return true;
  if (!LASER_SHADOW_BIN) {
    shadowError = 'Shadownet sidecar binary is unavailable.';
    return false;
  }
  try {
    fs.mkdirSync(LASER_SHADOW_DIR, { recursive: true, mode: 0o700 });
    const attempts = process.env.LASER_SHADOW_ATTEMPTS || '8';
    const pollMs = process.env.LASER_SHADOW_POLL_MS || '1000';
    const args = [
      '--rpc', LASER_RPC,
      '--datadir', LASER_DATADIR,
      '--network', LASER_NETWORK,
      '--output', LASER_SHADOW_OUTPUT,
      '--miner-id', 'laser-core',
      '--attempts', attempts,
      '--poll-ms', pollMs
    ];
    shadowError = null;
    shadowStopping = false;
    shadowStartedAt = new Date().toISOString();
    shadowProcess = spawn(LASER_SHADOW_BIN, args, {
      cwd: LASER_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    shadowProcess.stdout.on('data', data => {
      const message = data.toString().trim();
      if (message) console.log('[laser-shadow]', message);
    });
    shadowProcess.stderr.on('data', data => {
      const message = data.toString().trim();
      if (message) console.error('[laser-shadow]', message);
    });
    shadowProcess.on('error', error => {
      shadowError = error.message;
      shadowProcess = null;
    });
    shadowProcess.on('exit', code => {
      if (!shadowStopping && code !== 0 && shadowError === null)
        shadowError = `laser-shadow exited with code ${code}`;
      shadowStopping = false;
      shadowProcess = null;
    });
    return true;
  } catch (error) {
    shadowError = error.message;
    shadowProcess = null;
    return false;
  }
}

function hasProcessExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForProcessExit(child, timeoutMs) {
  if (hasProcessExited(child)) return Promise.resolve(true);

  return new Promise(resolve => {
    let settled = false;
    const finish = exited => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    if (hasProcessExited(child)) finish(true);
  });
}

async function stopNode() {
  const processToStop = laserdProcess;
  if (!processToStop || hasProcessExited(processToStop)) return true;

  console.log('[laser-core] Stopping node gracefully...');
  const gracefulExit = waitForProcessExit(processToStop, 6000);

  try {
    await laserCmd([
      'node', 'stop', '--rpc', LASER_RPC,
      '--datadir', LASER_DATADIR, '--network', LASER_NETWORK
    ], 3000);
  } catch (error) {
    console.warn('[laser-core] Graceful node stop failed:', error.message);
    if (!hasProcessExited(processToStop)) {
      try {
        processToStop.kill();
      } catch (killError) {
        console.error('[laser-core] Failed to terminate node:', killError.message);
      }
    }
    return await waitForProcessExit(processToStop, 2000);
  }

  if (await gracefulExit) {
    console.log('[laser-core] Node stopped cleanly.');
    return true;
  }

  console.warn('[laser-core] Node did not exit after RPC stop; terminating it.');
  try {
    processToStop.kill();
  } catch (error) {
    console.error('[laser-core] Failed to terminate node:', error.message);
  }

  const forcedExit = await waitForProcessExit(processToStop, 2000);
  if (!forcedExit) {
    console.error('[laser-core] Node process did not exit before shutdown timeout.');
  }
  return forcedExit;
}

async function stopShadow() {
  const processToStop = shadowProcess;
  if (!processToStop || hasProcessExited(processToStop)) return true;
  try {
    shadowStopping = true;
    processToStop.kill();
  } catch (error) {
    shadowStopping = false;
    shadowError = error.message;
    return false;
  }
  const stopped = await waitForProcessExit(processToStop, 3000);
  if (!stopped) shadowError = 'laser-shadow did not stop before timeout';
  return stopped;
}

// ── Window ─────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    show: false,
    center: true,
    icon: LASER_APP_ICON,
    title: `Laser Core — [${LASER_NETWORK} / ${runtime.channel}]`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false
    },
    autoHideMenuBar: false,
    backgroundColor: '#f8f8f6'
  });

  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'Options...', enabled: false }
      ]
    },
    {
      label: 'Builds',
      submenu: installedBuilds().length > 0 ?
        installedBuilds().map(build => ({
          label: build.label,
          click: () => showBuildDetails(build)
        })) :
        [{ label: 'No complete node builds found', enabled: false }]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Laser Core', click: showAbout }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  hardenLocalWindow(mainWindow, LASER_RENDERER_URL);
  mainWindow.loadURL(LASER_RENDERER_URL);
}

function showBuildDetails(build) {
  const { dialog } = require('electron');
  const compatibility = build.compatible ?
    'Compatible with the current data directory.' :
    'Not compatible with the current data directory.';
  dialog.showMessageBox(mainWindow, {
    type: build.compatible ? 'info' : 'warning',
    title: 'Laser Node Build',
    message: build.nodeVersion,
    detail:
      `Channel: ${build.channel}\nProtocol: ${build.protocol}\n` +
      `Store format: ${build.storeFormat}\n${compatibility}\n` +
      `Source: ${build.sourceCommit || 'working tree build'}\n` +
      `Node: ${build.laserd}\nCLI: ${build.laser}\n\n` +
      'Laser Core selects builds from data-directory compatibility and never rewrites chain data.'
  });
}

function showAbout() {
  const { dialog } = require('electron');
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Laser Core',
    message: `Laser Core v${app.getVersion()}`,
    detail: (() => {
      const build = activeBuildIdentity();
      return `Node: ${build.nodeVersion}\nChannel: ${runtime.channel}\nProtocol: ${build.protocol}\nStore format: ${build.storeFormat}\nNetwork: ${LASER_NETWORK}\nP2P bind: ${LASER_LISTEN}\nP2P advertise: ${LASER_ADVERTISE || 'same as bind'}\nRPC: ${LASER_RPC}\nDatadir: ${LASER_DATADIR}\nPeers: ${LASER_PEERS.join(', ') || 'none configured'}\n\nLaser is experimental testnet software.\nSee NOTICE.txt for licensing information.`;
    })()
  });
}

// ── IPC Handlers (shell out to laser CLI) ──────────────────────

function laserCmd(args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(LASER_BIN, args, { timeout, cwd: LASER_CWD }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout.trim());
    });
  });
}

const WALLET_SECRET_TTL_MS = 5 * 60 * 1000;
const walletSecrets = new WalletSecretStore({ ttlMs: WALLET_SECRET_TTL_MS });

function walletName(value) {
  return normalizeWalletName(value);
}

function lockWalletSecret(name) {
  walletSecrets.lock(name);
}

function rememberWalletSecret(name, passphrase) {
  walletSecrets.remember(name, passphrase);
}

function walletSecret(name) {
  return walletSecrets.get(name);
}

function laserCmdWithPassphrase(args, name, timeout = 15000) {
  const secret = walletSecret(name);
  return new Promise((resolve, reject) => {
    const child = spawn(
      LASER_BIN,
      [...args, '--passphrase-stdin'],
      { cwd: LASER_CWD, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer = null;
    let input = null;
    const clearInput = () => {
      if (!input) return;
      input.fill(0);
      input = null;
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInput();
      if (error) reject(error);
      else resolve(value);
    };
    const collect = target => data => {
      outputBytes += data.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        finish(new Error('Wallet command exceeded its output limit.'));
        return;
      }
      target.push(data);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', error => finish(error));
    child.on('close', code => {
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      finish(code === 0 ? null : new Error(err || out || 'Wallet command failed.'), out);
    });
    timer = setTimeout(() => {
      child.kill();
      finish(new Error('Wallet command timed out.'));
    }, timeout);
    input = Buffer.alloc(secret.length * 2 + 2);
    secret.copy(input, 0);
    input[secret.length] = 10;
    secret.copy(input, secret.length + 1);
    input[input.length - 1] = 10;
    child.stdin.on('error', clearInput);
    child.stdin.end(input, clearInput);
  });
}

function walletCommand(args, name, timeout = 15000) {
  return runtime.channel === 'sandbox-v2'
    ? laserCmd(args, timeout)
    : laserCmdWithPassphrase(args, name, timeout);
}

function updateSplash(text, progress) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send('splash:status', { text, progress });
}

async function waitForNodeReady(timeoutMs = 300000) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastRpcError = '';

  while (Date.now() - startedAt < timeoutMs) {
    if (nodeStartupError) {
      updateSplash('Node failed: ' + nodeStartupError, 100);
      return { ready: false, status: null, error: nodeStartupError };
    }
    attempt++;
    updateSplash(
      attempt < 3 ? 'Starting node...' : 'Waiting for RPC interface...',
      Math.min(85, 18 + attempt * 6)
    );

    try {
      const raw = await laserCmd([
        'node', 'status', '--rpc', LASER_RPC,
        '--datadir', LASER_DATADIR, '--network', LASER_NETWORK, '--json'
      ], 1800);
      const status = parseExactJSON(raw);
      updateMiningBackend(status);
      nodeReady = true;
      updateSplash('Node ready at height ' + status.height, 100);
      return { ready: true, status };
    } catch (error) {
      lastRpcError = error.message;
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }

  nodeStartupError = nodeStartupError ||
    `RPC did not become ready: ${lastRpcError || 'startup timed out'}`;
  updateSplash('Node unavailable: ' + nodeStartupError, 100);
  return { ready: false, status: null, error: nodeStartupError };
}

registerMainHandler('laser:startup', () => ({
  appVersion: app.getVersion(),
  ready: nodeReady,
  error: nodeStartupError,
  stderr: nodeStderr,
  channel: runtime.channel,
  storeVersion: runtime.storeVersion,
  node: LASERD_BIN,
  cli: LASER_BIN,
  shadow: currentShadowState()
}));

registerSplashHandler('splash:identity', () => ({
  appVersion: app.getVersion(),
  network: LASER_NETWORK,
  channel: runtime.channel,
  storeVersion: runtime.storeVersion,
  build: activeBuildIdentity()
}));

registerMainHandler('laser:status', async () => {
  const raw = await laserCmd([
    'node', 'status', '--rpc', LASER_RPC,
    '--datadir', LASER_DATADIR, '--network', LASER_NETWORK, '--json'
  ]);
  const status = parseExactJSON(raw);
  updateMiningBackend(status);
  return { ...status, shadow: currentShadowState() };
});

registerMainHandler('laser:peers', async () => {
  const raw = await laserCmd([
    'peer', 'list', '--rpc', LASER_RPC,
    '--datadir', LASER_DATADIR, '--network', LASER_NETWORK, '--json'
  ]);
  return parseExactJSON(raw);
});

async function openWalletRecord(requestedName, passphrase, requireExisting) {
  const name = walletName(requestedName);
  const exists = fs.existsSync(walletFilePath(LASER_CWD, name));
  if (requireExisting && !exists) {
    throw new Error('Select an existing wallet before choosing Open.');
  }
  if (requireExisting === false && exists) {
    throw new Error('A wallet with that name already exists.');
  }
  if (passphrase !== undefined && passphrase !== null)
    rememberWalletSecret(name, passphrase);
  let walletOut;
  try {
    walletOut = await walletCommand(['wallet', name], name);
  } catch (error) {
    lockWalletSecret(name);
    throw error;
  }
  const lines = walletOut.split('\n').map(l => l.trim()).filter(Boolean);
  let address = '';
  for (const line of lines) {
    if (line.startsWith('Address:')) address = line.replace('Address:', '').trim();
  }
  let balance = null, nonce = null;
  try {
    const balOut = await walletCommand([
      'node', 'balance', name, '--rpc', LASER_RPC,
      '--datadir', LASER_DATADIR, '--network', LASER_NETWORK, '--json'
    ], name);
    const parsed = parseExactJSON(balOut);
    balance = parsed.balance_photons ?? null;
    nonce = parsed.nonce ?? null;
  } catch (_) {}
  return { name, address, balance_photons: balance, nonce };
}

registerMainHandler('laser:wallet-list', () => listWallets(LASER_CWD));

registerMainHandler('laser:wallet-open', async (_event, name, passphrase) => {
  return await openWalletRecord(name, passphrase, true);
});

registerMainHandler('laser:wallet-create', async (_event, name, passphrase) => {
  return await openWalletRecord(name, passphrase, false);
});

registerMainHandler('laser:wallet-restore', async (_event, requestedName) => {
  const name = walletName(requestedName);
  if (fs.existsSync(walletFilePath(LASER_CWD, name))) {
    throw new Error('A wallet with that name already exists.');
  }
  const { dialog } = require('electron');
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore encrypted Laser wallet',
    properties: ['openFile'],
    filters: [
      { name: 'Laser wallet backup', extensions: ['key'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (selection.canceled || selection.filePaths.length !== 1) return null;
  try {
    restoreEncryptedWallet(LASER_CWD, selection.filePaths[0], name);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error('A wallet with that name already exists.');
    }
    throw error;
  }
  return { name };
});

registerMainHandler('laser:wallet-unlocked', (_event, requestedName) => {
  const name = walletName(requestedName);
  if (runtime.channel === 'sandbox-v2') return true;
  return walletSecrets.has(name);
});

registerMainHandler('laser:wallet-exists', (_event, requestedName) => {
  const name = walletName(requestedName);
  return fs.existsSync(walletFilePath(LASER_CWD, name));
});

registerMainHandler('laser:copy-address', (_event, address) => {
  const normalized = String(address || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Only a valid Laser address can be copied.');
  }
  clipboard.writeText(normalized);
  return true;
});

async function queryMinerMetrics(wallet) {
  const name = walletName(wallet);
  const raw = await walletCommand([
    'node', 'miner', name, '--rpc', LASER_RPC,
    '--datadir', LASER_DATADIR, '--network', LASER_NETWORK, '--json'
  ], name);
  return parseExactJSON(raw);
}

registerMainHandler('laser:miner-metrics', async (_event, wallet) => {
  if (!wallet || !String(wallet).trim()) {
    throw new Error('Load a wallet before requesting miner metrics.');
  }
  return await queryMinerMetrics(String(wallet).trim());
});

registerMainHandler('laser:mine', async (_event, wallet, count) => {
  const name = walletName(wallet);
  const requestedCount = blockCount(count);
  return await walletCommand([
    'node', 'mine', name, String(requestedCount),
    '--rpc', LASER_RPC, '--datadir', LASER_DATADIR, '--network', LASER_NETWORK
  ], name, 120000);
});

// ── Auto-mine management ───────────────────────────────────────

let mineTimer = null;
let mineWallet = null;
let mineIntervalMs = 10000;
let miningEnabled = false;
let mineGeneration = 0;
let mineSessionStartedAt = null;
let mineSessionBlocks = 0;
let mineSessionErrors = 0;
let mineSessionLastBlockAt = null;
let mineSessionLastDurationMs = null;
let mineSessionTotalSolveMs = 0;
let mineSessionBaselinePhotons = null;
let mineNextRunAt = null;

function stopMiningForWallet(name) {
  if (mineWallet !== name) return;
  miningEnabled = false;
  mineGeneration++;
  if (mineTimer) clearTimeout(mineTimer);
  mineTimer = null;
  mineWallet = null;
  mineNextRunAt = null;
}

registerMainHandler('laser:wallet-lock', (_event, requestedName) => {
  const name = walletName(requestedName);
  stopMiningForWallet(name);
  lockWalletSecret(name);
  return true;
});

function resetMiningSession(wallet, baselinePhotons = null) {
  mineWallet = wallet;
  mineSessionStartedAt = Date.now();
  mineSessionBlocks = 0;
  mineSessionErrors = 0;
  mineSessionLastBlockAt = null;
  mineSessionLastDurationMs = null;
  mineSessionTotalSolveMs = 0;
  mineSessionBaselinePhotons = baselinePhotons;
  mineNextRunAt = null;
}

function miningStatus() {
  return {
    mining: miningEnabled,
    wallet: mineWallet,
    interval: mineIntervalMs,
    automatic: false,
    stoppable: true,
    backend: miningBackend,
    cuda_available: cudaAvailable,
    cpu_fallback: true,
    pow_profile: powProfile,
    session: {
      started_at: mineSessionStartedAt,
      blocks: mineSessionBlocks,
      errors: mineSessionErrors,
      last_block_at: mineSessionLastBlockAt,
      last_duration_ms: mineSessionLastDurationMs,
      total_solve_ms: mineSessionTotalSolveMs,
      baseline_total_photons: mineSessionBaselinePhotons,
      next_run_at: mineNextRunAt
    }
  };
}

registerMainHandler('laser:mine-start', async (_event, wallet, intervalMs) => {
  if (!wallet || !String(wallet).trim()) {
    throw new Error('Load a wallet before auto-mining.');
  }
  const requestedWallet = walletName(wallet);
  mineIntervalMs = Number.isInteger(intervalMs) && intervalMs >= 1000
    ? Math.min(intervalMs, 600000)
    : 10000;

  if (mineWallet !== requestedWallet || mineSessionStartedAt === null) {
    let baseline = null;
    try {
      const metrics = await queryMinerMetrics(requestedWallet);
      baseline = metrics.total_mined_photons;
    } catch (error) {
      console.warn('[laser-core] Miner baseline unavailable:', error.message);
    }
    resetMiningSession(requestedWallet, baseline);
  }

  if (miningEnabled) {
    return miningStatus();
  }
  if (mineTimer) clearTimeout(mineTimer);
  const generation = ++mineGeneration;
  miningEnabled = true;

  const doMine = async () => {
    if (!miningEnabled || generation !== mineGeneration) return;
    const jobWallet = mineWallet;
    const jobStartedAt = Date.now();
    mineNextRunAt = null;
    try {
      await walletCommand([
        'node', 'mine', jobWallet, '1',
        '--rpc', LASER_RPC, '--datadir', LASER_DATADIR, '--network', LASER_NETWORK
      ], jobWallet, 120000);
      if (jobWallet === mineWallet) {
        mineSessionBlocks++;
        mineSessionLastBlockAt = Date.now();
        mineSessionLastDurationMs = mineSessionLastBlockAt - jobStartedAt;
        mineSessionTotalSolveMs += mineSessionLastDurationMs;
      }
      if (miningEnabled && generation === mineGeneration && mainWindow) {
        mainWindow.webContents.send('mine:block-mined', miningStatus());
      }
    } catch (e) {
      if (jobWallet === mineWallet && miningEnabled &&
          generation === mineGeneration) {
        mineSessionErrors++;
      }
      if (jobWallet === mineWallet && miningEnabled &&
          generation === mineGeneration && mainWindow) {
        mainWindow.webContents.send('mine:error', e.message, miningStatus());
      }
    } finally {
      if (miningEnabled && generation === mineGeneration) {
        mineNextRunAt = Date.now() + mineIntervalMs;
        mineTimer = setTimeout(doMine, mineIntervalMs);
      }
    }
  };

  doMine();
  return miningStatus();
});

registerMainHandler('laser:mine-stop', async () => {
  const wasMining = miningEnabled;
  miningEnabled = false;
  mineGeneration++;
  if (mineTimer) clearTimeout(mineTimer);
  mineTimer = null;
  mineNextRunAt = null;

  if (wasMining) {
    await laserCmd([
      'node', 'mine-stop', '--rpc', LASER_RPC,
      '--datadir', LASER_DATADIR, '--network', LASER_NETWORK
    ], 5000);
  }
  return miningStatus();
});

registerMainHandler('laser:mine-status', () => {
  return miningStatus();
});

registerMainHandler('laser:send', async (_event, from, to, amount, fee) => {
  const name = walletName(from);
  const recipient = laserAddress(to);
  const sendAmount = laserValue(amount, 'Amount', false);
  const sendFee = fee === null || fee === undefined || String(fee).trim() === ''
    ? null
    : laserValue(fee, 'Fee', true);
  if (sendAmount.photons + (sendFee ? sendFee.photons : 0n) >
      MAX_PROTOCOL_PHOTONS) {
    throw new Error('Amount and fee exceed the protocol maximum.');
  }
  const args = [
    'node', 'send', name, recipient, sendAmount.text,
    '--rpc', LASER_RPC, '--datadir', LASER_DATADIR, '--network', LASER_NETWORK
  ];
  if (sendFee) args.splice(5, 0, sendFee.text);
  return await walletCommand(args, name);
});

registerMainHandler('laser:config', () => {
  return {
    network: LASER_NETWORK,
    rpc: LASER_RPC,
    listen: LASER_LISTEN,
    advertise: LASER_ADVERTISE,
    datadir: LASER_DATADIR,
    walletDir: path.join(LASER_CWD, 'wallets'),
    channel: runtime.channel,
    storeVersion: runtime.storeVersion,
    peers: LASER_PEERS,
    cudaMiner: LASER_CUDA_MINER_BIN || null
  };
});

// ── App Lifecycle ──────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    transparent: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#fbfbf9',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false
    }
  });

  hardenLocalWindow(splashWindow, LASER_SPLASH_URL);
  splashWindow.loadURL(LASER_SPLASH_URL);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('org.laser.core');
  registerRendererProtocol();
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  // Show splash first
  createSplash();

  // Start the node
  startNode();

  const minimumSplash = new Promise(resolve => setTimeout(resolve, 1100));
  const [nodeResult] = await Promise.all([waitForNodeReady(), minimumSplash]);

  if (nodeResult.ready) {
    startShadow();
    updateSplash('Shadownet node and PhotonHash observer ready', 100);
  }

  const publisherConfig = resolvePublisherConfig({
    appDir: __dirname,
    userData: app.getPath('userData'),
    resourcesPath: process.resourcesPath
  });
  if (nodeResult.ready && publisherConfig) {
    explorerPublisher = new ExplorerPublisher(
      publisherConfig,
      LASER_DATADIR,
      LASER_NETWORK
    );
    explorerPublisher.start();
  }

  createWindow();
  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.center();
    mainWindow.show();
  });
});

let shutdownPromise = null;
let shutdownComplete = false;

function shutdownAndQuit() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    if (explorerPublisher) {
      explorerPublisher.stop();
      explorerPublisher = null;
    }
    miningEnabled = false;
    mineGeneration++;
    if (mineTimer) {
      clearTimeout(mineTimer);
      mineTimer = null;
      mineWallet = null;
    }
    walletSecrets.clear();

    await stopShadow();
    await stopNode();
    shutdownComplete = true;
    app.quit();
  })();

  return shutdownPromise;
}

app.on('before-quit', event => {
  if (shutdownComplete) return;
  event.preventDefault();
  shutdownAndQuit();
});

app.on('window-all-closed', () => {
  shutdownAndQuit();
});
