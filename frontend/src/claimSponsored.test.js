// frontend/src/claimSponsored.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sponsoredClaim } from './claimSponsored.js';

const okFetch = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
const baseArgs = { sender: '0xS', note: '0xN', mgr: '0xM', oracle: '0xO' };
// 'AQID' = base64 of [1,2,3]; dAppKit returns the same bytes verbatim (honest wallet).
const honestKit = { signTransaction: async ({ transaction }) => ({ bytes: transaction, signature: 'HOLDERSIG' }) };
const okClient = { core: { executeTransaction: async () => ({ $kind: 'Transaction', Transaction: { digest: '0xDIGEST' } }) } };

test('happy path returns digest', async () => {
  const out = await sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'SPONSORSIG' }) });
  assert.equal(out.digest, '0xDIGEST');
});

test('sponsor-claim 503 → phase request (pre-popup, fallbackable)', async () => {
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ code: 'NO_SPONSOR' }, false, 503) }),
    (e) => e.phase === 'request' && e.code === 'NO_SPONSOR' && e.status === 503);
});

test('403 carries status so caller can skip fallback', async () => {
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ code: 'NOTE_NOT_OWNED' }, false, 403) }),
    (e) => e.phase === 'request' && e.status === 403);
});

test('wallet mutates bytes → phase verify, code BYTE_MISMATCH (post-popup)', async () => {
  const liar = { signTransaction: async () => ({ bytes: 'DIFFERENT', signature: 'X' }) };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: liar, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'verify' && e.code === 'BYTE_MISMATCH');
});

test('wallet rejects signature → phase sign', async () => {
  const reject = { signTransaction: async () => { throw new Error('user rejected'); } };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: reject, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'sign');
});

test('execute returns FailedTransaction → phase execute', async () => {
  const failClient = { core: { executeTransaction: async () => ({ $kind: 'FailedTransaction', FailedTransaction: { effects: { status: { error: { message: 'boom' } } } } }) } };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: failClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'execute');
});
