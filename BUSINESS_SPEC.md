# BUSINESS_SPEC — One-Click Structured Note Factory

> Track 2 · DeepBook & Prediction Markets · Sui Overflow 2026
> HANDBOOK pillar: **Vaults & Structured Products**

---

## 1. Executive Summary

Structured Note Factory is a one-click issuance platform that lets any user — retail, KOL, or CeFi white-label — mint a tokenised structured note (range-accrual, capped-upside, principal-protected) on Sui in a single PTB. Under the hood the factory composes multi-strike / multi-expiry **DeepBook Predict** binaries (`predict::mint`) into a Move-object note, attests product terms + backtest CSVs to **Walrus** for immutable compliance disclosure, and surfaces a public SocialFi leaderboard ranking KOL-issued notes by realised return.

The global structured products market hit **~$1.4T in 2024 notional issuance** (+37.3% YoY) [source: SRP Global Market Overview 2024], but on-chain access has collapsed: every flagship DOV (Ribbon, Cega, Friktion) has shut down or pivoted away [source: DefiLlama, https://defillama.com/protocol/aevo; The Block, 2024-11, https://www.theblock.co/post/328228/cega-announces-acquisition-and-sunsetting-of-product-suite]. The factory ships into a vacuum: Predict's sub-hour SVI surface is the first on-chain primitive capable of pricing the multi-strike combinations these notes require, and Walrus is the only Sui-native answer to the audit-trail problem that killed DeFi structured products in 2025.

Win probability: **70/100**. Hackathon target: 3 working note templates issuable end-to-end on testnet, Walrus-attested term sheet on each issuance, leaderboard with ≥3 demo KOL notes, and a 2-week SVI backtest replay per template with downloadable CSV.

---

## 2. Problem Statement

Three structural failures keep $1.4T/yr of structured product flow off-chain:

- **Bank notes are HNW-only**. Minimum ticket sizes ($50k–$250k), KYC, and private-bank distribution gate 90% of the addressable market [source: SRP 2024]. Retail wanting yield-enhanced exposure has no on-chain equivalent.
- **DOV 1.0 died**. Ribbon → Aevo migration killed the structured products line after a 2025-12 oracle-manipulation exploit ($2.7M loss) [source: DefiLlama; The Block 2025-Q4]; Cega sunset in 2024-Q4; Friktion shut in 2023; Thetanuts pivoted to RFQ. Combined peak TVL >$674M is now <$30M. The whole category needs a re-launch on infrastructure that actually prices multi-strike payoffs.
- **No on-chain term-sheet attestation**. Bank notes ship a 60-page prospectus; DeFi vaults ship a docs page that can be silently edited post-issuance. Auditors and compliance teams can't underwrite either. Walrus blob attestation closes this gap natively on Sui — no other L1 has a comparable primitive integrated with a vol-surface protocol.

**The gap**: nobody has stitched (a) a real on-chain vol surface, (b) a one-click multi-strike composer, (c) immutable term attestation, and (d) a distribution surface (KOL leaderboard + B2B SDK) into a single product. DeepBook Predict + Walrus + Sui object model is the first stack where it's even possible.

---

## 3. Target Users & Personas

### Persona A — Retail Yield Seeker ("Kenji, 28, salaryman, $30k DeFi portfolio")
- Wants 8–15% APR on stables with capped downside; can't read SVI; doesn't want to manage positions.
- Today: stuck rotating between Pendle PTs, Aave supply, and Ethena sUSDe.
- Wants: pick "BTC stays in $90–110k for 7 days → 12% APR" from a UI, mint, forget.

### Persona B — Crypto KOL / Influencer ("Mei, 80k Twitter followers, runs a $TG group")
- Monetises today via referral codes (Bybit, OKX) — low margin, brand-corroding.
- Wants: publish her own structured note ("Mei's BTC Range Note #14"), earn issuance fee + referral rebate, leaderboard credibility.
- Win condition: her notes outperform peer KOLs over a 30-day rolling window — the leaderboard becomes her track record.

### Persona C — CeFi White-Label / Fintech ("OrangeFi, regional neobank, 2M users")
- Wants on-chain structured products to wrap and resell under their own brand.
- Pain: regulators require auditable term sheets; existing DeFi can't provide them.
- Wants: SDK integration, Walrus term-sheet URL per note, monthly NAV CSV export, white-label UI kit.

### Persona D — DeepBook Predict Core Team (indirect)
- Needs sustained multi-strike flow across the SVI surface to keep PLP utilisation high and prove the surface is composable, not just tradeable.

---

## 4. Use Cases — Three Concrete Note Templates

### UC1 — Range Accrual Note (flagship)
"Earn 12% APR for every hour BTC stays inside $90k–$110k over the next 7 days; principal at risk if range breaks." Composed as a strip of long-range Predict binaries (multiple `predict::mint` calls bundled in one PTB) auto-rolling at each rolling sub-hour expiry. Payoff curve plotted live; max loss capped at strip notional minus accrued coupons.

### UC2 — Capped-Upside Note
"Earn 2× BTC upside from $95k → $115k, capped above $115k; 100% principal back if BTC ≤ $95k at expiry." Composed as a long binary call spread on Predict (mint at $95k strike, mint inverse at $115k strike) + a long deep-OTM safety leg. Sold to retail as "leveraged-but-safe BTC exposure."

### UC3 — Principal-Protected Note
"Get 100% USDC back at expiry; if BTC > $120k at expiry get an extra 30%." Composed as a zero-coupon dUSDC leg (parked via `predict::supply` for PLP yield to fund the option premium) + a long deep-OTM Predict binary call. Net: principal-protected upside coupon, financed entirely by PLP yield — the only Sui-native equivalent of a bank principal-protected note.

---

## 5. Market Analysis

### TAM / SAM / SOM
- **TAM** — global structured products notional issuance: **$1.4T in 2024**, +37.3% YoY; US alone forecast to grow $149.4B → $200B+ in 2025 [source: SRP Global Market Overview 2024; iCapital 2024 YE Forecast]. Retail/wealth share ≈65–75% → addressable retail notional **~$900B–$1.05T/yr**.
- **SAM** — DeFi-native subset (users who already custody stables on-chain and would buy structured exposure without bank intermediation). Conservative anchor: peak DOV TVL summed across Ribbon + Thetanuts + Cega + Friktion ≈ **$674M** at 2022 peaks [source: DefiLlama]. Re-launch on proper vol-surface infra with retail UX could plausibly reach **$1–3B TVL** over 18 months (Internal projection — no external benchmark) — still <0.3% of TAM, so the ceiling is distribution and trust, not market size.
- **SOM (year 1, hackathon → mainnet+12mo)** — Sui-native + KOL-distributed. Realistic target: **$20–80M TVL** with 30–100bps issuance fee + 10% performance share → **$0.6–3M annual revenue** (Internal projection — no external benchmark). Anchor: Thetanuts hit $100M at peak with weaker tech [source: DefiLlama].

### Competitive Landscape

| Product / Protocol | Vol-surface pricing | Multi-strike composition | Term attestation | Retail UX | Status |
|---|---|---|---|---|---|
| Ribbon / Aevo (structured) | No (single-strike DOV) | No | No | Medium | **Shut 2025-12** |
| Cega | Partial (exotic) | Yes (basket) | No | Low | **Sunset 2024-Q4** |
| Thetanuts V4 | No (RFQ) | Limited | No | Low | Active (institutional pivot) |
| Bank structured notes (UBS, JPM) | Yes (proprietary) | Yes | Yes (prospectus) | None (HNW only) | Dominant ($1.4T) |
| **Structured Note Factory** | **Yes (Predict SVI)** | **Yes (PTB-composed)** | **Yes (Walrus)** | **One-click** | **Building** |

No live competitor combines on-chain vol-surface pricing + multi-strike composition + immutable attestation + retail-grade UX. Bank notes have the first three; we add #4 and the on-chain rail.

---

## 6. Differentiation — Why Sui + DeepBook + Predict + Walrus

1. **SVI surface is a prerequisite, not a nice-to-have.** Composing a range-accrual note requires pricing 24+ adjacent strikes consistently. Single-strike DOVs (Ribbon) couldn't do this. Predict's SVI is the only on-chain primitive that supports it.
2. **PTB atomicity removes the leg-risk that killed Cega.** All strikes of a multi-leg note mint in one transaction or none — no partial fills, no exchange-rate slippage between legs. Impossible on Ethereum without complex flashloan choreography.
3. **Walrus term attestation closes the regulatory loop.** Term sheet PDF + backtest CSV + marketing copy → Walrus blob → blob ID embedded in the note Move object. Anyone (auditor, regulator, end user) can verify what was promised at mint, immutably. No other L1 has a blob store integrated this tightly with a vol protocol.
4. **Move object = native tokenised note.** Each note is a typed object with embedded settlement logic, not an ERC-20 share that requires a separate vault contract. Composability with `deepbook_margin` (leveraged variants), `iron_bank` (USDsui collateral), and Sui kiosks (secondary market) is free.
5. **Sub-hour rolling expiries** let range-accrual notes auto-roll hourly without keeper gas blowing up — a structural advantage over weekly-expiry options on Deribit.

---

## 7. Product Scope

### MVP (Hackathon, ~5 weeks)
- **3 note templates**: Range Accrual, Capped Upside, Principal Protected — each a parametrised Move function over `predict::mint`.
- **Issuance UI**: pick template → set parameters (strike range, tenor, principal) → see live payoff diagram + Monte-Carlo expected return → mint.
- **Walrus attestation**: auto-generate term sheet (Markdown → PDF) + backtest CSV, upload to Walrus, store blob ID in note object.
- **Leaderboard PWA**: rank live notes by realised APR, issuer, TVL; demo with 3 seeded KOL accounts.
- **Backtest replay**: 2-week SVI history → simulated note PnL per template.

### v1 (mainnet day one — 8 weeks)
- **B2B SDK**: TypeScript package for CeFi white-label; exposes `composeNote()`, `attestTerms()`, `subscribeSettlements()`.
- **KOL referral**: on-chain rebate split (60% issuer / 30% protocol / 10% referrer).
- **Leveraged variants** via `deepbook_margin` for sophisticated users (gated, capped at 2×).
- **Secondary market**: list active notes on Sui kiosk for transferable resale.

### v2 (Q4 2026)
- **Multi-asset** (ETH, SOL, Attention Index when listed).
- **Custom note builder** (drag-and-drop composer for power users).
- **Regulated wrapper** (Cayman SPV) for institutional distribution.

### Strategic call: factory-first, vault-second
Issuance fees scale with users, not TVL — so the factory model captures value earlier than a vault. Vault wrappers (v2) layer on once 90-day live performance data justifies LP onboarding.

---

## 8. User Flow

1. **Land on factory homepage** → see top 5 active notes by APR, total TVL across all notes, "issue your own" CTA.
2. **Connect Sui wallet** (Slush / Suiet) → auto-create `PredictManager`, faucet dUSDC on testnet.
3. **Pick template** → "Range Accrual" → wizard: underlying (BTC), tenor (7d), range ($90k–$110k), principal (1000 dUSDC).
4. **Preview** → payoff diagram, historical sim ("over the last 90 days, this configuration paid out 76% of weeks, average APR 11.4%"), max loss, Walrus draft term sheet preview.
5. **Mint** → single PTB: composes multi-strike Predict binaries, allocates collateral, uploads term sheet to Walrus, mints note Move object to wallet. Tx receipt + Walrus URL displayed.
6. **Track** → portfolio page shows live mark-to-market, time-to-expiry, current accrual.
7. **Settle** → at expiry, factory keeper (or `predict::redeem_permissionless` from idea #8) auto-redeems, principal + payout returned to wallet.
8. **Share / publish** (KOL flow) → "list on leaderboard" → note becomes publicly mintable by followers with auto-rebate; KOL dashboard tracks issuance volume + earned fees.

---

## 9. Technical Architecture (summary, no code)

- **On-chain (Sui Move)**:
  - `note_factory` module — three template entry functions (`mint_range_accrual`, `mint_capped_upside`, `mint_principal_protected`), each composing 2–24 `predict::mint` calls in one PTB.
  - `Note` Move object — typed struct holding strike array, expiry array, principal, Walrus blob ID, issuer address, fee config.
  - `leaderboard` module — append-only registry of public notes, indexed by issuer + realised return.
- **Walrus integration**: TypeScript client generates term-sheet PDF + backtest CSV → `walrus::store` → blob ID embedded in `Note` at mint.
- **Pricing engine (off-chain TS)**: subscribes to `oracle::OracleSVIUpdated`; computes payoff diagrams and Monte-Carlo sims for the wizard; cross-checks BTC mark against Pyth feed.
- **Backtest service**: replays 14-day SVI history → simulated payouts per template config; output downloadable CSV referenced from Walrus.
- **Indexer + frontend**: Postgres indexer for note state, leaderboard ranking, KOL attribution; Next.js PWA frontend.
- **Settlement keeper**: shared with Settled-Redeem Keeper Network (idea #8) or standalone fallback.

No new Move primitives required beyond `predict::mint/redeem/supply` and Walrus — keeps audit scope minimal.

---

## 10. Business Model

Three revenue lines, layered:

1. **Issuance fee** — 30bps of principal at mint, paid by issuer (KOL) or buyer (factory-issued template).
2. **Performance share** — 10% of realised payout above hurdle (1-month SOFR + 200bps) for factory-issued notes; KOL-issued notes split per their config.
3. **B2B SDK licence (v1)** — $2k–$10k/mo per CeFi integrator, plus 5bps revenue share on white-labelled flow.

Unit economics: $50M issuance volume/yr × 30bps = $150k issuance + $200–500k performance share = **$0.4–0.7M ARR** from one anchor KOL ring + 2 CeFi integrators (Internal projection). Lean ops (2 engineers + 1 BD) is profitable from year one.

Cost structure: Walrus storage (~$0.01/note at typical 50KB term sheet), Sui gas (~$0.005/PTB), indexer hosting ($300/mo). Negligible relative to revenue.

---

## 11. Go-to-Market

- **Phase 0 — hackathon proof**: 3 working templates + Walrus attestation + leaderboard demo with seeded KOLs. Win → grant + DeepBook foundation amplification.
- **Phase 1 — KOL alpha (weeks 6–10)**: recruit 5–10 crypto-Twitter KOLs (10k–100k followers) to issue weekly notes; subsidise issuance fees; publish leaderboard widely.
- **Phase 2 — retail distribution (weeks 10–16)**: open factory to public; performance leaderboard becomes the marketing flywheel ("which KOL's notes paid out best last month?").
- **Phase 3 — CeFi white-label (months 4–9)**: pitch 2–3 regional Asian fintechs (OrangeX, Bitkub-class); SDK + Walrus attestation = their regulatory wedge.
- **Phase 4 — multi-asset + regulated wrapper (Q4 2026)**: ETH/SOL templates, Cayman SPV for institutional.

Anchor partnerships to pursue at hackathon: Slush (wallet sponsorship of zero-gas mint), Pyth (price-feed grant), Mysten (Walrus credit).

---

## 12. Hackathon Demo Plan + Judging Mapping

### 7-minute demo script
1. (0:00–0:45) **Hook**: split screen — bank prospectus (60 pages, HNW-only, $250k min) vs Factory UI (one click, 100 dUSDC min, Walrus term sheet).
2. (0:45–2:30) **Issue a Range Accrual note**: pick BTC $90k–$110k 7d → live payoff curve appears → Monte-Carlo shows 76% historical hit rate → click mint → PTB lands on Sui testnet (explorer link), Walrus blob URL displayed, note object appears in wallet.
3. (2:30–4:00) **KOL leaderboard**: switch view → 3 demo KOL notes ranked by 30d realised APR; click into one → see its issuer's track record, Walrus-attested terms, mint-as-follower flow with auto-rebate.
4. (4:00–5:30) **Backtest evidence**: scrub 2-week replay → equity curves for all 3 templates side-by-side. Demo success criteria (targets, not measured): **range accrual ≥10% APR, capped upside ≥1.6× BTC delta, principal protected ≥98% capital return** — actual numbers TBD against full SVI history.
5. (5:30–6:30) **Walrus + regulatory**: show that the term sheet pinned at mint matches the actual settlement — judge can verify via the Walrus blob URL independently.
6. (6:30–7:00) **Pitch**: "$1.4T market, all banks; we're the on-chain factory" → ask for grant + mainnet day-one partner status.

### Judging criteria mapping
- **Real-World (50%)** — $1.4T market with real distribution path (KOL + CeFi SDK); Walrus attestation is concrete regulatory progress, not theatre.
- **Technical Quality (20%)** — multi-strike PTB composition, Move object note, Walrus integration, settlement keeper.
- **Innovation (15%)** — first one-click structured-note issuance with on-chain vol surface + immutable terms.
- **UX (10%)** — wizard UI, payoff diagrams, leaderboard PWA.
- **Sui Ecosystem Fit (5%)** — Predict + Walrus + (optional) `deepbook_margin` + Slush wallet + Kiosk for secondary.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| "Yet another vault" framing — judges saw 5 of these last year | High | High | Lead with Walrus attestation + KOL leaderboard, both novel; never demo as a vault |
| Pricing logic bug → mispriced note → user loss | Medium | High | Unit tests per template + Monte-Carlo cross-check + 2-week dry-run before any mainnet issuance |
| Financial-engineering depth too ambitious for 5 weeks | High | Medium | Ship only 3 templates; explicitly defer custom composer to v2; reuse Predict pricing primitives |
| KOL/SocialFi feels tacked on | Medium | Medium | Hard-code leaderboard into mint flow (every public note auto-listed); demo with real KOL test accounts not mocks |
| Walrus testnet instability blocks demo | Medium | High | Pre-pin term sheets pre-demo; local fallback if Walrus 5xx; status banner |
| Predict SVI insufficient depth for multi-leg | Medium | Medium | Size cap per note (≤1k dUSDC notional MVP); coordinate with PLP supply for v1 |
| Settlement-day liquidity squeeze (mass redeem) | Low | Medium | Stagger expiries; use Keeper Network for redeem; cap concurrent notes per asset |
| Regulator views note as a security in some jurisdictions | Medium | High | Walrus term sheet explicit about risk; v2 wrapper handles compliant distribution; geofence factory UI day one |
| Backtest results overfit / look fake | Medium | Medium | Publish raw SVI snapshots + replay code; let judges re-run independently |
| Single-keeper failure delays settlement | Low | Medium | `predict::redeem_permissionless` fallback; partner with Keeper Network (HANDBOOK #8) |

---

## 14. Open Questions

1. **Template count for MVP** — 3 is the IDEA_REPORT scope, but 2 (range accrual + principal protected) might be more demo-able. Drop capped upside?
2. **KOL onboarding incentives** — pay issuance fee subsidies in DEEP, dUSDC, or factory-native points? Affects token-design path.
3. **Walrus attestation scope** — pin just terms + backtest, or also include marketing copy + risk disclaimers? Larger blob = higher storage cost but stronger compliance posture.
4. **Settlement integration** — build own keeper or hard-depend on Keeper Network (idea #8)? Tighter integration = faster but couples roadmaps.
5. **Secondary market timing** — kiosk listing in v1 or wait until enough TVL makes it useful?
6. **Revenue share with DeepBook / Predict** — formal rebate, or implicit via PLP supply incentives?
7. **B2B SDK pricing** — flat fee, revenue share, or both? Anchor pricing depends on first 2 integrator deals.
8. **Audit scope** — full Move audit for v1 mainnet, or partial scope on `note_factory` only? Cost vs trust trade-off.
9. **Token / DAO** — does the factory need a governance token to incentivise issuers, or is fee-share enough?
10. **Multi-asset roadmap** — ETH next, or Attention Index (synergy with idea #4 cal-crypto-attention-layer)?

---

*End of spec. ~2,300 words.*
