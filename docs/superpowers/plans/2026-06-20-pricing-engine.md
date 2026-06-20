# Pricing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI + importable JS module that derives a valid range-accrual strike ladder (every leg passes `predict::mint`'s ask-price band) from the live oracle forward, replacing the manual `LOWER/UPPER/STEP` env in `mint.js`.

**Architecture:** dry-run probing (no SVI replication). `oracle.js` reads forward from the live OracleSVI; `probe.js` binary-searches each band boundary via 1-leg `dryRunTransactionBlock`; `ladder.js` (pure) turns boundaries into a max-width forward-centered ladder; `price.js` wires them and is imported by `mint.js`.

**Tech Stack:** Node 24 ESM, `@mysten/sui ^1.45.2`, `node:test` (zero-dep, built-in), testnet JSON-RPC.

## Global Constraints

- Price/strike scale = 1e9 (9 decimals); all strike/forward values are `bigint`.
- `MAX_LEGS = 128` (must match Move `note_factory`); ladder shrinks symmetric-inward if exceeded.
- Oracle IDs are EPHEMERAL (~15-min rolling) → resolve dynamically via `registry::OracleCreated`, never hardcode.
- Abort-code whitelist: only code `1` (pricing_config crash) and `7` (`assert_mintable_ask`) count as band rejection; ANY other abort throws + prints raw effects.
- All probes share ONE fixed notional (band is ask-price-vs-strike; hold notional constant).
- Ladder is compute-then-mint-immediately; `mint.js` re-fetches oracle and aborts if timestamp changed or `|forward_now − forward_compute| ≥ step`.
- Predict pkg: `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`. Reuse `../integration/config.js` for `RPC, ADDR, PKG, CFG, VAULT, PREDICT, DUSDC, CLOCK`.
- JSON-RPC is deprecated (Protocol 124) but acceptable for hackathon (dryRun ≠ Quorum Driver; matches existing scripts).

---

### Task 1: Scaffold `scripts/pricing/` + pure `ladder.js`

**Files:**
- Create: `scripts/pricing/package.json`
- Create: `scripts/pricing/ladder.js`
- Test: `scripts/pricing/ladder.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `buildLadder({ forward, tickSize, minStrike, loBound, hiBound, stepMult?, maxLegs? }) -> { lower, upper, step, legs, center }` — all bigint except `legs` (number), `center` bigint. Also exports `snapToGrid(x, tick) -> bigint`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pricing",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "test": "node --test" },
  "dependencies": { "@mysten/sui": "^1.45.2" }
}
```

- [ ] **Step 2: Install deps**

Run: `cd scripts/pricing && npm install`
Expected: `node_modules/@mysten/sui` present, exit 0.

- [ ] **Step 3: Write the failing tests**

`scripts/pricing/ladder.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder, snapToGrid } from './ladder.js';

const T = 1_000_000_000n; // tickSize $1

test('snapToGrid rounds to nearest tick', () => {
  assert.equal(snapToGrid(62_447_400_000_000n, T), 62_447_000_000_000n);
  assert.equal(snapToGrid(62_447_600_000_000n, T), 62_448_000_000_000n);
});

test('ladder is forward-centered and symmetric when bounds allow', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 50_000_000_000_000n,
    loBound: center - 3n * T, hiBound: center + 3n * T });
  assert.equal(r.step, T);
  assert.equal(r.lower, center - 3n * T);
  assert.equal(r.upper, center + 3n * T);
  assert.equal(r.legs, 7); // (6T)/T + 1
  assert.equal(r.center, center);
});

test('legs formula with stepMult', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center - 4n * T, hiBound: center + 4n * T, stepMult: 2 });
  assert.equal(r.step, 2n * T);
  assert.equal((r.upper - r.lower) % r.step, 0n);
  assert.equal(r.legs, Number((r.upper - r.lower) / r.step) + 1);
});

test('minStrike clamps lower bound', () => {
  const center = 51_000_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 50_000_000_000_000n,
    loBound: 49_000_000_000_000n, hiBound: center + 2n * T });
  assert.ok(r.lower >= 50_000_000_000_000n);
});

test('MAX_LEGS shrink stays forward-centered and symmetric', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center - 500n * T, hiBound: center + 500n * T, maxLegs: 128 });
  assert.equal(r.legs, 128);
  // symmetric inward around center: 127 even split → 63 below, 64 above (or vice versa), within 1 step
  assert.ok(r.lower <= center && r.upper >= center);
  assert.ok((r.upper - center) - (center - r.lower) <= r.step);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd scripts/pricing && node --test ladder.test.js`
