# Range Accrual issue→settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 Range Accrual 模板的發行→結算全流程（mint 2-PTB builder + claim atomic settle builder），含最小化的 fee_vault / leaderboard / events。

**Architecture:** mint 因 Predict API（`create_manager` 只回 ID、內部 share）被迫拆 2 PTB；PTB2 與 claim 都用 no-ability hot-potato builder 解「Move entry 不能吃 `vector<&OracleSVI>`」。所有 builder fn 為 `public fun`（非 entry，Protocol 124 規則）。note 維持 data-core，僅新增 `soulbound_transfer` 破口。

**Tech Stack:** Sui Move 2024 (sui 1.73.1)、Predict interface stub（published-at link）、`sui move test` / `sui move build`。

## Global Constraints

- Move edition `2024`；`sui move build` / `sui move test` 必過才 commit。
- Predict 為 abort-body stub → **mint/claim 等 Predict-touching 路徑無法 Move unit test**，只能 build-check + testnet PTB 整合測試。TDD 僅嚴格套用在純函式（fee/sizing/strike/ticket invariant）。
- 所有 `mint_*` / `claim_*` builder fn 宣告 `public fun`，**禁用 `entry`**（hot-potato 參數）。
- `NoteBase` key-only soulbound：跨 module 轉移只能經 `note::soulbound_transfer`，禁 `public_transfer`。
- Predict (testnet)：pkg `0xf5ea…5138`、shared obj `0xc873…028a`、dUSDC `0xe950…3e1a::dusdc::DUSDC`。
- 錯誤碼範圍：note 1xx · strategy 2xx · factory 5xx · leaderboard 6xx · fee_vault 7xx。
- fee kind：`0`=issuance、`1`=perf。perf fee = 10%；hurdle 預設 10000 bps（100% 本金）。
- 每完成一個 module 後跑 `sui move build`；含測試的 task 跑 `sui move test`。
- commit 訊息用 `feat:` / `test:` 前綴；repo 目前非 git，第一個 commit 前先 `git init`（若使用者要 git 版控；否則跳過所有 commit step）。

---

### Task 1: events module

**Files:**
- Modify: `move/sources/events.move`

**Interfaces:**
- Produces: `events::emit_note_minted(note_id: ID, strategy: vector<u8>, issuer: address, manager_id: ID, notional: u64, expiry_ts_ms: u64, walrus_blob_id: vector<u8>, is_public: bool)`、`events::emit_note_settled(note_id: ID, payout: u64, perf_fee: u64, settled_by: address)`、`events::emit_public_note_registered(note_id: ID, issuer: address, template: vector<u8>)`、`events::emit_fee_collected(note_id: ID, kind: u8, amount: u64)`

- [ ] **Step 1: 實作 events module（純 struct + emit wrapper，無單元測試）**

```move
/// Unified event structs — single source of truth for the off-chain indexer.
/// See spec §3 (events module: single indexer source).
module structured_note_factory::events;

use sui::event;

public struct NoteMinted has copy, drop {
    note_id: ID,
    strategy: vector<u8>,
    issuer: address,
    manager_id: ID,
    notional: u64,
    expiry_ts_ms: u64,
    walrus_blob_id: vector<u8>,
    is_public: bool,
}

public struct NoteSettled has copy, drop {
    note_id: ID,
    payout: u64,
    perf_fee: u64,
    settled_by: address,
}

public struct PublicNoteRegistered has copy, drop {
    note_id: ID,
    issuer: address,
    template: vector<u8>,
}

public struct FeeCollected has copy, drop {
    note_id: ID,
    kind: u8,        // 0 issuance · 1 perf
    amount: u64,
}

public(package) fun emit_note_minted(
    note_id: ID, strategy: vector<u8>, issuer: address, manager_id: ID,
    notional: u64, expiry_ts_ms: u64, walrus_blob_id: vector<u8>, is_public: bool,
) {
    event::emit(NoteMinted { note_id, strategy, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public });
}

public(package) fun emit_note_settled(note_id: ID, payout: u64, perf_fee: u64, settled_by: address) {
    event::emit(NoteSettled { note_id, payout, perf_fee, settled_by });
}

public(package) fun emit_public_note_registered(note_id: ID, issuer: address, template: vector<u8>) {
    event::emit(PublicNoteRegistered { note_id, issuer, template });
}

public(package) fun emit_fee_collected(note_id: ID, kind: u8, amount: u64) {
    event::emit(FeeCollected { note_id, kind, amount });
}
```

- [ ] **Step 2: build**

Run: `cd move && sui move build`
Expected: 編譯通過（events module 無 unused 警告以外的錯誤）

- [ ] **Step 3: Commit**

```bash
git add move/sources/events.move
git commit -m "feat: events module — unified indexer event structs"
```

---

### Task 2: fee_vault module（含 TDD）

**Files:**
- Modify: `move/sources/fee_vault.move`
- Test: `move/tests/fee_vault_tests.move`

