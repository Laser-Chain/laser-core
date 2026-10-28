'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { waitForRpc } = require('../node-startup');

function clock() {
  let time = 0;
  return { now: () => time, sleep: async ms => { time += ms; } };
}

test('five minutes of saved-chain verification remains pending, not failed', async () => {
  const result = await waitForRpc({ ...clock(), timeoutMs: 300000,
    probe: async () => { throw new Error('RPC connection refused'); },
    getError: () => null, isRunning: () => true });
  assert.deepEqual(result, { ready: false, pending: true, error: null });
});

test('splash yields after fifteen seconds while the node continues startup', async () => {
  const time = clock();
  const result = await waitForRpc({ ...time,
    probe: async () => { throw new Error('RPC not listening'); },
    getError: () => null, isRunning: () => true });
  assert.equal(result.pending, true);
  assert.ok(time.now() >= 15000 && time.now() < 16000);
});

test('an early RPC reply returns the actual status', async () => {
  const status = { height: 44467 };
  const result = await waitForRpc({ ...clock(), probe: async () => status,
    getError: () => null, isRunning: () => true });
  assert.equal(result.ready, true);
  assert.equal(result.status, status);
});

test('real launch failures retain their diagnostic and do not keep waiting', async () => {
  let calls = 0;
  const result = await waitForRpc({ ...clock(),
    probe: async () => { calls++; }, isRunning: () => false,
    getError: () => 'Data directory is locked by another node.' });
  assert.equal(result.pending, false);
  assert.match(result.error, /locked/);
  assert.equal(calls, 0);
});

test('a child exiting during a status request cannot become ready', async () => {
  let running = true;
  const result = await waitForRpc({ ...clock(), getError: () => null,
    isRunning: () => running,
    probe: async () => { running = false; return { height: 1 }; } });
  assert.equal(result.ready, false);
  assert.equal(result.pending, false);
  assert.match(result.error, /exited/);
});

// Execute the real main-process readiness transition without Electron, a node,
// wallet access or network I/O, including a late status after the splash yields.
function readinessHarness(overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const transition = source.slice(source.indexOf('function markNodeReady('), source.indexOf('\nasync function waitForNodeReady('));
  const events = [];
  const context = { nodeReady: false, nodeStartupError: 'stale error', nodeServicesStarted: false,
    shutdownPromise: null, laserdProcess: {}, hasProcessExited: () => false,
    updateMiningBackend: status => events.push(['status', status.height]),
    startShadow: () => events.push(['observer']),
    explorerPublisher: { setNodeReady: ready => events.push(['publisher', ready]) },
    console: { error() {} }, ...overrides };
  vm.runInNewContext(transition + '\nthis.accept = markNodeReady;', context);
  return { context, events };
}

test('late readiness clears stale errors, starts the observer once and notifies the publisher', () => {
  const { context, events } = readinessHarness();
  context.accept({ height: 44467 });
  context.accept({ height: 44468 });
  assert.equal(context.nodeReady, true);
  assert.equal(context.nodeStartupError, null);
  assert.deepEqual(events, [['status', 44467], ['observer'], ['publisher', true], ['status', 44468], ['publisher', true]]);
});

test('a status reply during shutdown does not launch background services', () => {
  const { context, events } = readinessHarness({ shutdownPromise: Promise.resolve() });
  context.accept({ height: 44467 });
  assert.equal(context.nodeReady, false);
  assert.equal(events.length, 0);
});

test('optional publisher failure does not make an answering node fail', () => {
  const { context } = readinessHarness({ explorerPublisher: { setNodeReady() { throw new Error('fixture'); } } });
  context.accept({ height: 44467 });
  assert.equal(context.nodeReady, true);
  assert.equal(context.nodeStartupError, null);
});

test('publisher readiness can recover after an RPC interruption without restarting the observer', () => {
  const { context, events } = readinessHarness({ explorerPublisher: null });
  context.accept({ height: 1 });
  let publisherReady = false;
  context.explorerPublisher = { setNodeReady: ready => { publisherReady = ready; } };
  context.accept({ height: 2 });
  assert.equal(publisherReady, true);
  publisherReady = false;
  context.accept({ height: 3 });
  assert.equal(publisherReady, true);
  assert.equal(events.filter(event => event[0] === 'observer').length, 1);
});
