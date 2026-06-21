import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDusdcCoin } from './coins.js';

const fakeClient = (coins) => ({ getCoins: async () => ({ data: coins }) });

test('pickDusdcCoin: picks largest balance coin', async () => {
  const c = fakeClient([
    { coinObjectId: '0xa', balance: '5' },
    { coinObjectId: '0xb', balance: '12' },
  ]);
  const r = await pickDusdcCoin(c, '0xowner');
  assert.equal(r.coinId, '0xb');
  assert.equal(r.total, 17n);
});

test('pickDusdcCoin: throws NO_DUSDC when empty', async () => {
  await assert.rejects(() => pickDusdcCoin(fakeClient([]), '0xowner'),
    (e) => e.code === 'NO_DUSDC');
});
