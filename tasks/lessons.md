# Lessons

## 2026-06-23 — brainstorming visual companion 給 full-doc demo 要 base64 內嵌資產；redesign 的 design review 在 plan 階段抓 a11y 比實作後抓便宜
- **背景**：Nacre Light 重設計用 brainstorming 的 visual companion 秀真實 demo（full HTML，非 fragment）。第一版 logo 用相對路徑 `<img src="logo.png">` → companion server 只 serve 最新 HTML，相對資產 404 破圖（masthead 顯示 alt「PearlFo」）。改成 base64 data-URI 內嵌（173KB）才穩。**教訓**：companion 的 full-document demo，所有圖片資產一律 base64 內嵌，別賭相對路徑能被 serve。
- **背景2**：動畫/動態效果（氣泡、caustic、bob）在「截圖」裡本來就看不到 → 使用者回報「你講的全都沒有」。要嘛強度做到靜態也看得出立體（氣泡加白高光點+藍邊+陰影），要嘛明講「這是動態、請看 live」。**別用單張截圖判動畫。**
- **流程價值**：2 路 design review（sui-frontend + frontend-design/taste）在 **plan 階段**（還沒寫 code）就抓到 WCAG CTA 文字對比 fail（pink-gold 末端 3.1:1）、dim text 太淡、gradient-text wordmark 在白底溶字、無 mobile masthead、ConnectButton modal 在亮頁仍暗。全 patch 進 plan 標 `/* review */` → 5 個 SDD subagent 照抄即正確，不用實作後再返工。**a11y/對比這種「紙上可判」的問題，design review 要在 plan 前跑。**
- **SDD 純-CSS 任務的「test」**：CSS 沒 unit test → 用 `vite build` green + **branch-wide `git diff` 零-logic 不變式 gate**（證明 api/mint/config/dapp-kit/main byte-unchanged）當可驗收的 test，encode「這是純 presentation 遷移」的 why（符合 Rule 9）。final whole-branch review（opus）仍抓到 1 個 build 不會 fail 的 a11y 漏洞（logo bob 沒進 reduced-motion）——證明 build-green ≠ 規格全中。

## 2026-06-23 — 驗證視覺別只信一種工具：ImageMagick 不 render SVG gradient、playwright MCP screenshot 寫到它自己的 cwd
- **錯誤 pattern 1**：手繪 logo SVG 用 `magick -background "#0b0d12" logo.svg out.png` 預覽，render 出近黑的形狀 → 誤判 gradient 壞掉，連改兩版。用 solid `fill="#ff00ff"` 測同一 path 才發現**幾何是對的，是 IM 內建 MSVG renderer 不支援 `<linearGradient>`/`<radialGradient>`**（會 render 成黑/透明）。瀏覽器渲染正常。
- **錯誤 pattern 2**：playwright MCP `browser_take_screenshot` 回報「Screenshot saved ./app-full.png」但 `find /` 當下找不到 → 誤判「MCP 在隔離 sandbox、檔案取不回」，改用 computed-style 探測當 gate。**真相**：screenshot 確實寫到本機 repo root（MCP server 的 cwd 剛好＝repo root），只是我 `find` 跑得比檔案 flush 早（race）；幾分鐘後 `git status` 就看到 `app-full.png`（293KB，可直接 Read 看圖）。
- **正確做法**：(1) SVG 視覺驗證一律用真瀏覽器（playwright/dev server），別用 ImageMagick rasterize 判斷 gradient/filter 類效果——IM 的 SVG 支援很弱。(2) playwright MCP 截圖找不到時，先 `git status`/`ls` repo root（MCP 可能就寫在 cwd），別急著斷定「取不回」就放棄看圖。computed-style 探測是好的補充 gate，但能看圖就看圖。
- **連帶**：第一版 SVG 兩個 arc 同向彎 → render 成「眼睛」（shell＝眼皮、ribs＝睫毛、pearl＝瞳孔）。glyph 設計要 top shell 上凸、bottom shell 下凸、pearl 夾中間才像開蚌；小尺寸（~28-40px）寧可 bold simple（單一 scallop fan + pearl）勝過細節。


