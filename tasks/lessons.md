# Lessons

## 2026-06-25 — Sponsored-tx：先用 keypair probe 證「機制」再投實作，但 probe 證不到「wallet 行為」；JSON-RPC execute 已被 P126 停用要走 gRPC；SDD final review 抓跨-task dead-phase
- **probe-before-implement 分清「機制」vs「wallet 行為」**：sponsored claim 押在「gRPC 雙簽 execute 真能上鏈」這個未驗機制上。brainstorming/plan 階段先用**兩把 keypair**（keytool sign，key 不離 keystore）建 `setGasOwner(sponsor)`+雙簽 tx、`grpc.core.executeTransaction` 真打 testnet→Success（digest `9ABVbVc6…`，Sender≠GasOwner）。**但 keypair 本質 verbatim 簽，證不到 C2「瀏覽器 wallet 會不會改寫 gasData」**——那只有真 wallet 能驗，仍 human-deferred。**教訓**：probe 能 de-risk「協議/SDK 機制」（C1），但凡「第三方 client(wallet)行為」的假設，headless probe 給的是假安心；要明確切開「機制已證 vs wallet 未證」，未證的用前端 byte-equality assert + fallback 兜底，不擋實作。
- **JSON-RPC `executeTransactionBlock` 已被 Protocol 126 停用（Quorum Driver，2026-07-31 永久關）**：plan-stage sui-architect 抓到 spec 寫的 execute 路徑會死。正解＝gRPC `client.core.executeTransaction({transaction:<Uint8Array>, signatures:[base64...], include:{effects}})`——方法在 `.core`（非 top-level）、`transaction` 要 **Uint8Array**（base64 string 會 throw）、結果是 union `{$kind:'Transaction'|'FailedTransaction', Transaction:{digest,effects.status}}`。dryRun 不受影響。**教訓**：寫鏈上 execute 一律確認走 gRPC 不走 JSON-RPC；API 形狀用 installed d.ts + probe 雙重釘死，別憑記憶。
- **SDD per-task review 看不到「跨 task 的 dead state」，final whole-branch review 才抓得到**：plan 自己寫的 `setClaimPhase('sponsoring'); setClaimPhase('awaiting-sign')` 同一 sync tick 連設→React 批次→'sponsoring' 永不 render，且 phase 轉換發生在 `sponsoredClaim` **內部**、parent 看不到→speced 4-phase 按鈕不可達。Task 4 implementer 主動 flag + reviewer 升為 Important。修＝給 `sponsoredClaim` 加 `onPhase` callback 外露轉換。**教訓**：一個函式「對外可觀測的狀態轉換」是它的 interface 一部分；plan 設計時若 UI 要反映子流程 phase，子流程函式就得吐 callback/event，別假設 controller 連設 state 能被看到（同 tick 批次）。
- **codex 對「diff 外的既有 guard」會誤報（再驗一次）**：codex --multi correctness+readability 都報「/sponsor-claim 沒檢查 client/txdeps→500」，實際 POST block 頂端 `server.js:153` 早已 `if(!client||!txdeps) return 503`，只是在 unchanged context 不在 diff 裡。**教訓**：codex 報「缺某防護」先 grep 既有檔案確認不在 diff 外，再決定真偽（呼應既有「codex finding 必對真 code 驗證」）。security lens 這次直接 LGTM，真 finding 都在 correctness（非物件 e deref：wallet 可能 reject 非 Error/null→`e?.code`/`String(e)` 守）。

