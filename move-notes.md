# move-notes.md

## 2026-06-19 — 結算模式決策（實測 gas + 修正 keeper 框架）

### 實測 gas（testnet 真實上鏈）
- **mint PTB2**：computation 154.7M + net storage 24.6M = **+179.3M MIST ≈ 0.179 SUI**（storage 主導，分配 note+position）。由 holder mint 時自付，與結算模式無關。
- **claim**：computation 1.0M(floor) + net storage −8.2M = **−7.19M MIST ≈ −0.0072 SUI（gas-negative，倒賺 rebate）**。刪 note+2 dynamic-field → storage rebate > 成本。注意此為 3-leg 單 expiry；多 expiry computation 會線性升，但仍 modest。

### 🔑 修正：keeper「代執行 claim」結構性不可能
- `claim_begin(note: NoteBase<RangeAccrual>, ...)` 吃 **by-value owned soulbound note**（AddressOwner=holder）。
- Sui 規則：owned object 只能由 owner 簽名的交易當 input。第三方 keeper 連把 note 放進 PTB input 都做不到 → **keeper 用自己地址代跑 claim 不可能**（與既有「note soulbound → keeper 碰不到」一致）。前一輪把 keeper 講成「自動代執行」是錯誤框架。
- claim gas-negative 是真，但「誰能執行」被 object ownership 鎖死，不是 gas 問題。

### 定案：結算模式 = 兩者並存（holder 永遠是 signer，差別只在 gas 誰付）
- **路徑 A 自助 claim**：holder 簽 + holder 付 gas（gas-negative 倒賺）。現況已支援。
- **路徑 B Sponsored tx**：holder 簽（提供 owned note + sender 授權）+ **項目方 gas station 第二簽並提供 gas coin**。holder 免持 SUI。這才是 mainnet「項目方幫忙」的正解。
- **合約零改動**（claim 已 `public fun` + by-value note，天然支援兩路徑）。

### Mainnet 實踐清單（全 off-chain）
1. Indexer：監看 `predict::oracle::OracleActivated` + settlement_price 非 null → 標記可結算 → 推播 holder。
2. Gas station 服務（路徑 B）：後端持 sponsor SUI + gas coin pool，對 holder 簽好的 claim txBytes 做 sponsor 簽名（Mysten reference gas-station / Shinami / Enoki）。
3. 前端：兩顆按鈕（自付 gas / 免 gas sponsored）。
4. MIN_NOTIONAL 與結算模式**脫鉤**（不存在代付且代執行）→ 純擋 dust/spam。

### MIN_NOTIONAL 決策
- 實測 keeper 成本趨近零，原計畫 50–100 dUSDC 為**未實測臆測**，已推翻。
- **hackathon：維持 default 1 dUSDC**（1_000_000，沒人會洗 testnet 榜，零治理動作）。
- **mainnet 前：`set_min_notional(5_000_000)` 拉到 5 dUSDC**（擋 leaderboard spam，留 SUI 波動 margin）。

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

## 2026-06-19 — OracleSVI ID 枚舉（解 Task 8 blocker）
- **枚舉方法**：`suix_queryEvents` MoveEventType=`<PKG>::registry::OracleCreated`（descending=最新在前）。
  欄位：`oracle_id, oracle_cap_id, underlying_asset(String), expiry(u64 ms), min_strike(u64), tick_size(u64)`。
- **BTC testnet 現況**：每 **15 分鐘**一檔（expiry 間隔 900000ms），`min_strike=50000000000000`、`tick_size=1000000000`。scale=1e9 → strike $50,000 起、tick $1。spot≈$62,398（`prices.spot`）。
- **OracleSVI object**：`type=<PKG>::oracle::OracleSVI`、**Shared**（建 PTB 須帶 `initial_shared_version`）。
  - active oracle：`active:true`、`settlement_price:null` → 可 mint。
  - 已結算：`active:false`、`settlement_price` 有值 → 可測 claim/settle path。
- **關鍵洞察**：oracle ID 是 **ephemeral**（15min 滾動），**禁止 hardcode**。整合測試/前端在「建 PTB 當下」查 `OracleCreated` 動態取最新 active oracle + 其 `initial_shared_version`，再組 PTB。多 expiry 取相鄰 N 檔（MVP ≤3）。
- 範例（會過期，僅供結構參考）：active `0x30b3b07b…fb27a47a`@ver908578530 expiry1781859600000；settled `0x2b7c693f…ffaa3031` settlement_price=62611333655270。

## 2026-06-19 — Task 8 testnet 整合測試（進行中）

