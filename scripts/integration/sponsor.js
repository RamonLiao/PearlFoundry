// Gas-station helpers: load the sponsor keypair, pick its gas coins, sponsor-sign a built tx.
// Used by the /sponsor-claim route. The sponsor private key never leaves this process and is
// never logged or returned in a response.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { toBase64 } from '@mysten/sui/utils';

// Pinned gas budget for sponsored claims. Claim is ~gas-negative (measured -0.0072 SUI); this is a
// conservative reservation ceiling, NOT the cost. Client-supplied budgets are ignored.
export const SPONSOR_GAS_CAP = 20_000_000n;

const err = (code, msg, status) => Object.assign(new Error(msg), { code, ...(status ? { status } : {}) });

export function loadSponsor(env = process.env) {
  const key = env.SPONSOR_KEY;
  if (!key) throw err('NO_SPONSOR', 'SPONSOR_KEY not set — gas station disabled');
  let keypair;
  try {
    const { secretKey } = decodeSuiPrivateKey(key);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } catch (e) {
    throw err('BAD_SPONSOR_KEY', `SPONSOR_KEY is not a valid Sui private key: ${e.message}`);
  }
  return { keypair, address: keypair.toSuiAddress() };
}

export async function pickGasCoins(client, sponsorAddr, budgetMist) {
  const picked = [];
  let total = 0n;
  let cursor;
  do {
    const page = await client.getCoins({ owner: sponsorAddr, coinType: '0x2::sui::SUI', cursor });
    for (const c of page.data) {
      picked.push({ objectId: c.coinObjectId, version: c.version, digest: c.digest });
      total += BigInt(c.balance);
      if (total >= budgetMist) return picked;
    }
    cursor = page.hasNextPage ? page.nextCursor : undefined;
  } while (cursor);
  throw err('NO_SPONSOR_GAS', `sponsor has insufficient SUI for gas (need ${budgetMist}, have ${total})`, 502);
}

export async function signSponsored({ tx, client, keypair }) {
  const built = await tx.build({ client });
  const { signature } = await keypair.signTransaction(built);
  return { txBytes: toBase64(built), sponsorSig: signature };
}
