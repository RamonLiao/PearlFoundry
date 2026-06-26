# Spec B — In-app empty / loading / error 插圖 polish

**Date:** 2026-06-26
**Type:** Frontend, presentation-layer only (zero business-logic / contract / schema change)
**Status:** Design approved, pending plan

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

既有可 reuse 的語彙：`Mascot` component（`MASCOT_VARIANT` JOYFUL/SHOWY/SERENE、treatment duotone/full）、`nl-skel-sweep` keyframe（nacre 摩光 skeleton，06-24 建）、line-SVG icon family（`.nl-li`）、單一 `@media (prefers-reduced-motion)` block per 檔。

## 設計決策（brainstorming 定案）

### 1. Error 狀態 — 「裂殼」line glyph（無吉祥物）

**為什麼不放吉祥物**：現有 3 個變體全是開心 kawaii 珍珠，沒有難過/皺眉版。錯誤旁放笑臉珍珠＝tone-mismatch slop。CSS 把笑臉硬調成「難過」（desaturate / rust-wash）在 companion 比較後判定為勉強。→ 改用中性的手繪裂殼 line glyph，零 tone-mismatch、且融入既有 line-SVG icon family。

- **新 component `frontend/src/ErrorState.jsx`**：rust 左邊框卡片（`border-left:3px var(--rust)`）+ 動畫裂殼 SVG + 文案。
  - props：`{ title?='Something went wrong', message, glyph?=true }`（`message` 為既有錯誤字串，原樣顯示，含 sponsored `[CODE]` brackets 等動態尾綴）。
  - SVG＝珍珠貝殼上下兩半 + 中央裂縫，全 `stroke="var(--rust)"`，`aria-hidden`。
- **動畫（on-mount，一次性）**：上半殼上移微 rotate、下半殼下移微 rotate、裂縫 `stroke-dashoffset` draw-in、整體一次 horizontal nudge。約 0.5s，settle 後靜止（過 WCAG 2.2.2，無無限動畫）。
- **reduced-motion**：gate 成靜態（殼半就定位、裂縫 `dashoffset:0`）。**擴充既有 reduced-motion block**，不新增。
- **取代點**：
  - `App.jsx` `mintPhase==='error'`：`<p className="nl-error">{mintErr}</p>` → `<ErrorState message={mintErr} />`
  - `MyNotes.jsx` 展開列 `paramsCache[id].error`：→ `<ErrorState message={…} />`（compact 變體，見下）
  - `Leaderboard.jsx` `{msg && <pre className="nl-error">…}` → `<ErrorState message={msg} />`
- **compact 變體**：expanded-row 空間窄，`ErrorState` 支援 `compact` prop（縮小 glyph + 單行）以免撐高列。
- **scope 邊界**：**不動** `nl-status--ok`（成功 pre）與 `nl-status` 中性狀態，只換 error 路徑。`nl-error` class 若無其他 caller 可清，否則保留。

動畫 keyframes 寫進 `App.css`（全域 sheet）。`ErrorState` import `App.css` 既有 token；自身結構樣式可放 App.css 對應區塊（沿用既有 `nl-` 前綴慣例）。

### 2. Pre-connect 歡迎 — 揮手珍珠

- `App.jsx` hero else 分支（未連錢包）：disabled「Connect to mint」鈕**旁**放全彩 `Mascot variant={MASCOT_VARIANT.JOYFUL} treatment="full"` + 一句 `Connect your wallet to begin`。
- 「揮手」＝輕微 tilt/wiggle keyframe `nl-wave`（小角度來回，非無限狂晃；可設有限次或極輕慢無限——以不喧賓奪主為準，實作時取 companion 已驗的輕度），reduced-motion gated。
- 不新增區塊、不打斷既有 hero 圖表解說結構；只在 else 分支內加 mascot + 文案 + 既有 disabled 鈕並排。

### 3. Expanded-row 載入 — 圖表狀 nacre skeleton

- `MyNotes.jsx` 展開列、`paramsCache[id]` 尚無 `curve`/`error` 時：`<p>Loading payoff…</p>` → **圖表輪廓 skeleton**。
- **reuse 既有 `nl-skel-sweep`** nacre 摩光動畫（不新增 keyframe，避免命名碰撞——見 06-24 lesson）。
- skeleton 尺寸 **match `PayoffChart size="full"`** 的外框，使 skeleton→chart 切換**不 reflow**（同表結構穩定）。
- 形狀：階梯輪廓暗示（幾條漸升的 placeholder bar / 軸線灰條），非 generic 灰塊。
- sr-only `role="status"` 「Loading payoff…」保留給螢幕報讀。

### 4. 全站首屏 — 極簡珍珠脈動