## 2026-06-22 — git 狀態「看似被平行 session 污染」時，先查 authorship/timestamp 再下結論，別擅自動 branch
- **情境**：SDD 跑到 Task 5 結束算 merge-base 時發現：(1) HEAD 跑到 `main` 而非我建的 `feat/settlement-watcher`，(2) 我的 task commits 中間插了一個不是我做的 `b6694aa "PearlFoundry README"`。直覺＝平行 session 污染（呼應 06-20 /tmp 覆寫教訓）。
- **真相（reflog + `git show -s --format`）**：`b6694aa` 作者就是 owner 本人（同人不同 email），README 是**這專案自己的產品 README**（PearlFoundry = 此 repo），時間在 session 進行中；reflog `Branch: renamed refs/heads/feat/settlement-watcher to refs/heads/main` = owner **刻意把 feature branch 升成 main**。不是敵意污染，歷史線性完好。
- **正確做法**：git 狀態與預期矛盾時，**取證優先、不 mutate**：`git reflog`（誰改了 HEAD/branch）、`git show -s --format='%an %ae %ci %s' <sha>`（外來 commit 的作者/時間/內容）、`git worktree list`、`git branch -a`。確認是「自己人的合法操作」還是「真污染」再決定。對 hard-to-reverse 的 branch/push 操作，先把決策交回 human（本次 owner 選「停在 main、不 push、等決定 remote」）。
- **連帶**：SDD ledger（`.superpowers/sdd/progress.md`）記的 commit SHA 在 git 裡永存，branch 名字被改也能靠 SHA + reflog 還原進度，不用重跑已完成 task。

## 2026-06-22 — spec 階段的 skill review 能擋掉「紙上正確但 runtime 會 race」的設計（settlement watcher 連修 2 個）
- **背景**：watcher spec 第一版自審只抓到 seeding 職責歸屬；sui-indexer + sui-architect 兩個 skill 並行審 spec 才抓到兩個真 bug：(1) 冷啟動「snapshot-seed 當下 pending set」會 **race 同進程的 runPoller**——開機到 seed 之間 poller 剛 ingest 的新成熟 note 被當 backlog 永久吞掉，破壞 headline 保證；(2) `markNotified` 在 `notifyMatured` 前 → crash 在中間永久標記但 log 從沒發，打臉「log 是 source of truth」。
- **正確做法**：off-chain daemon/pipeline 的 spec 一樣要過領域 skill review（不只 Move 才需要）。**凡是「兩個非同步來源共享狀態」的設計（poller 寫 / watcher 讀同一 db）必問：snapshot 取在哪個時間點？跟另一方的進度有無 race？** 解法把「start-time snapshot」改成「per-record 純 predicate 邊界」（`expiry < seed_cutoff_ts` 持久化），order-independent、免賭對方進度。
- **連帶**：log-before-mark 的測試要用「注入會 throw 的 log」模擬 crash-after-log-before-mark，斷言下一輪 re-fire——這才是測 at-least-once 的 why，不是 happy-path 重述。


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

## 2026-06-20 — dual-review 共享 /tmp 路徑會被並行 session 覆寫 → codex 審到別人的 diff 回幻覺
- **錯誤 pattern**：`git diff > /tmp/rev.diff` 用固定檔名。另一並行 session 也寫 `/tmp/rev.diff`，我的 pricing diff 被覆寫成別專案的 backend/RECALL 內容。codex review.sh 讀到該內容 → 回完全無關的幻覺 finding（`backend/src/memory.ts`、`recall.report.v1`）。
- **正確做法**：review diff 一律寫**唯一檔名**（`/tmp/xxx_$$.diff` 帶 PID）。codex 回的 finding 若引用 diff 裡不存在的檔案/符號 = 立即懷疑輸入被汙染或幻覺，先 `head` 驗 diff 內容再重跑，不要照單全收。重跑後 codex F1–F3 全為真 bug，證明 wrapper 本身可用、問題在輸入。

## 2026-06-21 — Sui event filter：要按 event 抓事件用 MoveEventModule，不是 MoveModule
- **錯誤 pattern**：indexer poller 用 `queryEvents({ query:{ MoveModule:{ package, module:'events' }}})` 想抓 `events` module 發的事件 → 回 **0 筆**（package 還在、事件還在）。連 sui-architect+sui-indexer 兩輪 review 都誤判「emit 在 events.move 所以兩者等價」。
- **真相（live testnet 實證）**：`MoveModule` filter 按「交易的 entry module」過濾（PTB 呼叫的是 `note_factory::mint/claim`，不是 events）→ 對不上。`MoveEventModule` 才是按「event 型別的定義 module」(`events`) 過濾，回 5 筆正確。
- **正確做法**：抓某 module 定義的事件型別 → `MoveEventModule`；抓某 entry module 的交易所發事件 → `MoveModule`。兩者語意不同，**別假設等價**。plan 的 calibration gate（first-run 對既有上鏈事件驗 filter 真的回得來）當場抓到，再次印證「runtime 假設一律 dry-run 校準」。
- **連帶**：parsedJson 的 u64 全是字串、`vector<u8>` 是 number[]（非 base64/hex）——都與設計假設一致，calibrate.js 一次驗完。