## 2026-06-24 — Move 型別的 defining package address 跨 upgrade 不變，會漂移的是 runtime/latest id；type-check 別只做 suffix match（codex 抓到 auth bypass）
- **背景**：`/quote`+`/claim-tx` 加 `mgr→sender` owner guard。第一版用 `type.endsWith('::predict_manager::PredictManager')` suffix match，註解還寫錯理由「type 帶原始 addr 會 drift，所以只能 suffix」。
- **codex security finding（真）**：suffix match 讓攻擊者自部署 `xxx::predict_manager::PredictManager { owner: attacker }` 當 `mgr` 傳進來就過 guard → 繞過授權 fast-fail。
- **真相（live 實證）**：Move struct type 的 package address 是 **defining/original id**，模組首次發布時固定、**package upgrade 永不改它**。會漂移的是 runtime/latest id（config 的 `PREDICT`=`0xc8736…`）。正解**反過來**：完整 type 釘死成原始 defining addr（`0xf5ea2b37…::predict_manager::PredictManager`，跨 3 個 manager 物件查都一致）做 **exact match**——drift-proof 又防繞過。原本的 drift 顧慮方向完全顛倒。
- **正確做法**：(1) 鏈上 type 驗證一律 **exact full-type match**，addr 用該 type 的 defining id（從任一該型別物件 `getObject().data.type` 取、多物件交叉確認）；別 suffix-only。(2) defining addr 釘進 config 當單一來源（`PREDICT_MGR_TYPE`），別跟漂移的 runtime `PREDICT` 混用。(3) 寫安全 guard 註解前先確認「哪個值會變」——猜錯方向會把防護寫成漏洞。
- **連帶（dual-review）**：codex `--multi` 三 lens 同回。correctness 報的「no-client 503 regression」是 **false positive**（沒看到 `if(!client) return 503` 在 route branch 之上、該測試實際綠）→ 印證「codex finding 必對真 code/測試驗證」。唯一真 bug 出在 security lens，三路獨立召回率確較高。
- **驗證**：reject（foreign→403、非 manager→400）+ admit（真 owner→200 完整 quote）都對真 testnet manager `0x29f2…fda4` live 打過，不留 human-deferred。