**Interfaces:**
- Consumes: 無
- Produces: `fee_vault::collect<T>(vault: &mut FeeVault, c: Coin<T>)`（存 balance，不 emit）、`fee_vault::withdraw<T>(vault: &mut FeeVault, _cap: &FeeAdminCap, amount: u64, ctx: &mut TxContext): Coin<T>`、struct `FeeVault has key`、`FeeAdminCap has key, store`、`#[test_only] init_for_testing`

- [ ] **Step 1: 寫失敗測試**

```move
#[test_only]
module structured_note_factory::fee_vault_tests;

use sui::test_scenario as ts;
use sui::coin;
use sui::sui::SUI;
use structured_note_factory::fee_vault::{Self, FeeVault, FeeAdminCap};

#[test]
fun collect_accumulates_and_withdraw_takes() {
    let admin = @0xA;
    let mut sc = ts::begin(admin);
    fee_vault::init_for_testing(sc.ctx());

    sc.next_tx(admin);
    let mut vault = sc.take_shared<FeeVault>();
    let cap = sc.take_from_sender<FeeAdminCap>();

    // 兩次 collect 同幣別 → 累加
    fee_vault::collect(&mut vault, coin::mint_for_testing<SUI>(1000, sc.ctx()));
    fee_vault::collect(&mut vault, coin::mint_for_testing<SUI>(500, sc.ctx()));

    let out = fee_vault::withdraw<SUI>(&mut vault, &cap, 1200, sc.ctx());
    assert!(coin::value(&out) == 1200, 0);
    coin::burn_for_testing(out);

    ts::return_shared(vault);
    sc.return_to_sender(cap);
    sc.end();
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd move && sui move test fee_vault`
Expected: FAIL（`collect`/`withdraw`/`init_for_testing` 未定義）

- [ ] **Step 3: 實作 fee_vault**

```move
/// Money-flow authority: 30bps issuance fee / 10% perf share; `FeeAdminCap`-gated.
/// Isolated so fee/authority changes don't touch the note audit core. See spec §3.
/// Multi-currency: per-type `Balance<T>` stored as dynamic field (keyed by TypeName).
module structured_note_factory::fee_vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_field as df;
use std::type_name::{Self, TypeName};

public struct FeeVault has key { id: UID }
public struct FeeAdminCap has key, store { id: UID }

/// dynamic-field key: one Balance<T> per quote-asset type.
public struct BalKey has copy, drop, store { t: TypeName }

fun init(ctx: &mut TxContext) {
    transfer::share_object(FeeVault { id: object::new(ctx) });
    transfer::transfer(FeeAdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Deposit a fee coin into the per-type balance. Event emission is the caller's
/// job (note_id is only known after the note is built — see note_factory).
public(package) fun collect<T>(vault: &mut FeeVault, c: Coin<T>) {
    let k = BalKey { t: type_name::get<T>() };
    if (df::exists_(&vault.id, k)) {
        let b: &mut Balance<T> = df::borrow_mut(&mut vault.id, k);
        balance::join(b, coin::into_balance(c));
    } else {
        df::add(&mut vault.id, k, coin::into_balance(c));
    };
}

/// Cap-gated withdrawal. Possession of `FeeAdminCap` is the authority.
public fun withdraw<T>(vault: &mut FeeVault, _cap: &FeeAdminCap, amount: u64, ctx: &mut TxContext): Coin<T> {
    let k = BalKey { t: type_name::get<T>() };
    let b: &mut Balance<T> = df::borrow_mut(&mut vault.id, k);
    coin::take(b, amount, ctx)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd move && sui move test fee_vault`
Expected: PASS（1 test）

- [ ] **Step 5: Commit**

```bash
git add move/sources/fee_vault.move move/tests/fee_vault_tests.move
git commit -m "feat: fee_vault — per-type Balance<T> collect/withdraw, cap-gated"
```

---

### Task 3: leaderboard module（event-only，A1）

**Files:**
- Modify: `move/sources/leaderboard.move`

**Interfaces:**
- Consumes: `events::emit_public_note_registered`
- Produces: `leaderboard::register(note_id: ID, issuer: address, template: vector<u8>)`

- [ ] **Step 1: 實作 leaderboard（純 emit，無 on-chain vector，A1）**

```move
/// Public-note registry — A1: NO on-chain vector / shared object (avoids consensus
/// hotspot + unbounded growth). `register` only emits an event; ranking lives in the
/// off-chain indexer (spec §8). See spec §3 (leaderboard) and D4.
module structured_note_factory::leaderboard;

use structured_note_factory::events;

public(package) fun register(note_id: ID, issuer: address, template: vector<u8>) {
    events::emit_public_note_registered(note_id, issuer, template);
}
```

- [ ] **Step 2: build**

