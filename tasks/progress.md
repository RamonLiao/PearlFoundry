# Progress — Structured Note Factory

## Current Task
`note` module 完成（audit core 資料結構）。下一步：`strategy_range_accrual` + `note_factory::mint_range_accrual` 打通 issue→settle（建議開新 chat）。

## TODO
- [ ] 查 testnet (BTC, 各 expiry) 的 `OracleSVI` object IDs（wizard 枚舉 strike 用）
- [x] `sui-dev-agents:init` scaffold — `move/` package，8 modules 骨架，`sui move build` 通過
- [x] 建 Predict **interface stub package**（`move/predict_interface/`，published-at 連鏈，body `abort 0`）→ 主+stub build 通過。**ABI 修正**：predict_manager deposit/withdraw/balance 是 generic `<T>`；redeem_permissionless 只吃 MarketKey，range 用 redeem_range。**未驗**：redeem_range 授權 + publish 期 linking。
- [x] 實作 `note` module（`NoteBase<phantom S>` key-only soulbound）→ build 通過。資料核心 only：`new`/getters/witness-gated params df（`ParamsKey` singleton + `_w:S` 證明）/`set_status`(Active→Settled/Defaulted)/`remove_params`+`destroy`。claim 編排與 event 刻意留給 factory。
- [ ] 實作 `strategy_range_accrual` + `note_factory::mint_range_accrual`，打通 issue→settle 全流程
- [ ] 驗證點：freshly-shared manager 能否在同一 PTB 內 `create_manager→deposit→mint`
- [ ] 後續：strategy_capped_upside、strategy_principal_protected、leaderboard、fee_vault
- [ ] off-chain：Walrus 上傳、pricing-engine、indexer、settlement-keeper

## Recently Completed (2026-06-16)
- **Scaffold**：`sui move new structured_note_factory --path move`。Move.toml edition 2024 + addresses + Predict dep TODO 註解（sui 1.73 framework 為隱式系統依賴，免寫 git rev）。建 8 module 骨架（events/note/strategy_range_accrual/strategy_capped_upside/strategy_principal_protected/note_factory/leaderboard/fee_vault），`sui move build` 通過。
- 讀 BUSINESS_SPEC + IDEA_REPORT，鎖定 4 個架構決策（D1 3 templates / D2 Hybrid witness / D3 custody / D4 leaderboard）
- 驗證 DeepBook Predict **真實 testnet ABI**（sui_getNormalizedMoveModulesByPackage）→ 推翻「vector<Position>」假設
- 產出完整 spec：`docs/specs/2026-06-16-structured-note-factory-spec.md` + `docs/architecture/*.mmd` + `docs/security/threat-model.md`
- sui-architect review → 6 個發現全修（soulbound、all-legs-settled invariant、Params versioning、PP yield、Defaulted state、OracleSVI cap）
- 反編譯 `predict_manager::{new,withdraw}` + `predict::redeem_permissionless` → **D3 LOCKED 成立**

## Blockers
- 無硬 blocker。兩個待查項（OracleSVI IDs、同-PTB shared manager）屬實作期驗證，不擋設計。

## Notes
- **關鍵鏈上事實**：Predict 無 Position 物件；部位記在 shared `PredictManager`（key-only，無 store），key=MarketKey/RangeKey。
- **Custody 接線**：mint PTB sender=holder → create_manager 設 owner=holder；mint/withdraw owner-gated，redeem_permissionless 無 owner 檢查。note 必須 soulbound（Move 拿不到 owned obj current holder）。
- **Addresses (testnet)**：Predict pkg `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`；Predict shared obj `0xc8736...028a`；dUSDC `0xe95040...3e1a::dusdc::DUSDC`。
- 細節全在 `move-notes.md` + spec。下一個 Move 任務開新 chat（conventions：一 chat 一任務）。