Expected: FAIL — `buildLadder` / `snapToGrid` not exported.

- [ ] **Step 5: Implement `ladder.js`**

```js
// Pure: turn probed band boundaries into a max-width, forward-centered, on-grid ladder.
const MAX_LEGS_DEFAULT = 128;

export function snapToGrid(x, tick) {
  const r = x % tick;
  return r * 2n >= tick ? x - r + tick : x - r;
}

// align v to the grid {center + k*step} — dir +1 rounds up (away from center for upper),
// dir -1 rounds down. We snap upper DOWN to grid, lower UP to grid, both relative to center.
function snapToCenterGrid(v, center, step, mode) {
  const diff = v - center;            // signed
  // floor division toward -inf for k:
  let k = diff / step;
  if (diff % step !== 0n) {
    if (mode === 'up' && diff > 0n) k += 1n;        // upper: round outward then we clamp ≤ v? no — round inward
  }
  // We want grid points strictly inside [lower,upper]. Round inward to not exceed probed bounds.
  // upper: largest center+k*step ≤ v ; lower: smallest center+k*step ≥ v
  if (mode === 'upper') {
    k = floorDiv(diff, step);
  } else { // lower
    k = ceilDiv(diff, step);
  }
  return center + k * step;
}

function floorDiv(a, b) { const q = a / b; return (a % b !== 0n && (a < 0n)) ? q - 1n : q; }
function ceilDiv(a, b)  { const q = a / b; return (a % b !== 0n && (a > 0n)) ? q + 1n : q; }

export function buildLadder({ forward, tickSize, minStrike, loBound, hiBound, stepMult = 1, maxLegs = MAX_LEGS_DEFAULT }) {
  const step = tickSize * BigInt(stepMult);
  const center = snapToGrid(forward, tickSize);
  let lo = loBound > minStrike ? loBound : minStrike;
  let hi = hiBound;
  let lower = snapToCenterGrid(lo, center, step, 'lower'); // smallest grid ≥ lo
  let upper = snapToCenterGrid(hi, center, step, 'upper'); // largest grid ≤ hi
  if (upper < lower) { upper = lower = center; }
  let legs = Number((upper - lower) / step) + 1;
  if (legs > maxLegs) {
    const below = BigInt(Math.floor((maxLegs - 1) / 2));
    const above = BigInt(maxLegs - 1) - below;
    lower = center - below * step;
    upper = center + above * step;
    if (lower < minStrike) { lower = snapToCenterGrid(minStrike, center, step, 'lower'); }
    legs = Number((upper - lower) / step) + 1;
  }
  return { lower, upper, step, legs, center };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd scripts/pricing && node --test ladder.test.js`
Expected: PASS (5 tests). If `snapToCenterGrid` dead branch noise, delete the unused `mode==='up'` block.

- [ ] **Step 7: Commit**

```bash
git add scripts/pricing/package.json scripts/pricing/ladder.js scripts/pricing/ladder.test.js
git commit -m "feat(pricing): pure forward-centered max-width ladder builder + tests"
```

---

### Task 2: `oracle.js` — resolve + fetch forward + event sanity

**Files:**
- Create: `scripts/pricing/oracle.js`
- Test: `scripts/pricing/oracle.test.js`

**Interfaces:**
- Consumes: `../integration/config.js` (`RPC, PKG`(predict pkg via PREDICT type? use literal), `PREDICT`).
- Produces:
  - `resolveOracle(client, asset, expiry) -> Promise<string oracleId>` (throws + lists expiries if no match).
  - `fetchOracle(client, oracleId) -> Promise<{ forward, spot, tickSize, minStrike, expiry, settled }>` (bigints; settled boolean; throws if settled).
  - `sanityBand(client, asset) -> Promise<{ minSeen, maxSeen } | null>` from recent `predict::PositionMinted`.
  - `PREDICT_PKG` constant = `0xf5ea...5138`.

- [ ] **Step 1: Write integration test (live testnet, 1 oracle)**