Run: `cd move && sui move build`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add move/sources/leaderboard.move
git commit -m "feat: leaderboard — event-only register (off-chain ranking)"
```

---

### Task 4: note::soulbound_transfer（C1 破口）

**Files:**
- Modify: `move/sources/note.move`（在 Lifecycle 區段附近新增）

**Interfaces:**
- Produces: `note::soulbound_transfer<S>(note: NoteBase<S>, to: address)`

- [ ] **Step 1: 新增 soulbound_transfer**

在 `note.move` 的 `destroy` 函式之後加入：

```move
/// Soulbound transfer helper. `NoteBase` is key-only, so `transfer::transfer<T: key>`
/// can ONLY be called by this defining module — `note_factory` cannot transfer the note
/// itself (C1). This is the single sanctioned move-out of a note; there is deliberately
/// no `store`-based `public_transfer` path (keeps the soulbound invariant, review F3/T6).
public(package) fun soulbound_transfer<S>(note: NoteBase<S>, to: address) {
    transfer::transfer(note, to);
}
```

- [ ] **Step 2: build**

Run: `cd move && sui move build`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add move/sources/note.move
git commit -m "feat: note::soulbound_transfer — sanctioned key-only move-out (C1)"
```

---

### Task 5: strategy_range_accrual module（含純函式 TDD）

**Files:**
- Modify: `move/sources/strategy_range_accrual.move`
- Test: `move/tests/strategy_range_accrual_tests.move`

**Interfaces:**
- Consumes: `predict::predict::{mint}`、`predict::oracle::{is_active,id,expiry}`、`predict::market_key::up`
- Produces:
  - struct `RangeAccrual has drop`、`RangeParams has store, copy, drop`、const `VERSION: u8 = 1`
  - `ra::witness(): RangeAccrual`
  - `ra::legs_per_expiry(lower: u64, upper: u64, step: u64): u16`（純，asserts EInvalidRange/EZeroStep）
  - `ra::qty_per_leg(net: u64, legs_per_expiry: u16, expiry_count: u8): u64`（純，asserts EZeroQtyPerLeg）
  - `ra::new_params(version, lower, upper, strike_step, expiry_count, legs_per_expiry, qty_per_leg, hurdle_bps): RangeParams`
  - `ra::params_hurdle_bps(p: &RangeParams): u16`
  - `ra::mint_expiry_legs<T>(predict: &mut Predict, mgr: &mut PredictManager, o: &OracleSVI, lower: u64, upper: u64, step: u64, qty_per_leg: u64, clk: &Clock, ctx: &mut TxContext): vector<MarketKey>`（Predict-touching，build-check only）
  - error consts: `EInvalidRange`、`EZeroStep`、`EZeroQtyPerLeg`、`EOracleNotActive`

- [ ] **Step 1: 寫失敗測試（純函式）**

```move
#[test_only]
module structured_note_factory::strategy_range_accrual_tests;

use structured_note_factory::strategy_range_accrual as ra;

#[test]
fun ladder_strike_count() {
    // strikes 100,102,104,106,108,110 → 6
    assert!(ra::legs_per_expiry(100, 110, 2) == 6, 0);
    // single strike when range == step
    assert!(ra::legs_per_expiry(100, 102, 2) == 2, 1);
}

#[test]
fun equal_weight_split() {
    // net=6000, 6 strikes, 1 expiry → 1000/leg
    assert!(ra::qty_per_leg(6000, 6, 1) == 1000, 0);
    // 2 expiries → 500/leg
    assert!(ra::qty_per_leg(6000, 6, 2) == 500, 1);
}

#[test]
#[expected_failure(abort_code = ra::EInvalidRange)]
fun rejects_inverted_range() { ra::legs_per_expiry(110, 100, 2); }

#[test]
#[expected_failure(abort_code = ra::EZeroStep)]
fun rejects_zero_step() { ra::legs_per_expiry(100, 110, 0); }

#[test]
#[expected_failure(abort_code = ra::EZeroQtyPerLeg)]
fun rejects_dust_notional() { ra::qty_per_leg(5, 6, 1); }
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd move && sui move test strategy_range_accrual`
Expected: FAIL（function/const 未定義）

- [ ] **Step 3: 實作 strategy_range_accrual**

