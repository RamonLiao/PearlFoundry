# Progress — Structured Note Factory

## Current Task
**pricing-engine 設計+計畫 ✅ 完成（2026-06-20，待實作）**：解 mint ask-price band → 自動產合法 strike ladder。決策：dry-run 探測（非 SVI 複刻）+ CLI 函式模組（`scripts/pricing/`）+ oracle 讀 forward / event sanity + 最大化合法寬度。spec `docs/superpowers/specs/2026-06-20-pricing-engine-design.md`、plan `docs/superpowers/plans/2026-06-20-pricing-engine.md`（5 tasks TDD）。sui-architect review 整合 A1–A4。**下一步：選執行方式（subagent-driven / inline）開始實作 Task 1–5。**

（前一任務）**Task 8 testnet 整合 ✅ 完成**：mint(2-PTB)→settle→claim happy-path 真實上鏈，5 Monkey abort 全過，FeeVault 對帳 132758。結算模式定案=兩者並存；MIN_NOTIONAL hackathon 1 / mainnet 5。

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
- [x] **結算模式決策 ✅ 定案（2026-06-19）**：**兩者並存**。實測 gas（mint +0.179 SUI / claim **−0.0072 SUI gas-negative 倒賺 rebate**）+ 修正框架：keeper「代執行 claim」**結構性不可能**（claim 吃 by-value owned soulbound note，Sui owned-object 只能 owner 簽 → 第三方碰不到）。合法兩路徑（holder 永遠 signer）：**A 自助 claim**（holder 付 gas）／**B sponsored tx**（holder 簽 + 項目方 gas station 代付 gas，免持 SUI）。合約零改動。mainnet 實踐 = indexer 監看結算 + gas station 服務 + 前端兩顆按鈕。詳見 move-notes.md 2026-06-19。
- [x] **MIN_NOTIONAL 決策**：與結算模式脫鉤，純擋 dust/spam。原 50–100 dUSDC 為臆測已推翻。**hackathon 維持 1 dUSDC**（現行 default，零治理動作）；**mainnet 前 `set_min_notional(5_000_000)` 拉 5 dUSDC**。
- [x] 設計決策：leg=N adjacent up-strike ladder、等權 sizing、claim 內 atomic settle+withdraw、最小 fee_vault+leaderboard、mint 2-PTB builder、roll/Defaulted 列 roadmap
- [x] sui-architect review（C1 soulbound_transfer / C2 public-fun-非-entry / A1 leaderboard event-only / A2 Display V2 roadmap）
- [ ] 後續：strategy_capped_upside、strategy_principal_protected、roll（shared-note 設計）、Defaulted 清算
- [~] off-chain：**pricing-engine 設計+plan ✅（2026-06-20，待實作 Task 1–5）**；Walrus 上傳、indexer、settlement-keeper 仍待設計

## Recently Completed (2026-06-19) — Task 8 testnet 整合
- **mint(2-PTB)→settle→claim 全 happy-path 真實上鏈**（mint `13ikpdQK…`、claim `EveDmojuk…`）。獲利結算 payout 10894829、perf fee 102758、note deleted、position 歸零。
- **FeeVault 對帳精確** = 132758（30000 issuance + 102758 perf）。
- **5 項 Monkey dry-run abort 全過**：claim-before-expiry / dust notional / expiry-count-mismatch / >128 legs / 遠 OTM strike。
- **部署** package `0xa699…b21a`（含 shared FactoryConfig/FeeVault、owned Admin caps + UpgradeCap）。commit `9fac24d`。
- **踩雷1 `PublishUpgradeMissingDependency`**：補 DEEP(`0x36dbef`)+DeepBook V3(`0x74cd56`) linkage-only stub（`move/deep_interface`、`move/deepbook_interface`），predict_interface 依賴之。
- **踩雷2 `predict::mint` ask-price band**：strike 必須貼 forward，遠 OTM abort（`assert_mintable_ask` code 7 / `pricing_config` code 1）。→ strategy 範圍須綁 live forward 動態算。
- **整合腳本** `scripts/integration/{config,mint,claim,poll_settle}.js`（@mysten/sui v1.36，oracle/mgr/note 走 env）。簽署用 keytool sign + execute-signed-tx（私鑰不離 keystore；export 被 classifier 擋＝正確）。

