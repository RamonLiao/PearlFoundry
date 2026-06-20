# Lessons

## 2026-06-16 — 設計前必驗鏈上真實 ABI，別信 business spec 的技術假設
- **錯誤 pattern**：IDEA_REPORT/BUSINESS_SPEC 假設 Predict 有 `Position` 物件、可 `vector<Position>` 自持。初版架構 §3 照抄。
- **真相**：Predict 根本沒有 Position 物件；部位是 shared `PredictManager`（key-only 無 store）內的 table 記帳。若帶錯假設進實作，會在寫第一個 entry function 時才爆。
- **正確做法**：對外部協議整合，**先用 `sui_getNormalizedMoveModulesByPackage` 撈真實 ABI**，函式 body 的 assert 要 `sui move disassemble` 反組譯（normalized ABI 看不到授權邏輯）。設計決策標 PROPOSED，驗證後才 LOCK。

## 2026-06-16 — owner-gated 授權看「對照組」比看單一函式可信
- 判斷 `redeem_permissionless` 有無 owner 檢查時，光看「沒找到 assert」不夠（可能漏看）。
- **正確做法**：找同 module 的對照組（`mint_range` 有明確 `sender→owner→Eq→BrFalse→Abort`），證明「有 gate 的函式長這樣、這個沒有」=刻意設計，排除反組譯漏看。

## 2026-06-18 — 設計外部整合前，先確認 Move/PTB 的結構性限制（非 runtime）
- **情境**：原 spec §5.1 假設「mint 所有 leg 在單一 PTB atomic 完成」。
- **真相（撈 ABI 驗證）**：`predict::create_manager` / `predict_manager::new` 都只回 `ID`、在 call 內就把 manager share 掉。PTB 沒有「ID → `&mut` shared 物件」的 command，且 shared input 必須在簽章時帶 initialSharedVersion。→ 同-PTB 用剛 share 的物件**結構性不可能**，不用花 gas 跑就能斷定。mint 被迫拆 2 PTB。
- **另一限制**：Move entry / 一般 fn 的參數**不能是 `vector<&T>`**（reference 不能進 vector/struct）。多個 shared 物件 ref（如多 `&OracleSVI`）只能靠 hot-potato builder + 逐物件多次 call 解。
- **再一限制**：`transfer::transfer<T: key>` 只能由**定義 T 的 module** 呼叫。key-only（無 store）物件跨 module 轉移，必須由定義 module 開 `public(package)` wrapper。
- **正確做法**：整合外部協議時，除了撈 ABI，還要把「回傳型別（ID vs 物件）、ref 能否進 collection、transfer 權限歸屬」一起當設計約束先確認，再決定 PTB 切分。

## 2026-06-19 — publish 的 linkage 閉包要涵蓋 dependency 的 transitive closure
- **錯誤 pattern**：以為本地 `sui move build` 全綠就能 publish。實際 publish 報 `PublishUpgradeMissingDependency in command 0`。
- **真相**：publish 交易的 linkage table 必須包含 dependency 的**完整 transitive on-chain 依賴**，不只你直接 call 的 package。Predict 內部依賴 DEEP token + DeepBook V3，我們的 Move.toml 沒宣告 → 缺。本地 build 只驗原始碼層級型別解析，不驗 linkage 閉包完整性。
- **正確做法**：撈 dependency package 的 on-chain `linkageTable`（`sui_getObject` bcs），對缺的 package 建 linkage-only stub（至少一個 dummy module + published-at，空 sources 會被 CLI 當 unpublished 拒絕），讓依賴圖忠實反映 transitive closure。

## 2026-06-19 — 外部協議的 runtime 限制要實證，別只信反組譯臆測
- **錯誤 pattern**：mint 第一版 strike 選太遠 OTM（62500/63000/63500e9，forward 62447e9），abort `assert_mintable_ask` code 7。派去反組譯的 subagent 臆測「amount 太小」，方向錯。
- **真相（實證）**：同 amount，把 strike 改貼 forward（62600/62700/62800e9）就成功。code 7 = SVI-implied ask price 掉出 oracle 允許 band（遠 OTM）。極端 OTM 連 `pricing_config::quote_spread_from_fair_price` 都先崩（code 1）。
- **正確做法**：對外部協議的 runtime gate，**dry-run 實證比反組譯臆測可信**。查鏈上真實成功事件（`PositionMinted` 的 strike/ask_price 分佈）反推合法輸入帶，比猜 error constant 快又準。
- **設計回饋**：range-accrual 的 lower/upper/step 不能 hardcode，必須綁當下 forward 動態算窄範圍（off-chain pricing-engine 職責）。

## 2026-06-20 — 紙上 plan 的技術假設要 dry-run 逐條實證（pricing-engine 連翻 4 個）
- **背景**：pricing-engine plan（sui-architect review 過）寫得很細，但實作時 4 個核心假設被 live testnet 推翻，全靠 dry-run 當場抓到：
  1. plan 假設「1-leg 探測（lower=upper=strike）」→ 真相 `legs_per_expiry` `assert!(lower<upper)`，1-leg 直接 abort。改 2-leg 微 ladder（partner 往 forward 靠，單調性隔離被測 strike）。
  2. plan 假設「探完整 band 邊界」→ 真相 band 寬 ~6000-8000 ticks，exponential search kmax 在找到 fail 前就停、binary search invariant 破。改 maxLegs-capped。
  3. plan 假設「MAX_LEGS=128 可單 PTB mint」→ 真相 gas 隨 leg 陡升，128 legs >10 SUI 超錢包。off-chain 預設改 16。**單 PTB 的瓶頸是 gas 不是 band**。
  4. plan/spec A2 假設「oracle ts 只在 15-min rolling 變，可用 ts-equality + drift 閾值 gate」→ 真相 ts 連續每幾秒更新、forward probe 期間抖 ~20 ticks，但 band 寬 6000 ticks 永不掉出 → 任何 drift 閾值誤判。改 pre-submit dry-run（無閾值，權威）。
- **正確做法**：對外部協議整合，plan 的每個「runtime 行為假設」都標 PROPOSED，實作第一步先用一次性 dry-run 校準（成功/各 abort code/gas），再依實證寫。嚴格 abort whitelist（只收 1/7）讓非預期 abort（grid-misalign code 2、EInvalidRange）立刻 loud-fail 而非被吞成 band 邊界——這正是當場抓到 1-leg 假設錯的原因。
- **校準 SOP 驗證了**：`parseAbortCode` regex 對真實 SDK error string（`MoveAbort(..., N) in command M`）驗過，N 可超 u64（EInvalidRange 巨大 code）用 BigInt 解析。