```move
/// Range Accrual template: leg composition + payoff/sizing math.
/// Provides one-time witness `RangeAccrual` and versioned `RangeParams` (review F4).
/// MVP payoff (D1): equal-weight ladder of `up` binaries from lower..upper (step).
/// See spec §3, §4 and design doc 2026-06-18 §3.
module structured_note_factory::strategy_range_accrual;

use predict::predict::{Self, Predict};
use predict::predict_manager::PredictManager;
use predict::oracle::{Self, OracleSVI};
use predict::market_key::{Self, MarketKey};
use sui::clock::Clock;

const VERSION: u8 = 1;

// === Errors (2xx) ===
#[error]
const EInvalidRange: vector<u8> = b"range_accrual: lower must be < upper";
#[error]
const EZeroStep: vector<u8> = b"range_accrual: strike_step must be > 0";
#[error]
const EZeroQtyPerLeg: vector<u8> = b"range_accrual: notional too small for leg count";
#[error]
const EOracleNotActive: vector<u8> = b"range_accrual: oracle not active, cannot open legs";

/// One-time witness; gates param writes on NoteBase<RangeAccrual> (review F4).
public struct RangeAccrual has drop {}

/// Versioned params. Existing versions are FROZEN; evolution = new version, never
/// edit in place (dynamic_field protects the parent layout, not this value struct).
public struct RangeParams has store, copy, drop {
    version: u8,
    lower: u64,
    upper: u64,
    strike_step: u64,
    expiry_count: u8,
    legs_per_expiry: u16,
    qty_per_leg: u64,
    hurdle_bps: u16,
}

public fun witness(): RangeAccrual { RangeAccrual {} }

public fun version(): u8 { VERSION }

/// Number of ladder strikes per expiry = (upper-lower)/step + 1. Pure.
public fun legs_per_expiry(lower: u64, upper: u64, step: u64): u16 {
    assert!(lower < upper, EInvalidRange);
    assert!(step > 0, EZeroStep);
    ((((upper - lower) / step) + 1) as u16)
}

/// Equal-weight allocation (D2): net principal split across all legs. Pure.
public fun qty_per_leg(net: u64, legs_per_expiry: u16, expiry_count: u8): u64 {
    let total = (legs_per_expiry as u64) * (expiry_count as u64);
    let q = net / total;
    assert!(q > 0, EZeroQtyPerLeg);
    q
}

public fun new_params(
    version: u8, lower: u64, upper: u64, strike_step: u64,
    expiry_count: u8, legs_per_expiry: u16, qty_per_leg: u64, hurdle_bps: u16,
): RangeParams {
    RangeParams { version, lower, upper, strike_step, expiry_count, legs_per_expiry, qty_per_leg, hurdle_bps }
}

public fun params_hurdle_bps(p: &RangeParams): u16 { p.hurdle_bps }

/// Mint one expiry's full ladder of `up` binaries into the manager. Returns the keys
/// minted (recorded on the note). Predict-touching → integration-tested only.
public(package) fun mint_expiry_legs<T>(
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    lower: u64,
    upper: u64,
    step: u64,
    qty_per_leg: u64,
    clk: &Clock,
    ctx: &mut TxContext,
): vector<MarketKey> {
    assert!(oracle::is_active(o), EOracleNotActive);
    let oid = oracle::id(o);
    let exp = oracle::expiry(o);
    let mut legs = vector[];
    let mut s = lower;
    while (s <= upper) {
        let k = market_key::up(oid, exp, s);
        predict::mint<T>(predict, mgr, o, k, qty_per_leg, clk, ctx);
        vector::push_back(&mut legs, k);
        s = s + step;
    };
    legs
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd move && sui move test strategy_range_accrual`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add move/sources/strategy_range_accrual.move move/tests/strategy_range_accrual_tests.move
git commit -m "feat: strategy_range_accrual — witness, params, ladder sizing + compose"
```

---

### Task 6: note_factory — FactoryConfig + 純費用helper + mint builder

**Files:**
- Modify: `move/sources/note_factory.move`
- Test: `move/tests/note_factory_fee_tests.move`

**Interfaces:**
- Consumes: Task 1–5 全部 produces；`note::{new,add_params,note_id,soulbound_transfer}`；`predict_manager::deposit`；`predict::Predict`；`oracle::{id,expiry}`
- Produces:
  - struct `FactoryConfig has key`（`fee_bps: u16, hurdle_bps: u16, paused: bool`）、`FactoryAdminCap has key, store`
  - struct `MintTicket`（no abilities, hot potato）
  - `note_factory::compute_issuance_fee(notional: u64, fee_bps: u16): u64`（純）
  - `note_factory::compute_perf_fee(payout: u64, net_principal: u64, hurdle_bps: u16): u64`（純）
  - `mint_begin<T>(cfg: &FactoryConfig, vault: &mut FeeVault, mgr: &mut PredictManager, payment: Coin<T>, underlying: vector<u8>, lower: u64, upper: u64, strike_step: u64, expiry_total: u8, walrus_blob_id: vector<u8>, is_public: bool, ctx: &mut TxContext): MintTicket`
  - `mint_add_expiry<T>(t: &mut MintTicket, predict: &mut Predict, mgr: &mut PredictManager, o: &OracleSVI, clk: &Clock, ctx: &mut TxContext)`
  - `mint_finalize<T>(t: MintTicket, clk: &Clock, ctx: &mut TxContext)`
  - error consts `EManagerMismatch`、`EExpiryCountMismatch`、`EPaused`（claim 用的在 Task 7）
  - const `PERF_FEE_BPS: u64 = 1000`

- [ ] **Step 1: 寫失敗測試（純費用函式）**

```move
#[test_only]
module structured_note_factory::note_factory_fee_tests;

use structured_note_factory::note_factory as nf;

#[test]
fun issuance_fee_30bps() {
    // 1_000_000 * 30 / 10000 = 3000
    assert!(nf::compute_issuance_fee(1_000_000, 30) == 3000, 0);
}

#[test]
fun perf_fee_above_hurdle() {
    // payout=1200, net=1000, hurdle=10000(100%) → threshold=1000, profit=200, 10%=20
    assert!(nf::compute_perf_fee(1200, 1000, 10000) == 20, 0);
}

