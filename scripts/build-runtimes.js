'use strict';
// Windows x64 source builds. Git archives isolate committed inputs from live
// worktrees; all temporary files and logs remain under ignored .runtime/.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { RECEIPT, FORMAT, REQUIRED, sha256, fileHash, sourceManifest, verifySet } = require('./runtime-provenance');
const app = path.resolve(__dirname, '..');
const SANDBOX = 'c651572d5061e2e382a036ed538b305b70d6cb42';
const ROOTS = ['Makefile', 'apps', 'components', 'include', 'src', 'vendor', 'tests', 'scripts', 'laser-wallet'];
const quote = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
const msys = value => path.resolve(value).replaceAll('\\', '/').replace(/^([A-Za-z]):\//, (_, drive) => '/' + drive.toLowerCase() + '/');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();

async function buildRuntimes(options) {
  if (process.platform !== 'win32') throw new Error('Native package builds currently require Windows x64.');
  const native = path.resolve(options.source);
  const explorer = path.resolve(options.explorerSource);
  const nativeCommit = git(native, 'rev-parse', 'HEAD');
  const explorerCommit = git(explorer, 'rev-parse', 'HEAD');
  const bash = options.bash || 'C:/msys64/usr/bin/bash.exe';
  const nvcc = options.nvcc || process.env.LASER_NVCC;
  if (!nvcc || !fs.existsSync(nvcc)) throw new Error('Set LASER_NVCC to the installed CUDA nvcc.exe. No GPU work is run by this build.');
  fs.mkdirSync(path.join(app, '.runtime'), { recursive: true });
  const work = fs.mkdtempSync(path.join(app, '.runtime/build-'));
  const log = fs.openSync(path.join(work, 'build.log'), 'a');
  const environment = { ...process.env, MSYSTEM: 'UCRT64', CHERE_INVOKING: '1' };
  async function run(program, args, cwd) {
    fs.writeSync(log, '\nCOMMAND ' + JSON.stringify([path.basename(program), ...args]) + '\n');
    await new Promise((resolve, reject) => {
      const child = spawn(program, args, { cwd, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => fs.writeSync(log, data));
      child.stderr.on('data', data => fs.writeSync(log, data));
      try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error('Build command failed (' + code + '); see retained build.log.')));
    });
  }
  const bashRun = command => run(bash, ['-lc', 'export PATH=/ucrt64/bin:/usr/bin:$PATH; export CC=gcc; set -e; ' + command], work);
  function snapshot(repo, commit, name, roots) {
    const directory = path.join(work, name);
    fs.mkdirSync(directory);
    const archive = path.join(work, name + '.tar');
    execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', 'archive', '--format=tar', '--output=' + archive, commit, '--', ...roots], { windowsHide: true });
    execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true });
    return directory;
  }
  function identity(root, commit) {
    const files = sourceManifest(root);
    const digest = sha256(JSON.stringify(files));
    fs.writeFileSync(path.join(work, path.basename(root) + '-inputs.json'), JSON.stringify(files, null, 2) + '\n');
    return { commit, content_sha256: digest, files: files.length };
  }
  function assertSource(root, expected) {
    // The suite leaves two disposable persistence fixtures beside build/.
    const generated = ['build/', '.laser-store-test/', '.laser-tx-pool-test/'];
    const manifest = sourceManifest(root).filter(file => !generated.some(prefix => file.file.startsWith(prefix)));
    if (sha256(JSON.stringify(manifest)) !== expected.content_sha256) throw new Error('Build changed its source inputs.');
  }
  function tool(program, versionArgs) {
    const version = execFileSync(program, versionArgs, { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).join(' | ');
    return { name: path.basename(program), sha256: fileHash(program), version };
  }
  function writeRuntime(component, sources, tools, recipe, files, extras = {}) {
    const directory = path.join(work, 'runtime', component);
    fs.mkdirSync(directory, { recursive: true });
    const outputs = REQUIRED[component].map(file => {
      fs.copyFileSync(files[file], path.join(directory, file));
      return { file, bytes: fs.statSync(files[file]).size, sha256: fileHash(files[file]) };
    });
    const receipt = { format: FORMAT, component, sources, tools, commands: recipe, outputs, ...extras };
    fs.writeFileSync(path.join(directory, RECEIPT), JSON.stringify(receipt, null, 2) + '\n');
    const hashes = Object.fromEntries(outputs.map(output => [output.file, output.sha256]));
    let info;
    if (component === 'v3') info = ['channel=v3', 'source_commit=' + nativeCommit, 'source_dirty=false',
      'laser_version=Laser 3.0.0-beta.2', 'laserd_version=laserd 3.0.0-beta.2', 'network=shadow', 'wire_protocol=3', 'store_format=3',
      'laser_sha256=' + hashes['laser.exe'], 'laserd_sha256=' + hashes['laserd.exe'],
      'laser_shadow_sha256=' + hashes['laser-shadow.exe'], 'laser_cuda_miner_sha256=' + hashes['laser-cuda-miner.exe']];
    else if (component === 'sandbox-v2') info = ['channel=sandbox-v2', 'source_commit=' + SANDBOX,
      'compat_patches=' + extras.patches.map(patch => path.basename(patch.file)).join(','),
      'network=regtest', 'wire_protocol=2', 'store_format=1', 'laser_sha256=' + hashes['laser.exe'], 'laserd_sha256=' + hashes['laserd.exe']];
    else info = ['format=laser-explorer-runtime-v1', 'source_commit=' + explorerCommit, 'lxe_sha256=' + hashes['lxe.exe']];
    info.push('provenance_sha256=' + fileHash(path.join(directory, RECEIPT)));
    fs.writeFileSync(path.join(directory, 'BUILDINFO.txt'), info.join('\n') + '\n');
  }
  try {
    const current = snapshot(native, nativeCommit, 'native', ROOTS);
    const old = snapshot(native, SANDBOX, 'sandbox', ROOTS.filter(name => name !== 'laser-wallet'));
    const reader = snapshot(explorer, explorerCommit, 'explorer', ['src', 'Makefile']);
    fs.mkdirSync(path.join(work, 'patches'));
    const patches = ['sandbox-v2-sync.patch', 'sandbox-v2-miner-metrics.patch', 'sandbox-v2-live-state-lock.patch'].map(name => {
      const file = path.join(app, 'compat', name);
      const applied = path.join(work, 'patches', name);
      fs.writeFileSync(applied, fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
      // These archives live below the desktop checkout. Stop Git discovering
      // that parent repository and silently skipping paths outside its prefix.
      const patchEnvironment = { ...environment, GIT_CEILING_DIRECTORIES: work };
      const changed = [...fs.readFileSync(file, 'utf8').matchAll(/^\+\+\+ b\/([A-Za-z0-9_./-]+)\r?$/gm)].map(match => match[1]);
      if (!changed.length || changed.some(name => name.split('/').includes('..'))) throw new Error('Invalid compatibility patch inventory.');
      const before = changed.map(name => fileHash(path.join(old, name)));
      execFileSync('git', ['-C', old, '-c', 'core.autocrlf=false', 'apply', '--check', applied], { windowsHide: true, env: patchEnvironment });
      execFileSync('git', ['-C', old, '-c', 'core.autocrlf=false', 'apply', applied], { windowsHide: true, env: patchEnvironment });
      if (changed.some((name, i) => fileHash(path.join(old, name)) === before[i])) throw new Error('Compatibility patch was not applied: ' + name);
      return { file: 'compat/' + name, sha256: fileHash(applied), normalization: 'CRLF-to-LF' };
    });
    const nativeIdentity = identity(current, nativeCommit);
    const oldIdentity = identity(old, SANDBOX);
    const explorerIdentity = identity(reader, explorerCommit);
    const gcc = tool('C:/msys64/ucrt64/bin/gcc.exe', ['--version']);
    const make = tool('C:/msys64/usr/bin/make.exe', ['--version']);
    const cuda = tool(nvcc, ['--version']);
    const nativeRecipe = ['make', '-j1', 'REPRODUCIBLE=1', 'all', 'test', 'shadow-test'];
    await bashRun('cd ' + quote(msys(current)) + '; ' + nativeRecipe.map(quote).join(' '));
    assertSource(current, nativeIdentity);
    const laserVersion = execFileSync(path.join(current, 'build/laser.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    const daemonVersion = execFileSync(path.join(current, 'build/laserd.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    if (laserVersion !== 'Laser 3.0.0-beta.2' || daemonVersion !== 'laserd 3.0.0-beta.2') throw new Error('Unexpected native version; review runtime metadata before release.');
    // Compile CUDA without executing it or querying/using the mining GPU.
    const vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe';
    const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim();
    const msvcVersion = fs.readFileSync(path.join(vs, 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'), 'utf8').trim();
    const hostTools = ['cl.exe', 'link.exe'].map(name => ({ name, version: 'MSVC ' + msvcVersion + ' Hostx64/x64', sha256: fileHash(path.join(vs, 'VC/Tools/MSVC', msvcVersion, 'bin/Hostx64/x64', name)) }));
    const cudaArgs = ['-Iinclude', '-Icomponents/photonhash/include', '-O3', '-std=c++17',
      '-gencode', 'arch=compute_75,code=sm_75', '-gencode', 'arch=compute_80,code=sm_80',
      '-gencode', 'arch=compute_86,code=sm_86', '-gencode', 'arch=compute_89,code=sm_89',
      '-gencode', 'arch=compute_120,code=sm_120', '-gencode', 'arch=compute_120,code=compute_120',
      'apps/cuda-miner/main.cu', 'components/photonhash/src/photonhash.c', '-o', 'build/laser-cuda-miner.exe'];
    // Static generated batch file; paths come from local tool discovery, never
    // user secrets. Reject command metacharacters before writing the file.
    for (const value of [vs, nvcc, current]) if (/[\r\n%&|<>^]/.test(value)) throw new Error('Unsupported build-tool path.');
    const batch = path.join(work, 'cuda-build.cmd');
    fs.writeFileSync(batch, '@echo off\r\ncall "' + path.join(vs, 'VC/Auxiliary/Build/vcvars64.bat') + '" >nul\r\nif errorlevel 1 exit /b 1\r\ncd /d "' + current + '"\r\n"' + nvcc + '" ' + cudaArgs.join(' ') + '\r\nexit /b %errorlevel%\r\n');
    await run(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', batch], work);
    const nativeFiles = Object.fromEntries(REQUIRED.v3.map(name => [name, path.join(current, 'build', name)]));
    writeRuntime('v3', [nativeIdentity], [gcc, make, cuda, ...hostTools], [nativeRecipe, ['nvcc', ...cudaArgs]], nativeFiles,
      { checks: ['native unit/KAT/negative suite', 'shadow adapter and isolation'], gpu_execution: false });
    const explorerRecipe = ['gcc', '-O2', '-std=c11', '-Wall', '-Wextra', '-I<native>/include', '-I<native>/components/photonhash/include', '-I<native>/vendor', 'src/lxe.c', '<native>/build/obj/*.o', '<native>/build/obj/mldsa/*.o', '-lbcrypt', '-lws2_32', '-Wl,--no-insert-timestamp', '-o', 'build/lxe.exe'];
    await bashRun('cd ' + quote(msys(reader)) + '; mkdir -p build; gcc -O2 -std=c11 -Wall -Wextra -I' + quote(msys(path.join(current, 'include'))) + ' -I' + quote(msys(path.join(current, 'components/photonhash/include'))) + ' -I' + quote(msys(path.join(current, 'vendor'))) + ' src/lxe.c ' + quote(msys(current)) + '/build/obj/*.o ' + quote(msys(current)) + '/build/obj/mldsa/*.o -lbcrypt -lws2_32 -Wl,--no-insert-timestamp -o build/lxe.exe');
    assertSource(reader, explorerIdentity);
    writeRuntime('explorer', [explorerIdentity, nativeIdentity], [gcc], [explorerRecipe], { 'lxe.exe': path.join(reader, 'build/lxe.exe') });
    const sandboxRecipe = ['make', '-j1', 'REPRODUCIBLE=1', 'build/tests/test_block_store', 'build/tests/test_control', 'build/laser', 'build/laserd'];
    await bashRun('cd ' + quote(msys(old)) + '; ' + sandboxRecipe.map(quote).join(' ') + '; ./build/tests/test_block_store; ./build/tests/test_control');
    assertSource(old, oldIdentity);
    writeRuntime('sandbox-v2', [oldIdentity], [gcc, make], [sandboxRecipe, ['./build/tests/test_block_store'], ['./build/tests/test_control']],
      Object.fromEntries(REQUIRED['sandbox-v2'].map(name => [name, path.join(old, 'build', name)])), { patches });
    assertSource(current, nativeIdentity);
    const runtime = path.join(work, 'runtime');
    verifySet(runtime);
    // Preserve all previously staged bytes before replacing the three known
    // runtime directories; no existing build evidence is deleted.
    const backup = path.join(work, 'previous-runtime');
    for (const component of Object.keys(REQUIRED)) {
      const destination = path.join(app, '.runtime', component);
      if (fs.existsSync(destination)) fs.cpSync(destination, path.join(backup, component), { recursive: true });
      fs.mkdirSync(destination, { recursive: true });
      for (const name of fs.readdirSync(path.join(runtime, component))) fs.copyFileSync(path.join(runtime, component, name), path.join(destination, name));
    }
    verifySet(path.join(app, '.runtime'));
    console.log('Verified freshly compiled runtimes. Evidence retained in ' + path.relative(app, work));
    return runtime;
  } finally { fs.closeSync(log); }
}

module.exports = { buildRuntimes };
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--source': 'source', '--explorer-source': 'explorerSource', '--nvcc': 'nvcc', '--bash': 'bash' }[args[i]];
    if (!key || !args[i + 1]) throw new Error('Expected --source and --explorer-source paths; optional --nvcc and --bash.');
    options[key] = args[i + 1];
  }
  if (!options.source || !options.explorerSource) throw new Error('Specify --source and --explorer-source.');
  buildRuntimes(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
