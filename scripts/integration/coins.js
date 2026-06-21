import { DUSDC } from './config.js';

export async function pickDusdcCoin(client, owner) {
  const { data } = await client.getCoins({ owner, coinType: DUSDC });
  if (!data || data.length === 0) {
    const e = new Error('connected wallet holds no testnet dUSDC — use the faucet first');
    e.code = 'NO_DUSDC';
    throw e;
  }
  const total = data.reduce((a, c) => a + BigInt(c.balance), 0n);
  const largest = data.reduce((a, c) => (BigInt(c.balance) > BigInt(a.balance) ? c : a));
  return { coinId: largest.coinObjectId, total };
}
