# move-notes.md

## 2026-06-16 — Architecture design (sui-architect)

**目的**：把 BUSINESS_SPEC/IDEA_REPORT 落地成 Move 架構。產出 spec：
`docs/specs/2026-06-16-structured-note-factory-spec.md` (+ architecture/*.mmd, security/threat-model.md)

### 定案決策
- D1 MVP 3 templates: range accrual / capped upside / principal protected
- D2 Note 物件 = Hybrid `NoteBase<phantom S>` + per-strategy witness
- D3 Custody = 每 Note 一個專屬 PredictManager；`redeem_permissionless` 結算 + owner-gated `claim` 提款
- D4 Leaderboard = 鏈上 append-only registry(事實) + 鏈下 indexer 排名

### 鏈上實證（testnet，2026-06-16，sui_getNormalizedMoveModulesByPackage）
- Predict package: `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`
- Predict shared obj: `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`
- dUSDC: `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC`
- predict-server config endpoint: `https://predict-server.testnet.mystenlabs.com/config` (回 predict_id + quote_assets)

### 鏈上限制（推翻原始假設）
- **沒有 Position 物件**：部位是 `PredictManager.positions/range_positions` table，key=MarketKey/RangeKey
- `mint/mint_range/redeem/redeem_permissionless/redeem_range` 全部回傳 `()`，mutate `&mut PredictManager`
- `PredictManager` abilities = **key only（無 store）** → 不能包進自訂 struct，只能 by-ID 引用
- `MarketKey`/`RangeKey` = copy+store → 可裝 vector（leg 用 key 描述）
- `OracleSVI` = 每 (underlying, expiry) 一個 shared object
- `plp::PLP` 只有 drop = witness，不是 LP token；supply/withdraw 進出 Coin<T>
- `supply/withdraw` 簽章: `(&mut Predict, Coin<T>, &Clock, ctx) -> Coin`

### 待確認（需 bytecode disassembly，normalized ABI 看不到 body assert）
1. `predict_manager::withdraw` 授權：sender==owner 還是吃 cap？→ 決定 claim 接線
2. `predict_manager::new` / `predict::create_manager` 是 share 還是 transfer 給 sender？→ 決定 manager 歸屬 + Kiosk resale
3. `mint/redeem` 是否 assert manager.owner==sender

### 已知風險
- Kiosk 二級市場：manager.owner 建立時固定 ≠ 轉手後持有者 → claim 授權斷裂。MVP 先做 non-transferable note。
- shared `&mut Predict` + `&OracleSVI` 多筆 mint 競爭 → MVP 用 notional/leg cap 緩解。

### sui-architect review 修正（2026-06-16，已套進 spec/threat-model）
- D3 custody 從 Locked 降為 **PROPOSED pending disasm**（與 redeem_permissionless 的 owner check 可能矛盾）
- NoteBase 改 **key-only 無 store = soulbound**（Move 拿不到 owned obj current holder，claim 只能信 sender → 必須不可轉讓才安全）
- claim 加 **all-legs-settled invariant**（partial settle 會 strand 資金；claim 內原子 settle 全 leg 再 withdraw）→ T9
- Params 加 `version: u8`（dynamic field 不保護 value struct 演進；既有 Params 凍結，演進靠新 key）
- PP yield invariant 重定義：mint 時用 conservative floor yield 算 premium budget；對外只能宣稱**有條件**本金保護
- 新增 §5.4 **Defaulted state 清算規則**：best-effort 回 manager balance，no perf fee
- §13 + T7 加 **多 expiry OracleSVI shared-object lock cap（≤3/note）**

### 反編譯結果（2026-06-16，sui move disassemble v1.73.1）→ D3 已鎖定成立
- `predict_manager::new` = `transfer::share_object` → manager 是 **shared**；`public(friend)`，外部走 `predict::create_manager`；owner=建立時 sender
- `predict_manager::withdraw` = `assert sender==self.owner`（owner-gated；WithdrawCap 內建非外傳）
- `mint`/`mint_range` = owner-gated（sender==owner，abort 1）
- `redeem_permissionless` = **無 owner 檢查**，唯一 gate `oracle::is_settled`（abort 9）；owner/sender 只進事件 → 真的任何人可 settle，無 MEV
- **custody 接線定案**：mint PTB 必須 sender=holder（create_manager 設 owner=holder，過 mint owner gate）→ note soulbound 給 holder；settle 任何人推、claim 由 holder（sender==owner）withdraw

## 2026-06-17 — Predict interface-stub package（TODO #1 完成）

建 `move/predict_interface/`（package name `Predict`），Move.toml `published-at` + `[addresses] predict = 0xf5ea2b…785138`，連鏈不部署。
主 package `move/Move.toml` 加 `Predict = { local = "predict_interface" }`（path 相對 Move.toml 目錄）。
模組：`predict / predict_manager / market_key / range_key / oracle`，struct 空殼/`id:UID` 佔位，所有 body `abort 0`。
`sui move build` 通過（主 + stub）。

### 重撈精確 ABI 的修正（vs 先前 spec 摘要，sui_getNormalizedMoveModulesByPackage 2026-06-17）
- **`predict_manager::{deposit,withdraw,balance}` 全是 generic `<T>`**（先前摘要寫成非泛型）→ note_factory 呼叫必帶 `<DUSDC>` type arg。`position/range_position/owner` 非泛型。
- **`redeem_permissionless<T>` 只吃 `MarketKey`**。range 部位只能用 `redeem_range<T>`（RangeKey）。`mint/mint_range/redeem` 全部 generic `<T>`（T = quote asset，body 用、簽章不出現）。
- market_key: `new(ID,expiry,strike,is_up:bool)` / `up,down(ID,u64,u64)` + getters。range_key: `new(ID,expiry,lower,higher)` + getters。
- oracle 讀面：`is_settled / id / status(&O,&Clock):u8 / status_settled():u8 / settlement_price():Option<u64> / forward_price / spot_price / expiry`。

### 未驗證點（不擋本任務）
- **`redeem_range` 授權未反組譯**：range accrual 的「任何人可結算」假設僅對 market_key 的 `redeem_permissionless` 證實過。range 用 `redeem_range`，若 owner-gated → 結算只能 holder 自己推（影響 §7 settle-by-anyone 設計）。實作 settle 前要 disasm 確認。
- **stub linker 簽章比對只在 `sui client publish` 才發生**（build 只 type-check）。首次部署前須留意 publish 期 linking error。

### 下一步
1. 查 testnet (BTC, expiry) 的 OracleSVI object IDs（wizard 枚舉 strike 用）
2. 實作 `note` module（`NoteBase<phantom S>` key-only soulbound）→ 再 `strategy_range_accrual` + `note_factory::mint_range_accrual`
3. 實作 settle 前先 disasm `redeem_range` 授權
4. 驗證點：freshly-shared manager 能否同一 PTB `create_manager→deposit→mint`

> 提醒：下一個 Move 任務建議開新 chat。

## 2026-06-17 — `note` module 實作（audit core 資料結構）

`move/sources/note.move` 從骨架填實。**範圍刻意限縮為資料核心**，不含 claim 編排（碰 predict/strategy/fee_vault 的多檔任務，留給 note_factory）。

### 設計定案
- `NoteBase<phantom S> has key`（**無 store = soulbound**）；欄位照 spec §4。`legs: vector<MarketKey>` / `range_legs: vector<RangeKey>`（key copy+store 可裝 vector）。
- **strategy params 用 dynamic_field**：df key 不能用 witness（witness 只有 `drop`，df key 需 `copy+drop+store`）→ 用固定 singleton `public struct ParamsKey() has copy,drop,store`。型別安全靠 `NoteBase<S>`（一 note 一 params blob），寫入授權靠 `add_params<S,P>(note, _w: S, params)` 的 `_w: S`（只有定義 S 的 strategy module 造得出 witness）。
- 生命週期：`set_status` 只允許 `Active(0)→Settled(1)/Defaulted(2)`（terminal 不可逆，`EInvalidStatusTransition`）。
- 銷毀：`remove_params<S,P>` 必須先呼叫（`exists_with_type` assert 防漏），再 `destroy` 刪 UID，回傳 `owner_at_mint`（= holder，soulbound invariant）給 factory route payout。
- mutators 全 `public(package)`；getters 全 `public`。error code 1xx，用 `#[error]` 註解。
- `sui move build` 通過（主 + Predict stub）。

### 待後續任務接線（非本任務漏項，是刻意切分）
- `claim<S>` 全 leg settle + withdraw + perf fee + emit → `note_factory`
- 事件 struct（NoteMinted/NoteSettled…）→ `events` module
- `RangeParams`/`CappedParams`/`PPParams` witness struct → 各 `strategy_*`
