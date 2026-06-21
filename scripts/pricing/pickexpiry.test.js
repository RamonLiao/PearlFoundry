import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLiveExpiry } from './oracle.js';

// nowMs anchor: all future expiries are relative to this
const NOW = 1_000_000_000_000; // arbitrary fixed ms
const BUF = 20 * 60 * 1000;   // 20 min default buffer

// Expiries (ms strings as on-chain)
const PAST    = String(NOW - BUF - 1);            // before now+buffer
const NEAR    = String(NOW + BUF + 60_000);       // 1 min past buffer
const FAR     = String(NOW + BUF + 120_000);      // 2 min past buffer (farther)
const EDGE    = String(NOW + BUF);                // exactly at boundary (not past it)

// Oracle IDs
const ORC_NEAR_PRICED   = '0xorc-near-priced';
const ORC_NEAR_UNPRICED = '0xorc-near-unpriced';
const ORC_FAR_PRICED    = '0xorc-far-priced';
const ORC_ETH           = '0xorc-eth';

// Fake getObject — controls whether oracle is priced
function makeGetObject(pricedIds) {
  return async ({ id }) => {
    const forward = pricedIds.has(id) ? '50000000000000' : '0';
    return {
      data: {
        content: {
          fields: {
            prices: { fields: { forward, spot: '50000000000000' } },
            expiry: NEAR, // not used by fetchOracle for routing decisions
            timestamp: String(NOW),
            settlement_price: null,
          },
        },
      },
    };
  };
}

// Fake queryEvents — returns a fixed descending list of OracleCreated events
function makeQueryEvents(events) {
  return async () => ({ data: events, hasNextPage: false });
}

function makeEvent(underlying_asset, expiry, oracle_id) {
  return { parsedJson: { underlying_asset, expiry, oracle_id, tick_size: '1000000000', min_strike: '50000000000000' } };
}

// --- tests ---

test('picks nearest future expiry past buffer (both priced)', async () => {
  const events = [
    makeEvent('BTC', FAR,  ORC_FAR_PRICED),
    makeEvent('BTC', NEAR, ORC_NEAR_PRICED),
    makeEvent('BTC', PAST, '0xorc-past'),
  ];
  const client = {
    queryEvents: makeQueryEvents(events),
    getObject: makeGetObject(new Set([ORC_NEAR_PRICED, ORC_FAR_PRICED])),
  };
  const result = await pickLiveExpiry(client, 'BTC', { nowMs: NOW });
  assert.equal(result, NEAR);
});

test('skips unpriced near expiry, returns next farther priced expiry', async () => {
  const events = [
    makeEvent('BTC', FAR,  ORC_FAR_PRICED),
    makeEvent('BTC', NEAR, ORC_NEAR_UNPRICED),
  ];
  const client = {
    queryEvents: makeQueryEvents(events),
    getObject: makeGetObject(new Set([ORC_FAR_PRICED])),
  };
  const result = await pickLiveExpiry(client, 'BTC', { nowMs: NOW });
  assert.equal(result, FAR);
});

test('ignores non-BTC and past expiries', async () => {
  const events = [
    makeEvent('ETH', NEAR, ORC_ETH),
    makeEvent('BTC', PAST, '0xorc-past'),
    makeEvent('BTC', FAR,  ORC_FAR_PRICED),
  ];
  const client = {
    queryEvents: makeQueryEvents(events),
    getObject: makeGetObject(new Set([ORC_FAR_PRICED])),
  };
  const result = await pickLiveExpiry(client, 'BTC', { nowMs: NOW });
  assert.equal(result, FAR);
});

test('throws when no candidate qualifies', async () => {
  const events = [
    makeEvent('BTC', NEAR, ORC_NEAR_UNPRICED),
    makeEvent('BTC', PAST, '0xorc-past'),
    makeEvent('ETH', FAR,  ORC_ETH),
  ];
  const client = {
    queryEvents: makeQueryEvents(events),
    getObject: makeGetObject(new Set([])),
  };
  await assert.rejects(
    () => pickLiveExpiry(client, 'BTC', { nowMs: NOW }),
    /no live.*BTC/i,
  );
});
