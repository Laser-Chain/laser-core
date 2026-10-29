'use strict';

function privacyConfig(env) {
  const mode = env.LASER_PRIVACY || 'direct';
  const enabled = mode !== 'direct'; // Invalid private configurations also block side services.
  let error = null;
  const proxy = env.LASER_TOR_PROXY || '127.0.0.1:9050';
  const match = /^(127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/.exec(proxy);
  if (!['direct', 'tor'].includes(mode)) error = 'LASER_PRIVACY must be direct or tor.';
  else if (enabled && (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)) {
    error = 'Use a local Tor proxy such as 127.0.0.1:9050 or [::1]:9050.';
  } else if (!enabled && (env.LASER_TOR_PROXY !== undefined || env.LASER_ONION_ONLY !== undefined)) {
    error = 'Set LASER_PRIVACY=tor before configuring a Tor proxy or onion-only routing.';
  } else if (env.LASER_ONION_ONLY !== undefined && !['0', '1'].includes(env.LASER_ONION_ONLY)) {
    error = 'LASER_ONION_ONLY must be 0 or 1.';
  }
  return { mode, enabled, proxy, onionOnly: env.LASER_ONION_ONLY === '1', error };
}

function requireProxyCapability(runtime, execFileSync) {
  if (!runtime.privacy?.enabled) return;
  let output;
  try {
    output = execFileSync(runtime.laserd, ['--capabilities'], {
      cwd: runtime.workingDir, encoding: 'utf8', timeout: 5000,
      maxBuffer: 4096, windowsHide: true
    });
  } catch (_) {
    throw new Error('This node runtime does not support Tor mode. No node was started. Use a compatible runtime.');
  }
  if (!output.split(/\r?\n/).includes('proxy=socks5-isolated-v1')) {
    throw new Error('This node runtime does not support Tor mode. No node was started. Use a compatible runtime.');
  }
}

// The UI loads only bundled files. Native RPC uses a separate numeric loopback
// socket; it does not need Chromium networking. This is defense in depth, not
// an OS firewall or a guarantee about future Electron background services.
function restrictBrowserNetworking(app, session, privacy) {
  if (!privacy.enabled) return;
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  app.on('session-created', browserSession => blockWebRequests(browserSession));
}

function blockWebRequests(browserSession) {
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try { allowed = ['laser-core:', 'file:', 'data:', 'blob:'].includes(new URL(details.url).protocol); }
    catch (_) { /* malformed URLs remain blocked */ }
    callback({ cancel: !allowed });
  });
}

module.exports = { privacyConfig, requireProxyCapability, restrictBrowserNetworking, blockWebRequests };
