# Range Accrual — issue→settle 實作設計

> 範圍：`strategy_range_accrual` + `note_factory` 的 mint/claim，打通 Range Accrual 模板的
> 發行→結算全流程。為此最小化實作 `fee_vault`、`leaderboard`、`events`。
> 上游 spec：`docs/specs/2026-06-16-structured-note-factory-spec.md`（本檔修正其 §5.1）。

## 0. 驗證過的鏈上事實（2026-06-18，testnet ABI）

撈自 `sui_getNormalizedMoveFunction`，Predict pkg `0xf5ea…5138`：

- `predict::create_manager(&mut TxContext) -> ID` — 內部 share manager，**只回 ID**。
- `predict_manager::new(&mut TxContext) -> ID` — 同樣只回 ID，內部 share。
- `predict::mint<T>(&mut Predict, &mut PredictManager, &OracleSVI, MarketKey, u64, &Clock, &mut TxContext)` — 每次吃**單一** `&OracleSVI`。
- `predict::redeem_permissionless<T>(…)` — 簽章同 mint，無 owner check。
- `predict_manager::{deposit,deposit_permissionless}<T>(&mut PredictManager, Coin<T>, &TxContext)` — 簽章相同，差別在內部 owner check。
- `predict_manager::{withdraw,balance,position,range_position,owner}` — 既有 stub 已對齊。

**推得的兩個硬限制：**

1. **single-PTB atomic mint 結構性不可能**（修正 spec §5.1「all legs in one PTB」）。
   兩條建 manager 的路都只回 `ID` 並在 call 內 share；PTB 無「ID → `&mut` shared 物件」的
   command，shared input 必須在簽章時就帶 `initialSharedVersion`。→ mint 至少 2 PTB。

2. **keeper auto-roll 不可能**：`mint` owner-gated（manager.owner=holder）+ note soulbound owned
   → keeper 兩者都碰不到。真 accrual 需 roll，故 MVP 不做 roll（見 §5 roadmap）。

3. Move entry **不能吃 `vector<&OracleSVI>`**（ref 不能進 vector/struct）→ 多 expiry 必須走
   hot-potato builder + 逐 oracle 多次 call。

## 1. 鎖定決策

| # | 決策 | 選擇 |
|---|---|---|
| D1 | leg 組成 | N adjacent `up` strike binary ladder（非單一 RangeKey） |
| D2 | leg sizing | 等權平均：每 leg qty = net_principal / (strike數 × expiry數) |
| D3 | claim settle | claim 內 atomic settle+withdraw（builder），符合 review F2 |
| D4 | scope | 最小實作 fee_vault + leaderboard，跑通 issue→settle |
| D5 | claim 歸屬 | `note_factory`（note.move 維持 data-core；修正 spec §3 把 claim 放 note 的說法） |

## 2. 動到的 module 與職責

| Module | 工作 |
|---|---|
| `strategy_range_accrual` | witness `RangeAccrual`；versioned `RangeParams`；strike 列舉 helper；leg 組成（`public(package)`，被 factory 呼叫）；payoff 註解 |
| `note` | **新增** `public(package) fun soulbound_transfer<S>(note, to)` 包 `transfer::transfer`（key-only 跨 module 轉移破口，見 C1） |
| `note_factory` | 2-PTB mint builder + 對稱 claim builder（**`public fun`，非 `entry`**，見 C2）；orchestrate strategy→manager→note→leaderboard→fee |
| `events` | `NoteMinted` / `NoteSettled` / `PublicNoteRegistered` / `FeeCollected` |
| `fee_vault` | `FeeVault`(shared) + `FeeAdminCap` + `collect<T>` + `withdraw<T>`（cap-gated） |
| `leaderboard` | `register` 只 `emit PublicNoteRegistered`（**event-only，無 on-chain vector**，見 A1） |

### 2.1 sui-architect review 修正（2026-06-18）

- **C1（critical）**：`NoteBase` key-only，`transfer::transfer<T:key>` 只能由定義 T 的 module 呼叫。
  factory 不能直接轉 note。→ `note` module 提供 `public(package) fun soulbound_transfer`。
- **C2（critical, Protocol 124）**：「non-public entry functions cannot have hot-potato-entangled
  arguments」。所有 builder fn 收/回 `MintTicket`/`ClaimTicket` → 一律 `public fun`，**不可 `entry`**。
  PTB 可直接 call public fn 並串 hot potato。
- **A1（architecture）**：leaderboard 不用 on-chain `vector<ID>`（每次 mint mutate 同一 shared 物件
  = 共識熱點 + 無上限增長）。`register` 只 emit event，ranking 走 off-chain indexer（spec §8）。