### 部署 (testnet, digest AnPSTTKL1fvw3VDPZcqYpeJeFoG7gJEJk34prV2NbB2K)
- **package** `0xa69904d3bafe89a197da763f3c5c7ca39522aa3d81974b3910ad5c261bdcb21a`
- FactoryConfig (shared, v908750651) `0xc8516309c6c65dd71a910a966abb8e74284ecb49eaaae1607acbf7440f249351`
- FeeVault (shared, v908750651) `0x9991245eed652140437bcda579c5ff6f7f7fae13986d6145d65941abacd75c2c`
- FactoryAdminCap (owned) `0x5ec377311a9ffa9144245e3798eb0dd4a0fbbdff1989d5611cbd81c7d1fdab5f`
- FeeAdminCap (owned) `0x5bbfc8079d772ae604dc08b65c2cdea78c1ebf281d64696297b86af3398fce08`
- UpgradeCap (owned) `0x5d6191f76feb6cfb6ca2fc506759bddf8b04ea8c999452e67e5abd119960612f`

### 踩雷：PublishUpgradeMissingDependency
- 症狀：publish 報 `PublishUpgradeMissingDependency in command 0`，但本地 `sui move build` 全綠。
- 主因：publish 的 linkage table 必須涵蓋 dependency 的**完整 transitive closure**，不只直接 call 的 package。Predict 內部依賴 DEEP token (`0x36dbef…58a8`) 與 DeepBook V3 (`0xfb28c4…6982`→v19 `0x74cd56…77c8`)，我們的 Move.toml 沒宣告 → 缺。
- 解法：新增兩個 linkage-only stub（`move/deep_interface`、`move/deepbook_interface`，各一個空 dummy module + published-at），讓 `predict_interface/Move.toml` 依賴它們，忠實反映 `note_factory → Predict → {DEEP, DeepBook}`。空 sources 會被 CLI 當「unpublished dependency」拒絕，所以每個 stub 必須至少有一個 module。

### Oracle 枚舉（動態，禁 hardcode）
- 正確 event = `oracle::OracleActivated`（**非** `registry::OracleCreated`），parsedJson 帶 `oracle_id`/`expiry`/`timestamp`。
- 查法：`suix_queryEvents {"MoveEventType":"<predict_pkg>::oracle::OracleActivated"}` desc。
- Oracle 物件欄位：`active:bool`、`settlement_price:null=未結算`、`underlying_asset`（全 BTC）、`expiry`（ms）。15-min rolling grid（expiry 間隔 900000ms），約到期前 ~2hr activate。
- Predict shared obj（`Predict` type 實例）`0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`

### Mint round-trip (digest 13ikpdQKhFMNUj6Enk9tjGku1hDtJWX8onUJUHsVz3Gy)
- PredictManager (PTB1 create_manager) `0x312231fc2aa5d484b4324c57ec09a876a2a008fee5f91b65ffac3046bf0eed59`
- Note (soulbound NoteBase<RangeAccrual>, AddressOwner=sender) `0x9d560b97bf47faf89148894280d9ea421ba272ff9b273fa2289960782287d929`
- Oracle minted into `0xd69e473b…65bfbea`（BTC, forward 62601e9, expiry 1781857800000）
- Params：notional 10 dUSDC、3-leg up-ladder strikes 62600/62700/62800e9（step $100）、issuance fee 30000（30bps）✓
- 事件：3× PositionMinted(ask 0.40/0.21/0.085)、FeeCollected(kind=0,30000)、PublicNoteRegistered、NoteMinted ✓

### 🔑 關鍵發現：predict::mint 的 ask-price band（assert_mintable_ask code 7）
- predict 對每個 leg 算 SVI-implied ask price，**必須落在 oracle 的允許 band 內**，否則 abort `assert_mintable_ask` code 7。
- 實證：strike 距 forward 太遠（OTM）→ ask price 掉出下界 → abort。62500/63000/63500e9（forward 62447e9）失敗；貼 forward 的 62600/62700/62800e9 成功。
- **對 strategy 的設計回饋**：range-accrual 的 lower/upper/step 不能 hardcode，必須綁當下 forward price 動態算窄範圍（off-chain pricing-engine 職責）。寬 ladder / 遠 OTM 尾 leg 會讓整張 note 鑄造 abort。
- 簽署路徑（不洩漏私鑰）：TS SDK build txBytes → `sui keytool sign --data <b64>` → `sui client execute-signed-tx`。私鑰匯出被 classifier 擋（正確）。

### 待續：claim（需等 oracle 結算）
- claim 需 `oracle::is_settled==true`（settlement_price 非 null），由 Predict keeper 在 expiry 後設定，時點不可控。
- claim.js 已備妥（claim_begin→claim_settle_expiry→claim_finalize）。expiry 1781857800000 後輪詢 is_settled，再執行。

