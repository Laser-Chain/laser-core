'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { setup } = require('./renderer-harness');

test('network publisher status separates delivery failures from local mining and node health', async () => {
  const h = setup({ publisherStatus: async () => ({ state: 'error', enabled: true, url: 'https://explorer.invalid/ingest', error: 'Explorer ingest failed (HTTP 401).', lastHeight: 10, lastPublishedAt: Date.now() - 60000 }) });
  await h.app.poll(); h.app.state.view = 'network';
  const view = h.app.renderVals();
  assert.equal(h.app.state.node.online, true);
  assert.equal(view.publisher.label, 'Publishing failed');
  assert.match(view.publisher.detail, /#10/);
  assert.ok(view.sbar.some(item => item.text === 'Explorer upload failed'));
  assert.ok(h.app.render()); assert.equal(h.calls.length, 0);
});

test('publisher setup clears tokens after both successful and failed saves without localStorage writes', async () => {
  const saved = [];
  const h = setup({ publisherSave: async input => { saved.push(input); return { state: 'waiting', enabled: input.enabled, url: input.url }; } });
  h.app.editPublisher();
  h.app.renderVals().publisher.onUrl({ target: { value: 'https://explorer.invalid/ingest' } });
  h.app.renderVals().publisher.onToken({ target: { value: 'test-token' } });
  await h.app.savePublisher(true);
  assert.equal(saved[0].token, 'test-token'); assert.equal(h.app.state.publisherDraft, null);
  assert.equal(h.storage.size, 0); assert.equal(h.calls.length, 0);
  h.laser.publisherSave = async () => { throw new Error('Save failed'); };
  h.app.editPublisher(); h.app.state.publisherDraft.token = 'second-token';
  await h.app.savePublisher(true);
  assert.equal(h.app.state.publisherDraft.token, ''); assert.equal(h.app.state.publisherError, 'Save failed');
  assert.equal(h.storage.size, 0);
});

test('publisher settings menu opens the network setup and cancellation clears the draft', () => {
  const h = setup(); h.app.init(); h.listeners.publisher();
  assert.equal(h.app.state.view, 'network');
  h.app.state.publisherDraft.token = 'test-token'; h.app.renderVals().publisher.cancel();
  assert.equal(h.app.state.publisherDraft, null);
  h.app.cleanup(); assert.equal(h.listeners.publisher, undefined);
});

test('server authority is shown as a completed handover rather than an upload error', async () => {
  const h = setup({ publisherStatus: async () => ({state:'delegated',enabled:true}) });
  await h.app.poll();
  const view = h.app.renderVals();
  assert.equal(view.publisher.label, 'Managed by server');
  assert.equal(view.publisher.hasError, false);
  assert.match(view.publisher.detail, /server node/);
});
