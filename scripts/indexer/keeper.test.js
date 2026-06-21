import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runKeeper } from './keeper.js';

test('poller throwing aborts the watcher and rejects (fail-loud supervision)', async () => {
  const controller = new AbortController();
  let watcherAborted = false;
  const runPollerFn = async () => { throw new Error('poller died'); };
  const runWatcherFn = async ({ signal }) => {
    await new Promise((res) => signal.addEventListener('abort', res, { once: true }));
    watcherAborted = true;
  };
  await assert.rejects(
    runKeeper({ db: {}, client: {}, pkg: '0x0', controller, runPollerFn, runWatcherFn, log: () => {} }),
    /poller died/,
  );
  assert.equal(controller.signal.aborted, true);
  assert.equal(watcherAborted, true);
});

test('watcher throwing aborts the poller and rejects', async () => {
  const controller = new AbortController();
  let pollerAborted = false;
  const runWatcherFn = async () => { throw new Error('watcher died'); };
  const runPollerFn = async ({ signal }) => {
    await new Promise((res) => signal.addEventListener('abort', res, { once: true }));
    pollerAborted = true;
  };
  await assert.rejects(
    runKeeper({ db: {}, client: {}, pkg: '0x0', controller, runPollerFn, runWatcherFn, log: () => {} }),
    /watcher died/,
  );
  assert.equal(pollerAborted, true);
});
