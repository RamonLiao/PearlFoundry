# Product Economics & Payoff — Range Accrual Note

> Why this doc exists: the mint/MyNotes payoff chart shows a max of `9.97` against a `10`
> dUSDC notional, which *looks* like a guaranteed loss. It is not. This records the real
> economics, who funds payouts, and the chart correction — so anyone can answer these later.
> Grounded in on-chain code + two live settled notes (2026-06-24).

## TL;DR

- The Range Accrual note is a **bullish, directional structured product**: deposit notional,
  bet BTC settles into/above a strike band by expiry. The higher it settles, the more you get
  back — payout **can exceed the notional**.
- **Who pays when the holder profits?** The **DeepBook Predict market counterparties** — whoever
  sold (shorted) the `up` binaries the note buys. A prediction market is zero-sum (minus fees).
  The factory **never pays out of its own pocket**.
- The factory is a **non-custodial pass-through wrapper**. It only collects fees (issuance +
  perf) into `FeeVault`. `FeeVault` has no code path that funds a claim.

## How a Range Accrual note works

1. Holder deposits `notional` dUSDC (demo: 10) via `note_factory::mint_begin`.
2. Issuance fee (`fee_bps`, default 30 bps = 0.3%) is split off → `FeeVault`. `net = notional − fee`
   (e.g. 9.97) goes into the holder's `PredictManager`.
3. `strategy_range_accrual::mint_expiry_legs` buys an **equal-weight ladder of `up` binaries**:
   one `predict::mint(qty_per_leg)` per strike `s` in `lower..upper` (step), where
   `qty_per_leg = net / total_legs` (e.g. 9_970_000 / 16 = 623_125).
4. Each `predict::mint` pays the **premium** (DeepBook Predict ask price, `< 1.0` per unit) to the
   market. **The premium is spent, not the face value** — so the manager keeps
   `leftover = net − Σ premiumᵢ` in its DeepBook `BalanceManager` balance bag.
5. At/after expiry, `claim_settle_expiry` calls `predict::redeem_permissionless` for each leg:
   ITM legs (settlement ≥ strike) pay `qty_per_leg`, OTM legs pay 0. Payouts land back in the
   manager balance.
6. `claim_finalize` **withdraws the entire manager balance** = `leftover + Σ_ITM qty_per_leg`,
   takes a perf fee (10% of profit above `net_principal`, hurdle 10000 bps = principal), and
   transfers the rest to the holder. The soulbound note is then deleted.

### The real payoff function

```
payout(settlement) = leftover + qty_per_leg × (# strikes strictly below settlement)
                     └ unspent premium       └ ITM leg redemptions
```

- **Floor (all OTM, settlement < lower):** `payout = leftover` (> 0) — you reclaim the unspent
  premium; you lose only what was spent on premiums.
- **Cap (all ITM, settlement ≥ upper):** `payout = leftover + qty_per_leg × legs` — **above the
  notional whenever the ladder appreciated**, i.e. the bet paid off.
- It is a staircase in settlement price, shifted **up** by `leftover`.

## Empirical proof (live testnet, 2026-06-24)

Two settled notes, both notional 10 dUSDC (`net_principal` = 9.97 after 0.3% issuance):

| Note      | gross payout | perf fee | reading                                   |
|-----------|--------------|----------|-------------------------------------------|
| `0x9d56…` | **11.00** (10_997_587) | 0.103 (102_758) | settled high, ~all legs ITM → **profit**, payout > notional |
| `0xc03e…` | **5.24** (5_240_530)   | 0       | settled below band, all OTM → payout ≈ `leftover`, holder −4.76 |

Perf-fee check on `0x9d56`: `net_principal` 9.97; profit `11.00 − 9.97 = 1.03`; perf 10% =
0.103 ✓ (`PERF_FEE_BPS = 1000`). The settlement event's `payout` field is the **gross** balance
(before perf fee is split); holder receives `payout − perf_fee`.

So the observed payoff range was **5.24 → 11.00**, not the chart's `0 → 9.97`.

## The chart bug (and the fix)

`frontend/src/payoff.js` plots only the ladder face: baseline pinned at `0`, max pinned at
`qty_per_leg × legs` (= 9.97). It **omits `leftover`**, so it understates **both** ends:
the floor (real `leftover`, not 0) and the cap (real `leftover + 9.97`, which can exceed
notional). That is why the chart misleadingly implies "max 9.97 < 10 = guaranteed loss".

