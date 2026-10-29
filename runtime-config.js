const fs = require('fs');
const path = require('path');
const { privacyConfig } = require('./privacy');

const SANDBOX_V2_COMMIT = 'c651572d5061e2e382a036ed538b305b70d6cb42';
const SANDBOX_V2_PEER = '203.0.113.10:19444';
const V3_PUBLIC_SEED = 'switchyard.proxy.rlwy.net:18675';

function unique(items) {
  return [...new Set(items.filter(Boolean).map(item => path.resolve(item)))];
}

function parsePeers(value) {
  if (!value) return [];
  return [...new Set(String(value)
    .split(/[;,\s]+/)
    .map(peer => peer.trim())
    .filter(Boolean))];
}

function buildNodeArgs(runtime) {
  if (runtime.error) throw new Error(runtime.error);
  const args = [
    '--network', runtime.network,
    '--datadir', runtime.dataDir,
    '--listen', runtime.listen,
    '--rpc-listen', runtime.rpc
  ];
  if (runtime.privacy?.enabled) {
    args.push('--proxy', runtime.privacy.proxy);
    if (runtime.privacy.onionOnly) args.push('--onion-only');
  }
  if (runtime.advertise) args.push('--advertise', runtime.advertise);
  for (const peer of runtime.peers) args.push('--peer', peer);
  return args;
}

function readStoreVersion(dataDir, readFile) {
  try {
    const storePath = path.join(dataDir, 'blocks.dat');
    let header;
    if (readFile) {
      header = readFile(storePath);
    } else {
      const descriptor = fs.openSync(storePath, 'r');
      try {
        header = Buffer.alloc(8);
        const count = fs.readSync(descriptor, header, 0, header.length, 0);
        if (count !== header.length) return null;
      } finally {
        fs.closeSync(descriptor);
      }
    }
    if (header.length < 8) return -1;
    const magic = header.subarray(0, 4).toString('ascii');
    const version = header.readUInt32LE(4);
    if ((magic === 'LSB2' && (version === 1 || version === 2)) ||
        (magic === 'LSB3' && version === 3)) {
      return version;
    }
    return -1;
  } catch (error) {
    return error && error.code === 'ENOENT' ? null : -1;
  }
}

function findRepoRoot(appDir, env, exists = fs.existsSync) {
  const candidates = unique([
    env.LASER_CWD,
    path.resolve(appDir, '..'),
    path.resolve(appDir, '..', 'laser-v1')
  ]);
  return candidates.find(candidate =>
    exists(path.join(candidate, 'build')) ||
    exists(path.join(candidate, 'Makefile'))
  ) || candidates[0];
}

function executableNames(platform) {
  const suffix = platform === 'win32' ? '.exe' : '';
  return {
    laser: `laser${suffix}`,
    laserd: `laserd${suffix}`,
    shadow: `laser-shadow${suffix}`,
    cudaMiner: `laser-cuda-miner${suffix}`
  };
}

function discoverBuildCandidates(runtime, options = {}) {
  const appDir = path.resolve(options.appDir || __dirname);
  const resourcesPath = options.resourcesPath &&
    path.resolve(options.resourcesPath);
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const names = executableNames(platform);
  const definitions = [
    {
      channel: 'sandbox-v2',
      directories: [
        resourcesPath && path.join(resourcesPath, 'bin', 'sandbox-v2'),
        path.join(appDir, '.runtime', 'sandbox-v2'),
        path.join(runtime.repoRoot, 'laser-core', '.runtime', 'sandbox-v2')
      ]
    },
    {
      channel: 'v3',
      directories: [
        resourcesPath && path.join(resourcesPath, 'bin', 'v3'),
        path.join(runtime.repoRoot, 'build'),
        path.join(appDir, '.runtime', 'v3')
      ]
    }
  ];
  const requiredChannel = runtime.storeVersion === 1
    ? 'sandbox-v2'
    : (runtime.storeVersion === null || runtime.storeVersion === 3 ? 'v3' : null);
  const seen = new Set();
  const builds = [];
  for (const definition of definitions) {
    for (const directory of unique(definition.directories)) {
      const laser = path.join(directory, names.laser);
      const laserd = path.join(directory, names.laserd);
      if (!exists(laser) || !exists(laserd)) continue;
      const key = path.normalize(laserd).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      builds.push({
        id: definition.channel + ':' + directory,
        channel: definition.channel,
        directory,
        laser,
        laserd,
        shadow: exists(path.join(directory, names.shadow)) ?
          path.join(directory, names.shadow) : null,
        cudaMiner: exists(path.join(directory, names.cudaMiner)) ?
          path.join(directory, names.cudaMiner) : null,
        active: path.normalize(laser).toLowerCase() ===
            path.normalize(runtime.laser || '').toLowerCase() &&
          path.normalize(laserd).toLowerCase() ===
            path.normalize(runtime.laserd || '').toLowerCase(),
        compatible: requiredChannel !== null &&
          definition.channel === requiredChannel
      });
    }
  }
  return builds;
}

