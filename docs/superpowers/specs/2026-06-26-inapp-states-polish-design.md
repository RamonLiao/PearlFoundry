# Spec B — In-app empty / loading / error 插圖 polish

**Date:** 2026-06-26
**Type:** Frontend, presentation-layer only (zero business-logic / contract / schema change)
**Status:** Design approved + 2-route plan-stage review integrated, pending plan

## Goal

把現有的「珍珠吉祥物 / nacre」視覺語彙從**空狀態**（MyNotes / Leaderboard 已有 duotone mascot）延伸到剩下三類未經處理的狀態：**error**、**pre-connect**、**loading**。目標是消除裸 `<p>` 文字狀態與旋轉環式 AI-slop，讓每個狀態都用品牌語彙。

四個插入點，全部在範圍內。

## Background — 現況（待改）

| 項 | 現況 | 檔案/位置 |
|---|---|---|
| error 插圖化 | 裸 `<p className="nl-error">{msg}</p>` 與 `<pre className="nl-status--err">` | `App.jsx` (`mintPhase==='error'`)、`MyNotes.jsx` (`paramsCache[id].error`、`msg`)、`Leaderboard.jsx` (`msg`) |
| pre-connect 歡迎 | `<button disabled>Connect to mint</button>`（無插圖） | `App.jsx` hero 的 `account ? … : (…)` else 分支 |
| expanded-row 載入 | `<p className="nl-note">Loading payoff…</p>` | `MyNotes.jsx` 展開列 paramsCache 未就緒分支 |
| 全站首屏 loading | 無（Leaderboard 自有 skeleton，但 React mount 前白屏） | `index.html` / `main.jsx` |

既有可 reuse 的語彙：`Mascot` component（`MASCOT_VARIANT` JOYFUL/SHOWY/SERENE、treatment duotone/full）、`nl-skel-sweep` keyframe（nacre 摩光 skeleton，06-24 建，定義在 Leaderboard.css:80）、line-SVG icon family（`.nl-li`）、單一 `@media (prefers-reduced-motion)` block per 檔。

## 設計決策（brainstorming 定案 + 2-route review 整合）

> 標記說明：【design X】＝frontend-design taste review；【sui X】＝sui-frontend 整合 review。所有 finding 已對真實 code 驗證（main.jsx 同步 render 寫法、index.html 無 viewport、`.nl-error` 僅在 Leaderboard.css 定義兩次、`.nl-skel` 為 11px strip 皆屬實，無 false positive）。

### 1. Error 狀態 — 「裂殼」line glyph（無吉祥物）

**為什麼不放吉祥物**：現有 3 個變體全是開心 kawaii 珍珠，沒有難過/皺眉版。錯誤旁放笑臉珍珠＝tone-mismatch slop。CSS 把笑臉硬調成「難過」（desaturate / rust-wash）在 companion 比較後判定為勉強。→ 改用中性的手繪裂殼 line glyph，零 tone-mismatch、且融入既有 line-SVG icon family。companion 已選定**裂殼裂開動畫版（A）**而非破浪版（B）。

- **新 component `frontend/src/ErrorState.jsx`**：rust 左邊框卡片（`border-left:3px var(--rust)`）+ 動畫裂殼 SVG + 文案。
  - props：`{ title?='Something went wrong', message, compact?=false }`（`message` 為既有錯誤字串，原樣顯示，含 sponsored `[CODE]` brackets 等動態尾綴）。
  - SVG＝珍珠貝殼上下兩半 + 中央裂縫，全 `stroke="var(--rust)"`，`aria-hidden`。
  - **【design C2】glyph 保持「小 + 純線條」，禁套 mascot 的 `nl-pearl-well` 圓底/well 輪廓**——well 是吉祥物的招牌剪影，error glyph 借用會被讀成「難過版吉祥物」＝正是要避的 slop。
  - **【design M3 — 修既有 WCAG 債】**`--rust #cc6a4f` on white ≈ **3.1:1，fail AA 正文**（既有 `.nl-error` 已帶此債）。→ **錯誤訊息文字用深 ink `--pearl` `#3a3340`（≈10:1）**，`--rust` 只用在 **border + glyph stroke + 粗體 title**（非文字圖形 3:1 門檻過）。error 卡片一律落在白 `--obsidian-raised`（rust 在頁底 `--obsidian` 上 ≈2.9:1 不足 3:1）。