`scripts/pricing/oracle.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuiClient } from '@mysten/sui/client';
import { resolveOracle, fetchOracle, PREDICT_PKG } from './oracle.js';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

test('resolveOracle finds a live BTC oracle and fetchOracle reads forward', async () => {
  // pick the most recent BTC oracle's expiry from events, then resolve it back
  const ev = await client.queryEvents({
    query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
    limit: 1, order: 'descending',
  });
  const expiry = BigInt(ev.data[0].parsedJson.expiry);
  const oracleId = await resolveOracle(client, 'BTC', expiry);
  assert.match(oracleId, /^0x[0-9a-f]{64}$/);
  const o = await fetchOracle(client, oracleId);
  assert.ok(o.forward > 0n, 'forward positive');
  assert.ok(o.tickSize > 0n, 'tickSize positive');
  assert.ok(o.minStrike > 0n, 'minStrike positive');
  assert.equal(o.settled, false);
});

test('resolveOracle throws on unknown expiry', async () => {
  await assert.rejects(() => resolveOracle(client, 'BTC', 1n), /no oracle|expiry/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/pricing && node --test oracle.test.js`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `oracle.js`**

```js
export const PREDICT_PKG = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';

// Enumerate registry::OracleCreated, match (asset, expiry). Events carry oracle_id,
// expiry, underlying_asset, min_strike, tick_size. IDs are ephemeral → always resolve live.
export async function resolveOracle(client, asset, expiry) {
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await client.queryEvents({
      query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
      limit: 50, order: 'descending', cursor,
    });
    for (const e of r.data) {
      const j = e.parsedJson;
      if (j.underlying_asset !== asset) continue;
      if (BigInt(j.expiry) === BigInt(expiry)) return j.oracle_id;
      seen.push(j.expiry);
    }
    if (!r.hasNextPage) break;
    cursor = r.nextCursor;
  }
  throw new Error(`no oracle for asset=${asset} expiry=${expiry}; recent expiries=${[...new Set(seen)].slice(0, 8).join(',')}`);
}

export async function fetchOracle(client, oracleId) {
  const r = await client.getObject({ id: oracleId, options: { showContent: true } });
  const f = r.data?.content?.fields;
  if (!f) throw new Error(`oracle ${oracleId} has no content`);
  const settled = f.settlement_price != null;
  if (settled) throw new Error(`oracle ${oracleId} already settled (price=${f.settlement_price})`);
  const prices = f.prices.fields;
  return {
    forward: BigInt(prices.forward),
    spot: BigInt(prices.spot),
    tickSize: 1_000_000_000n,           // $1 grid (OracleCreated tick_size); see sanity note
    minStrike: 50_000_000_000_000n,     // floor; overridden by event below if available
    expiry: BigInt(f.expiry),
    timestamp: BigInt(f.timestamp),
    settled,
  };
}

// Order-of-magnitude sanity only — PositionMinted is Predict-global (other strategies' strikes).
export async function sanityBand(client, asset) {
  const r = await client.queryEvents({
    query: { MoveEventModule: { package: PREDICT_PKG, module: 'predict' } },
    limit: 50, order: 'descending',
  }).catch(() => ({ data: [] }));
  const strikes = r.data
    .filter(e => e.type.endsWith('::PositionMinted') && e.parsedJson?.strike)
    .map(e => BigInt(e.parsedJson.strike));
  if (!strikes.length) return null;
  return { minSeen: strikes.reduce((a, b) => a < b ? a : b), maxSeen: strikes.reduce((a, b) => a > b ? a : b) };
}
```

Note: `tickSize`/`minStrike` are not on the oracle object content — they come from the
`OracleCreated` event. Step 3b folds them in so callers get accurate values.

- [ ] **Step 3b: Carry tick_size/min_strike from the resolve event**

Change `resolveOracle` to return `{ oracleId, tickSize, minStrike }` and update `fetchOracle`
to accept overrides. Adjust signatures:

```js
// resolveOracle returns the matched event's fields:
return { oracleId: j.oracle_id, tickSize: BigInt(j.tick_size), minStrike: BigInt(j.min_strike) };
```
```js
// fetchOracle(client, oracleId, { tickSize, minStrike }):
export async function fetchOracle(client, oracleId, meta = {}) {
  // ...as above, but:
  tickSize: meta.tickSize ?? 1_000_000_000n,
  minStrike: meta.minStrike ?? 50_000_000_000_000n,
}
```
Update the test from Step 1 to destructure `{ oracleId, tickSize, minStrike } = await resolveOracle(...)`
and pass meta into `fetchOracle(client, oracleId, { tickSize, minStrike })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/pricing && node --test oracle.test.js`
Expected: PASS (2 tests). If testnet has no live BTC oracle at run time, the first test
errors loudly (acceptable — surfaces environment state, not a code bug).

