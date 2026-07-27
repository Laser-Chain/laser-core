const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  SANDBOX_V2_PEER,
  V3_PUBLIC_SEED,
  buildNodeArgs,
  discoverBuildCandidates,
  parsePeers,
  readStoreVersion,
  resolveRuntime
} = require('../runtime-config');

function storeHeader(version, magic = version === 3 ? 'LSB3' : 'LSB2') {
  const header = Buffer.alloc(12);
  header.write(magic, 0, 'ascii');
  header.writeUInt32LE(version, 4);
  return header;
}

test('peer configuration accepts multiple unique endpoints', () => {
  assert.deepEqual(
    parsePeers('one:1, two:2;one:1\nthree:3'),
    ['one:1', 'two:2', 'three:3']
  );
});

test('node arguments keep bind and advertised endpoints separate', () => {
  const args = buildNodeArgs({
    channel: 'v3',
    network: 'shadow',
    dataDir: 'node-shadow',
    listen: '0.0.0.0:19333',
    advertise: 'seed1.laserchain.org:19333',
    rpc: '127.0.0.1:19544',
    peers: ['seed2.laserchain.org:19333']
  });
  assert.deepEqual(args, [
    '--network', 'shadow',
    '--datadir', 'node-shadow',
    '--listen', '0.0.0.0:19333',
    '--rpc-listen', '127.0.0.1:19544',
    '--advertise', 'seed1.laserchain.org:19333',
    '--peer', 'seed2.laserchain.org:19333'
  ]);
});

test('build inventory lists every complete local channel and marks compatibility', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const sandbox = path.join(appDir, '.runtime', 'sandbox-v2');
  const v3 = path.join(repoRoot, 'build');
  const present = new Set([
    sandbox, v3,
    path.join(sandbox, 'laser.exe'), path.join(sandbox, 'laserd.exe'),
    path.join(v3, 'laser.exe'), path.join(v3, 'laserd.exe'),
    path.join(v3, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(1)
  });
  const builds = discoverBuildCandidates(runtime, {
    appDir,
    platform: 'win32',
    exists: item => present.has(path.normalize(item))
  });

  assert.equal(builds.length, 2);
  assert.equal(builds.find(build => build.channel === 'sandbox-v2').active, true);
  assert.equal(builds.find(build => build.channel === 'sandbox-v2').compatible, true);
  assert.equal(builds.find(build => build.channel === 'v3').compatible, false);
});

test('store version detection recognizes every supported header without mutation', () => {
  assert.equal(readStoreVersion('ignored', () => storeHeader(1)), 1);
  assert.equal(readStoreVersion('ignored', () => storeHeader(2)), 2);
  assert.equal(readStoreVersion('ignored', () => storeHeader(3)), 3);
  assert.equal(readStoreVersion('ignored', () => Buffer.from('wrong')), -1);
  assert.equal(readStoreVersion('ignored', () => storeHeader(3, 'LSB2')), -1);
});

test('a preserved v1 datadir selects the pinned sandbox runtime', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const runtimeDir = path.join(appDir, '.runtime', 'sandbox-v2');
  const present = new Set([
    path.join(repoRoot, 'build'),
    path.join(runtimeDir, 'laser.exe'),
    path.join(runtimeDir, 'laserd.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(1)
  });

  assert.equal(runtime.channel, 'sandbox-v2');
  assert.equal(runtime.storeVersion, 1);
  assert.equal(runtime.error, null);
  assert.deepEqual(runtime.peers, [SANDBOX_V2_PEER]);
  assert.equal(runtime.expectedNodeVersion, 'laserd 2.0.0-beta.1');
  assert.equal(buildNodeArgs(runtime).includes('--auto-mine'), false);
  assert.deepEqual(buildNodeArgs(runtime).slice(-2), [
    '--peer', SANDBOX_V2_PEER
  ]);
});

test('a format-3 store selects the current v3 build directory', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe'),
    path.join(buildDir, 'laser-cuda-miner.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  });

  assert.equal(runtime.channel, 'v3');
  assert.equal(runtime.storeVersion, 3);
  assert.equal(runtime.error, null);
  assert.equal(runtime.network, 'shadow');
  assert.equal(runtime.shadow, path.join(buildDir, 'laser-shadow.exe'));
  assert.equal(runtime.cudaMiner, path.join(buildDir, 'laser-cuda-miner.exe'));
  assert.deepEqual(runtime.peers, [V3_PUBLIC_SEED]);
});