function resolveRuntime(options = {}) {
  const appDir = path.resolve(options.appDir || __dirname);
  const resourcesPath = options.resourcesPath && path.resolve(options.resourcesPath);
  const env = options.env || process.env;
  const privacy = privacyConfig(env);
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const readFile = options.readFile;
  const names = executableNames(platform);
  const repoRoot = findRepoRoot(appDir, env, exists);
  const workingDir = options.isPackaged && options.userData
    ? path.resolve(options.userData)
    : repoRoot;
  const defaultDataDir = options.isPackaged
    ? path.join(workingDir, privacy.enabled ? 'shadownet-tor' : 'shadownet')
    : path.join(workingDir, privacy.enabled ? 'node-shadow-tor' : 'node-shadow');
  const dataDir = path.resolve(env.LASER_DATADIR ||
    defaultDataDir);
  const storeVersion = readStoreVersion(dataDir, readFile);
  const channel = env.LASER_CHANNEL || (storeVersion === 1 ? 'sandbox-v2' : 'v3');

  const runtimeDirs = channel === 'sandbox-v2'
    ? unique([
        resourcesPath && path.join(resourcesPath, 'bin', 'sandbox-v2'),
        path.join(appDir, '.runtime', 'sandbox-v2'),
        path.join(repoRoot, 'laser-core', '.runtime', 'sandbox-v2')
      ])
    : unique([
        resourcesPath && path.join(resourcesPath, 'bin', 'v3'),
        path.join(repoRoot, 'build'),
        path.join(appDir, '.runtime', 'v3')
      ]);

  let laserd = env.LASERD_BIN;
  let laser = env.LASER_BIN;
  let shadow = env.LASER_SHADOW_BIN;
  let cudaMiner = env.LASER_CUDA_MINER;
  if (!laserd || !laser) {
    const pair = runtimeDirs.find(dir =>
      exists(path.join(dir, names.laserd)) && exists(path.join(dir, names.laser))
    );
    const fallback = pair || runtimeDirs[0];
    laserd = laserd || (fallback && path.join(fallback, names.laserd));
    laser = laser || (fallback && path.join(fallback, names.laser));
  }
  if (!shadow && channel === 'v3') {
    const shadowDir = runtimeDirs.find(dir => exists(path.join(dir, names.shadow)));
    shadow = shadowDir && path.join(shadowDir, names.shadow);
  }
  if (!cudaMiner && channel === 'v3') {
    const cudaDir = runtimeDirs.find(dir =>
      exists(path.join(dir, names.cudaMiner)));
    cudaMiner = cudaDir && path.join(cudaDir, names.cudaMiner);
  }

  const requestedNetwork = env.LASER_NETWORK || 'shadow';
  const network = requestedNetwork === 'shadownet' ? 'shadow' : requestedNetwork;

  let error = null;
  if (!laserd || !laser || !exists(laserd) || !exists(laser)) {
    const hint = channel === 'sandbox-v2'
      ? 'Run npm run prepare:sandbox in laser-core to build the pinned v2 runtime.'
      : 'Build Laser first, or set LASERD_BIN and LASER_BIN.';
    error = `Missing ${channel} node runtime. ${hint}`;
  } else if (channel === 'v3' && network === 'shadow' &&
             (!shadow || !exists(shadow))) {
    error = 'Missing the laser-shadow sidecar required by the Shadownet runtime.';
  }
  if (!['sandbox-v2', 'v3'].includes(channel)) {
    error = `Unsupported Laser runtime channel: ${channel}`;
  } else if (storeVersion === -1) {
    error = 'Refusing to open an unrecognized or corrupt block store.';
  } else if (storeVersion === 2) {
    error = 'Refusing to open the obsolete format-2 store; archive it and start with an empty v3 data directory.';
  } else if (storeVersion === 1 && channel !== 'sandbox-v2') {
    error = 'Refusing to open the preserved v1 sandbox store with the v3 runtime.';
  } else if (storeVersion === 3 && channel !== 'v3') {
    error = 'Refusing to open a v3 store with the sandbox-v2 runtime.';
  }

  const configuredPeers = env.LASER_PEERS !== undefined
    ? env.LASER_PEERS
    : env.LASER_PEER;
  const defaultPeers = channel === 'sandbox-v2'
    ? SANDBOX_V2_PEER
    : V3_PUBLIC_SEED;
  const peers = parsePeers(configuredPeers === undefined
    ? defaultPeers
    : configuredPeers);
  if (privacy.error) error = privacy.error;
  else if (privacy.enabled) {
    if (channel !== 'v3') error = 'Tor mode requires the v3 runtime.';
    else if (env.LASER_LISTEN && env.LASER_LISTEN !== 'none') error = 'Tor mode keeps the P2P listener off. Remove LASER_LISTEN or set it to none.';
    else if (env.LASER_ADVERTISE) error = 'Remove LASER_ADVERTISE in Tor mode. Your node will not publish a public address.';
    else if (env.LASER_RPC && !/^127\.0\.0\.1:([0-9]{1,5})$/.test(env.LASER_RPC)) error = 'Tor mode requires a numeric local RPC address such as 127.0.0.1:19544.';
    else if (privacy.onionOnly && (!peers.length || peers.some(peer => !/^[a-z2-7]{56}\.onion:[0-9]{1,5}$/.test(peer)))) {
      error = 'Onion-only mode needs explicit v3 .onion peers in LASER_PEERS. No public onion seed is configured.';
    }
  }
  return {
    privacy,
    channel,
    repoRoot,
    workingDir,
    dataDir,
    storeVersion,
    laser,
    laserd,
    shadow,
    cudaMiner,
    error,
    peers,
    network,
    rpc: env.LASER_RPC || (privacy.enabled ? '127.0.0.1:29544' : '127.0.0.1:19544'),
    listen: privacy.enabled ? 'none' : (env.LASER_LISTEN || '127.0.0.1:19333'),
    advertise: privacy.enabled ? null : (env.LASER_ADVERTISE || null),
    expectedNodeVersion: channel === 'sandbox-v2' ? 'laserd 2.0.0-beta.1' : null
  };
}

module.exports = {
  SANDBOX_V2_COMMIT,
  SANDBOX_V2_PEER,
  V3_PUBLIC_SEED,
  buildNodeArgs,
  discoverBuildCandidates,
  parsePeers,
  readStoreVersion,
  resolveRuntime
};