- [ ] **Step 5: Commit**

```bash
git add scripts/pricing/oracle.js scripts/pricing/oracle.test.js
git commit -m "feat(pricing): oracle resolution + forward fetch + event sanity band"
```

---

### Task 3: `probe.js` — dry-run band probing

**Files:**
- Create: `scripts/pricing/probe.js`
- Test: `scripts/pricing/probe.test.js`

**Interfaces:**
- Consumes: `buildMintDryRun` context `{ client, sender, mgr, cfg, vault, predict, dusdc, dusdcCoin, clock, oracleId, notional, asset, tickSize }`.
- Produces:
  - `makeIsMintable(ctx) -> (strike: bigint) => Promise<'ok'|'band'>` (memoized; throws on non-1/7 abort).
  - `findBoundary(isMintable, forward, dir, step, { kmax?, floor? }) -> Promise<bigint>` (last-good strike).
  - `probeBounds(ctx, forward, step) -> Promise<{ loBound, hiBound }>`.

- [ ] **Step 1: Write the test (live testnet — boundary exactness)**

`scripts/pricing/probe.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuiClient } from '@mysten/sui/client';
import { resolveOracle, fetchOracle } from './oracle.js';
import { makeIsMintable, probeBounds } from './probe.js';
import { ADDR, CFG, VAULT, PREDICT, DUSDC, CLOCK } from '../integration/config.js';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
// Requires env: MGR, DUSDC_COIN (balance ≥ NOTIONAL), EXPIRY (matching a live oracle).
const E = process.env;
const run = E.MGR && E.DUSDC_COIN && E.EXPIRY ? test : test.skip;

run('probed boundary is exact: hiBound mintable, hiBound+step not', async () => {
  const { oracleId, tickSize, minStrike } = await resolveOracle(client, 'BTC', BigInt(E.EXPIRY));
  const o = await fetchOracle(client, oracleId, { tickSize, minStrike });
  const ctx = { client, sender: ADDR, mgr: E.MGR, cfg: CFG, vault: VAULT, predict: PREDICT,
    dusdc: DUSDC, dusdcCoin: E.DUSDC_COIN, clock: CLOCK, oracleId, notional: 10_000_000n,
    asset: 'BTC', tickSize: o.tickSize };
  const isMintable = makeIsMintable(ctx);
  const { loBound, hiBound } = await probeBounds(ctx, o.forward, o.tickSize);
  assert.ok(loBound <= o.forward && hiBound >= o.forward);
  assert.equal(await isMintable(hiBound), 'ok');
  assert.equal(await isMintable(hiBound + o.tickSize), 'band');
  assert.equal(await isMintable(loBound - o.tickSize), 'band');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/pricing && node --test probe.test.js`
Expected: FAIL — module not found (or `skip` if env unset; set env to actually exercise).

- [ ] **Step 3: Implement `probe.js`**

```js
import { Transaction } from '@mysten/sui/transactions';
import { PKG } from '../integration/config.js';

const bytes = s => [...new TextEncoder().encode(s)];
const BAND_CODES = new Set([1n, 7n]); // pricing_config crash / assert_mintable_ask

// Build a minimal 1-leg mint PTB at `strike` (lower=upper=strike, step=tick → legs=1).
function buildOneLeg(ctx, strike) {
  const tx = new Transaction();
  tx.setSender(ctx.sender);
  tx.setGasBudget(600_000_000);
  const [pay] = tx.splitCoins(tx.object(ctx.dusdcCoin), [ctx.notional]);
  const ticket = tx.moveCall({
    target: `${PKG}::note_factory::mint_begin`,
    typeArguments: [ctx.dusdc],
    arguments: [
      tx.object(ctx.cfg), tx.object(ctx.vault), tx.object(ctx.mgr), pay,
      tx.pure.vector('u8', bytes(ctx.asset)),
      tx.pure.u64(strike), tx.pure.u64(strike), tx.pure.u64(ctx.tickSize),
      tx.pure.u8(1),
      tx.pure.vector('u8', bytes('probe')), tx.pure.bool(true),
    ],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::mint_add_expiry`,
    typeArguments: [ctx.dusdc],
    arguments: [ticket, tx.object(ctx.predict), tx.object(ctx.mgr), tx.object(ctx.oracleId), tx.object(ctx.clock)],
  });
  tx.moveCall({ target: `${PKG}::note_factory::mint_finalize`, arguments: [ticket, tx.object(ctx.clock)] });
  return tx;
}