## 2026-06-21 — 棄用的 API 不必然比 beta 的差；選型看「核心機制可靠度」非「未來相容」
- **情境**：indexer ingestion 初選 GraphQL（理由：JSON-RPC「已棄用」這個未驗證文件假設）。
- **真相（review 實證）**：GraphQL `events` forward cursor backwards-oriented、跨輪詢無法可靠續傳 + 仍 beta schema 不穩 → poller 核心機制破功。被 signaled 棄用的 JSON-RPC `suix_queryEvents` 反而有原生可靠 `nextCursor {txDigest,eventSeq}`（同時就是 store 的 dedup envelope）。gRPC 正式接班但 `ListAuthenticatedEvents` 對普通 `event::emit` 涵蓋未證實。
- **正確做法**：3 層架構讓 ingest 可換 → 現在選「核心機制最可靠」的（JSON-RPC），把「戰略正確但未證實」的（gRPC）列 roadmap。別為「未來相容」賭上當下的核心可靠度。

## 2026-06-21 — SDK 大版本漂移：plan 寫的前端 API 可能已整包改名，實作前先撈 installed 型別
- **錯誤 pattern**：frontend plan（brainstorm+writing-plans 時）照 `@mysten/dapp-kit` 寫 provider 樹 + `useSignAndExecuteTransaction`/`useSuiClient` hooks。實際 install 的是繼任套件 `@mysten/dapp-kit-react` 2.x：**整包改名**、provider 改 `createDAppKit`+`DAppKitProvider`、**沒有那兩個 hook**（簽署改走 `dAppKit.signAndExecuteTransaction({transaction})` singleton），client 變 gRPC（`SuiGrpcClient`），交易結果是 `{$kind,Transaction,FailedTransaction}` discriminated union 帶 **gRPC `effects.changedObjects`（非 JSON-RPC `objectChanges`）**。
- **正確做法**：前端任務 dispatch 前先 (1) 跑 sui-frontend skill 確認當前套件名/API，(2) 直接 grep `node_modules/<pkg>/dist/*.d.mts` 撈真實 exports/簽名（本次靠它確定 sign 結果 union + `idOperation==='Created'`/`outputState==='ObjectWrite'` 字串）。plan 的前端 code 一律當「intent 草稿」不是「verbatim」；controller 在 dispatch prompt 裡明寫「brief 的 dapp-kit code 是 stale，用這組實測 API」，避免每個 subagent 重踩。
- **連帶校準**：`predict::create_manager` dry-run 確認**只建 1 個物件**（Shared PredictManager）→ 前端 positional MGR 抽取（`find(Created)`）無歧義，免做 type-assert 硬化。再次印證「runtime 假設一律 dry-run/型別實證」。

## 2026-06-21 — SDD orchestration：plan 的紙上前端 code 撞 SDK 漂移時，controller 要先校準再分派
- 8-task SDD 跑下來，前端 4 個 task（scaffold/mint/claim/auto-expiry）的 plan code 全因 dapp-kit 改版失準。**有效做法**：controller 在 Task 3 完成後，先自己撈出 2.x 的 sign API + 結果型別 + gRPC effects 形狀，寫進 ledger 的「API divergence note」，後續每個 dispatch 都帶這段 override → subagent 不用各自重新發現、也不會各寫一套。
- **headless 先行校準**：能 dry-run 的（create_manager 物件數、live expiry 枚舉、/quote 端到端 fail-loud）controller 先跑掉，把「只能瀏覽器錢包做的」縮到最小交給 human。Task 6（live round-trip）= 純人工，其餘全自動化驗證。

## 2026-06-24 — SDD fix subagent 可能「答非所問」：fixer 回報前一定查 git log 確認真的有 commit
- **情境**：payoff diagram SDD Task 6 的 review 開出 1 Important（React `key` 該放 `<Fragment>` 不是內層 `<tr>`）+ 1 Minor（cursor）。派 haiku fix subagent 去改，它回來卻吐出一份**load-progress 式的專案進度摘要**（誤觸 session workflow？），3 個 tool call、**完全沒改檔、沒 commit**。
- **抓到的方式**：不信 subagent 的「Done」自述，先 `git log --oneline -1`（tip 還是 c36a93d 沒動）+ `grep Fragment`（沒有）+ `git status`（working tree clean）→ 確認 fixer 根本沒做事。
- **正確做法**：(1) **fix subagent 回報後，controller 必驗 git 真有對應 commit**（log tip 變了沒、grep 改動點），別只看它的文字回報就 mark complete——這是 SDD 「fail loud」在 controller 層的落實。(2) 連續成功幾輪後的**單一 trivial 機械 fix**（3 行內、verbatim 指定），fixer 失敗一次就**直接由 controller 改**（讀檔→Edit→build→commit），不要無限 re-dispatch 同一個會迷路的 cheap model（呼應 dev-rules「同錯 3 次停手」）。(3) cheap model 跑「多步驟 + 要讀既有檔整合」時比「純 transcription」更容易迷路；fix-in-existing-file 這類任務 floor 拉到 mid-tier 或 controller 自理。
- **連帶**：這次也驗證了 SDD ledger + git log 是真實進度來源——subagent 的自述不可盡信，commit 才算數。

