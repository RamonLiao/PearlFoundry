import http from 'node:http';
import { leaderboard, listNotes, pendingSettle, feeStats, noteById } from './queries.js';
import { hexToUtf8, hexToBase64 } from './decode.js';
import { computeQtyPerLeg } from '../pricing/qty.js';
import { CFG, PKG, PREDICT_MGR_TYPE } from '../integration/config.js';
import { deriveLeftover, deriveParamsFromEvents } from './leftover.js';
import { pickGasCoins, signSponsored, SPONSOR_GAS_CAP } from '../integration/sponsor.js';

// Local dev dApp is served cross-origin (vite :5173 → api :8787); allow CORS so the
// browser can reach these routes. Permissive origin is fine for a local/testnet tool.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

const decodeNote = (r) => ({ ...r,
  strategy: hexToUtf8(r.strategy ?? ''), walrus_blob_id: hexToBase64(r.walrus_blob_id ?? '') });

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
});

// Deterministic Sui-address normalize: lowercase, strip 0x, left-pad to 32 bytes.
// Throws BAD_PARAMS on malformed input so a bad address fails loud (400), not a 500.
const httpErr = (code, status, msg) => Object.assign(new Error(msg), { code, status });
const normAddr = (a) => {
  const h = String(a).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,64}$/.test(h)) throw httpErr('BAD_PARAMS', 400, `malformed address: ${a}`);
  return `0x${h.padStart(64, '0')}`;
};

// Write-path auth guard: explicitly verify the client-supplied `mgr` is a real PredictManager
// owned by `sender`, up front and cheaply — before the expensive ladder probe + dry-run. The
// on-chain owner-gate alone would reject foreign managers, but only deep inside that probe
// (DoS surface) and with an opaque abort. EXACT type match (not suffix) so an attacker-deployed
// look-alike `predict_manager::PredictManager` can't pass. See tests for the threat cases.
async function assertManagerOwner(client, mgr, sender) {
  const want = normAddr(sender);
  if (!/^0x[0-9a-f]{1,64}$/i.test(String(mgr))) throw httpErr('BAD_MGR', 400, `malformed mgr id: ${mgr}`);
  const obj = await client.getObject({ id: mgr, options: { showType: true, showContent: true } });
  if (obj?.data?.type !== PREDICT_MGR_TYPE)
    throw httpErr('BAD_MGR', 400, 'mgr is not a PredictManager object');
  const owner = obj?.data?.content?.fields?.owner;
  if (!owner || normAddr(owner) !== want)
    throw httpErr('MGR_NOT_OWNED', 403, 'manager is not owned by sender');
}

// Cheap owner/exists fail-fast for the claimed note BEFORE the expensive dry-run. Settled-ness is
// the dry-run's job (authoritative — the real claim PTB aborts on-chain if not settled/already
// claimed, and we sponsor-sign only after a successful dry-run, so a non-settled note can't drain
// the sponsor). This guard just rejects foreign/non-existent notes without spending a dry-run.
async function assertClaimable(client, note, sender) {
  const want = normAddr(sender);
  if (!/^0x[0-9a-f]{1,64}$/i.test(String(note))) throw httpErr('BAD_NOTE', 400, `malformed note id: ${note}`);
  const obj = await client.getObject({ id: note, options: { showOwner: true } });
  if (!obj?.data) throw httpErr('BAD_NOTE', 400, 'note does not exist');
  const owner = obj.data.owner?.AddressOwner;
  if (!owner || normAddr(owner) !== want) throw httpErr('NOTE_NOT_OWNED', 403, 'note is not owned by sender');
}