export function makeIsMintable(ctx) {
  const cache = new Map();
  return async function isMintable(strike) {
    const key = strike.toString();
    if (cache.has(key)) return cache.get(key);
    const tx = buildOneLeg(ctx, strike);
    const txBytes = await tx.build({ client: ctx.client });
    const r = await ctx.client.dryRunTransactionBlock({ transactionBlock: Buffer.from(txBytes).toString('base64') });
    const st = r.effects.status;
    let verdict;
    if (st.status === 'success') verdict = 'ok';
    else {
      const code = parseAbortCode(st.error);
      if (code != null && BAND_CODES.has(code)) verdict = 'band';
      else throw new Error(`unexpected abort at strike=${strike}: ${st.error}\n${JSON.stringify(r.effects.status)}`);
    }
    cache.set(key, verdict);
    return verdict;
  };
}

// MoveAbort errors look like: "...MoveAbort(... ), 7) in command 1"
function parseAbortCode(err) {
  if (!err) return null;
  const m = err.match(/MoveAbort\([^)]*\),\s*(\d+)\)/) || err.match(/, (\d+)\) in command/);
  return m ? BigInt(m[1]) : null;
}

// Exponential outward from forward until first fail, then binary search → last-good strike.
export async function findBoundary(isMintable, forward, dir, step, { kmax = 4096, floor = 0n } = {}) {
  const at = k => forward + BigInt(dir) * k * step;
  if (await isMintable(forward) !== 'ok') throw new Error(`forward ${forward} itself not mintable — band/oracle anomaly`);
  let lastOk = 0n, k = 1n;
  while (k <= kmax) {
    const s = at(k);
    if (s < floor) break;
    if (await isMintable(s) === 'ok') { lastOk = k; k *= 2n; } else break;
  }
  if (lastOk === 0n) return forward;          // even 1 step out fails → ladder is just the center
  // binary search between lastOk (ok) and first-fail (≤ 2*lastOk)
  let lo = lastOk, hi = (k <= kmax) ? k : lastOk * 2n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await isMintable(at(mid)) === 'ok') lo = mid; else hi = mid;
  }
  return at(lo);
}

