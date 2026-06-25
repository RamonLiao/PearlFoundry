import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSponsor, pickGasCoins, signSponsored, SPONSOR_GAS_CAP } from './sponsor.js';

test('SPONSOR_GAS_CAP is 0.02 SUI', () => {
  assert.equal(SPONSOR_GAS_CAP, 20_000_000n);
});

test('loadSponsor throws NO_SPONSOR when key absent', () => {
  assert.throws(() => loadSponsor({}), (e) => e.code === 'NO_SPONSOR');
});

test('loadSponsor throws BAD_SPONSOR_KEY on garbage', () => {
  assert.throws(() => loadSponsor({ SPONSOR_KEY: 'not-a-key' }), (e) => e.code === 'BAD_SPONSOR_KEY');
});

test('loadSponsor returns address + keypair for a valid bech32 key', () => {
  // A throwaway, well-formed testnet ed25519 key (suiprivkey...). Generated for this test only.
  const KEY = 'suiprivkey1qrwrgl48wwc2cgv4xyeqzugzj8vr4lx00gcnufay6wnd2uju09kj25r4xk3';
  const s = loadSponsor({ SPONSOR_KEY: KEY });
  assert.match(s.address, /^0x[0-9a-f]{64}$/);
  assert.ok(typeof s.keypair.signTransaction === 'function');
});

const coin = (objectId, balance) => ({ coinObjectId: objectId, version: '7', digest: 'D', balance: String(balance) });

test('pickGasCoins accumulates coins until budget met', async () => {
  const client = { getCoins: async () => ({ data: [coin('0xa', 5_000_000), coin('0xb', 30_000_000)], hasNextPage: false }) };
  const picked = await pickGasCoins(client, '0xSPON', 20_000_000n);
  assert.deepEqual(picked.map((c) => c.objectId), ['0xa', '0xb']);
  assert.deepEqual(picked[0], { objectId: '0xa', version: '7', digest: 'D' });
});

test('pickGasCoins throws NO_SPONSOR_GAS when total below budget', async () => {
  const client = { getCoins: async () => ({ data: [coin('0xa', 1_000_000)], hasNextPage: false }) };
  await assert.rejects(() => pickGasCoins(client, '0xSPON', 20_000_000n), (e) => e.code === 'NO_SPONSOR_GAS' && e.status === 502);
});

test('signSponsored builds once and returns base64 bytes + sig', async () => {
  let builds = 0;
  const tx = { build: async () => { builds++; return new Uint8Array([1, 2, 3]); } };
  const keypair = { signTransaction: async (bytes) => { assert.ok(bytes instanceof Uint8Array); return { signature: 'SIGB64' }; } };
  const out = await signSponsored({ tx, client: {}, keypair });
  assert.equal(builds, 1);
  assert.equal(out.sponsorSig, 'SIGB64');
  assert.equal(out.txBytes, Buffer.from([1, 2, 3]).toString('base64'));
});
