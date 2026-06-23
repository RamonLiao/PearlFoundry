import http from 'node:http';
import { leaderboard, listNotes, pendingSettle, feeStats } from './queries.js';
import { hexToUtf8, hexToBase64 } from './decode.js';
import { computeQtyPerLeg } from '../pricing/qty.js';
import { CFG, PKG } from '../integration/config.js';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const decodeNote = (r) => ({ ...r,
  strategy: hexToUtf8(r.strategy ?? ''), walrus_blob_id: hexToBase64(r.walrus_blob_id ?? '') });

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
});

export function createServer(db, { client, txdeps } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
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
        if (p === '/note-params') {
          if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
          const note = url.searchParams.get('note');
          const asset = url.searchParams.get('asset') ?? 'BTC';
          const expiry = url.searchParams.get('expiry');
          if (!note || !expiry) return json(res, 400, { error: 'note, expiry required', code: 'BAD_PARAMS' });
          const { resolveOracle } = await import('../pricing/oracle.js');
          // RangeParams lives as a dynamic field under the note, keyed by the unit struct note::ParamsKey.
          const dfo = await client.getDynamicFieldObject({
            parentId: note,
            name: { type: `${PKG}::note::ParamsKey`, value: {} },
          });
          const pf = dfo.data?.content?.fields;
          // df value object wraps the stored struct under `.value.fields` (JSON-RPC layout for
          // a struct-valued dynamic field). Fall back to flat fields if the layout differs.
          const rp = pf?.value?.fields ?? pf;
          if (!rp || rp.lower == null) {
            return json(res, 404, { error: 'no params (note may be claimed/deleted)', code: 'NO_PARAMS' });
          }
          const params = {
            version: Number(rp.version), lower: rp.lower, upper: rp.upper,
            strike_step: rp.strike_step, qty_per_leg: rp.qty_per_leg,
            legs_per_expiry: Number(rp.legs_per_expiry), expiry_count: Number(rp.expiry_count),
            hurdle_bps: Number(rp.hurdle_bps),
          };
          // Oracle forward / settlement_price — read raw (NOT fetchOracle, which throws on settled).
          let forward = null, settlementPrice = null;
          try {
            const { oracleId } = await resolveOracle(client, asset, BigInt(expiry));
            const oc = await client.getObject({ id: oracleId, options: { showContent: true } });
            const f = oc.data?.content?.fields;
            settlementPrice = f?.settlement_price ?? null;
            forward = f?.prices?.fields?.forward ?? null;
          } catch (e) { console.error('[note-params] oracle read failed (forward optional):', e.message); }
          return json(res, 200, { params, forward, settlementPrice });
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
          return json(res, 200, await quote(client, txdeps, body));
        }
        if (p === '/claim-tx') {
          if (!body.sender || !body.note || !body.mgr || !body.oracle)
            return json(res, 400, { error: 'sender, note, mgr, oracle required', code: 'BAD_PARAMS' });
          return json(res, 200, { tx: txdeps.buildClaimTx(body).serialize() });
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, e.code === 'NO_DUSDC' ? 400 : 500, { error: e.message, code: e.code ?? 'INTERNAL' });
    }
  });
}

async function quote(client, txdeps, { sender, mgr, asset = 'BTC', expiry: bodyExpiry, notional = '10000000' }) {
  const expiry = bodyExpiry ?? await txdeps.pickLiveExpiry(client, asset);
  const coin = await txdeps.pickDusdcCoin(client, sender);
  const lad = await txdeps.computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin: coin.coinId, sender });
  const tx = txdeps.buildMintTx({ sender, mgr, oracle: lad.oracleId, dusdcCoin: coin.coinId,
    notional, lower: lad.lower, upper: lad.upper, step: lad.step, expiryTotal: 1, asset });
  // Authoritative fee_bps from FactoryConfig so the preview can't drift from the contract.
  const cfgObj = await client.getObject({ id: CFG, options: { showContent: true } });
  const feeBps = Number(cfgObj.data?.content?.fields?.fee_bps ?? 30);
  const qtyPerLeg = computeQtyPerLeg({ notional, feeBps, legs: lad.legs, expiryCount: 1 });
  return {
    ladder: { lower: lad.lower.toString(), upper: lad.upper.toString(), step: lad.step.toString() },
    forward: lad.forward.toString(),
    qtyPerLeg: qtyPerLeg.toString(),
    oracleId: lad.oracleId, expiry, tx: tx.serialize(),
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
  createServer(db, { client, txdeps }).listen(port, () => console.log(`[indexer+tx] serving on :${port}`));
}