## 2026-06-24 — UX batch：plan 的程式碼可能偏離自己的 spec，codex 在「邊界閾值 off-by-one + 假覆蓋的測試」上又補了一刀；plan-stage design review 抓到 keyframe 命名碰撞=真 bug
- **plan code ≠ spec，且 SDD 全程不會發現**：UX batch 的 `shortId` spec 明寫「`length <= head+tail+1` 原樣返回」，但 plan 我手寫成 `<= head+tail`，implementer 忠實照抄 plan。效果＝長度剛好 11 的 id（預設參數）會被「假截斷」成同長度的 `head…tail`（只丟 1 字 + 加 …，沒變短）。**5 道 SDD review + opus 全分支全綠**——因為大家對著 plan 驗，plan 自己就是錯的源頭。**dual-review codex R1（readability lens）一發抓到**，連帶指出 test 名稱宣稱覆蓋邊界、實際只測長度 6 和 2，**「假覆蓋」**。**教訓**：(1) spec→plan 轉寫時 controller 自己會引入偏差，per-task review 對 plan 驗不到「plan 偏離 spec」；**dual-review 是唯一拿 spec 當 ground truth 重驗的層**（呼應「內建 reviewer 不取代本流程」）。(2) 測試名稱宣稱的覆蓋要真的有對應 assertion——codex 會抓「test 名 vs test body 不符」，自己寫 plan 時邊界值要附具體 assertion 不能只寫個沒打到邊界的案例。(3) 這類 off-by-one 對真實 66-char id 永遠不觸發（無害），但仍是 spec 違反——**「實務無害」不等於「可以不修」**，修了 impl 才與 spec 一致、測試才誠實。
- **plan-stage design review 抓到 keyframe 命名碰撞（CSS 真 bug，非 taste）**：skeleton 原 spec 寫 `@keyframes nl-shimmer`，frontend-design review 在「還沒寫 code」時就指出 `nl-shimmer` 已存在 App.css（chart saturate shimmer），而 MyNotes **同時 import App.css + Leaderboard.css** → 第二個同名 keyframe 會 clobber chart 動畫。controller 當場 `grep @keyframes` 三檔證實=真碰撞，改名 `nl-skel-sweep`、寫進 spec 標 blocking。**教訓**：CSS 全域命名空間（keyframe/class/CSS var）的碰撞，凡「多個 stylesheet 被同一 component import」就要查重名；plan-stage review 在實作前抓到，省掉「動畫莫名失效」的 live debug。reduced-motion 規則同理一律「擴充既有 `@media` block」非新增（grep `prefers-reduced-motion` 確認每檔只 1 個 block）。
- **去 AI-slop 的具體手法（frontend-design review 主張）**：旋轉 ring spinner = 最明顯 AI tell → 換 brand 既有語彙（reuse `.nl-bubble` 珍珠漸層做 3 顆上升點 `nl-pearl`）；裸 `✕` close → 線條 SVG X 配既有 `.nl-li` icon family + pearl chip；skeleton 用 nacre 色（`--nacre` stops 漸層 sweep）非灰 pulse。**心法**：每個「通用 UI 元件」都先問「專案已有的手繪語彙能不能取代它」，能就別放預設 ring/grey-pulse/bare-glyph。molten 鈕上珍珠漸層看不見→改 `#3d1a28` 實色（兩 context 兩 fill）。
- **spec-compliance review 結構上看不到 adversarial 極端輸入**：chart-centerpiece 重設計跑了 7 道 per-task review（spec+quality）+ opus 全分支 review，全 APPROVED、全綠。但 dual-review 的 **codex R1（前景 wrapper）一發就抓到 `fmtExpiry(1e20)` → `new Date(ms).toISOString()` 丟 `RangeError` 讓 `<MetricRail>` render crash**——函式自己註解寫「null-safe / bad input em-dash」但沒守 finite-but-out-of-Date-range。**為什麼前面全漏**：per-task/whole-branch review 都是「對著 diff 驗合約與規格」，`Number.isFinite` 守了 NaN 就視為 null-safe 達標；沒人餵 `1e20` 這種「合法 number 但 Date 爆掉」的 monkey 輸入。**教訓**：SDD 的 spec-compliance review ≠ adversarial fuzz；凡「對外部/使用者輸入做轉換」的純函式（date/number/string parse），dual-review 的 codex（或 project test.md 的 monkey testing）是專門補這個洞的層，**不能因為 SDD 全 APPROVED 就跳過 dual-review**（dev-rules 明寫「內建 reviewer 不取代本流程」，這次正是活證）。修法＝`new Date()` 後 `Number.isNaN(date.getTime())` 守 + 補 `1e20`/`-1e20` 測試。
- **動畫序列「無到有」要靠真動畫迭代，截圖判不出來**（延續 06-23 教訓）：shimmer 一開始設「入場結束才起」，使用者在 companion 真動畫看到「填色先全顯示→突然消失→才 shimmer」的跳變，當場改成「填色入場 opacity 0 → 階梯畫完才從 0 淡入 → 接 shimmer」。**關鍵**：companion 能跑真 CSS 動畫 + replay 鈕，是調動畫時序的對的工具；用文字描述或單張截圖永遠調不出「不流暢」這種只有動起來才現形的問題。shimmer 放 gradient stop-opacity（或 fill 的 filter:saturate）跟「淡入 opacity」分屬不同屬性才不打架。
- **plan-stage design review（plan 前跑）便宜又抓得準**（延續教訓，再驗一次）：chart 重設計在「spec 寫好、還沒寫任何 code」時跑 sui-frontend + frontend-design 兩路，抓到「chart maxWidth:480 cap 會讓 hero 變小圖、rail 反成主角」「6 白卡＝雙倍 3-card slop」「hero 沒 un-gate 會靜默丟失第一眼價值」「ConnectButton 進 overflow column 會 clip dropdown」等——全 patch 進 spec，7 個 SDD subagent 照抄即正確。taste reviewer 也會算錯（聲稱 molten+plum 3:1 fail，實算 6.7:1 過）→ **review findings 含數值斷言時自己複算，別照單全收**。