export function createServer(db, { client, txdeps, sponsor } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    try {
      if (req.method === 'GET') {
        if (p === '/leaderboard') return json(res, 200, leaderboard(db));
        if (p === '/notes') return json(res, 200, listNotes(db, {
          issuer: url.searchParams.get('issuer') ?? undefined,
          isPublic: url.searchParams.has('public') ? url.searchParams.get('public') === '1' : undefined,
        }).map(decodeNote));
        if (p === '/pending-settle') return json(res, 200, pendingSettle(db, Date.now()).map(decodeNote));
        if (p === '/fees') return json(res, 200, feeStats(db));
        if (p === '/oracle') {
          if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
          const asset = url.searchParams.get('asset') ?? 'BTC';
          const expiry = url.searchParams.get('expiry');
          if (!expiry) return json(res, 400, { error: 'expiry required', code: 'BAD_PARAMS' });
          const { resolveOracle } = await import('../pricing/oracle.js');
          const { oracleId } = await resolveOracle(client, asset, BigInt(expiry));
          return json(res, 200, { oracleId });
        }
        if (p === '/sponsor-status')
          return json(res, 200, { available: !!sponsor, address: sponsor?.address ?? null });
        if (p === '/note-params') {
          if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
          const note = url.searchParams.get('note');
          const asset = url.searchParams.get('asset') ?? 'BTC';
          const expiry = url.searchParams.get('expiry');
          if (!note || !expiry) return json(res, 400, { error: 'note, expiry required', code: 'BAD_PARAMS' });
          // Fetch mint tx events to derive immutable leftover and reconstruct params if df is gone.
          const row = noteById(db, note);
          if (!row?.tx_digest) return json(res, 404, { error: 'no mint tx for note', code: 'NO_MINT_TX' });
          let leftover = null, eventParams = null;
          try {
            const txb = await client.getTransactionBlock({ digest: row.tx_digest, options: { showEvents: true } });
            leftover = deriveLeftover(txb.events).leftover.toString();
            eventParams = deriveParamsFromEvents(txb.events);
          } catch (e) {
            return json(res, 502, { error: `mint tx read failed: ${e.message}`, code: 'MINT_TX_READ_FAILED' });
          }
          const { resolveOracle } = await import('../pricing/oracle.js');
          // RangeParams lives as a dynamic field under the note, keyed by note::ParamsKey.
          // Move gives empty structs a phantom `dummy_field: bool` — the JSON-RPC name value
          // must carry it (verified via live calibration: `value: {}` errors -32602).
          const dfo = await client.getDynamicFieldObject({
            parentId: note,
            name: { type: `${PKG}::note::ParamsKey`, value: { dummy_field: false } },
          });
          const pf = dfo.data?.content?.fields;
          // df value object wraps the stored struct under `.value.fields` (JSON-RPC layout for
          // a struct-valued dynamic field). Fall back to flat fields if the layout differs.
          const rp = pf?.value?.fields ?? pf;
          let params;
          if (rp && rp.lower != null) {
            params = {
              version: Number(rp.version), lower: rp.lower, upper: rp.upper,
              strike_step: rp.strike_step, qty_per_leg: rp.qty_per_leg,
              legs_per_expiry: Number(rp.legs_per_expiry), expiry_count: Number(rp.expiry_count),
              hurdle_bps: Number(rp.hurdle_bps),
            };
          } else if (eventParams) {
            params = {
              version: 1,
              lower: eventParams.lower.toString(), upper: eventParams.upper.toString(),
              strike_step: eventParams.strike_step.toString(), qty_per_leg: eventParams.qty_per_leg.toString(),
              legs_per_expiry: eventParams.legs_per_expiry, expiry_count: eventParams.expiry_count,
              hurdle_bps: 10000,
            };
          } else {
            return json(res, 404, { error: 'no params (note may be claimed/deleted)', code: 'NO_PARAMS' });
          }
          // Oracle forward / settlement_price — read raw (NOT fetchOracle, which throws on settled).
          let forward = null, settlementPrice = null;
          try {
            const { oracleId } = await resolveOracle(client, asset, BigInt(expiry));
            const oc = await client.getObject({ id: oracleId, options: { showContent: true } });
            const f = oc.data?.content?.fields;
            settlementPrice = f?.settlement_price ?? null;
            forward = f?.prices?.fields?.forward ?? null;
          } catch (e) { console.error('[note-params] oracle read failed (forward optional):', e.message); }
          return json(res, 200, { params, forward, settlementPrice, leftover });
        }
      }
      if (req.method === 'POST') {
        if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
        const body = await readBody(req);
        if (body == null) return json(res, 400, { error: 'bad json', code: 'BAD_JSON' });
        if (p === '/create-manager-tx') {
          if (!body.sender) return json(res, 400, { error: 'sender required', code: 'BAD_PARAMS' });
          return json(res, 200, { tx: txdeps.buildCreateManagerTx({ sender: body.sender }).serialize() });
        }
        if (p === '/quote') {
          if (!body.sender || !body.mgr) return json(res, 400, { error: 'sender, mgr required', code: 'BAD_PARAMS' });
          await assertManagerOwner(client, body.mgr, body.sender);
          const q = await quote(client, txdeps, body);
          return json(res, q.status ?? 200, q.body ?? q);
        }
        if (p === '/claim-tx') {
          if (!body.sender || !body.note || !body.mgr || !body.oracle)
            return json(res, 400, { error: 'sender, note, mgr, oracle required', code: 'BAD_PARAMS' });
          await assertManagerOwner(client, body.mgr, body.sender);
          return json(res, 200, { tx: txdeps.buildClaimTx(body).serialize() });
        }
        if (p === '/sponsor-claim') {
          if (!sponsor) return json(res, 503, { error: 'gas sponsor not configured', code: 'NO_SPONSOR' });
          if (!body.sender || !body.note || !body.mgr || !body.oracle)
            return json(res, 400, { error: 'sender, note, mgr, oracle required', code: 'BAD_PARAMS' });
          await assertManagerOwner(client, body.mgr, body.sender);
          await assertClaimable(client, body.note, body.sender);
          const tx = txdeps.buildClaimTx({ sender: body.sender, note: body.note, mgr: body.mgr, oracle: body.oracle });
          tx.setGasOwner(sponsor.address);
          tx.setGasPayment(await pickGasCoins(client, sponsor.address, SPONSOR_GAS_CAP));
          tx.setGasBudget(SPONSOR_GAS_CAP);
          const { txBytes, sponsorSig } = await signSponsored({ tx, client, keypair: sponsor.keypair });
          const dr = await client.dryRunTransactionBlock({ transactionBlock: txBytes });
          if (dr.effects.status.status !== 'success')
            return json(res, 502, { error: `claim dry-run failed: ${dr.effects.status.error}`, code: 'CLAIM_DRYRUN_FAILED' });
          return json(res, 200, { tx: txBytes, sponsorSig });
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      const status = e.status ?? (e.code === 'NO_DUSDC' ? 400 : 500);
      return json(res, status, { error: e.message, code: e.code ?? 'INTERNAL' });
    }
  });
}