## Recently Completed (2026-06-20) — pricing-engine 設計+計畫
- **brainstorming 4 決策**：(1) band 判定走 **dry-run 探測**（非 SVI 複刻，符合 lessons「runtime gate 要實證」）；(2) 交付 = **CLI 函式模組** `scripts/pricing/`，mint.js import；(3) forward 來源 = **oracle 為主**（讀 `prices.forward`）+ PositionMinted event 為 sanity；(4) 目標 = **最大化合法寬度**。
- **驗證 OracleSVI schema（live testnet）**：`prices.{forward,spot}`、`svi.{a,b,m…}`、`settlement_price`(null=未結算)、`expiry`、`timestamp`；`tick_size`/`min_strike` 在 `registry::OracleCreated` event 不在 object content。
- **sui-architect review 整合 A1–A4 進 spec**：A1 probe **非無狀態**（mint_begin 先扣 notional/splitCoins 早於 band check → probe 需 funded coin+MGR+固定 notional）；A2 **ladder staleness TTL**（forward 15min 滾動，compute-then-mint-immediately，mint.js re-fetch guard）；A3 JSON-RPC deprecated 技術債註記（dryRun ≠ Quorum Driver，hackathon OK）；A4 event sanity 僅數量級、權威邊界以 dry-run 為準。
- **產出**：spec `docs/superpowers/specs/2026-06-20-pricing-engine-design.md`、plan `docs/superpowers/plans/2026-06-20-pricing-engine.md`（5 tasks：ladder 純函式→oracle→probe→price CLI+mint guard→monkey）。
- **校準風險（plan 已標）**：`parseAbortCode` regex 要對真實 SDK error string 驗一次再依賴（Task 3 Step 4）。

## Recently Completed (2026-06-19) — Task 1–7
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
- **無 blocker**。Task 1–8 全完成；OracleSVI 動態枚舉已落地、round-trip 全驗證。
- 待決策（非 blocker）：結算模式（自助 claim vs keeper 代付）。

## Notes
- **架構定案**：mint = 2 PTB。PTB1 raw `predict::create_manager`（owner=holder）；PTB2 = `mint_begin → mint_add_expiry×N → mint_finalize`（no-ability hot-potato `MintTicket`）。claim = `claim_begin → claim_settle_expiry×N → claim_finalize`（`ClaimTicket`，atomic settle+withdraw，post-check position==0）。全為 `public fun` 非 `entry`（C2）。
- **C1**：`NoteBase` key-only，跨 module 轉移只能經新增的 `note::soulbound_transfer`（factory 不能直接 `transfer::transfer`/`public_transfer`）。
- **A1**：leaderboard 無 on-chain vector/shared 物件，`register` 純 emit event；ranking 走 off-chain indexer。
- **payoff/sizing**：等權 ladder，`legs_per_expiry=(upper-lower)/step+1`，`qty_per_leg=net/(lpe·expiry_count)`。perf fee=10%，hurdle 預設 10000bps（net principal）。fee kind：0 issuance / 1 perf。
- **關鍵鏈上事實**：Predict 無 Position 物件；部位記在 shared `PredictManager`（key-only 無 store），key=MarketKey/RangeKey。
- **Addresses (testnet)**：Predict pkg `0xf5ea…5138`；shared obj `0xc8736…028a`；dUSDC `0xe95040…3e1a::dusdc::DUSDC`。
- 細節全在 design doc + plan + `move-notes.md`。下一個 Move 任務（實作）開新 chat（conventions：一 chat 一任務）。
