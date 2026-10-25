const assert = require('node:assert/strict');
const test = require('node:test');

const {
  blockCount,
  miningIntensity,
  laserAddress,
  laserValue,
  MAX_PROTOCOL_PHOTONS
} = require('../ipc-validation');

test('mining intensity accepts only bounded integer percentages', () => {
  for (const value of [10, 25, 50, 75, 100]) assert.equal(miningIntensity(value), value);
  assert.equal(miningIntensity(), 100);
  for (const value of [null, true, '25', 0, 9, 101, 25.5, NaN, Infinity, '--rpc']) {
    assert.throws(() => miningIntensity(value));
  }
});

test('block counts are bounded integers', () => {
  assert.equal(blockCount(1), 1);
  assert.equal(blockCount('100'), 100);
  for (const value of [0, 101, 1.5, 'mine', '--network']) {
    assert.throws(() => blockCount(value));
  }
});

test('addresses are normalized and reject argument-shaped input', () => {
  const address = 'A'.repeat(64);
  assert.equal(laserAddress(address), address.toLowerCase());
  for (const value of ['', 'a'.repeat(63), 'g'.repeat(64), '--rpc']) {
    assert.throws(() => laserAddress(value));
  }
});

test('amounts enforce precision, positivity, and protocol bounds', () => {
  assert.deepEqual(laserValue('1.2', 'Amount', false), {
    photons: 1200000000n,
    text: '1.200000000'
  });
  assert.deepEqual(laserValue('0', 'Fee', true), {
    photons: 0n,
    text: '0.000000000'
  });
  for (const value of ['0', '-1', '1e3', '1.0000000001', '--rpc']) {
    assert.throws(() => laserValue(value, 'Amount', false));
  }
  assert.throws(() => laserValue(
    ((MAX_PROTOCOL_PHOTONS / 1000000000n) + 1n).toString(),
    'Amount',
    false
  ));
});