async function quote(client, txdeps, { sender, mgr, asset = 'BTC', expiry: bodyExpiry, notional = '10000000' }) {
  const expiry = bodyExpiry ?? await txdeps.pickLiveExpiry(client, asset);
  const coin = await txdeps.pickDusdcCoin(client, sender);
  const lad = await txdeps.computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin: coin.coinId, sender });
  const tx = txdeps.buildMintTx({ sender, mgr, oracle: lad.oracleId, dusdcCoin: coin.coinId,
    notional, lower: lad.lower, upper: lad.upper, step: lad.step, expiryTotal: 1, asset });
  // Dry-run the exact mint we'd sign: doubles as a staleness guard and the leftover source
  // (leftover = net − Σ PositionMinted.cost). Fail loud rather than return a bogus preview.
  const txBytes = await tx.build({ client });
  const dr = await client.dryRunTransactionBlock({ transactionBlock: Buffer.from(txBytes).toString('base64') });
  if (dr.effects.status.status !== 'success') {
    return { status: 502, body: { error: `mint dry-run failed: ${dr.effects.status.error}`, code: 'QUOTE_DRYRUN_FAILED' } };
  }
  const { leftover } = deriveLeftover(dr.events);
  // Authoritative fee_bps from FactoryConfig so the preview can't drift from the contract.
  const cfgObj = await client.getObject({ id: CFG, options: { showContent: true } });
  const feeBps = Number(cfgObj.data?.content?.fields?.fee_bps ?? 30);
  const qtyPerLeg = computeQtyPerLeg({ notional, feeBps, legs: lad.legs, expiryCount: 1 });
  return {
    ladder: { lower: lad.lower.toString(), upper: lad.upper.toString(), step: lad.step.toString() },
    forward: lad.forward.toString(),
    qtyPerLeg: qtyPerLeg.toString(),
    oracleId: lad.oracleId, expiry, tx: tx.serialize(),
    leftover: leftover.toString(),
    notional, // echo the principal so the metric rail can display it
  };
}

// CLI: node server.js <dbPath> <port>
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('./db.js');
  const { SuiClient } = await import('@mysten/sui/client');
  const { RPC } = await import('../integration/config.js');
  const txbuild = await import('../integration/txbuild.js');
  const { pickDusdcCoin } = await import('../integration/coins.js');
  const { computeLadder } = await import('../pricing/price.js');
  const { pickLiveExpiry } = await import('../pricing/oracle.js');
  const db = openDb(process.argv[2] ?? 'indexer.db');
  const port = Number(process.argv[3] ?? 8787);
  const client = new SuiClient({ url: RPC });
  const txdeps = { ...txbuild, pickDusdcCoin, computeLadder, pickLiveExpiry };
  let sponsor = null;
  try { const { loadSponsor } = await import('../integration/sponsor.js'); sponsor = loadSponsor(); }
  catch (e) { console.warn('[sponsor] disabled:', e.message); }
  createServer(db, { client, txdeps, sponsor }).listen(port, () => console.log(`[indexer+tx] serving on :${port}${sponsor ? ` (sponsor ${sponsor.address})` : ''}`));
}
