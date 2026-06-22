# PearlFoundry — 5-Minute Demo Script

> Sui Overflow 2026 · Track 2 (DeepBook & Prediction Markets) · Pillar: Vaults & Structured Products
> British English. Total 5:00 — **1:00 pitch · 3:00 live demo · 1:00 future vision.**
> Honesty rule: the demo shows only what is genuinely live on testnet (Range Accrual mint→settle→claim + public leaderboard). Capped-Upside, Principal-Protected, Walrus attestation and the white-label SDK are framed as roadmap, not demonstrated.

---

## PART 1 — The Pitch (1:00)

**[Slide 1 — Title, ~10s]**
"Good afternoon. I'm [name], and this is **PearlFoundry** — a one-click structured-note factory built natively on DeepBook Predict."

**[Slide 2 — The Problem, ~25s]**
"Structured notes are a multi-trillion-dollar market, yet retail is locked out. Three reasons:
- Bank notes demand fifty-to-two-hundred-thousand-dollar minimums, lock-ups, and heavy KYC.
- The first generation of DeFi option vaults — Ribbon, Cega — collapsed on oracle manipulation and the absence of a real volatility surface.
- And neither side gives you an auditable, immutable record of the terms you actually bought."

**[Slide 3 — The Solution, ~25s]**
"PearlFoundry fixes all three on Sui. We bundle multiple DeepBook Predict option legs into a **single atomic Programmable Transaction Block** — so there's no leg-risk and no slippage. We price every note against DeepBook's **on-chain SVI volatility surface**, not a guessed number. And each note is a **soulbound Move object** carrying its own terms — a tamper-proof prospectus you can't edit after the fact. Let me show you the full mint-to-claim loop, live on testnet."

---

## PART 2 — Live Demo (3:00)

> Pre-flight (before you present): wallet funded with testnet SUI + dUSDC; backend indexer/server running; `pickLiveExpiry` confirmed returning a priced future BTC expiry; frontend `vite` dev server up. Have a fallback screen-recording ready in case the faucet or oracle is flaky.

**[0:00–0:30 — Orientation]**
"This is the PearlFoundry dApp. I'll connect my wallet… [click ConnectButton]. Notice I've already got a position from earlier — but let's mint a fresh Range Accrual note from scratch."

**[0:30–1:30 — The One-Click Mint]**
"I pick the **Range Accrual** template on BTC. Under the hood, our off-chain pricing engine reads DeepBook's live SVI forward, then builds a **multi-leg ladder of adjacent strikes** hugging that forward — because Predict rejects legs priced too far out-of-the-money. The whole ladder is sized to my notional automatically.

I click **Mint**. Watch what happens: this is actually **two PTBs**. The first creates my shared Predict manager; the second runs a hot-potato builder — `mint_begin`, one `add_expiry` per leg, then `mint_finalize` — all atomic. [Approve in wallet.]

…and there's my note. It's a **soulbound object** — it can't be transferred out, only claimed by me. Here it is under **My Notes**, with its strike range and expiry embedded on-chain."

**[1:30–2:15 — Settlement & Claim]**
"Now let's jump to a note that's already matured. Our **settlement watcher** — a notify-only daemon — has been tailing chain events and flagged this one as ready. Critically, a keeper **structurally cannot** claim on the holder's behalf: the note is an owned soulbound object, so only the owner can sign. The watcher pings; the holder claims.

I click **Claim**. This runs `claim_begin` → settle each expiry → `claim_finalize` **atomically** — it settles every leg, withdraws the payout, takes the performance fee, and deletes the note in one transaction. [Approve.]

Done. Payout's in my wallet, the performance fee — ten per cent above the hurdle — went to the fee vault, and the note object is burnt. Fully closed loop, on-chain."

**[2:15–3:00 — The Leaderboard]**
"Finally, the social layer. This is the **Nacre Ledger** — our public issuer leaderboard, ranked by realised PnL, served by our off-chain indexer. It's visible to anyone, even before connecting a wallet. And once I'm connected, **my own row is highlighted** — there I am, tagged 'YOU'.

This is the SocialFi hook: KOLs and issuers build a **public, verifiable track record** of realised returns — the thing traditional structured-product desks have never had to show."

---

## PART 3 — Future Vision (1:00)

**[Slide 4 — Roadmap, ~35s]**
"What you've seen is the live core. Here's where it goes:
- **More templates.** Range Accrual is shipped; **Capped-Upside** and **Principal-Protected** notes are next, reusing the same atomic-PTB factory.
- **Walrus term attestation.** Every note will pin an immutable PDF term sheet and historical backtest CSV to Walrus, with the Blob ID embedded in the Move object — a regulator-grade audit trail.
- **Gasless claims.** A sponsored-transaction gas station so holders can claim without ever holding SUI — the holder signs, the issuer pays gas."

**[Slide 5 — The Vision, ~25s]**
"The bigger picture: PearlFoundry is the **issuance rail for on-chain structured products**. CeFi platforms white-label the entire flow through our SDK; KOLs issue bespoke notes to their followers and earn on a transparent, realised-return leaderboard. We're taking a fifty-thousand-dollar private-banking product and making it a one-click mint for everyone — fully composable, fully auditable, on Sui.

Thank you. I'm happy to take questions."

---

## Timing & Delivery Notes
- **Total 5:00.** If you overrun, cut the Capped-Upside/Principal-Protected line in Part 3 first.
- **Speak to the soulbound point** — it's your strongest differentiator vs. the collapsed first-gen DOVs.
- **If the live mint fails** (faucet/oracle), narrate over the fallback recording without breaking stride: "I'll run this from a recording I made earlier this morning — same testnet, same contracts."
- **Numbers you can quote if asked:** net mint gas ≈ 0.505 SUI for a 16-leg note; claim is gas-negative (earns rebate); fee vault reconciliation verified to the unit on testnet.
- **Don't claim** Walrus, Capped-Upside, Principal-Protected, or the SDK are built — they're explicitly roadmap.