- `frontend/index.html` 內 `#nl-boot`：純 inline HTML/CSS（**不依賴 JS/React/外部 CSS**，因為這正是 React mount 前的瞬間），居中 logo（`/logo-mark.png` 或既有 mark）+ 輕脈動（scale/opacity 緩動）。
- **移除時機（fail-loud）**：`main.jsx` 在 `root.render(...)` 後移除 `#nl-boot`（`document.getElementById('nl-boot')?.remove()`）。**必須保證移除**，否則 splash 永久遮畫面＝比沒做還糟。移除邏輯放在同步 render 之後即可（dapp-kit provider 同步掛載）。
- inline CSS 含 `prefers-reduced-motion` → 脈動關閉、靜態居中 logo。
- 內聯 critical CSS 控制在極小（避免拖慢首次 paint，與「治白屏」目的矛盾）。

### 共同約束

- 所有新動畫**單一 reduced-motion block 擴充**（grep `prefers-reduced-motion` 確認每檔僅 1 個 block）；`index.html` 的 boot 自帶獨立 inline block（無法 reach App.css）。
- 吉祥物一律 `MASCOT_VARIANT` 具名常數，禁 `variant={1}` magic number。
- error glyph 走既有 line-SVG icon family（`stroke=currentColor`/token、`aria-hidden`、`stroke-linecap/join=round`）。
- 去 AI-slop：禁旋轉 ring spinner、禁灰 pulse 方塊、禁裸 emoji glyph。

## Components / 介面

| Unit | 職責 | 介面 | 依賴 |
|---|---|---|---|
| `ErrorState.jsx` | 統一錯誤呈現（裂殼 glyph + 文案 card） | `{title?, message, compact?, glyph?}` | App.css token + keyframes |
| `Mascot.jsx`（既有） | pre-connect 揮手（新 `nl-wave` 加在 consumer 端 wrapper，不改 Mascot 本體） | 既有 props | — |
| MyNotes expanded skeleton | 圖表狀載入佔位 | inline markup（或小 `ChartSkeleton` 視 plan 決定） | `nl-skel-sweep` |
| `#nl-boot`（index.html + main.jsx remove） | 首屏脈動 + 移除 | DOM id 約定 | 無（純 HTML/CSS） |

> `Mascot` 本體**不改**：揮手是 consumer 端 wrapper 的 `nl-wave` class，保持 Mascot 對其他 caller（空狀態 / mint 慶祝）byte-unchanged。

## 資料流 / 錯誤處理

- 全部 read-path / presentation。無新 fetch、無新狀態機分支。
- error message 為既有錯誤字串透傳，`ErrorState` 不解析、不重寫 code 尾綴（誠實 fail-loud 不變）。
- `#nl-boot` 移除失敗的唯一風險＝遮畫面 → 放在 render 後同步移除，最壞情況加一道 CSS：當 `#root` 有子節點時 `#nl-boot` `display:none`（防呆雙保險，plan 階段定）。

## Testing

依專案既定（06-26 lesson 校正）：**harness 是 `node --test`（node:test）純 JS，無 jsdom / RTL / vitest**，全專案 `.test.js` 只測純函式。本任務純 presentation，**無新增可單測的純邏輯**。

驗收 gate：
1. `vite build` green。
2. **branch-wide `git diff` 零-logic 不變式**：證明 `api.js` / `mint.js` / `config.js` / `dapp-kit.js` / `main.jsx`（除 `#nl-boot` remove 一行）/ 合約 / indexer schema **byte-unchanged**（encode「這是純 presentation polish」的 why，符合 Rule 9）。
3. `Mascot.jsx` byte-unchanged（揮手在 consumer wrapper）。
4. **render = human-deferred browser pass**（sandbox 無錢包，本專案每個前端任務既定慣例）：裂殼動畫 on-mount + reduced-motion 靜態、揮手珍珠、expanded skeleton→chart 不 reflow、首屏脈動出現且 mount 後消失、hard-refresh 不殘留 boot。`cd frontend && npm run dev`。

> 若 plan 階段拆出任何純 helper（如 boot-remove 的純函式、skeleton 尺寸常數），則補對應 `node --test`。預設無。

## 非範圍（YAGNI）

- 不新增吉祥物表情變體（無難過版＝採 line glyph 規避）。
- 不改任何成功/中性狀態樣式。
- 不動 ConnectButton wallet modal（dapp-kit-react 2.x 無 theme prop，沿用既有限制）。
- 不做 toast / 全域通知系統。

## 風險 / 開放項（plan 階段定）

- `nl-wave` 揮手強度：輕度 vs 有限次——companion 已驗輕度可接受，plan 給具體 timing。
- `#nl-boot` 防呆是否加 CSS 雙保險（第二道）。
- expanded skeleton 是否抽 `ChartSkeleton.jsx` vs inline——視 markup 複雜度，plan 決定。