## 2026-06-24 — leftover spike：先 live 校準才設計（balanceChanges/balance() 都被現場證偽）；SDD 跨檔「dead-code 可達性」缺口只有 final cross-cutting review 抓得到
- **「先校準再設計」省整份 spec 重寫**：B-leftover 的機制押在未驗鏈上行為，brainstorming 第一個 action 就是 live devInspect/dryRun 探測，**沒寫任何 code**。當場推翻 progress 寫死的兩個假設：(1) `balanceChanges` 只回 `−notional`（sender-level coin 變動，BalanceManager 內部 `Balance<T>` bag 不是 Coin 物件 → 永不露 premium）；(2) live `predict_manager::balance()` 雖 devInspect 可呼叫（Public/回 u64）但 **time-dependent**——對 settled note 回 cap（ITM 贖回灌回），非 mint-time floor。最終定案＝**`leftover = net − Σ PositionMinted.cost`**（mint tx events，immutable）。**教訓**：外部協議整合，凡「未驗鏈上機制」一律 brainstorming 階段先 headless 實證；紙上推測（連 progress 自己寫的）都可能錯，fullnode 是唯一裁判。`PositionMinted.cost` 直接帶 premium，不用 ask_price×qty 推。
- **live 校準的「異常值」常是規格在說話**：第一次 devInspect balance 回 15.04 > net 9.97「不可能」，差點當 bug——其實 15.04 = cap（該 note 全 ITM 結算、16 legs 全贖回），`leftover 5.07 + qty 623125×16 = 15.04` 完美對上。**異常先別判 bug，先把它跟已知量（net/cap/payout）對帳**，對上了就是規格沒讀懂而非資料錯。
- **SDD final cross-cutting review 抓到 per-task review 結構上看不到的缺口（I1）**：Task 4（backend `/note-params` 對 claimed note 從 events 重建 staircase）和 Task 5（frontend MyNotes 接線）各自 review 都過、各自正確；但**接縫斷掉**——MyNotes 只對 `state !== 'settled'` 的列開展開，所以 settled note 永遠不會呼叫 `/note-params`，Task 4 的重建分支**prod 不可達 = dead code**，spec 明寫的「claimed 也畫圖」沒交付。**教訓**：per-task review 看單 task diff，**跨 task 的「產出物有沒有被呼叫到」只有 whole-branch review 看得到**——final review 不可省，且要明確要它查「整合接縫 / 有沒有 task 的產出在 prod 不可達」。修法＝拿掉 3 個 `state !== 'settled'` 守衛。
- **df-gone 重建路徑用「鏈上 settled payout」做終極交叉驗證**：Task 4 的重建分支單元測試只跑 stub。解除 deferred 時 controller 直接 curl 兩個**真 claimed note**：0xc03e（全 OTM）leftover 5240530 = db payout 5240530 EXACT；0x9d56（1 ITM）leftover 7674254 + qty 3323333×1 = 10997587 = db payout EXACT。**leftover 公式 + staircase 數學 + 重建路徑一次全驗，且對到鏈上已實現 payout**——比任何 stub 測試強。**教訓**：能拿「鏈上已結算的真實數字」當 oracle 對帳時，就別只信 stub；settled note 的 payout 是現成的 ground truth。
- **SDD fix subagent 回報後 controller 必驗 git diff**（延續既有教訓）：每個 implementer/fixer 回 DONE 後，controller 都 `git show <sha>` 看真 diff（不只信文字回報）——這次 haiku/sonnet 全程誠實，但 Task 4 fixer 主動抓到我 brief 裡的算術 slip（fixture 第二 strike 差 1e9 但斷言 step 1e12 → 改 63812e9）並修正，證明「brief 也會錯，implementer 該照邏輯校正而非盲抄」。