- **A2（roadmap）**：Display V2（Registry `0xd` 已啟用）綁 note → walrus term sheet URL。MVP 不做。

## 3. 資料結構

```move
// strategy_range_accrual.move
public struct RangeAccrual has drop {}              // one-time witness
public struct RangeParams has store, copy, drop {
    version: u8,           // 凍結既有版本；演進＝新版 key，不就地改
    lower: u64,            // ladder 最低 strike
    upper: u64,            // ladder 最高 strike
    strike_step: u64,      // strike 間距
    expiry_count: u8,      // expiry 數（=oracle 數）
    legs_per_expiry: u16,  // = (upper-lower)/step + 1
    qty_per_leg: u64,      // 等權分配後每 leg 數量
    hurdle_bps: u16,       // perf fee 門檻（payout > principal·hurdle 才收）
    // roadmap: coupon_bps_per_hour / roll_interval_ms / accrued_coupon（roll 啟用後）
}
```

```move
// note_factory.move — hot potato，無任何 ability → 必被 finalize 消費
public struct MintTicket {
    issuer: address,
    manager_id: ID,
    underlying: vector<u8>,
    legs: vector<MarketKey>,
    oracle_ids: vector<ID>,
    notional: u64,
    net_principal: u64,
    lower: u64, upper: u64, strike_step: u64,
    qty_per_leg: u64,
    legs_per_expiry: u16,
    expected_expiries: u8,
    expiries_added: u8,
    expiry_ts_ms: u64,
    walrus_blob_id: vector<u8>,
    fee_bps: u16,
    is_public: bool,
}

public struct ClaimTicket {
    note: NoteBase<RangeAccrual>,   // 整顆 note 搬進來，finalize 才 destroy
    pending_legs: vector<MarketKey>,// 尚未確認 settled 的 leg
    expiry_ts_ms: u64,
}
```

`fee_vault`、`leaderboard` 最小結構：

```move
// fee_vault.move
public struct FeeVault has key { id: UID }          // 用 dynamic field 存各幣別 Balance<T>
public struct FeeAdminCap has key, store { id: UID }
// leaderboard.move — A1: 無 on-chain vector，register 只 emit event
// 不需要 shared 物件；register 是純函式直接 emit PublicNoteRegistered
```

## 4. 流程

> **C2**：以下所有 `mint_*` / `claim_*` 皆為 `public fun`（**非 `entry`**），因收/回 hot potato。
> PTB 直接 call public fn 並在 command 間串 ticket。

### 4.1 Mint（2 PTB）

**PTB1**（前端直接呼叫，無 factory code）：
```
mid = predict::create_manager(ctx)   // manager shared, owner = sender(holder)
```
前端從 effects 讀 manager object ID。

**PTB2**（factory builder，manager 此時為 shared input）：
```
t = mint_begin<DUSDC>(
      cfg, &mut FeeVault, &mut PredictManager, payment: Coin<DUSDC>,
      underlying, lower, upper, strike_step, expiry_total,
      walrus_blob_id, is_public, &Clock, ctx) -> MintTicket
  - notional = payment.value
  - fee = notional * cfg.fee_bps / 10000;  split → fee_vault::collect → emit FeeCollected(kind=issuance)
  - net = notional - fee;  predict_manager::deposit(mgr, net_coin, ctx)
  - legs_per_expiry = (upper-lower)/strike_step + 1
  - qty_per_leg = net / (legs_per_expiry * expiry_total)   // D2 等權；assert > 0
  - init ticket（legs=[], oracle_ids=[], expiries_added=0）

repeat ×expiry_total:
  mint_add_expiry<DUSDC>(&mut t, &mut Predict, &mut PredictManager, &OracleSVI, &Clock, ctx)
    - exp = oracle::expiry(o);  oid = oracle::id(o)
    - assert oracle::is_active(o)            // 不能對已結算/未啟用的 oracle 開倉
    - s = lower; while s <= upper:
        k = market_key::up(oid, exp, s)
        predict::mint<DUSDC>(predict, mgr, o, k, t.qty_per_leg, clk, ctx)
        t.legs.push(k); s = s + strike_step
    - t.oracle_ids.push(oid); t.expiries_added += 1

mint_finalize<DUSDC>(t, ctx)                            // A1: 不收 Leaderboard
  - assert t.expiries_added == t.expected_expiries     // 全 expiry 都開了倉
  - note = note::new<RangeAccrual>(issuer=sender, owner_at_mint=sender, manager_id, …)
  - note::add_params(&mut note, RangeAccrual{}, RangeParams{…})
  - if is_public: leaderboard::register(id(note), sender, b"range_accrual")  // 純 emit event
  - emit NoteMinted{…}
  - note::soulbound_transfer(note, sender)  // C1: 由 note module 包 transfer::transfer
```