export async function probeBounds(ctx, forward, step) {
  const isMintable = makeIsMintable(ctx);
  const hiBound = await findBoundary(isMintable, forward, +1, step);
  const loBound = await findBoundary(isMintable, forward, -1, step, { floor: 0n });
  return { loBound, hiBound };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `MGR=0x.. DUSDC_COIN=0x.. EXPIRY=<live> cd scripts/pricing && node --test probe.test.js`
Expected: PASS (boundary exact). Get MGR/DUSDC_COIN from the Task 8 round-trip objects or a fresh
`create_manager` + a dUSDC coin with balance ≥ 10_000_000. Verify `parseAbortCode` matches the
actual SDK error string first via one manual `node -e` dry-run of a far-OTM strike; adjust regex if needed.

- [ ] **Step 5: Commit**

```bash
git add scripts/pricing/probe.js scripts/pricing/probe.test.js
git commit -m "feat(pricing): dry-run band probing with binary-search boundary finder"
```

---

### Task 4: `price.js` CLI (`computeLadder`) + `mint.js` staleness guard

**Files:**
- Create: `scripts/pricing/price.js`
- Modify: `scripts/integration/mint.js`

**Interfaces:**
- Consumes: `resolveOracle`, `fetchOracle`, `sanityBand`, `probeBounds`, `buildLadder`.
- Produces: `computeLadder({ asset, expiry, notional, mgr, dusdcCoin, stepMult?, maxLegs? }) -> Promise<{ oracleId, lower, upper, step, legs, center, forward, timestamp }>`.

- [ ] **Step 1: Implement `price.js`**

```js
// CLI + importable: derive a band-valid range-accrual ladder from the live oracle.
// Usage: MGR=.. DUSDC_COIN=.. ASSET=BTC EXPIRY=.. NOTIONAL=10000000 node price.js
import { SuiClient } from '@mysten/sui/client';
import { ADDR, RPC, CFG, VAULT, PREDICT, DUSDC, CLOCK } from '../integration/config.js';
import { resolveOracle, fetchOracle, sanityBand } from './oracle.js';
import { probeBounds } from './probe.js';
import { buildLadder } from './ladder.js';

export async function computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin, stepMult = 1, maxLegs = 128 }) {
  const { oracleId, tickSize, minStrike } = await resolveOracle(client, asset, BigInt(expiry));
  const o = await fetchOracle(client, oracleId, { tickSize, minStrike });
  const step = o.tickSize * BigInt(stepMult);
  const ctx = { client, sender: ADDR, mgr, cfg: CFG, vault: VAULT, predict: PREDICT,
    dusdc: DUSDC, dusdcCoin, clock: CLOCK, oracleId, notional: BigInt(notional), asset, tickSize: o.tickSize };
  const { loBound, hiBound } = await probeBounds(ctx, o.forward, step);
  const ladder = buildLadder({ forward: o.forward, tickSize: o.tickSize, minStrike: o.minStrike,
    loBound, hiBound, stepMult, maxLegs });
  const sb = await sanityBand(client, asset);
  if (sb && (ladder.lower < sb.minSeen / 2n || ladder.upper > sb.maxSeen * 2n)) {
    console.warn(`[warn] ladder [${ladder.lower},${ladder.upper}] outside order-of-magnitude sanity [${sb.minSeen},${sb.maxSeen}]`);
  }
  return { oracleId, ...ladder, forward: o.forward, timestamp: o.timestamp };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const E = process.env;
  const client = new SuiClient({ url: RPC });
  const out = await computeLadder({ client, asset: E.ASSET || 'BTC', expiry: E.EXPIRY,
    notional: E.NOTIONAL || '10000000', mgr: E.MGR, dusdcCoin: E.DUSDC_COIN,
    stepMult: Number(E.STEP_MULT || '1'), maxLegs: Number(E.MAX_LEGS || '128') });
  console.log(JSON.stringify({ ...out, lower: out.lower.toString(), upper: out.upper.toString(),
    step: out.step.toString(), center: out.center.toString(), forward: out.forward.toString(),
    timestamp: out.timestamp.toString() }, null, 2));
}
```

- [ ] **Step 2: Verify CLI end-to-end (live)**

Run: `MGR=0x.. DUSDC_COIN=0x.. ASSET=BTC EXPIRY=<live> NOTIONAL=10000000 node scripts/pricing/price.js`
Expected: JSON with `lower < forward < upper`, `legs ≥ 1`, all on `step` grid. Spot-check that
`lower` and `upper` round-trip through a fresh `mint.js` dry-run as `success`.

- [ ] **Step 3: Add staleness guard to `mint.js`**

In `scripts/integration/mint.js`, after the existing `const client = ...` line, before building the
PTB, insert a re-fetch guard (the ladder must be minted against the same forward it was computed for):

```js
// Staleness guard (A2): ladder is compute-then-mint-immediately. If the oracle rolled
// or forward drifted ≥ step since compute, abort rather than mint a stale (band-failing) ladder.
import { fetchOracle } from '../pricing/oracle.js';
const COMPUTE_TS = process.env.COMPUTE_TS, COMPUTE_FWD = process.env.COMPUTE_FWD;
if (COMPUTE_TS && COMPUTE_FWD) {
  const o = await fetchOracle(client, ORACLE, { tickSize: STEP, minStrike: LOWER });
  if (o.timestamp.toString() !== COMPUTE_TS) { console.error(`stale: oracle ts ${o.timestamp} != ${COMPUTE_TS}`); process.exit(1); }
  const drift = o.forward > BigInt(COMPUTE_FWD) ? o.forward - BigInt(COMPUTE_FWD) : BigInt(COMPUTE_FWD) - o.forward;
  if (drift >= STEP) { console.error(`stale: forward drift ${drift} ≥ step ${STEP}`); process.exit(1); }
}
```

(`COMPUTE_TS`/`COMPUTE_FWD` come from `price.js` output; the import path assumes `mint.js` can reach
`../pricing/`. If `scripts/pricing/node_modules` differs, the import resolves to pricing's `@mysten/sui` —
harmless, same version.)

- [ ] **Step 4: Verify staleness guard fires**

Run with a deliberately wrong forward:
`COMPUTE_TS=1 COMPUTE_FWD=1 MGR=.. ORACLE=.. DUSDC_COIN=.. LOWER=.. UPPER=.. STEP=.. node scripts/integration/mint.js dryrun`
Expected: exits 1 with `stale: oracle ts ...` (guard triggers before build). Then run with the real
`COMPUTE_TS`/`COMPUTE_FWD` from a fresh `price.js` and confirm it proceeds to a `success` dry-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/pricing/price.js scripts/integration/mint.js
git commit -m "feat(pricing): computeLadder CLI + mint.js staleness guard"
```

---

### Task 5: Monkey testing (test.md requirement)

**Files:**
- Create: `scripts/pricing/monkey.test.js`

**Interfaces:**
- Consumes: `buildLadder` (pure cases), live client (env-gated cases).

- [ ] **Step 1: Write monkey tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder } from './ladder.js';

const T = 1_000_000_000n;

test('forward pinned at minStrike → lower clamps, ladder degenerates upward only', () => {
  const center = 50_000_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: center,
    loBound: center - 5n * T, hiBound: center + 3n * T });
  assert.ok(r.lower >= center);
  assert.equal(r.center, center);
});

test('loBound > hiBound (probe found nothing) → single-leg center ladder', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center + T, hiBound: center - T });
  assert.equal(r.legs, 1);
  assert.equal(r.lower, center);
  assert.equal(r.upper, center);
});

test('huge tickSize coarser than band → at most a few legs', () => {
  const center = 62_500_000_000_000n;
  const big = 1_000_000_000_000n; // $1000 tick
  const r = buildLadder({ forward: center, tickSize: big, minStrike: 0n,
    loBound: center - big, hiBound: center + big });
  assert.ok(r.legs <= 3);
  assert.equal(r.step, big);
});
```

- [ ] **Step 2: Run and verify pass**

Run: `cd scripts/pricing && node --test monkey.test.js`
Expected: PASS (3 tests). If the degenerate `loBound>hiBound` case doesn't collapse to a
single center leg, fix the `upper < lower` guard in `buildLadder`.

- [ ] **Step 3: Document env-gated live monkey cases**

Add to `move-notes.md` under a new pricing-engine section: live monkey cases to run manually
(expired oracle → `fetchOracle` throws; notional=0 → probe forward fails loud; far-future EXPIRY →
`resolveOracle` throws with expiry list). No code — these are operational checks.

- [ ] **Step 4: Commit**

```bash
git add scripts/pricing/monkey.test.js
git commit -m "test(pricing): monkey edge cases for ladder degeneration + clamps"
```

---

## Self-Review

**Spec coverage:**
- oracle.js (resolve/fetch/sanity) → Task 2 ✓
- probe.js (isMintable/findBoundary, abort whitelist, A1 stateful ctx) → Task 3 ✓
- ladder.js (max-width, forward-centered, MAX_LEGS shrink, minStrike clamp) → Task 1 ✓
- price.js CLI + computeLadder → Task 4 ✓
- A2 staleness TTL → Task 4 Step 3/4 ✓
- A3 JSON-RPC debt → Global Constraints note ✓
- A4 event pollution (order-of-magnitude only) → Task 2 sanityBand + Task 4 warn ✓
- Error handling table (settled/no-match/forward-unmintable/unexpected-abort/legs>MAX) → Tasks 2,3,1 ✓
- Testing (pure unit / probe exactness / monkey) → Tasks 1,3,5 ✓

**Placeholder scan:** No TBD/TODO; all code blocks concrete. One known risk: `parseAbortCode` regex
must match the live SDK error string — Task 3 Step 4 explicitly says verify/adjust against a real
dry-run before relying on it (not a placeholder, a calibration step).

**Type consistency:** `buildLadder` signature identical across Tasks 1/4. `resolveOracle` returns
`{ oracleId, tickSize, minStrike }` (Task 2 Step 3b) — consumed that way in Tasks 3/4. `fetchOracle`
takes `(client, oracleId, meta)` consistently. `isMintable` verdict `'ok'|'band'` consistent. `ctx`
shape identical in probe.test, probe.js, price.js.