#[test]
fun perf_fee_at_or_below_hurdle_is_zero() {
    assert!(nf::compute_perf_fee(1000, 1000, 10000) == 0, 0);
    assert!(nf::compute_perf_fee(900, 1000, 10000) == 0, 1);
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd move && sui move test note_factory_fee`
Expected: FAIL（`compute_issuance_fee`/`compute_perf_fee` 未定義）

- [ ] **Step 3: 實作 note_factory 第一部分（config + 純 helper + mint builder）**

```move
/// External API surface: orchestrates strategy -> manager -> note -> leaderboard -> fee.
/// mint is 2-PTB (Predict's create_manager shares the manager + returns only ID, so it
/// cannot be a same-PTB input — design doc 2026-06-18 §0). PTB2 + claim use no-ability
/// hot-potato builders because Move entry cannot take `vector<&OracleSVI>` (C2: all
/// builder fns are `public fun`, never `entry`). See spec §3 and design doc.
module structured_note_factory::note_factory;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use predict::predict::Predict;
use predict::predict_manager::{Self, PredictManager};
use predict::oracle::{Self, OracleSVI};
use predict::market_key::MarketKey;
use structured_note_factory::note::{Self, NoteBase};
use structured_note_factory::strategy_range_accrual::{Self as ra, RangeAccrual};
use structured_note_factory::fee_vault::{Self, FeeVault};
use structured_note_factory::leaderboard;
use structured_note_factory::events;

const PERF_FEE_BPS: u64 = 1000;   // 10%
const FEE_KIND_ISSUANCE: u8 = 0;
const FEE_KIND_PERF: u8 = 1;
const TEMPLATE: vector<u8> = b"range_accrual";

// === Errors (5xx) ===
#[error]
const EPaused: vector<u8> = b"note_factory: minting paused";
#[error]
const EManagerMismatch: vector<u8> = b"note_factory: manager id does not match note/ticket";
#[error]
const EExpiryCountMismatch: vector<u8> = b"note_factory: added expiries != expected";

public struct FactoryConfig has key {
    id: UID,
    fee_bps: u16,
    hurdle_bps: u16,
    paused: bool,
}

public struct FactoryAdminCap has key, store { id: UID }

/// Hot potato: no abilities → MUST be consumed by `mint_finalize`. Guarantees no
/// half-built note state can persist (legs minted but note never created).
public struct MintTicket {
    issuer: address,
    manager_id: ID,
    underlying: vector<u8>,
    legs: vector<MarketKey>,
    oracle_ids: vector<ID>,
    notional: u64,
    net_principal: u64,
    issuance_fee: u64,
    lower: u64,
    upper: u64,
    strike_step: u64,
    qty_per_leg: u64,
    legs_per_expiry: u16,
    expected_expiries: u8,
    expiries_added: u8,
    expiry_ts_ms: u64,         // max expiry across oracles (note expiry)
    walrus_blob_id: vector<u8>,
    fee_bps: u16,
    hurdle_bps: u16,
    is_public: bool,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(FactoryConfig { id: object::new(ctx), fee_bps: 30, hurdle_bps: 10000, paused: false });
    transfer::transfer(FactoryAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Pure fee helpers (unit-tested) ===

public fun compute_issuance_fee(notional: u64, fee_bps: u16): u64 {
    (((notional as u128) * (fee_bps as u128) / 10000) as u64)
}

public fun compute_perf_fee(payout: u64, net_principal: u64, hurdle_bps: u16): u64 {
    let threshold = (((net_principal as u128) * (hurdle_bps as u128) / 10000) as u64);
    if (payout > threshold) {
        ((((payout - threshold) as u128) * (PERF_FEE_BPS as u128) / 10000) as u64)
    } else { 0 }
}

// === Mint (PTB2 builder; PTB1 = raw predict::create_manager off-chain) ===

public fun mint_begin<T>(
    cfg: &FactoryConfig,
    vault: &mut FeeVault,
    mgr: &mut PredictManager,
    mut payment: Coin<T>,
    underlying: vector<u8>,
    lower: u64,
    upper: u64,
    strike_step: u64,
    expiry_total: u8,
    walrus_blob_id: vector<u8>,
    is_public: bool,
    ctx: &mut TxContext,
): MintTicket {
    assert!(!cfg.paused, EPaused);
    let notional = coin::value(&payment);
    let fee = compute_issuance_fee(notional, cfg.fee_bps);
    let fee_coin = coin::split(&mut payment, fee, ctx);
    fee_vault::collect(vault, fee_coin);
    let net = notional - fee;
    // remaining `payment` is the net principal → deposit into the manager
    predict_manager::deposit<T>(mgr, payment, ctx);

    let lpe = ra::legs_per_expiry(lower, upper, strike_step);
    let qpl = ra::qty_per_leg(net, lpe, expiry_total);

    MintTicket {
        issuer: ctx.sender(),
        manager_id: object::id(mgr),
        underlying,
        legs: vector[],
        oracle_ids: vector[],
        notional,
        net_principal: net,
        issuance_fee: fee,
        lower, upper, strike_step,
        qty_per_leg: qpl,
        legs_per_expiry: lpe,
        expected_expiries: expiry_total,
        expiries_added: 0,
        expiry_ts_ms: 0,
        walrus_blob_id,
        fee_bps: cfg.fee_bps,
        hurdle_bps: cfg.hurdle_bps,
        is_public,
    }
}

public fun mint_add_expiry<T>(
    t: &mut MintTicket,
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    clk: &Clock,
    ctx: &mut TxContext,
) {
    assert!(object::id(mgr) == t.manager_id, EManagerMismatch);
    let legs = ra::mint_expiry_legs<T>(predict, mgr, o, t.lower, t.upper, t.strike_step, t.qty_per_leg, clk, ctx);
    vector::append(&mut t.legs, legs);
    vector::push_back(&mut t.oracle_ids, oracle::id(o));
    let exp = oracle::expiry(o);
    if (exp > t.expiry_ts_ms) { t.expiry_ts_ms = exp; };
    t.expiries_added = t.expiries_added + 1;
}

public fun mint_finalize<T>(t: MintTicket, clk: &Clock, ctx: &mut TxContext) {
    let MintTicket {
        issuer, manager_id, underlying, legs, oracle_ids, notional,
        net_principal: _, issuance_fee, lower, upper, strike_step, qty_per_leg,
        legs_per_expiry, expected_expiries, expiries_added, expiry_ts_ms,
        walrus_blob_id, fee_bps, hurdle_bps, is_public,
    } = t;
    assert!(expiries_added == expected_expiries, EExpiryCountMismatch);

    let mint_ts = clk.timestamp_ms();
    let params = ra::new_params(ra::version(), lower, upper, strike_step, expiries_added, legs_per_expiry, qty_per_leg, hurdle_bps);
    let mut note = note::new<RangeAccrual>(
        issuer, issuer, manager_id, underlying, legs, vector[], oracle_ids,
        notional, mint_ts, expiry_ts_ms, walrus_blob_id, fee_bps, is_public, ctx,
    );
    note::add_params(&mut note, ra::witness(), params);

    let nid = note::note_id(&note);
    events::emit_fee_collected(nid, FEE_KIND_ISSUANCE, issuance_fee);
    if (is_public) { leaderboard::register(nid, issuer, TEMPLATE); };
    events::emit_note_minted(nid, TEMPLATE, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public);

    note::soulbound_transfer(note, issuer);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
```

- [ ] **Step 4: 跑測試確認通過 + build**

Run: `cd move && sui move test note_factory_fee && sui move build`
Expected: PASS（3 tests）+ build 通過（mint builder Predict-touching，build-check only）

- [ ] **Step 5: Commit**

```bash
git add move/sources/note_factory.move move/tests/note_factory_fee_tests.move
git commit -m "feat: note_factory — config, fee helpers, 2-PTB mint builder"
```

---

### Task 7: note_factory — claim builder（atomic settle+withdraw）

**Files:**
- Modify: `move/sources/note_factory.move`（接續 Task 6）

**Interfaces:**
- Consumes: Task 6 的 `FeeVault`、`compute_perf_fee`、`PERF_FEE_BPS`、error 機制；`note::{legs,manager_id,expiry_ts_ms,status,status_active,notional,fee_bps,borrow_params,remove_params,set_status,status_settled,note_id,destroy}`；`predict::redeem_permissionless`；`predict_manager::{position,balance,withdraw}`；`oracle::{is_settled,id}`；`market_key::oracle_id`；`ra::{RangeParams,params_hurdle_bps}`
- Produces:
  - struct `ClaimTicket`（no abilities）
  - `claim_begin(note: NoteBase<RangeAccrual>, mgr: &PredictManager, clk: &Clock, ctx: &TxContext): ClaimTicket`
  - `claim_settle_expiry<T>(ct: &mut ClaimTicket, predict: &mut Predict, mgr: &mut PredictManager, o: &OracleSVI, clk: &Clock, ctx: &mut TxContext)`
  - `claim_finalize<T>(ct: ClaimTicket, mgr: &mut PredictManager, vault: &mut FeeVault, ctx: &mut TxContext)`
  - error consts `ENotExpired`、`EOracleNotSettled`、`ELegsNotSettled`、`ENoteNotActive`

- [ ] **Step 1: 新增 claim 相關 imports / errors / struct**

在 Task 6 的 errors 區段補：

```move
#[error]
const ENotExpired: vector<u8> = b"note_factory: clock < note expiry";
#[error]
const EOracleNotSettled: vector<u8> = b"note_factory: oracle not settled";
#[error]
const ELegsNotSettled: vector<u8> = b"note_factory: not all legs settled";
#[error]
const ENoteNotActive: vector<u8> = b"note_factory: note not active";
```

在 import 區補（接續既有 use）：

```move
use predict::predict;                                   // for redeem_permissionless
use predict::market_key;                                // for oracle_id
use structured_note_factory::strategy_range_accrual::RangeParams;
```

> 註：`use predict::predict::Predict;`（Task 6）已引入型別；此處 `use predict::predict;` 為了呼叫 `predict::redeem_permissionless`。若編譯器警告重複，合併為 `use predict::predict::{Self, Predict};`。`market_key`、`predict_manager`、`oracle` 同理用 `{Self, ...}` 形式。

新增 struct（接 MintTicket 之後）：

```move
/// Hot potato: holds the whole note until every leg is settled, then destroys it in
/// `claim_finalize`. No abilities → cannot be dropped/stored mid-settle (review F2:
/// settle-then-withdraw is atomic; a partially-settled note can never be claimed).
public struct ClaimTicket {
    note: NoteBase<RangeAccrual>,
    pending_legs: vector<MarketKey>,
    expiry_ts_ms: u64,
}
```

- [ ] **Step 2: 實作 claim_begin / claim_settle_expiry / claim_finalize**

```move
public fun claim_begin(
    note: NoteBase<RangeAccrual>,
    mgr: &PredictManager,
    clk: &Clock,
    _ctx: &TxContext,
): ClaimTicket {
    assert!(note::status(&note) == note::status_active(), ENoteNotActive);
    let expiry = note::expiry_ts_ms(&note);
    assert!(clk.timestamp_ms() >= expiry, ENotExpired);
    assert!(note::manager_id(&note) == object::id(mgr), EManagerMismatch);
    let pending = *note::legs(&note);   // copy vector<MarketKey>
    ClaimTicket { note, pending_legs: pending, expiry_ts_ms: expiry }
}

/// Settle every pending leg belonging to `o`'s oracle, atomically: redeem (permissionless)
/// then assert the manager position is 0 (review F2 post-check). Settled legs leave the
/// pending set.
public fun claim_settle_expiry<T>(
    ct: &mut ClaimTicket,
    predict: &mut Predict,
    mgr: &mut PredictManager,
    o: &OracleSVI,
    clk: &Clock,
    ctx: &mut TxContext,
) {
    assert!(oracle::is_settled(o), EOracleNotSettled);
    let oid = oracle::id(o);
    let mut remaining = vector[];
    let n = vector::length(&ct.pending_legs);
    let mut i = 0;
    while (i < n) {
        let k = *vector::borrow(&ct.pending_legs, i);
        if (market_key::oracle_id(&k) == oid) {
            let pos = predict_manager::position(mgr, k);
            if (pos > 0) {
                predict::redeem_permissionless<T>(predict, mgr, o, k, pos, clk, ctx);
            };
            assert!(predict_manager::position(mgr, k) == 0, ELegsNotSettled);
            // settled → not carried into `remaining`
        } else {
            vector::push_back(&mut remaining, k);
        };
        i = i + 1;
    };
    ct.pending_legs = remaining;
}

public fun claim_finalize<T>(
    ct: ClaimTicket,
    mgr: &mut PredictManager,
    vault: &mut FeeVault,
    ctx: &mut TxContext,
) {
    let ClaimTicket { mut note, pending_legs, expiry_ts_ms: _ } = ct;
    assert!(vector::is_empty(&pending_legs), ELegsNotSettled);

    let bal = predict_manager::balance<T>(mgr);
    let mut payout = predict_manager::withdraw<T>(mgr, bal, ctx);
    let payout_amt = coin::value(&payout);

    // perf fee on profit above net-principal hurdle
    let hurdle = ra::params_hurdle_bps(note::borrow_params<RangeAccrual, RangeParams>(&note));
    let notional = note::notional(&note);
    let fee_bps = note::fee_bps(&note);
    let net_principal = notional - compute_issuance_fee(notional, fee_bps);
    let perf_fee = compute_perf_fee(payout_amt, net_principal, hurdle);
    if (perf_fee > 0) {
        let fee_coin = coin::split(&mut payout, perf_fee, ctx);
        fee_vault::collect(vault, fee_coin);
    };

    // consume note: remove params (required before destroy), then delete
    let _p: RangeParams = note::remove_params<RangeAccrual, RangeParams>(&mut note);
    note::set_status(&mut note, note::status_settled());
    let nid = note::note_id(&note);
    let holder = note::destroy(note);

    transfer::public_transfer(payout, holder);
    events::emit_fee_collected(nid, FEE_KIND_PERF, perf_fee);
    events::emit_note_settled(nid, payout_amt, perf_fee, ctx.sender());
}
```

- [ ] **Step 3: build**

Run: `cd move && sui move build`
Expected: 通過（claim 全 Predict-touching，build-check only）

- [ ] **Step 4: 跑全部現有測試確保未回歸**

Run: `cd move && sui move test`
Expected: 先前所有 unit test 仍 PASS

- [ ] **Step 5: Commit**

```bash
git add move/sources/note_factory.move
git commit -m "feat: note_factory — atomic settle+withdraw claim builder (F2)"
```

---

### Task 8: testnet 整合測試（PTB round-trip）

> **Blocked**：需先查到 BTC 各 expiry 的 `OracleSVI` object IDs（progress.md TODO）。此 task 是 Predict-touching 路徑唯一的真實驗證，不能省。

**Files:**
- Create: `scripts/integration/range_accrual_roundtrip.md`（PTB 步驟與指令紀錄）

- [ ] **Step 1: 部署 package 到 testnet**

Run: `cd move && sui client publish --gas-budget 500000000`
Expected: 取得 `structured_note_factory` package ID、共享的 `FactoryConfig`/`FeeVault` object IDs、`FactoryAdminCap`/`FeeAdminCap` 到 sender。記入 `move-notes.md`。

- [ ] **Step 2: 查 OracleSVI IDs**

用 `sui_getOwnedObjects` / Predict indexer / `sui client object` 找 BTC 目標 expiry 的 `OracleSVI` shared object IDs（≥1 個，多 expiry 測 multi）。確認 `oracle::is_active == true`。

- [ ] **Step 3: PTB1 — create manager**

Run（sui client ptb）:
```
sui client ptb \
  --move-call 0xf5ea…5138::predict::create_manager \
  --gas-budget 50000000
```
Expected: effects 出現新 shared `PredictManager`，owner 欄位 = sender。記下 manager object ID。

- [ ] **Step 4: PTB2 — mint（begin → add_expiry×N → finalize）**

用 TS SDK 組單一 PTB（CLI 串 hot potato 較難，建議 `@mysten/sui` `Transaction`）：
```
const t = tx.moveCall({ target: `${PKG}::note_factory::mint_begin`, typeArguments:[DUSDC],
  arguments:[cfg, vault, mgr, payment, bcs(underlying), u64(lower), u64(upper), u64(step), u8(expiryTotal), bcs(blobId), bool(isPublic)] });
tx.moveCall({ target:`${PKG}::note_factory::mint_add_expiry`, typeArguments:[DUSDC],
  arguments:[t, predict, mgr, oracle0, clock] });    // 每 expiry 一次
tx.moveCall({ target:`${PKG}::note_factory::mint_finalize`, typeArguments:[DUSDC],
  arguments:[t, clock] });
```
Expected: `NoteMinted` + `FeeCollected(kind=0)` 事件；sender 收到 soulbound `NoteBase<RangeAccrual>`；`predict_manager::position` 對每個 leg key > 0。

- [ ] **Step 5: 等到期後 claim（begin → settle_expiry×N → finalize）**

到 `expiry_ts_ms` 之後、`oracle::is_settled==true`，組 PTB：
```
const ct = tx.moveCall({ target:`${PKG}::note_factory::claim_begin`, arguments:[note, mgr, clock] });
tx.moveCall({ target:`${PKG}::note_factory::claim_settle_expiry`, typeArguments:[DUSDC],
  arguments:[ct, predict, mgr, oracle0, clock] });   // 每 expiry 一次
tx.moveCall({ target:`${PKG}::note_factory::claim_finalize`, typeArguments:[DUSDC],
  arguments:[ct, mgr, vault] });
```
Expected: `NoteSettled` + `FeeCollected(kind=1)`；holder 收到 `Coin<DUSDC>` payout；note 物件已刪除；每 leg `position == 0`。

- [ ] **Step 6: Monkey testing（專案規則）**

逐項對 testnet 驗證應 abort：
- redeem-before-expiry → `claim_begin` abort `ENotExpired`
- 少 add_expiry 就 finalize → `mint_finalize` abort `EExpiryCountMismatch`
- partial-settle 就 finalize → `claim_finalize` abort `ELegsNotSettled`
- double-claim（note 已刪）→ tx 失敗（input object 不存在）
- oracle 未 settled 就 settle_expiry → abort `EOracleNotSettled`
- zero / dust notional → `mint_begin` abort `EZeroQtyPerLeg`
- 極端 strike 範圍（leg 數爆）→ 記錄 PTB 物件數上限門檻，寫入 roadmap 的 notional/leg cap。

- [ ] **Step 7: 紀錄結果**

把 package/object IDs、OracleSVI IDs、round-trip gas、monkey 結果寫入 `move-notes.md` 與 `tasks/progress.md`。

---

## Self-Review

**Spec coverage：**
- 設計 §2 module 表 → Task 1–7 全覆蓋（events/fee_vault/leaderboard/note 破口/strategy/factory mint/factory claim）。
- §4.1 mint 2-PTB → Task 6 + Task 8 Step 3–4。
- §4.2 claim atomic → Task 7 + Task 8 Step 5。
- C1（soulbound_transfer）→ Task 4；C2（public fun 非 entry）→ Task 6/7 程式碼皆 `public fun`；A1（leaderboard event-only）→ Task 3。
- §6 測試策略：純函式 TDD（Task 2/5/6）+ 整合（Task 8）+ Monkey（Task 8 Step 6）。
- §4.3 roadmap 項目（roll/Defaulted/加權/RangeKey/cap/Display V2）→ 明確不在本計畫，無對應 task（刻意 defer，非遺漏）。

**Placeholder scan：** 無 TBD/TODO 於實作 step；Task 8 標 Blocked（OracleSVI IDs）是真實外部依賴，非計畫缺漏。

**Type consistency：** `compute_issuance_fee`/`compute_perf_fee`/`ra::legs_per_expiry`/`ra::qty_per_leg`/`ra::mint_expiry_legs`/`note::soulbound_transfer`/`fee_vault::collect`/`leaderboard::register` 在定義 task 與使用 task 簽章一致；`MintTicket`/`ClaimTicket` 欄位在 begin 設定、add/settle 更新、finalize 解構，前後吻合。
