'use strict';

// A splash deadline limits how long the window blocks, not how long chain
// verification may run. Only an actual process/configuration failure is fatal.
async function waitForRpc({
  probe, isRunning, getError, onAttempt = () => {},
  timeoutMs = 15000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const started = now();
  let attempts = 0;
  while (now() - started < timeoutMs) {
    const error = getError();
    if (error || !isRunning()) {
      return { ready: false, pending: false, error: error || 'Node exited before RPC became ready.' };
    }
    onAttempt(++attempts);
    try {
      const status = await probe();
      // Do not resurrect readiness if the child exited during the RPC request.
      if (isRunning() && !getError()) return { ready: true, pending: false, status };
    } catch (_) {
      // Connection refusal is expected while the daemon verifies saved blocks.
    }
    await sleep(450);
  }
  const error = getError();
  return error || !isRunning()
    ? { ready: false, pending: false, error: error || 'Node exited before RPC became ready.' }
    : { ready: false, pending: true, error: null };
}

module.exports = { waitForRpc };