### 4.2 Claim（atomic settle+withdraw，builder）

```
ct = claim_begin(note, &mut PredictManager, &Clock, ctx) -> ClaimTicket
  - assert clock.ts_ms >= note.expiry_ts_ms              // ENotExpired
  - assert note.manager_id == object::id(mgr)            // EManagerMismatch
  - assert note.status == ACTIVE
  - move legs → ct.pending_legs

repeat ×expiry_count:
  claim_settle_expiry<DUSDC>(&mut ct, &mut Predict, &mut PredictManager, &OracleSVI, &Clock, ctx)
    - assert oracle::is_settled(o)                        // EOracleNotSettled
    - oid = oracle::id(o)
    - 對 ct.pending_legs 中 oracle_id==oid 的每個 k：
        predict::redeem_permissionless<DUSDC>(predict, mgr, o, k, position(mgr,k), clk, ctx)
        assert predict_manager::position(mgr, k) == 0     // F2 post-check
        從 pending_legs 移除 k

claim_finalize<DUSDC>(ct, &mut PredictManager, &mut FeeVault, ctx)
  - assert ct.pending_legs.is_empty()                     // 全 leg settled，否則 abort
  - payout = predict_manager::withdraw(mgr, predict_manager::balance(mgr), ctx)
  - principal = note.notional - issuance_fee（已在 mint 扣；用 net 比較）
  - perf_fee = if payout.value > principal * hurdle_bps/10000:
                  (payout.value - principal*hurdle/1e4) * 10% else 0
  - if perf_fee>0: split → fee_vault::collect → emit FeeCollected(kind=perf)
  - note::set_status(SETTLED); note::remove_params; holder = note::destroy(note)
  - transfer::public_transfer(payout, holder)             // holder == owner_at_mint（soulbound 保證）
  - emit NoteSettled{note_id, payout, perf_fee, settled_by: sender}
```

### 4.3 Roadmap（明確 defer，非靜默跳過）

- **roll / 真 accrual**：需把 note 改 shared + 內嵌授權讓 keeper roll（推翻 soulbound custody，review F3/T6）。
- **Defaulted 清算**（review F6）：oracle deviation + grace period → best-effort 退還 manager balance、不收 perf fee。MVP claim 只走 Settled happy path。
- **leg sizing 加權**（依 strike 距離 / oracle spot）→ 近似連續 range payoff。
- **精確 range replication**（call spread，非 ladder）。
- **單一 RangeKey 路徑**（用 mint_range/redeem_range）作為 ladder 的替代。
- **notional / leg cap**：限制 strike數×expiry數 防 PTB 物件數爆（gas / 上限）。
- **Display V2**（Registry `0xd`，A2）：綁 note → walrus term sheet URL，前端顯示。

## 5. 錯誤碼（沿用 spec §7 範圍）

- `strategy_range_accrual` 2xx：`EInvalidRange`(lower>=upper)、`EZeroStep`、`EZeroQtyPerLeg`、`EOracleNotActive`、`EOracleExpiryMismatch`
- `note_factory` 5xx：`ENotExpired`、`EManagerMismatch`、`EExpiryCountMismatch`、`ELegsNotSettled`、`ENotionalCapExceeded`
- `fee_vault` 7xx：`ENotFeeAdmin`
- `leaderboard` 6xx：（append-only，暫無）

## 6. 測試策略

- **strategy 單元**：strike 列舉數正確、qty_per_leg 計算、邊界（lower==upper-step、zero step、zero notional → abort）。
- **factory 單元**（用 `test_scenario` + Predict stub 的 mock？stub body abort，故 mint/claim 整合測試需對 testnet 真 Predict 跑 PTB）。
  - 純 Move 單元只能測不碰 Predict 的部分（fee 計算、ticket invariant、note 生命週期）。
  - **整合**：對 testnet Predict 跑 PTB1→PTB2→claim round-trip（需 OracleSVI IDs，仍待查）。
- **Monkey**（專案規則）：redeem-before-expiry、double-claim、少 add_expiry 就 finalize（應 abort EExpiryCountMismatch）、partial-settle 就 finalize（應 abort ELegsNotSettled）、zero notional、極端 strike 範圍（leg 數爆）。
- `sui move test` 必過才 commit；改動後 `sui move build` 確認。