- **動畫（on-mount，一次性）**：上半殼上移微 rotate、下半殼下移微 rotate、裂縫 `stroke-dashoffset` draw-in。**【design I1】砍掉整卡 horizontal nudge（＝最 cliché 的 error shake，破壞精緻調性）**；位移極小（殼半 ≤2–3px、rotate ≤2°）。timing：裂縫 draw-in ~350ms ease-out、殼半分開 ~300ms（top 先 ~60ms stagger），總 settle ≤500ms，靜止（過 WCAG 2.2.2 無無限動畫）。
- **reduced-motion**：gate 成靜態（殼半就定位、裂縫 `dashoffset:0`）。**擴充既有 reduced-motion block（App.css:211）**，不新增。
- **取代點（3 處 → 實為 4 site，【sui C2】MyNotes 有兩個獨立 error site）**：
  - `App.jsx` `mintPhase==='error'`（line 229，`nl-hero` flow 內）：`<p className="nl-error">{mintErr}</p>` → `<ErrorState message={mintErr} />`（非 compact）
  - `MyNotes.jsx` **line 282** 展開列 `paramsCache[id].error`（在 `<td colSpan={4}>` 內）：→ `<ErrorState compact message={…} />`（**必須 compact**，否則 border-left+glyph 撐高列＝reflow）
  - `MyNotes.jsx` **line 298** `{msg && <pre className="nl-error">…}`（在 `</table>` **之後**，flow-level）：→ `<ErrorState message={msg} />`（非 compact）
  - `Leaderboard.jsx` **line 60** `{msg && <pre className="nl-error">…}` → `<ErrorState message={msg} />`（非 compact）
- **compact 變體（【design I2】altitude 編碼嚴重度：row-level < section-level）**：明顯更輕——單行、glyph ≤16px、compact 尺寸下可去掉 left-border（只留 rust glyph + ink 文字），避免「滿屏 rust 卡＝一片警報」（三處 error 可能同屏：App hero + MyNotes 展開列 + MyNotes 表底 msg）。
- **scope 邊界 / cleanup**：**不動** `nl-status--ok`（成功 pre）與 `nl-status` 中性狀態，只換 error 路徑。**【sui I1】替換完 `.nl-error` 在 Leaderboard.css（line 22 + line 67 重複定義）零 caller → 兩塊一併刪除**（消除既有重複規則混亂）。

動畫 keyframes 寫進 `App.css`（全域 sheet）。**【sui I3】裂殼 keyframe 命名（如 `nl-crack-draw`/`nl-shell-top`/`nl-shell-bot`）實作後 grep 確認不撞現有**（現有：`nl-reveal`/`nl-section-in`/`nl-mast-float`/`nl-caustic`/`nl-rise`/`nl-statuspip-pulse`/`nl-fillin`/`nl-shimmer`，均不撞）。`ErrorState` import `App.css` token；自身結構樣式放 App.css 對應區塊（`nl-` 前綴）。

### 2. Pre-connect 歡迎 — 揮手珍珠

- `App.jsx` hero else 分支（未連錢包，line 208）：disabled「Connect to mint」鈕**旁**放 `Mascot` + 一句 `Connect your wallet to begin`。
- **【design C1 — 改 brainstorm 初稿】用 `treatment="duotone"` + 縮小 `size≈56`（非 full、非 72）**。理由：全站吉祥物都是 duotone-toned-into-palette；pre-connect 放 `treatment="full"` 全彩 raster 會成為全屏最亮物件，而它旁邊是 disabled（低對比）鈕＝「不能按的東西最亮、真 CTA 反而退場」的對比倒置，且和 duotone 系統撞色（M3 muddiness）。`full+glow` **保留給 mint 慶祝**那唯一時刻（Mascot.css 註解既有意圖），不在此處花掉。
- **【design C1】文案為視覺主角**：`Connect your wallet to begin` 領銜，disabled 鈕降為 hint 質感，避免「mascot ‖ text ‖ dead button」三元素同 altitude 互搶。
- 「揮手」＝輕微 tilt/wiggle keyframe `nl-wave`。**【design M2】有限次（`animation-iteration-count: 2`，揮 2–3 下後 rest）**勝過無限狂晃，且避免多狀態同屏時的躁動；若必須 loop 則 ≤3°、≥2.5s 極慢低幅。reduced-motion gated。
- **【sui I2】`nl-wave` wrapper 顯式 `display:inline-block`（或 block），不靠 `<span>` 預設 inline 跑 transform**（inline box transform 跨瀏覽器在換行時不穩）。Mascot 本體輸出 `<span>`（inline-grid well），wrapper 包它。
- 不新增區塊、不打斷既有 hero 圖表解說結構；只在 else 分支內加 mascot + 文案 + 既有 disabled 鈕。

