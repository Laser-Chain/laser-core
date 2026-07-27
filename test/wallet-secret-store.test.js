const assert = require('node:assert/strict');
const test = require('node:test');

const { WalletSecretStore } = require('../wallet-secret-store');

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = target;
    }
  };
}

test('expiry zeroes a secret without requiring later access', () => {
  const clock = fakeClock();
  const store = new WalletSecretStore({
    ttlMs: 1000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  store.remember('alice', 'correct horse');
  const secret = store.get('alice');

  clock.advance(1000);

  assert.equal(store.has('alice'), false);
  assert.deepEqual([...secret], new Array(secret.length).fill(0));
});

test('access refreshes expiry and explicit lock zeroes immediately', () => {
  const clock = fakeClock();
  const store = new WalletSecretStore({
    ttlMs: 1000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  });
  store.remember('alice', 'secret');
  const secret = store.get('alice');
  clock.advance(900);
  assert.equal(store.get('alice'), secret);
  clock.advance(900);
  assert.equal(store.has('alice'), true);

  store.lock('alice');

  assert.equal(store.has('alice'), false);
  assert.deepEqual([...secret], new Array(secret.length).fill(0));
});