### ✅ Claim round-trip 完成（digest EveDmojukGq2EVyNRW6TzEAztdX1wDb6wYEefPXzA45E）
- Oracle 0xd69e 結算 settlement_price=62623298781818（~$62,623，落在 leg 62600 之上 → ITM）。keeper 約在 expiry 後不久結算（輪詢 iter 35 命中）。
- 事件：BalanceEvent withdraw 10997587、FeeCollected(kind=1 perf,102758)、NoteSettled(payout)。
- **獲利結算**：payout 10997587 > net principal 9970000 → profit 1027587；perf fee=10%×profit=102758 ✓。holder 收 10894829 dUSDC。
- Note 0x9d56…d929 **deleted**（+2 dynamic-field 物件一併清）；position 歸零。
- **FeeVault Balance<DUSDC> = 132758 = 30000(issuance) + 102758(perf) 完全對帳。**
- 簽署同 mint：keytool sign + execute-signed-tx（私鑰不離 keystore）。

### Task 8 結論
mint(2-PTB) → settle → claim 全 happy-path + 5 Monkey abort 在 testnet 驗證通過。合約金流、fee、soulbound、note 生命週期、atomic settle+withdraw 全部正確。
整合腳本：`scripts/integration/{config,mint,claim}.js`（@mysten/sui v1.36，oracle/mgr/note 走 env 不 hardcode）。

---

## 2026-06-20 — Pricing Engine（off-chain strike ladder，`scripts/pricing/`）

**目的**：自動從 live oracle forward 推導合法 range-accrual strike ladder（每 leg 過 `predict::mint` band），取代 `mint.js` 手動 `LOWER/UPPER/STEP`。

**模組**：`ladder.js`（純函式 forward-centered max-width ladder）、`oracle.js`（resolve+fetch forward+event sanity）、`probe.js`（dry-run band 探測）、`price.js`（CLI `computeLadder`，mint.js import）。全 TDD，pure 9 tests + live probe 2 tests 全綠。

### 與 plan 的重大偏離（皆來自 live 實證，非紙上）

1. **1-leg 探測不可行 → 2-leg 微 ladder**：`strategy_range_accrual::legs_per_expiry` 有 `assert!(lower < upper)`，lower==upper 直接 abort（EInvalidRange，巨大 code，發生在我們合約還沒到 predict band）。改用 2-leg 微 ladder：被測 strike 當外側、partner 取「往 forward 靠一格」。band per-leg 且單調 → partner 一定先過，tx 成敗 = 被測 strike 的 band 成敗。

2. **boundary 改 maxLegs-capped**：testnet band 寬 ~6000-8000 ticks（±$6-8k on $63k），遠超 MAX_LEGS。探到上千 ticks 既慢又脆（exponential search invariant 破）。改成只探 `maxLegs` 步：band 更寬回傳 cap 點（MAX_LEGS 收縮綁定）、更窄精確找邊。`findBoundary` 回 `{strike, capped}`。

3. **off-chain maxLegs 預設 = 16（非 128）**：實測 gas 隨 leg 陡升（storage 主導）：**4 legs 0.03 / 8 legs 0.17 / 16 legs 0.5 / 32 legs 1.6 / 128 legs >10 SUI**。錢包僅 ~22 SUI 連 128-leg 都 mint 不起。**單 PTB mint 的真實瓶頸是 gas，不是 band**。Move `MAX_LEGS=128` 維持為 DoS 硬上限。`mint.js` gasBudget 拉到 2 SUI。

4. **staleness guard 改 pre-submit dry-run（非 forward-drift 閾值）**：oracle timestamp **連續每幾秒更新**（非 15-min rolling），且 forward 在 ~12s probe 期間自然抖動 ~20 ticks。但 band 寬 6000 ticks，20-tick 抖動永不掉出 band → 任何 magic drift 閾值都誤判。最正確、無閾值做法 = 簽署前對「即將送出那筆 tx」做一次 dry-run，非 success 才 abort（`GUARD=1` bytes 模式）。符合「dry-run 是權威」哲學。

5. **`fetchOracle` 加 forward==0 fail-loud**：剛建立的 oracle（15-min rolling）forward=0 未定價，mint 會推出無意義 ladder → 直接 throw（Rule 12）。

### Off-chain abort code 對照（dry-run 分類用）
- code 1（`pricing_config`）/ code 7（`assert_mintable_ask`）= band rejection（whitelist，回 `'band'`）。
- code 2（`oracle_config::assert_valid_strike`）= strike 不在 tick grid（**非** band；probe 前須 snap forward）。
- EInvalidRange 巨大 code（`strategy_range_accrual`）= lower>=upper（我方合約）。
- 以上非 1/7 一律 throw + 印 raw effects，不誤判成 band。

### 端到端驗證（live testnet）
`price.js`（16-leg ladder）→ `mint.js dryrun` = **success，net gas 0.505 SUI**。`bytes`+`GUARD=1` pre-submit dry-run 通過。

### 操作型 monkey case（手動跑，無自動化 code）
- 對剛建立未定價 oracle（forward=0）→ `fetchOracle` throw。
- 已結算 oracle（settlement_price != null）→ `fetchOracle` throw。
- 遠未來 EXPIRY → `resolveOracle` throw 並列出 recent expiries。
- notional=0 / 不足 → probe forward 即 throw（非 1/7 abort），不誤判成 band。