test('the shadownet alias is canonicalized and still requires the observer', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: { LASER_NETWORK: 'shadownet' },
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  });

  assert.equal(runtime.network, 'shadow');
  assert.equal(runtime.error, null);
});

test('a Shadownet v3 runtime without laser-shadow fails closed', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  });

  assert.match(runtime.error, /laser-shadow sidecar required by the Shadownet runtime/);
});

test('the CUDA helper is optional and never blocks a CPU-only runtime', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  });

  assert.equal(runtime.error, null);
  assert.equal(runtime.cudaMiner, undefined);
});

test('a fresh packaged profile selects bundled v3 and a v3 data directory', () => {
  const appDir = path.resolve('C:/app/resources/app.asar');
  const resourcesPath = path.resolve('C:/app/resources');
  const userData = path.resolve('C:/Users/test/AppData/Roaming/Laser Core');
  const v3 = path.join(resourcesPath, 'bin', 'v3');
  const present = new Set([
    path.join(v3, 'laser.exe'),
    path.join(v3, 'laserd.exe'),
    path.join(v3, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const missingStore = new Error('missing');
  missingStore.code = 'ENOENT';
  const runtime = resolveRuntime({
    appDir,
    resourcesPath,
    userData,
    isPackaged: true,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item)),
    readFile: () => {
      throw missingStore;
    }
  });

  assert.equal(runtime.channel, 'v3');
  assert.equal(runtime.storeVersion, null);
  assert.equal(runtime.dataDir, path.join(userData, 'shadownet'));
  assert.equal(runtime.laserd, path.join(v3, 'laserd.exe'));
  assert.equal(runtime.shadow, path.join(v3, 'laser-shadow.exe'));
  assert.equal(runtime.error, null);
  assert.deepEqual(runtime.peers, [V3_PUBLIC_SEED]);
  assert.deepEqual(buildNodeArgs(runtime).slice(-2), [
    '--peer', V3_PUBLIC_SEED
  ]);
});

test('an explicit v3 peer setting overrides or disables the public seed', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const options = {
    appDir,
    platform: 'win32',
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  };

  const overridden = resolveRuntime({
    ...options,
    env: { LASER_PEERS: 'peer.example:19444' }
  });
  assert.deepEqual(overridden.peers, ['peer.example:19444']);

  const disabled = resolveRuntime({
    ...options,
    env: { LASER_PEERS: '' }
  });
  assert.deepEqual(disabled.peers, []);
});

test('obsolete and corrupt stores fail closed', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const options = {
    appDir,
    platform: 'win32',
    env: {},
    exists: item => present.has(path.normalize(item))
  };

  const obsolete = resolveRuntime({
    ...options,
    readFile: () => storeHeader(2)
  });
  assert.match(obsolete.error, /obsolete format-2 store/);

  const corrupt = resolveRuntime({
    ...options,
    readFile: () => Buffer.from('corrupt')
  });
  assert.match(corrupt.error, /unrecognized or corrupt block store/);
});

test('missing sandbox binaries fail closed with a build instruction', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: {},
    exists: item => path.normalize(item) === path.normalize(path.join(repoRoot, 'build')),
    readFile: () => storeHeader(1)
  });

  assert.equal(runtime.channel, 'sandbox-v2');
  assert.match(runtime.error, /prepare:sandbox/);
});

test('an explicit channel cannot bypass preserved-store isolation', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const repoRoot = path.resolve(appDir, '..');
  const buildDir = path.join(repoRoot, 'build');
  const present = new Set([
    buildDir,
    path.join(buildDir, 'laser.exe'),
    path.join(buildDir, 'laserd.exe'),
    path.join(buildDir, 'laser-shadow.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: { LASER_CHANNEL: 'v3' },
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(1)
  });

  assert.match(runtime.error, /Refusing to open the preserved v1 sandbox store/);
});

test('the sandbox runtime cannot open a format-3 store', () => {
  const appDir = path.resolve('C:/laser/laser-v1/laser-core');
  const runtimeDir = path.join(appDir, '.runtime', 'sandbox-v2');
  const present = new Set([
    runtimeDir,
    path.join(runtimeDir, 'laser.exe'),
    path.join(runtimeDir, 'laserd.exe')
  ].map(item => path.normalize(item)));
  const runtime = resolveRuntime({
    appDir,
    platform: 'win32',
    env: { LASER_CHANNEL: 'sandbox-v2' },
    exists: item => present.has(path.normalize(item)),
    readFile: () => storeHeader(3)
  });

  assert.match(runtime.error, /Refusing to open a v3 store with the sandbox-v2 runtime/);
});