## 2026-06-24 — 前端傳給 oracle 的「asset」要是 underlying（BTC）不是產品類型；硬寫 gasBudget 會「預留」SUI 害低餘額錢包 InsufficientGas；改 SQL schema 後 server 不重啟不生效
- **Bug 1（claim 全壞）**：MyNotes 用 `n.strategy || 'BTC'` 當 oracle lookup 的 asset，但 `n.strategy` 解碼是**產品類型 `range_accrual`**，而 `resolveOracle` 比對的是 `registry::OracleCreated.underlying_asset`(="BTC")→ claim 噴 `no oracle for asset=range_accrual`。同 bug 也讓 `/note-params` 的 forward 讀靜默失敗（被 try/catch 吞，圖少紅虛線）。**教訓**：oracle 是用「定價標的」keying，不是用 note 的 strategy 欄。notes table 沒存 underlying（hackathon 全 BTC）→ 用常數 `UNDERLYING='BTC'`，別把 strategy 名拿去當 asset。
- **Bug 2（mint 第二簽 InsufficientGas）**：`buildMintTx` 寫死 `setGasBudget(2 SUI)`。dapp-kit 簽署時 budget = 需要錢包持有 ≥ budget 的 gas coin **預留**，所以 free SUI <2 即 `InsufficientGas`，即使實際 16-leg mint 只花 ~0.5 SUI、錢包「看起來還有錢」。**教訓**：前端 PTB 別硬寫過大 gasBudget——交給 dapp-kit dry-run 估算（leave unset，跟同檔 `buildCreateManagerTx` 一致）。硬寫的高 budget 是「預留下限」不是「上限花費」，會誤殺低餘額錢包。CLI 腳本要自己 setGasBudget（不靠 wallet 估算）則另設。
- **Bug 3 連帶（為何 PnL 看不到）**：改了 `queries.js listNotes` 多 SELECT 兩欄，但 **`server.js` 啟動時就 import 了 queries.js**——舊 server process 還在跑舊 SQL，`/notes` 不回新欄位。`lsof -ti :8787` 發現舊 process 還佔 port（我的 `ps | grep` pattern 沒抓到）。**教訓**：改任何 server 啟動時 import 的模組（query/schema/route），**必須 kill 舊 process 重啟**才生效；驗證「沒在跑」用 `lsof -ti :<port>` 比 `ps|grep` 可靠。
- **驗 data-path 用 DB 直查**：PnL「沒顯示」先別怪前端——`node -e "require('better-sqlite3')..."` 直查 settlements 確認 `payout` 真的在（10997587），把「資料缺」vs「顯示 bug」vs「server 沒重啟」三者分離。better-sqlite3 在 `scripts/indexer/node_modules`，要 `cd scripts/indexer` 跑。
- **InsufficientGas ≠ 真缺 gas**：使用者錢包 14.4 SUI 還是 InsufficientGas。`getBalance` 查到**只有 1 顆 SUI coin** = 關鍵。mint 是連續兩簽（PTB1 create_manager → PTB2 mint），PTB1 花掉唯一 coin 後，PTB2 gas 估算拿到舊版本 coin → 錢包誤報 InsufficientGas。**教訓**：報 InsufficientGas 先 `getBalance`+`getCoins` 看「總額 vs coin 數」；單一 coin 連續多簽是常見狀態競爭來源，不是真缺錢。修法＝兩簽間插 `client.waitForTransaction({digest,timeout})` 等前一筆 index 完。

## 2026-06-24 — 現建的 shared object 不能在同一 PTB 當 shared input（PTB 不可合併的硬限制）；跨 PTB 狀態縫用 best-effort waitForTransaction 硬化
- **PTB1+PTB2 可否合併？不行**，兩個獨立 Move/Sui 硬限制：(1) `predict::create_manager(ctx): ID` **只回傳 ID 且內部直接 `share_object`**，caller 拿不到物件 handle；(2) `note_factory::mint_begin` 吃 `&mut PredictManager`（shared object），而 **Sui 鐵則：同一 PTB 內「現建的 shared object」不能在同 PTB 被當 shared-object input**（shared 版本要在 consensus 排程階段、執行前確定，但 manager 要等該 tx 執行**結束**才真 shared）。(3) 連帶：strike band 報價靠對**真實 manager** dry-run probe，manager 不先存在也 probe 不了。**教訓**：要判斷「能不能合 PTB」先查兩件事——上游 fun 是回物件還回 ID/內部 share？目標 fun 吃 owned 還 shared？吃 shared 就一定拆兩步。別空想合併。
- **跨 PTB 縫的硬化 pattern（best-effort，非正確性依賴）**：兩簽之間插 `client.waitForTransaction({digest, timeout})` 等前筆 index。**5 個防禦不可少**：無 digest→守衛跳過、wait hang→`timeout` 上限、**wait 拋錯但前筆已成功→try/catch 吞掉繼續，絕不 re-throw**（re-throw 會丟棄已上鏈的 manager → orphan + 逼重建）、client 用 wallet 同源（`useCurrentClient()` 取 dapp-kit gRPC client，別自建怕指錯網）、重複 wait idempotent。**核心心法**：硬化步驟失敗時 fall-through，不能讓「優化」變成「新的失敗點」。
- **dapp-kit-react 2.x 取 client**：`useCurrentClient()` 回 `SuiGrpcClient`（專案用 gRPC 非 JSON-RPC），有 `waitForTransaction({digest, timeout, pollSchedule})`。傳進純邏輯模組時用 optional + `client?.waitForTransaction &&` 守衛，保持模組可測（無 client 也能跑）。

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
