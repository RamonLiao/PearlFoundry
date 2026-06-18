# One-Click Structured Note Factory

**One-line pitch**: Issue range-accrual / auto-callable / capped-upside notes in one click — Predict positions composed under the hood, terms attested on Walrus, SocialFi leaderboard for KOL-issued products.

## Problem it solves
Bank structured products are HNW-only; DeFi barely touches them. Retail can't read "Strike/IV/SVI"; institutions need verifiable terms + backtests.

## Core mechanism
- UI: pick underlying (BTC/SUI/Attention Index) → tenor → principal-protected/half/none → see max payoff / max loss / historical sim → mint.
- Under the hood: multi-strike multi-expiry Predict binaries + ranges composed into a tokenized note (Move object).
- Walrus stores terms, marketing copy, backtest CSV — immutable for compliance.
- SocialFi: KOLs publish notes, leaderboard ranks by realized return, referral rebate.
- B2B: SDK for CeFi white-label.

## Why this track
Direct hit on HANDBOOK's "Vaults & Structured Products" pillar. Real-World 50% strong (institutional + retail). Walrus attestation closes the compliance loop.

## Win probability: 70/100
Right category, right composition. Risk: financial-engineering depth in 6 weeks is brutal; demo may look like another vault.

## Risks / weaknesses
- Pricing logic complexity → bugs.
- "Yet another structured product" framing.
- KOL/SocialFi feels tacked-on.
- Need real backtest data, not toy numbers.

## Required Sui primitives
- DeepBook Predict: `predict::mint`, multi-strike composition, `PredictManager`.
- Walrus (terms attestation).
- Optional `deepbook_margin` for leveraged variants.

## MVP scope
- 3 note templates: range-accrual, capped-upside, principal-protected.
- Issuance flow (UI → PTB → token).
- Walrus attestation demo.
- Leaderboard with 2-3 KOL test notes.
- Backtest replay over historical SVI.