### 3. Expanded-row 載入 — 圖表狀 nacre skeleton

- `MyNotes.jsx` 展開列、`paramsCache[id]` 尚無 `curve`/`error` 時：`<p>Loading payoff…</p>` → **圖表輪廓 skeleton**。
- **reuse 既有 `nl-skel-sweep`** nacre 摩光**動畫 class**（不新增 keyframe，避免命名碰撞——見 06-24 lesson）。
- **【sui C1 — 關鍵】不要直接套 `.nl-skel`**：`.nl-skel`（Leaderboard.css:72）是 `height:11px` 細條 cell strip，套上去只會得到 11px 條不是圖表。→ skeleton 自設明確尺寸（`aspect-ratio: 420/250` + `max-width:100%`，match `PayoffChart size="full"` 420×250 intrinsic），`nl-skel-sweep` 只當 sweep 動畫疊上。若抽 `ChartSkeleton.jsx` component，base 元素**不得** extend `.nl-skel`。
- skeleton 尺寸 match `PayoffChart size="full"` 外框，使 skeleton→chart 切換**不 reflow**。
- **【design I3】形狀要像「這張圖」不是長條 bar chart**：PayoffChart 是 payoff **階梯線**，skeleton 用「淡 axis L-frame + 單條 nacre-swept 階梯路徑（暗示 payoff kink）」，套在 path/clipped shape 上，**不是垂直長條**——否則 swap 像 bait-and-switch。
- sr-only `role="status"` 「Loading payoff…」保留給螢幕報讀。

### 4. 全站首屏 — 極簡珍珠脈動

- `frontend/index.html` 內 `#nl-boot`：純 inline HTML/CSS（**不依賴 JS/React/外部 CSS**，因為這正是 React mount 前的瞬間），居中 logo（`/logo-mark.png` 或既有 mark）。`#nl-boot` 放在 `<div id="root">` **之後**（sibling，供下方 CSS 防呆 selector 可達）。
- **【design M1 — 去 slop】不要脈動 logo 本身**（pulse logo ＝最 default 的 AI loading treatment）。改成 **logo 靜態清晰、背後一圈 nacre 光環/halo 脈動**（`::before` radial-gradient 做 opacity+scale），呼應 `nl-pearl-well` 的徑向語彙；脈動週期 **≥1.6s（慢＝沉穩＝premium；快脈動＝焦慮＝generic）**。
- **移除時機（fail-loud）—【sui C3 修正】**：`createRoot().render()` 在 concurrent mode 是**非阻塞**的，緊接著 `.remove()` 會在首次 commit/paint **之前**移除 → 閃一段空白 `#root`，比現狀更糟。正解＝**`ReactDOM.flushSync(() => root.render(...))` 強制同步 flush 後再 `document.getElementById('nl-boot')?.remove()`**（或把 remove 放 `App`/route 頂層的 `useEffect`，commit 後才跑）。spec 原寫「render 後同步移除」對 concurrent mode 是錯的。
- **【design M4 / sui — 雙保險】**再加一道 CSS：`#root:not(:empty) ~ #nl-boot { display:none }`（`#nl-boot` 須在 `#root` 之後 sibling 才可達）。「splash 卡死永遠遮畫面」嚴格比「沒 splash」差，一條規則值得。
- **【sui m3】`index.html` 補 `<meta name="viewport" content="width=device-width, initial-scale=1">`**（現缺；`#nl-boot` 用 `position:fixed` 居中，無 viewport meta 在手機 layout viewport 會錯位。亦修既有缺漏）。
- inline CSS 含 `prefers-reduced-motion` → halo 脈動關閉、靜態居中 logo。
- 內聯 critical CSS 控制在極小（避免拖慢首次 paint，與「治白屏」目的矛盾）。

### 共同約束