## 2026-06-24 — Move 空 struct 的 dynamic-field key 在 JSON-RPC 要帶 phantom `dummy_field`；live-run 才抓得到的兩個 runtime gap
- **背景**：payoff diagram 的 `/note-params` 用 `getDynamicFieldObject({ name: { type: '<pkg>::note::ParamsKey', value: {} }})` 讀 RangeParams。SDD 全程綠（測試用 stub）、final review 過，但**沒有 live note 可校準**，留為 deferred。使用者叫「run」才真接 testnet 跑。
- **抓到的真 bug 1（ParamsKey 編碼）**：`value: {}` 被 fullnode 拒 `-32602 "Missing field dummy_field for struct ...::note::ParamsKey {dummy_field: bool}"`。**Move 的空 struct（`struct ParamsKey has copy,drop,store {}`）編譯後有一個 phantom `dummy_field: bool`**，JSON-RPC 的 dynamic-field `name.value` 必須帶 `{ dummy_field: false }`。這對**所有** note 都會錯（與 alive 與否無關）——即 route 本來 100% 壞，但因 fail-loud 包成 error 而非壞資料。改對後 deleted note 回乾淨 `NO_PARAMS 404`。**教訓**：用空 struct 當 dynamic-field key 時，off-chain 讀取的 key value 不是 `{}`，是 `{ dummy_field: false }`。這種 encoding 假設**只有 live RPC 打得出來**，stub 測試永遠驗不到。
- **抓到的真 bug 2（CORS）**：indexer server 的 `json()` helper 從沒送 `Access-Control-Allow-Origin`。瀏覽器 dApp（vite :5173 → api :8787 跨源）**所有 fetch 被 CORS 擋**（leaderboard「Failed to fetch」、quote/note-params 同死）。先前 live demo 多半走 headless 整合腳本或只截 masthead（不打後端），所以這個 gap 一直沒被踩到。加 CORS header + OPTIONS preflight 後 leaderboard 才載入。
- **正確做法**：(1) 「純前端/純後端」feature 的 SDD build+invariant gate **驗不到跨源、RPC key-encoding 這種 runtime 整合層**——這些一定要**真的把整 stack 跑起來**（vite + server + 瀏覽器）才現形。能 headless 校準的（dynamic-field key、CORS header `curl -D -`）controller 在 deferred 解除時就該主動跑，別只等使用者。(2) deferred「fail-loud 兜底」是對的（錯不會給壞資料），但 fail-loud ≠ 功能對；「能達到」和「回對」是兩件事，後者要 live。(3) 呼應既有教訓「runtime 假設一律 dry-run/live 實證」——這次又驗證一次：紙上+stub 全綠騙不過 fullnode。

## 2026-06-24 — z-index 沒效果，第一件事查 computed `position` 是不是 static（別猜）
- **錯誤 pattern**：dapp-kit ConnectButton 帳號下拉被下方卡片蓋住。第一刀加 `.nl-masthead { z-index: 20 }`——**無效**，因為我假設 `.nl-section` 有給 `position: relative`（其實 `position: relative; z-index:1` 是 `.nl-app` wrapper 的，`.nl-section` 只有 opacity/transform/animation）。masthead = `position: static`，**static 元素的 z-index 完全被忽略**。連改兩次（先 z-index、又加重複 `.nl-connect` 規則）都沒中。
- **抓到的方式**：playwright `getComputedStyle(masthead)` 回 `z-index:"20" position:"static"` → 一眼看出 z-index 是死的。
- **正確做法**：(1) z-index 沒作用時，**第一步永遠是查該元素 computed `position`**——static 的話 z-index 無效，要先給 `position: relative/absolute/fixed`。(2) 改 stacking 前先確認「我以為提供 position 的那條規則」到底套在哪個 selector（`.nl-app` ≠ `.nl-section`），別靠記憶猜 CSS 來源。(3) web component（dapp-kit-core lit）的下拉在 shadow DOM 內 `position: absolute`，但它的 stacking 由 host 所在的 stacking context 決定——把 host 的祖先（masthead）做成 positioned + 高 z-index 就能整棵抬上去，不必鑽 shadow DOM。(4) 呼應既有教訓：CSS/視覺問題用 computed-style 探測實證，別靠讀 source 猜。
- **連帶（同日）**：純前/後端 SDD 驗不到的整合層 bug，要把整 stack 跑起來才現形——這次一口氣冒出 CORS（server 沒送 `Access-Control-Allow-Origin`，瀏覽器擋全部 fetch）、`/note-params` ParamsKey 需 `dummy_field:false`（Move 空 struct phantom 欄位）、z-index/position 三個，全是 live-run 才抓到。
