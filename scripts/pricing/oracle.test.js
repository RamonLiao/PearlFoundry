import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuiClient } from '@mysten/sui/client';
import { resolveOracle, fetchOracle, PREDICT_PKG } from './oracle.js';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

test('resolveOracle finds a live BTC oracle and fetchOracle reads forward', async () => {
  // pick the most recent BTC oracle's expiry from events, then resolve it back. Must filter by
  // asset — the newest registry event may be for another underlying, which would resolve-fail.
  const ev = await client.queryEvents({
    query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
    limit: 20, order: 'descending',
  });
  const btc = ev.data.find(e => e.parsedJson.underlying_asset === 'BTC');
  assert.ok(btc, 'a live BTC oracle event exists');
  const expiry = BigInt(btc.parsedJson.expiry);
  const { oracleId, tickSize, minStrike } = await resolveOracle(client, 'BTC', expiry);
  assert.match(oracleId, /^0x[0-9a-f]{64}$/);
  assert.ok(tickSize > 0n, 'tickSize positive');
  assert.ok(minStrike > 0n, 'minStrike positive');
  const o = await fetchOracle(client, oracleId, { tickSize, minStrike });
  assert.ok(o.forward > 0n, 'forward positive');
  assert.equal(o.tickSize, tickSize);
  assert.equal(o.minStrike, minStrike);
  assert.equal(o.settled, false);
});

test('resolveOracle throws on unknown expiry', async () => {
  await assert.rejects(() => resolveOracle(client, 'BTC', 1n), /no oracle|expiry/i);
});
