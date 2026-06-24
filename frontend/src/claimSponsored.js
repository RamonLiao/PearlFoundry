// frontend/src/claimSponsored.js
// Sponsored claim: backend sponsor-signs the gas, the holder signs the SAME bytes, we submit the
// dual-signed tx via the gRPC client. Errors are tagged with a .phase so the caller can decide
// whether to silently fall back to self-pay (pre-popup) or surface the error (post-holder-sign).
import { fromBase64 } from '@mysten/sui/utils';
import { API } from './config.js';

const tag = (e, phase, extra = {}) => Object.assign(e, { phase, ...extra });

export async function sponsoredClaim({ dAppKit, client, sender, note, mgr, oracle, fetchImpl = fetch }) {
  // --- phase 'request' (pre-popup): a failure here is safe to silently fall back to self-pay ---
  let resp;
  {
    let r;
    try {
      r = await fetchImpl(`${API}/sponsor-claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender, note, mgr, oracle }),
      });
    } catch (e) { throw tag(e, 'request'); }
    resp = await r.json();
    if (!r.ok) throw tag(new Error(resp.error || 'sponsor-claim failed'), 'request', { code: resp.code, status: r.status });
  }
  const { tx: txBytes, sponsorSig } = resp;

  // --- phase 'sign': wallet popup. The holder signs the SAME bytes verbatim ---
  let signed;
  try { signed = await dAppKit.signTransaction({ transaction: txBytes }); }
  catch (e) { throw tag(e, 'sign'); }

  // --- phase 'verify': C2 — reject if the wallet rebuilt/re-resolved gasData ---
  if (signed.bytes !== txBytes)
    throw tag(new Error('wallet altered the transaction bytes'), 'verify', { code: 'BYTE_MISMATCH' });

  // --- phase 'execute': dual-sig submit via gRPC (NOT JSON-RPC) ---
  let res;
  try {
    res = await client.core.executeTransaction({
      transaction: fromBase64(txBytes),
      signatures: [signed.signature, sponsorSig],
      include: { effects: true },
    });
  } catch (e) { throw tag(e, 'execute'); }
  if (res.$kind === 'FailedTransaction') {
    const err = res.FailedTransaction?.effects?.status?.error;
    throw tag(new Error(`claim failed on-chain: ${err?.message ?? JSON.stringify(err)}`), 'execute');
  }
  const digest = res.Transaction?.digest;
  if (!digest) throw tag(new Error('claim returned no digest — treat as NOT completed'), 'execute');
  return { digest };
}
