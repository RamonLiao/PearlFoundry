# Progress — Structured Note Factory

## Current Task
Range Accrual issue→settle 的 **brainstorming + plan 完成**（spec + 實作計畫已寫）。下一步：依計畫實作 Task 1–7（建議開新 chat），Task 8 整合測試前需先查 OracleSVI IDs。

## TODO
- [ ] **實作 plan Task 1–7**：events / fee_vault / leaderboard / note::soulbound_transfer / strategy_range_accrual / note_factory(mint+claim builder)。見 `docs/superpowers/plans/2026-06-18-range-accrual-issue-settle.md`
- [ ] 查 testnet (BTC, 各 expiry) 的 `OracleSVI` object IDs（mint add_expiry + 整合測試用）→ 擋 Task 8
- [ ] **Task 8 整合測試**：testnet PTB round-trip（mint 2-PTB → claim）+ Monkey testing
- [x] 設計決策：leg=N adjacent up-strike ladder、等權 sizing、claim 內 atomic settle+withdraw、最小 fee_vault+leaderboard、mint 2-PTB builder、roll/Defaulted 列 roadmap
- [x] sui-architect review（C1 soulbound_transfer / C2 public-fun-非-entry / A1 leaderboard event-only / A2 Display V2 roadmap）
- [ ] 後續：strategy_capped_upside、strategy_principal_protected、roll（shared-note 設計）、Defaulted 清算
- [ ] off-chain：Walrus 上傳、pricing-engine、indexer、settlement-keeper

## Recently Completed (2026-06-18)
- **驗證 single-PTB mint 結構性不可能**（撈 testnet ABI）：`predict::create_manager` 與 `predict_manager::new` 都只回 `ID`、內部 share manager；PTB 無「ID→&mut shared」command，shared input 須簽章時指定 → **解掉舊 TODO「同-PTB shared manager」，答案=不行，mint 拆 2-PTB**。0 gas。
- **驗證 keeper auto-roll 不可能**：mint owner-gated + note soulbound owned → keeper 兩者都碰不到。roll 改列 roadmap。
- 確認 `predict::mint`/`redeem_permissionless` 每次吃單一 `&OracleSVI` → 多 expiry 必須 hot-potato builder（Move entry 不能吃 `vector<&ref>`）。
- 產出 design：`docs/specs/2026-06-18-range-accrual-issue-settle-design.md`（修正舊 spec §5.1 single-PTB、§3 claim 歸屬）
- 產出 plan：`docs/superpowers/plans/2026-06-18-range-accrual-issue-settle.md`（8 tasks，純函式 TDD + testnet 整合）
- `git init` + `.gitignore`（排除 .claude/、CLAUDE.md、memory/、move/build/），初始 commit `a9c07e4`

## Blockers
- **OracleSVI object IDs 未查** → 擋 Task 8 整合測試（不擋 Task 1–7 實作）。
- 無設計 blocker（single-PTB / roll 兩個不確定性已驗證並定案）。

## Notes
- **架構定案**：mint = 2 PTB。PTB1 raw `predict::create_manager`（owner=holder）；PTB2 = `mint_begin → mint_add_expiry×N → mint_finalize`（no-ability hot-potato `MintTicket`）。claim = `claim_begin → claim_settle_expiry×N → claim_finalize`（`ClaimTicket`，atomic settle+withdraw，post-check position==0）。全為 `public fun` 非 `entry`（C2）。
- **C1**：`NoteBase` key-only，跨 module 轉移只能經新增的 `note::soulbound_transfer`（factory 不能直接 `transfer::transfer`/`public_transfer`）。
- **A1**：leaderboard 無 on-chain vector/shared 物件，`register` 純 emit event；ranking 走 off-chain indexer。
- **payoff/sizing**：等權 ladder，`legs_per_expiry=(upper-lower)/step+1`，`qty_per_leg=net/(lpe·expiry_count)`。perf fee=10%，hurdle 預設 10000bps（net principal）。fee kind：0 issuance / 1 perf。
- **關鍵鏈上事實**：Predict 無 Position 物件；部位記在 shared `PredictManager`（key-only 無 store），key=MarketKey/RangeKey。
- **Addresses (testnet)**：Predict pkg `0xf5ea…5138`；shared obj `0xc8736…028a`；dUSDC `0xe95040…3e1a::dusdc::DUSDC`。
- 細節全在 design doc + plan + `move-notes.md`。下一個 Move 任務（實作）開新 chat（conventions：一 chat 一任務）。