**Fix (decision):** shift the whole staircase up by `leftover`.
- `leftover` source — **mint preview**: dry-run the mint PTB in `/quote`, read dUSDC spent →
  `leftover = net − spent`. **MyNotes (already-minted, pending)**: read the manager's DeepBook
  `BalanceManager` balance bag (pre-settlement balance == `leftover`).
- Settled notes draw no chart (note is deleted on claim) — only the realized PnL number.

## Counterparty / liquidity risk (not factory risk)

- If a strike has no Predict liquidity, `predict::mint` aborts (ask-price band, code 7 — the
  known mint constraint). Strikes must hug the live forward; the off-chain pricing engine sizes
  the band dynamically for this reason.
- Counterparty default risk lives in **DeepBook Predict**, not the factory. The factory takes no
  market risk; it routes notional in and wraps the position as a soulbound note.

## Where does the counterparty come from?

The `up` binaries are **not created by the factory** — they are bought on **DeepBook Predict**, an
on-chain prediction market (CLOB-based). The other side is sourced from the existing market:

- **Bearish / neutral traders** who sell those `up` outcomes (they bet BTC won't reach the strike).
- **Market makers** quoting both sides for the spread, providing depth.
- **Pricing:** the ask is not arbitrary matching — it comes from an on-chain **SVI volatility-surface
  oracle + spread** (`pricing_config::quote_spread_from_fair_price`). Strikes must hug the live
  forward; far-OTM strikes have no fair-priced liquidity and `predict::mint` aborts (ask-price band,
  code 7). The off-chain pricing engine sizes the band against the live forward for this reason.

Consequence: the factory **does not create liquidity** — it depends on Predict market depth. Thin
markets ⇒ mint aborts or premiums widen. Counterparty default risk lives in DeepBook Predict, not
the factory.

## Product characteristics

- **Bullish, directional** range/ladder accrual on BTC over a fixed horizon (to expiry).
- **Defined payoff:** monotonic staircase in settlement price. Cap = `leftover + qty×legs` (can
  exceed notional). Floor = `leftover` (>0 — partial loss, **not** principal-protected, **not** zero).
- **Soulbound (non-transferable):** bound to the holder, no secondary market → hold-to-expiry only.
  Good for reputation/leaderboard (issuer PnL ranking), points programs; bad if you need early exit.
- **Self-settling:** `redeem_permissionless` — anyone can trigger settlement after expiry; holder
  (or a sponsor) signs the claim. No liquidations, no margin calls.
- **Non-custodial pass-through:** factory takes no market risk; routes notional into Predict and
  wraps the position. Fees: 0.3% issuance + 10% perf on profit above principal.
- **dUSDC-denominated, BTC underlying** (testnet).

## Who is it for / how to pitch it

**Target user:** someone with a **bullish-into-a-band** view on BTC over a short horizon who wants
defined, on-chain, composable exposure without running an options desk.

> "Deposit dUSDC and take a defined bullish bet that BTC climbs into a strike band by expiry. The
> higher it settles, the more you get back — payout can exceed your deposit. If it stays below the
> band, you keep the unspent premium instead of going to zero. No options desk, no liquidations,
> settles itself on-chain, and your position is a soulbound note that feeds an issuer leaderboard."

**Good fit:** directional bulls wanting partial downside cushion (floor = leftover) vs a naked call;
builders wanting composable structured exposure; reputation/points programs (soulbound + leaderboard).

**Bad fit:** anyone needing early exit / transferability (it's soulbound, hold-to-expiry); anyone
wanting full principal protection (this can lose the spent premium); bearish or neutral views.

## Related open work (approved 2026-06-24)

- **A — refresh-orphan + quote staleness:** PTB1 creates the manager; if the page is refreshed
  before PTB2, the manager id is lost from in-memory React state and the empty manager is
  orphaned on-chain (no funds lost — notional is only spent in PTB2). Fix: persist pending
  `{mgr, expiry, ts}` to localStorage, offer resume, and **re-`/quote`** on resume (the cached
  quote's ladder goes stale as the forward rolls ~15 min → PTB2 would abort `assert_mintable_ask`).
- **B — payoff chart economic correction:** the `leftover` shift described above.
