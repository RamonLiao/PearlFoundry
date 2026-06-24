# Payoff leftover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the real, immutable `leftover` (= net_principal − Σ premium) into the payoff staircase at the mint preview and MyNotes, and fix the chart display gaps that a non-zero floor exposes.

**Architecture:** One pure helper sums `PositionMinted.cost` from a mint transaction's events (live `getTransactionBlock` for an existing note, `dryRunTransactionBlock` for a preview). `/quote` and `/note-params` return `leftover`; the two frontend call sites pass it into the existing `computePayoffCurve({…, leftover})`. The chart gains a baseline Y-tick and marker-colour/overflow fixes for `baseline > 0`.

**Tech Stack:** Node http server + better-sqlite3 (`scripts/indexer/`), `@mysten/sui` client, React 18 + plain SVG (`frontend/src/`), `node --test`, Vite.

## Global Constraints

- Source of truth for `leftover` is mint-tx events; **never** `balanceChanges` (= −notional, sender-level) or live `predict_manager::balance` (time-dependent — inflates to the cap after settlement). Verified live (note `0x136990dd…`, tx `pd7Mjqm…`): `leftover = 9970000 − Σcost(4897965) = 5072035`.
- `leftover = net − Σcost` where `net` = the `BalanceEvent{deposit:true}` dUSDC amount, `Σcost` = sum of `cost` over `::PositionMinted` events. Fail-loud if `net` missing, `legs === 0`, or `leftover < 0`.
- All money values are base-unit integers; carry as `BigInt`, return as decimal strings over HTTP. dUSDC has 6 decimals (`/1e6`).
- `leftover` absent on the frontend → `computePayoffCurve` already defaults to `0n`. Keep that path; `baseline === 0` must render pixel-identical to today (no regression).
- ESM, 2-space indent, no new dependencies. Match existing `scripts/indexer` route + test style (see `server.test.js` `fakeClient`/`callRoute`).

---

### Task 1: `deriveLeftover` / `deriveParamsFromEvents` helper

**Files:**
- Create: `scripts/indexer/leftover.js`
- Test: `scripts/indexer/leftover.test.js`

**Interfaces:**
- Produces:
  - `deriveLeftover(events: Array<{type:string, parsedJson:object}>) -> { leftover: bigint, net: bigint, sumCost: bigint, legs: number }`
  - `deriveParamsFromEvents(events) -> { lower: bigint, upper: bigint, strike_step: bigint, qty_per_leg: bigint, legs_per_expiry: number, expiry_count: number } | null` (null when no PositionMinted events)

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLeftover, deriveParamsFromEvents } from './leftover.js';