- 所有新動畫**單一 reduced-motion block 擴充**（grep `prefers-reduced-motion` 確認每檔僅 1 個 block）；`index.html` 的 boot 自帶獨立 inline block（無法 reach App.css）。
- 吉祥物一律 `MASCOT_VARIANT` 具名常數，禁 `variant={1}` magic number。
- error glyph 走既有 line-SVG icon family（`stroke=currentColor`/token、`aria-hidden`、`stroke-linecap/join=round`）。
- 去 AI-slop：禁旋轉 ring spinner、禁灰 pulse 方塊、禁裸 emoji glyph。既有 busy loader 是 3-dot `nl-spinner`（非 ring）——新狀態不得引入更吵的視覺語彙。

## Components / 介面

| Unit | 職責 | 介面 | 依賴 |
|---|---|---|---|
| `ErrorState.jsx` | 統一錯誤呈現（裂殼 glyph + 文案 card） | `{title?, message, compact?}` | App.css token + keyframes |
| `Mascot.jsx`（既有，**不改**） | pre-connect 揮手（新 `nl-wave` 加在 consumer 端 inline-block wrapper，不改 Mascot 本體） | 既有 props | — |
| MyNotes expanded skeleton | 圖表狀載入佔位（自設 aspect-ratio，不 extend `.nl-skel`） | inline markup（或小 `ChartSkeleton`） | `nl-skel-sweep` 動畫 |
| `#nl-boot`（index.html + main.jsx flushSync remove + CSS 雙保險） | 首屏 halo 脈動 + 移除 | DOM id 約定 | 無（純 HTML/CSS） |

> `Mascot` 本體**不改**：揮手是 consumer 端 wrapper 的 `nl-wave` class，保持 Mascot 對其他 caller（空狀態 / mint 慶祝）byte-unchanged。

## 資料流 / 錯誤處理

- 全部 read-path / presentation。無新 fetch、無新狀態機分支。
- error message 為既有錯誤字串透傳，`ErrorState` 不解析、不重寫 code 尾綴（誠實 fail-loud 不變）。
- `#nl-boot` 移除失敗的唯一風險＝遮畫面 → `flushSync` 同步移除（主）+ `#root:not(:empty) ~ #nl-boot{display:none}`（雙保險）。

## Testing

依專案既定（06-26 lesson 校正）：**harness 是 `node --test`（node:test）純 JS，無 jsdom / RTL / vitest**，全專案 `.test.js` 只測純函式。本任務純 presentation，**無新增可單測的純邏輯**。

驗收 gate：
1. `vite build` green。
2. **branch-wide `git diff` 零-logic 不變式**：證明 `api.js` / `mint.js` / `config.js` / `dapp-kit.js` / `main.jsx`（除 `flushSync` 包裹 + `#nl-boot` remove）/ 合約 / indexer schema **byte-unchanged**（encode「這是純 presentation polish」的 why，符合 Rule 9）。
3. `Mascot.jsx` byte-unchanged（揮手在 consumer wrapper）。
4. **render = human-deferred browser pass**（sandbox 無錢包，本專案每個前端任務既定慣例）：裂殼動畫 on-mount + reduced-motion 靜態、揮手珍珠（duotone 56px）、expanded skeleton→chart 不 reflow 且形狀像階梯線、首屏 halo 脈動出現且 mount 後消失、hard-refresh 不殘留 boot、rust error 文字用 ink 不再 fail AA。`cd frontend && npm run dev`。

> 若 plan 階段拆出任何純 helper（如 boot-remove 的純函式、skeleton 尺寸常數），則補對應 `node --test`。預設無。

## 非範圍（YAGNI）

- 不新增吉祥物表情變體（無難過版＝採 line glyph 規避）。
- 不改任何成功/中性狀態樣式。
- 不動 ConnectButton wallet modal（dapp-kit-react 2.x 無 theme prop，沿用既有限制）。
- 不做 toast / 全域通知系統。

## 風險 / 開放項（plan 階段定）

- `nl-wave` 揮手強度：採有限次 2 cycle（M2）；plan 給具體 keyframe timing。
- `#nl-boot` flushSync vs `useEffect` 移除二選一（兩者皆正確，plan 擇一）+ CSS 雙保險 selector 須驗 `#nl-boot` 在 `#root` 後可達。
- expanded skeleton 是否抽 `ChartSkeleton.jsx` vs inline——視 markup 複雜度，plan 決定。
- `ErrorState` compact 變體去 left-border 是否足夠輕，human browser pass 時複核。
