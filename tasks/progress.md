# Progress — Structured Note Factory

## Current Task
**Task 8 testnet 整合測試 ✅ 完成**：mint(2-PTB)→settle→claim 全 happy-path 真實上鏈（mint digest 13ikpdQK…、claim digest EveDmojuk…），5 項 Monkey abort 全過，FeeVault 對帳 132758 精確。下一步：結算模式決策（自助 vs keeper）或 roadmap 項目。詳見 move-notes.md 2026-06-19。

## TODO
- [x] **實作 plan Task 1–7**：events / fee_vault / leaderboard / note::soulbound_transfer / strategy_range_accrual / note_factory(mint+claim builder)。
- [x] **Move review chain**（move-code-quality → sui-security-guard → sui-red-team）整合 + 修正（見下方 Review Fixes）。
- [x] 查 testnet (BTC, 各 expiry) 的 `OracleSVI` object IDs → **解法=動態枚舉**（`suix_queryEvents` `registry::OracleCreated`）；ID ephemeral（15min 滾動）禁 hardcode。Task 8 blocker 解除。詳見 move-notes.md 2026-06-19。
- [x] **Task 8 整合測試 ✅ 完成**：
  - [x] 部署 package（digest AnPSTTKL…）；踩雷 `PublishUpgradeMissingDependency` → 補 DEEP+DeepBook linkage stub。
  - [x] PTB1 create_manager + mint 2-PTB **真實上鏈**（digest 13ikpdQK…，note 0x9d56…d929 soulbound）。
  - [x] 5 項 Monkey dry-run abort 全過（claim-before-expiry / dust / expiry-mismatch / >128 legs / 遠OTM）。
  - [x] claim happy-path **真實上鏈**（digest EveDmojuk…）：獲利結算 payout 10894829、perf fee 102758、note deleted、position 歸零。
  - [x] FeeVault 對帳 = 132758（30000 issuance + 102758 perf）精確。
  - 🔑 發現：`predict::mint` 有 ask-price band（strike 必須貼 forward，遠 OTM abort）。strategy 範圍須綁 forward 動態算（pricing-engine 職責）。
- [ ] **決策待定：結算模式**（自助 claim vs 項目方 keeper 代付）→ 決定後用 `set_min_notional` 設值；keeper 模式需 Task 8 量到單張 round-trip gas 再校準 MIN_NOTIONAL（~50–100 dUSDC）。合約兩種模式皆已支援（min_notional 可調）。
- [x] 設計決策：leg=N adjacent up-strike ladder、等權 sizing、claim 內 atomic settle+withdraw、最小 fee_vault+leaderboard、mint 2-PTB builder、roll/Defaulted 列 roadmap
- [x] sui-architect review（C1 soulbound_transfer / C2 public-fun-非-entry / A1 leaderboard event-only / A2 Display V2 roadmap）
- [ ] 後續：strategy_capped_upside、strategy_principal_protected、roll（shared-note 設計）、Defaulted 清算
- [ ] off-chain：Walrus 上傳、pricing-engine、indexer、settlement-keeper

## Recently Completed (2026-06-19)
- **實作 Task 1–7**：6 個 module 全部從 scaffold 寫到完整。純函式 TDD（fee_vault / strategy sizing / factory fee）+ Predict-touching 路徑 build-check only。
- **三輪平行 review 整合修正**（red-team 另留 `tests/red-team/red_team_money_flow.move` 9 攻擊測試）：
  - **F1** `mint_begin` 加 `assert expiry_total > 0`（擋不受控 div-by-zero）。
  - **F2** `legs_per_expiry` 加 `MAX_LEGS=128` 上限 + `ETooManyLegs` domain error（擋 DoS/PTB gas 爆 + 不受控 cast abort）。red-team round_8/8d 翻成預期 abort；補邊界測試 128 接受/129 拒絕。
  - **F3** `FactoryConfig.min_notional`（可調欄位，預設 1_000_000=1 dUSDC）+ `set_min_notional` cap-gated setter；`mint_begin` assert `notional >= min_notional`（擋 0-fee dust 鑄造 + leaderboard spam）。
  - **F4** `mint_begin` assert `hurdle_bps >= 10000`（鎖死「績效費只收回本以上獲利」）。
  - **F5** vector free-fn → Move 2024 method syntax（~8 處）。
  - 補 `set_paused` setter（原 `paused` 欄位被檢查卻無處可設＝dead switch）。
  - 順手清掉 fee_vault deprecation warning（`with_defining_ids` / `exists_with_type`）、drop `mint_finalize` 未使用 `<T>`。
- **與計畫偏離**：`mint_finalize` 移除 `<T>`（整合測試 PTB 呼叫不帶 typeArg）。
- **未改（review 確認為設計/可接受）**：access-control（soulbound by-value）、manager/oracle/note binding、partial-settle 原子性、perf-fee ≤9 unit 進位 dust、claim 提走整個 manager balance（依「一 note 一 manager」不變式，無法鏈上 assert，列已知前提）。

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