// Real testnet mint (tx pd7Mjqm…, note 0x136990dd…): 16 legs, net 9.97 dUSDC.
const COSTS = [320100,318240,316379,314516,312653,310789,308924,307059,305193,303327,301461,299595,297731,295865,293999,292134];
const STRIKE0 = 62812000000000n, STEP = 1000000000000n, QTY = 623125n;
const mintEvents = [
  { type: 'pkg::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true, asset: { name: 'e95…::dusdc::DUSDC' } } },
  ...COSTS.map((c, k) => ({
    type: 'pkg::predict::PositionMinted',
    parsedJson: { cost: String(c), quantity: String(QTY), strike: String(STRIKE0 + BigInt(k) * STEP), is_up: true },
  })),
];

test('deriveLeftover: net − Σcost on the real mint', () => {
  const r = deriveLeftover(mintEvents);
  assert.equal(r.legs, 16);
  assert.equal(r.net, 9970000n);
  assert.equal(r.sumCost, 4897965n);
  assert.equal(r.leftover, 5072035n);          // 5.07 dUSDC — NOT 0 (old pin), NOT 15.04 (live balance)
});

test('deriveLeftover: fail-loud on missing deposit BalanceEvent', () => {
  assert.throws(() => deriveLeftover(mintEvents.filter((e) => !e.type.endsWith('::BalanceEvent'))), /net/i);
});

test('deriveLeftover: fail-loud on zero legs', () => {
  assert.throws(() => deriveLeftover([mintEvents[0]]), /legs/i);
});

test('deriveLeftover: fail-loud on negative leftover', () => {
  const bad = [{ type: 'x::events::BalanceEvent', parsedJson: { amount: '100', deposit: true } },
               { type: 'x::predict::PositionMinted', parsedJson: { cost: '999', quantity: '1', strike: '1' } }];
  assert.throws(() => deriveLeftover(bad), /leftover/i);
});

test('deriveParamsFromEvents: reconstruct ladder from PositionMinted strikes', () => {
  const p = deriveParamsFromEvents(mintEvents);
  assert.equal(p.lower, STRIKE0);
  assert.equal(p.upper, STRIKE0 + 15n * STEP);
  assert.equal(p.strike_step, STEP);
  assert.equal(p.qty_per_leg, QTY);
  assert.equal(p.legs_per_expiry, 16);
});

test('deriveParamsFromEvents: null when no mint legs', () => {
  assert.equal(deriveParamsFromEvents([mintEvents[0]]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test leftover.test.js`
Expected: FAIL — `Cannot find module './leftover.js'`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/indexer/leftover.js
// Derive a Range-Accrual note's immutable `leftover` from its mint transaction events.
// leftover = net_principal − Σ premium, where net = the deposited dUSDC (BalanceEvent deposit)
// and Σ premium = Σ PositionMinted.cost. This is fixed at mint and lifecycle-independent — unlike
// the live manager balance, which inflates to the cap once ITM legs redeem at settlement.

const isPositionMinted = (e) => e.type.endsWith('::PositionMinted');
const isDeposit = (e) => e.type.endsWith('::BalanceEvent') && e.parsedJson?.deposit === true;

export function deriveLeftover(events) {
  const legs = events.filter(isPositionMinted);
  if (legs.length === 0) throw new Error('deriveLeftover: no PositionMinted events (legs === 0)');
  const dep = events.find(isDeposit);
  if (!dep) throw new Error('deriveLeftover: no deposit BalanceEvent — cannot read net principal');
  const net = BigInt(dep.parsedJson.amount);
  const sumCost = legs.reduce((a, e) => a + BigInt(e.parsedJson.cost), 0n);
  const leftover = net - sumCost;
  if (leftover < 0n) throw new Error(`deriveLeftover: negative leftover (${leftover}) — Σcost exceeds net`);
  return { leftover, net, sumCost, legs: legs.length };
}

export function deriveParamsFromEvents(events) {
  const legs = events.filter(isPositionMinted);
  if (legs.length === 0) return null;
  const strikes = legs.map((e) => BigInt(e.parsedJson.strike)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lower = strikes[0], upper = strikes[strikes.length - 1];
  const strike_step = strikes.length > 1 ? strikes[1] - strikes[0] : upper; // single-leg degenerate
  return {
    lower, upper, strike_step,
    qty_per_leg: BigInt(legs[0].parsedJson.quantity),
    legs_per_expiry: legs.length,
    expiry_count: 1, // product is single-expiry; multi-expiry reconstruction is out of scope
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test leftover.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/leftover.js scripts/indexer/leftover.test.js
git commit -m "feat(indexer): deriveLeftover/deriveParamsFromEvents from mint events"
```

---

### Task 2: `noteById` query

**Files:**
- Modify: `scripts/indexer/queries.js` (append a new export)
- Test: `scripts/indexer/queries.test.js` (append)

**Interfaces:**
- Consumes: better-sqlite3 `db`, `notes` table (columns incl. `note_id`, `tx_digest`, `notional`, `expiry_ts_ms`).
- Produces: `noteById(db, noteId) -> { note_id, tx_digest, notional, expiry_ts_ms, ... } | undefined`

- [ ] **Step 1: Write the failing test**

Append to `scripts/indexer/queries.test.js` (follow the existing in-memory db setup in that file — reuse its `makeDb()`/seed helper if present; otherwise open `:memory:`, create the `notes` table, insert one row with a known `tx_digest`):

```js
test('noteById returns the row incl tx_digest, undefined when absent', () => {
  const db = seedDbWithNote({ note_id: '0xNOTE', tx_digest: '0xDIG', notional: '10000000', expiry_ts_ms: '1782266400000' });
  const row = noteById(db, '0xNOTE');
  assert.equal(row.tx_digest, '0xDIG');
  assert.equal(noteById(db, '0xMISSING'), undefined);
});
```

(Add `noteById` to the existing `import { … } from './queries.js'` line. If the file has no `seedDbWithNote` helper, inline the insert with the same column set the file's other tests use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test queries.test.js`
Expected: FAIL — `noteById is not a function`.

- [ ] **Step 3: Add the query**

Append to `scripts/indexer/queries.js`:

```js
export function noteById(db, noteId) {
  return db.prepare(`SELECT * FROM notes WHERE note_id = ?`).get(noteId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test queries.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/queries.js scripts/indexer/queries.test.js
git commit -m "feat(indexer): noteById query for mint-tx lookup"
```

---

### Task 3: `/quote` returns `leftover` (mint dry-run)

**Files:**
- Modify: `scripts/indexer/server.js` (`quote()` fn, ~`:114-130`; add import)
- Test: `scripts/indexer/server.test.js` (extend `fakeClient`, add a test)

**Interfaces:**
- Consumes: `deriveLeftover` (Task 1); `client.dryRunTransactionBlock`; existing `txdeps.buildMintTx` (returns a tx with `.build({client})`).
- Produces: `/quote` response gains `leftover: string`.

- [ ] **Step 1: Write the failing test**

In `server.test.js`, extend `fakeClient` with a `dryRunTransactionBlock` that returns a successful mint with 2 legs and a deposit, and make `buildMintTx` return a `.build()`-able tx. Add to `fakeTxdeps.buildMintTx`:

```js
buildMintTx: ({ sender, mgr }) => ({ serialize: () => `MINT:${sender}:${mgr}`, build: async () => new Uint8Array([1]) }),
```

Add to `fakeClient`:

```js
dryRunTransactionBlock: async () => ({
  effects: { status: { status: 'success' } },
  events: [
    { type: 'p::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true } },
    { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '5', strike: '1' } },
    { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '5', strike: '2' } },
  ],
}),
```

New test:

```js
test('POST /quote returns leftover from mint dry-run', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.leftover, '9370000'); // 9970000 − (300000+300000)
});

test('POST /quote 502 when mint dry-run fails', async () => {
  const bad = { ...fakeClient, dryRunTransactionBlock: async () => ({ effects: { status: { status: 'failure', error: 'MoveAbort … 7' } }, events: [] }) };
  const srv = createServer(fakeDb, { client: bad, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 502);
  assert.equal(j.code, 'QUOTE_DRYRUN_FAILED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: FAIL — `j.leftover` undefined / wrong status.

- [ ] **Step 3: Implement**

In `server.js`, add to the top imports:

```js
import { deriveLeftover } from './leftover.js';
```

The `quote()` helper returns the response object. The route currently does `return json(res, 200, await quote(...))`. To return a `502`, give `quote()` the ability to signal failure. Change the route call site (`:99`) and `quote()`:

Replace the route line:
```js
if (p === '/quote') {
  if (!body.sender || !body.mgr) return json(res, 400, { error: 'sender, mgr required', code: 'BAD_PARAMS' });
  const q = await quote(client, txdeps, body);
  return json(res, q.status ?? 200, q.body ?? q);
}
```

In `quote()`, after building `tx` and before the `return`, dry-run and derive leftover:

```js
  // Dry-run the exact mint we'd sign: doubles as a staleness guard and the leftover source
  // (leftover = net − Σ PositionMinted.cost). Fail loud rather than return a bogus preview.
  const txBytes = await tx.build({ client });
  const dr = await client.dryRunTransactionBlock({ transactionBlock: Buffer.from(txBytes).toString('base64') });
  if (dr.effects.status.status !== 'success') {
    return { status: 502, body: { error: `mint dry-run failed: ${dr.effects.status.error}`, code: 'QUOTE_DRYRUN_FAILED' } };
  }
  const { leftover } = deriveLeftover(dr.events);
```

and add `leftover: leftover.toString(),` to the returned object. (Preview is approximate — depth can shift before PTB2; that's expected for a forecast.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: PASS, including the existing `/quote returns ladder + tx` tests (they now also carry `leftover`; they don't assert its absence, so they stay green — confirm).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/server.js scripts/indexer/server.test.js
git commit -m "feat(quote): return leftover from mint dry-run (Σ PositionMinted.cost)"
```

---

### Task 4: `/note-params` returns `leftover` + settled-note param fallback

**Files:**
- Modify: `scripts/indexer/server.js` (`/note-params` route, `:50-90`)
- Test: `scripts/indexer/server.test.js` (extend `fakeDb`/`fakeClient`, add tests)

**Interfaces:**
- Consumes: `noteById` (Task 2), `deriveLeftover` + `deriveParamsFromEvents` (Task 1), `client.getTransactionBlock`.
- Produces: `/note-params` response gains `leftover: string`; when the params dynamic-field is gone, `params` is reconstructed from mint events.

- [ ] **Step 1: Write the failing test**

Extend the fakes so the note row carries a `tx_digest` and the client can fetch that tx's events. Replace `fakeDb` (or add a second db) so `noteById` returns a row:

```js
const noteRow = { note_id: '0xNOTE', tx_digest: '0xDIG', notional: '10000000', expiry_ts_ms: '1782266400000' };
const fakeDb = { prepare: (sql) => ({
  all: () => [],
  get: () => (sql.includes('WHERE note_id') ? noteRow : {}),
}) };
```

Add to `fakeClient`:

```js
getTransactionBlock: async ({ digest }) => ({
  events: digest === '0xDIG' ? [
    { type: 'p::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true } },
    { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '623125', strike: '62812000000000' } },
    { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '623125', strike: '62813000000000' } },
  ] : [],
}),
```

Tests:

```js
test('GET /note-params returns leftover from mint tx', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xNOTE&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 200);
  assert.equal(j.leftover, '9370000'); // 9970000 − 600000
});

test('GET /note-params reconstructs params from events when df gone (settled)', async () => {
  const dfGone = { ...fakeClient, getDynamicFieldObject: async () => ({ data: null }) };
  const srv = createServer(fakeDb, { client: dfGone, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xNOTE&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 200);
  assert.equal(j.params.lower, '62812000000000');
  assert.equal(j.params.strike_step, '1000000000000');
  assert.equal(j.leftover, '9370000');
});

test('GET /note-params 404 when note row has no tx_digest', async () => {
  const dbNoTx = { prepare: () => ({ all: () => [], get: () => undefined }) };
  const srv = createServer(dbNoTx, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xX&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 404);
  assert.equal(j.code, 'NO_MINT_TX');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: FAIL — `j.leftover` undefined; settled-fallback 404s on missing params.

- [ ] **Step 3: Implement**

Add `noteById` to the `./queries.js` import. In the `/note-params` handler:

After parsing `note`/`expiry`, fetch the mint tx events once and derive leftover:

```js
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
```

Keep the existing `getDynamicFieldObject` read. Where it currently 404s on a missing df (`if (!rp || rp.lower == null) return json(res, 404, …)`), replace that branch with the event reconstruction:

```js
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
```

Add `leftover` to the final response: `return json(res, 200, { params, forward, settlementPrice, leftover });`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: PASS (existing `/note-params` tests stay green — they don't assert `leftover` absence; confirm the canned `getDynamicFieldObject` path still returns the df params).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/server.js scripts/indexer/server.test.js
git commit -m "feat(note-params): return leftover + reconstruct params from mint events for settled notes"
```

---

### Task 5: Frontend wiring — pass `leftover` into the curve

**Files:**
- Modify: `frontend/src/mint.js` (`quoteMint`, `:10-12`)
- Modify: `frontend/src/App.jsx` (`:165-168` mint preview curve)
- Modify: `frontend/src/MyNotes.jsx` (`:38-52` toggleExpand)

**Interfaces:**
- Consumes: `/quote` `leftover` (Task 3), `/note-params` `leftover` (Task 4), existing `computePayoffCurve({…, leftover})`.

- [ ] **Step 1: Thread leftover through `quoteMint`**

`frontend/src/mint.js` `:10-12`:

```js
export async function quoteMint({ sender, mgr }) {
  const { tx, ladder, forward, qtyPerLeg, expiry, leftover } = await postTx('/quote', { sender, mgr });
  return { mgr, tx, ladder, forward, qtyPerLeg, expiry, leftover };
}
```

- [ ] **Step 2: Mint preview passes leftover**

`frontend/src/App.jsx` `:165-168` — add `leftover` to the curve args:

```js
const curve = computePayoffCurve({
  lower: preview.ladder.lower, upper: preview.ladder.upper,
  step: preview.ladder.step, qtyPerLeg: preview.qtyPerLeg,
  leftover: preview.leftover ?? 0,
});
```

- [ ] **Step 3: MyNotes passes leftover**

`frontend/src/MyNotes.jsx` `:43-46` — destructure `leftover` and feed it:

```js
const { params, forward, settlementPrice, leftover } = await getNoteParams(n.note_id, UNDERLYING, n.expiry_ts_ms);
const curve = computePayoffCurve({
  lower: params.lower, upper: params.upper, step: params.strike_step, qtyPerLeg: params.qty_per_leg,
  leftover: leftover ?? 0,
});
```

- [ ] **Step 4: Build to verify**

Run: `cd frontend && npm run build`
Expected: build succeeds, no type/syntax errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mint.js frontend/src/App.jsx frontend/src/MyNotes.jsx
git commit -m "feat(frontend): feed real leftover into payoff curve at both call sites"
```

---

### Task 6: PayoffChart — baseline tick (C1) + marker colours (C2/C3)

**Files:**
- Modify: `frontend/src/PayoffChart.jsx`
- Modify: `frontend/src/theme.css` (add `--chart-settlement`)

**Interfaces:**
- Consumes: `curve.baseline`, `curve.maxPayout` (already produced by `computePayoffCurve`).

**Test convention:** `PayoffChart` is pure presentational SVG. The frontend test runner is
`node --test` (see `payoff.test.js` importing `node:test`) which cannot parse JSX — there is no
JSX test seam, and the codebase's established convention for presentational SVG/CSS changes is
`vite build` green + a manual visual gate (per project lessons), not a unit test. The verifiable
invariant here is **`leftover=0` renders pixel-identical to today** (the baseline tick is gated on
`baseline > 0`), checked at Step 4. Do NOT add a `renderToStaticMarkup`/JSX test — it won't run.

- [ ] **Step 1: Implement C1 baseline tick**

In `PayoffChart.jsx`, in the `{full && <> … axis ticks … </>}` block (`:98-103`), add a third Y-tick when `baseline > 0`:

```jsx
{baseline > 0 && (
  <text x={x0 - 6} y={py(baseline) + 3} textAnchor="end" fill="var(--chart-tick)"
    fontFamily="var(--font-mono)" fontSize="11">{fmt(baseline)}</text>
)}
```

Update the `aria-label` (`:53`) to state the floor when non-zero — change `0 below ${fmt(lo)}` to:

```jsx
aria-label={`Payoff: floor ${fmt(baseline)} below ${fmt(lo)}, rising in steps to ${fmt(maxPayout)} at ${fmt(hi)}.${forward != null ? ` Forward ${fmt(forward)}.` : ''}${settlementPrice != null ? ` Settled at ${fmt(settlementPrice)}.` : ''}`}
```

- [ ] **Step 2: Implement C2 forward + C3 settlement colours**

C2 — forward line uses gold like its label. `:84` change `stroke="var(--rust)"` → `stroke="var(--chart-fwd)"`.

C3 — settlement marker to a distinct readable ink. Add a token in `theme.css` (next to the other `--chart-*` vars):

```css
--chart-settlement: #1f7a5e; /* jade-dark: legible on the pale nacre fill, distinct from gold forward */
```

In `PayoffChart.jsx` `:91-94`, replace the three `var(--pearl)` occurrences in the settlement marker with `var(--chart-settlement)`.

- [ ] **Step 3: Run build + existing payoff tests (no regression)**

Run: `cd frontend && npm run build && node --test src/payoff.test.js`
Expected: build green; existing 16 payoff-math tests still pass (unchanged).

- [ ] **Step 4: Visual gate — leftover=0 unchanged, leftover>0 shows floor**

`cd frontend && npm run dev`. Confirm: a `leftover=0` curve is pixel-identical to today (no third
y-tick); a `leftover>0` curve shows the floor tick at the staircase floor, a gold forward line, and
a jade settlement marker. (This is the project's standard presentational gate.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/PayoffChart.jsx frontend/src/theme.css
git commit -m "fix(chart): baseline floor tick + forward/settlement marker colours for leftover>0"
```

---

### Task 7: CSS — preview overflow guard (C4) + SVG max-width reconcile (C5)

**Files:**
- Modify: `frontend/src/App.css` (`.nl-preview`)
- Modify: `frontend/src/Leaderboard.css` (`.nl-detail svg`) and/or `frontend/src/PayoffChart.jsx` (`:54`)

**Interfaces:** presentational only.

- [ ] **Step 1: C4 — preview overflow guard**

In `App.css`, on `.nl-preview` add a mobile scroll guard so a tall many-leg chart never pushes Confirm/Cancel below the fold:

```css
.nl-preview { max-height: 70vh; overflow-y: auto; }
```

- [ ] **Step 2: C5 — reconcile SVG max-width**

The inline `maxWidth: full ? 480 : 420` (`PayoffChart.jsx:54`) conflicts with `Leaderboard.css` `.nl-detail svg { max-width: 420px }`, clipping the right edge of the full chart at 480px. MyNotes only ever renders `size="compact"` (≤420). Make the CSS rule defer to the SVG's own cap so it never clips:

In `Leaderboard.css`, change `.nl-detail svg { max-width: 420px; }` → `.nl-detail svg { max-width: 100%; }` (the SVG's inline `maxWidth` already caps it; `width:100%` + `max-width:100%` lets it shrink responsively without an external clip).

- [ ] **Step 3: Build to verify**

Run: `cd frontend && npm run build`
Expected: build green.

- [ ] **Step 4: Visual check (manual)**

Run `cd frontend && npm run dev`; with a `leftover>0` preview confirm: floor tick label visible at the staircase floor, gold forward line, jade settlement marker, Confirm/Cancel reachable on a narrow viewport, full chart not right-clipped.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.css frontend/src/Leaderboard.css frontend/src/PayoffChart.jsx
git commit -m "fix(chart): preview overflow guard + reconcile SVG max-width clip"
```

---

### Task 8: Live verification

**Files:** none (verification only).

- [ ] **Step 1: Start the tx server**

```bash
cd scripts/indexer && node server.js indexer.db 8787 &
```

- [ ] **Step 2: Verify `/note-params` leftover on the known note**

```bash
curl -s 'http://127.0.0.1:8787/note-params?note=0x136990dd5cab8f5ce98c937cda91ac421cb3caa8cd4966be3a98a4b0896136d9&asset=BTC&expiry=1782266400000' | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);console.log("leftover:",j.leftover,"=",j.leftover/1e6,"dUSDC")})'
```
Expected: `leftover: 5072035 = 5.072035 dUSDC` (matches the calibration).

- [ ] **Step 3: Frontend round-trip (manual, browser wallet)**

`cd frontend && npm run dev`; connect wallet, open the live note in MyNotes → confirm the staircase floors at ~5.07 (not 0) and caps at ~15.04; run a fresh mint preview → confirm the preview chart shows a positive floor.

- [ ] **Step 4: Full test sweep**

```bash
cd scripts/indexer && node --test && cd ../../frontend && npm run build
```
Expected: backend tests all green; build green.

- [ ] **Step 5: Update progress + commit**

Update `tasks/progress.md`: mark B-leftover spike done, note the live `leftover=5.07` confirmation and the deferred design batches. Commit.

```bash
git add tasks/progress.md && git commit -m "docs: payoff leftover spike done + live-verified (5.07 dUSDC)"
```

---

## Self-Review

**Spec coverage:**
- leftover formula / source (Σ PositionMinted.cost) → Task 1, 3, 4. ✓
- `/quote` leftover via dry-run + staleness guard → Task 3. ✓
- `/note-params` leftover via mint tx, immutable, settled-note param reconstruction → Task 4 (+ Task 2 `noteById`). ✓
- frontend both call sites feed leftover, 0-fallback no regression → Task 5. ✓
- Rejected mechanisms (balanceChanges / live balance) → not implemented (Global Constraints documents why). ✓
- C1 baseline tick (bug) + aria-label, C2 forward colour, C3 settlement colour → Task 6. ✓
- C4 overflow guard, C5 max-width conflict → Task 7. ✓
- Tests: real-tx fixture, fail-loud cases, baseline-tick render, no-regression at leftover=0 → Tasks 1, 6. ✓
- Live verification (leftover ≈ 5.07) → Task 8. ✓
- Out-of-scope (mgr→sender, centerpiece redesign, UX batch) → not in any task (tracked in progress.md). ✓

**Placeholder scan:** No TBD/TODO; every code step shows code; commands have expected output. ✓

**Type consistency:** `deriveLeftover` returns `{leftover,net,sumCost,legs}` (Task 1) used in Tasks 3-4. `deriveParamsFromEvents` returns bigints → `.toString()`'d in Task 4 response. `noteById` row `.tx_digest` used in Task 4. `leftover` string over HTTP → `?? 0` into `computePayoffCurve` (Task 5). `curve.baseline` Number → `fmt()` in Task 6. Consistent. ✓
