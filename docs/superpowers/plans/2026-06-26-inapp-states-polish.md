# In-app empty / loading / error 插圖 polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 error / pre-connect / loading / first-paint 四類狀態用品牌（nacre 珍珠）語彙重做，消除裸 `<p>` 文字與 AI-slop。

**Architecture:** 純 presentation-layer。新增一個 `ErrorState.jsx` component（動畫裂殼 line-glyph 卡片，取代 3 處裸 `nl-error`），pre-connect 加 duotone 揮手珍珠，expanded-row 加圖表狀 nacre-swept skeleton，`index.html` 加首屏 `#nl-boot` 脈動（`main.jsx` 用 `flushSync` 後移除）。零 business-logic / 合約 / schema 改動。

**Tech Stack:** React 18（dapp-kit-react 2.x、react-router 6）、Vite、純 CSS 動畫、`node --test`（無 jsdom/RTL）。

## Global Constraints

- **純 presentation-layer**：不得改 `api.js` / `mint.js` / `config.js` / `dapp-kit.js` / 合約 / indexer。`main.jsx` 僅允許「`flushSync` 包裹 render + `#nl-boot` remove」這一處改動。`Mascot.jsx` byte-unchanged（揮手在 consumer wrapper）。
- **無 render 單元測試**：harness 是 `node --test` 純 JS，全專案 `.test.js` 只測純函式。本任務無新增純邏輯 → 每個 task 的驗收＝`cd frontend && npm run build` green + 指定 grep 不變式。render 為 human-deferred browser pass。
- **動畫一律 reduced-motion gated**：擴充各檔**既有單一** `@media (prefers-reduced-motion: reduce)` block（App.css:211），**不新增** block。`index.html` 的 boot 自帶獨立 inline block。
- **吉祥物用 `MASCOT_VARIANT` 具名常數**，禁 `variant={1}` magic number。
- **去 AI-slop**：禁旋轉 ring spinner、禁灰 pulse 方塊、禁裸 emoji glyph。既有 busy loader 是 3-dot `nl-spinner`（非 ring）。
- **WCAG**：`--rust #cc6a4f` on white ≈3.1:1，**fail AA 正文** → 錯誤訊息文字用 `--pearl`（≈10:1），`--rust` 只用於 border / glyph stroke / 粗體 title（非文字 3:1 過）。error 卡片落白底 `--obsidian-raised`。
- Tokens：`--font-display`（Fraunces）、`--font-mono`（Martian Mono）、`--obsidian`（#faf6f0 頁底）、`--obsidian-raised`（#fff 卡）、`--surface-sunk`（#f3ecf3）、`--pearl`（#3a3340）、`--pearl-dim`、`--rust`、`--chart-grid`。

**spec**：`docs/superpowers/specs/2026-06-26-inapp-states-polish-design.md`

**真實 site 校正（讀 code 後）**：genuine `nl-error` 只有 **3 處**（App.jsx:229、Leaderboard.jsx:60、MyNotes.jsx:282）。MyNotes 底部 `msg` 是 dual `nl-status` block（含成功路徑），**不在 error 範圍、不動**。`.nl-error` 僅定義在 `Leaderboard.css`（line 22 + 67 重複），App.jsx 靠 cascade 取得樣式。

---

## File Structure

- **Create** `frontend/src/ErrorState.jsx` — 動畫裂殼錯誤卡片 component（`{title?, message, compact?}`）。
- **Modify** `frontend/src/App.css` — ErrorState 卡片 + 裂殼 keyframes + pre-connect + chart-skeleton 樣式；擴充 reduced-motion block。
- **Modify** `frontend/src/App.jsx` — wire ErrorState（mint error）+ pre-connect 揮手珍珠。
- **Modify** `frontend/src/MyNotes.jsx` — wire ErrorState compact（paramsCache error）+ chart skeleton。
- **Modify** `frontend/src/Leaderboard.jsx` — wire ErrorState（msg）。
- **Modify** `frontend/src/Leaderboard.css` — 刪兩處零-caller `.nl-error`。
- **Modify** `frontend/index.html` — `#nl-boot` 脈動 + viewport meta。
- **Modify** `frontend/src/main.jsx` — `flushSync` 包裹 render + `#nl-boot` remove。

---

## Task 1: `ErrorState` component + 裂殼動畫樣式

**Files:**
- Create: `frontend/src/ErrorState.jsx`
- Modify: `frontend/src/App.css`（新增卡片樣式 + keyframes；擴充 reduced-motion block at line ~211）

**Interfaces:**
- Produces: `ErrorState` default export, props `{ title?: string = 'Something went wrong', message: string, compact?: boolean = false }`. Renders a `role="alert"` card with animated cracked-shell glyph + message. compact 變體：去 left-border、glyph 16px、單行、無 title。

- [ ] **Step 1: 建 `frontend/src/ErrorState.jsx`**

```jsx
import './App.css';

// Cracked pearl-shell line glyph. No mascot: the only mascot variants are happy,
// so a frowning pearl is impossible — a neutral fractured shell carries "broke"
// without tone-mismatch slop. Rust stroke only (graphic ≥3:1, not body text).
const SHELL = (
  <svg className="nl-errglyph" viewBox="0 0 48 48" fill="none" stroke="var(--rust)"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="nl-errglyph-top">
      <path d="M24 8C14 8 7 16 6 24h36C41 16 34 8 24 8Z" />
      <path d="M16 22l4-9M24 22V9M32 22l-4-9" />
    </g>
    <g className="nl-errglyph-bot">
      <path d="M6 24c1 8 8 16 18 16s17-8 18-16" />
    </g>
    <path className="nl-errglyph-crack" pathLength="1" d="M24 9l-3 8 5 6-4 7 3 9" />
  </svg>
);

export default function ErrorState({ title = 'Something went wrong', message, compact = false }) {
  return (
    <div className={`nl-errstate${compact ? ' nl-errstate--compact' : ''}`} role="alert">
      {SHELL}
      <div className="nl-errstate-body">
        {!compact && <p className="nl-errstate-h">{title}</p>}
        <p className="nl-errstate-p">{message}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 `App.css` 末尾（reduced-motion block 之前的常規區）新增 ErrorState 樣式 + keyframes**

```css
/* ── ErrorState (cracked-shell error card) ───────────────────────────────── */
.nl-errstate {
  display: flex; gap: 14px; align-items: center;
  background: var(--obsidian-raised);
  border: 1px solid #ead9d2; border-left: 3px solid var(--rust);
  border-radius: 14px; padding: 14px 16px; margin: 12px 0 0;
}
.nl-errstate-h { font-family: var(--font-display); font-weight: 600; font-size: 16px;
  color: #7a3a2c; margin: 0 0 3px; }
/* body text = ink (≈10:1), NOT rust (would fail AA at 3.1:1) */
.nl-errstate-p { font-family: var(--font-mono); font-size: 12px; line-height: 1.55;
  color: var(--pearl); margin: 0; white-space: pre-wrap; word-break: break-word; }
.nl-errglyph { width: 46px; height: 46px; flex: none; }
/* compact (row-level): much lighter — no border, tiny glyph, single line */
.nl-errstate--compact { gap: 9px; padding: 8px 10px; border-left: none; align-items: flex-start; margin: 8px 0 0; }
.nl-errstate--compact .nl-errglyph { width: 16px; height: 16px; margin-top: 1px; }
.nl-errstate--compact .nl-errstate-p { font-size: 11.5px; }

/* one-shot break on mount; settles. No horizontal card-shake (cliché). */
.nl-errglyph-top { transform-box: fill-box; transform-origin: center;
  animation: nl-shell-top .3s cubic-bezier(.3,.7,.4,1) both; }
.nl-errglyph-bot { transform-box: fill-box; transform-origin: center;
  animation: nl-shell-bot .3s .06s cubic-bezier(.3,.7,.4,1) both; }
.nl-errglyph-crack { stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: nl-crack-draw .35s ease-out .05s forwards; }
@keyframes nl-shell-top { to { transform: translateY(-2px) rotate(-2deg); } }
@keyframes nl-shell-bot { to { transform: translateY(2px) rotate(2deg); } }
@keyframes nl-crack-draw { to { stroke-dashoffset: 0; } }
```

- [ ] **Step 3: 擴充既有 reduced-motion block（App.css:211 內，加一行）**

在 `@media (prefers-reduced-motion: reduce) { … }` block 內加：

```css
  .nl-errglyph-top, .nl-errglyph-bot, .nl-errglyph-crack { animation: none !important; stroke-dashoffset: 0 !important; transform: none !important; }
```

- [ ] **Step 4: build green**

Run: `cd frontend && npm run build`
Expected: build 成功（exit 0），無 `ErrorState` 相關 import/JSX 錯誤。

- [ ] **Step 5: grep 確認裂殼 keyframe 不撞既有名稱**

Run: `cd frontend && grep -rn "@keyframes nl-shell-top\|@keyframes nl-shell-bot\|@keyframes nl-crack-draw" src/*.css`
Expected: 各只出現 **1 次**（皆在 App.css），無重複定義。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ErrorState.jsx frontend/src/App.css
git commit -m "feat(frontend): ErrorState cracked-shell error card + animation"
```

---

## Task 2: Wire `ErrorState` into 3 sites + 刪重複 `.nl-error`

**Files:**
- Modify: `frontend/src/App.jsx`（import + line 229）
- Modify: `frontend/src/MyNotes.jsx`（import + line 282 paramsCache error → compact）
- Modify: `frontend/src/Leaderboard.jsx`（import + line 60）
- Modify: `frontend/src/Leaderboard.css`（刪 line 22 + line 67 的 `.nl-error`）

**Interfaces:**
- Consumes: `ErrorState` from Task 1 (`{title?, message, compact?}`).

- [ ] **Step 1: App.jsx — 加 import + 換 mint error**

在 import 區（`import Mascot from './Mascot.jsx';` 後）加：

```jsx
import ErrorState from './ErrorState.jsx';
```

把 App.jsx:229：

```jsx
        {mintPhase === 'error' && <p className="nl-error">{mintErr}</p>}
```

改為：

```jsx
        {mintPhase === 'error' && <ErrorState message={mintErr} />}
```

- [ ] **Step 2: MyNotes.jsx — 加 import + 換 paramsCache error（compact）**

在 import 區（`import { MASCOT_VARIANT } from './mascot.js';` 後）加：

```jsx
import ErrorState from './ErrorState.jsx';
```

把 MyNotes.jsx:282 的：

```jsx
                          ? <p className="nl-error">{paramsCache[n.note_id].error}</p>
```

改為：

```jsx
                          ? <ErrorState compact message={paramsCache[n.note_id].error} />
```

- [ ] **Step 3: Leaderboard.jsx — 加 import + 換 msg**

在 import 區（`import Mascot from './Mascot.jsx';` 後，與既有 import 風格一致）加：

```jsx
import ErrorState from './ErrorState.jsx';
```

把 Leaderboard.jsx:60：

```jsx
      {msg && <pre className="nl-error">{msg}</pre>}
```

改為：

```jsx
      {msg && <ErrorState message={msg} />}
```

- [ ] **Step 4: 刪 Leaderboard.css 兩處零-caller `.nl-error`**

刪除 Leaderboard.css:22：

```css
.nl-error { font-family: var(--font-mono); font-size: 12px; color: var(--rust); white-space: pre-wrap; margin: 12px 0 0; }
```

刪除 Leaderboard.css:67：

```css
.nl-error { color: var(--rust); font-family: var(--font-mono); font-size: 12px; margin: 0; }
```

- [ ] **Step 5: grep 確認 `.nl-error` 全淨空（class 與 caller 皆無）**

Run: `cd frontend && grep -rn "nl-error" src/`
Expected: **零命中**（class 定義與所有 caller 都已移除）。

- [ ] **Step 6: build green**

Run: `cd frontend && npm run build`
Expected: build 成功（exit 0）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx frontend/src/MyNotes.jsx frontend/src/Leaderboard.jsx frontend/src/Leaderboard.css
git commit -m "feat(frontend): wire ErrorState into 3 error sites; drop dup .nl-error"
```

---

## Task 3: Pre-connect 揮手珍珠（duotone 56px）

**Files:**
- Modify: `frontend/src/App.jsx`（hero else 分支，line ~208–210）
- Modify: `frontend/src/App.css`（pre-connect 樣式 + `nl-wave` keyframe；擴充 reduced-motion block）

**Interfaces:**
- Consumes: 既有 `Mascot`、`MASCOT_VARIANT`（App.jsx 已 import）。

- [ ] **Step 1: App.jsx — 換 else 分支**

把 App.jsx 的（`account ? (…) :` 之後）：

```jsx
              ) : (
                <button className="nl-btn nl-btn--primary" disabled title="Connect your wallet in the header to mint">Connect to mint</button>
              )}
```

改為：

```jsx
              ) : (
                <div className="nl-preconnect">
                  <span className="nl-wave"><Mascot variant={MASCOT_VARIANT.JOYFUL} treatment="duotone" size={56} /></span>
                  <div className="nl-preconnect-cta">
                    <p className="nl-preconnect-h">Connect your wallet to begin</p>
                    <button className="nl-btn nl-btn--primary nl-btn--hint" disabled title="Connect your wallet in the header to mint">Connect to mint</button>
                  </div>
                </div>
              )}
```

- [ ] **Step 2: App.css — 加 pre-connect 樣式 + nl-wave keyframe**

```css
/* ── Pre-connect greeter ─────────────────────────────────────────────────── */
.nl-preconnect { display: flex; align-items: center; gap: 16px; }
.nl-preconnect-cta { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
/* copy leads; the disabled button is a hint, not a co-equal CTA */
.nl-preconnect-h { font-family: var(--font-display); font-weight: 600; font-size: 17px;
  color: var(--pearl); margin: 0; }
.nl-btn--hint:disabled { opacity: .6; }
/* finite friendly wave (2 cycles, then rests) — wrapper is inline-block so the
   transform is stable across line wraps */
.nl-wave { display: inline-block; transform-origin: 70% 90%;
  animation: nl-wave 1.1s ease-in-out 2; }
@keyframes nl-wave { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-7deg); } 60% { transform: rotate(5deg); } }
```

- [ ] **Step 3: 擴充既有 reduced-motion block（加一行）**

```css
  .nl-wave { animation: none; }
```

- [ ] **Step 4: build green**

Run: `cd frontend && npm run build`
Expected: build 成功（exit 0）。

- [ ] **Step 5: grep 確認 `Mascot.jsx` 未被改動（byte-unchanged 不變式）**

Run: `git diff --stat frontend/src/Mascot.jsx`
Expected: **無輸出**（Mascot.jsx 未改）。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): pre-connect waving duotone pearl greeter"
```

---

## Task 4: Expanded-row 圖表狀 nacre skeleton

**Files:**
- Modify: `frontend/src/MyNotes.jsx`（展開列 `Loading payoff…` 分支，line ~287）
- Modify: `frontend/src/App.css`（`.nl-chartskel` 樣式，reuse `nl-skel-sweep` 動畫；擴充 reduced-motion block）

**Interfaces:**
- Consumes: 既有 `@keyframes nl-skel-sweep`（定義在 Leaderboard.css:80，MyNotes 已 import Leaderboard.css）。

- [ ] **Step 1: MyNotes.jsx — 換 Loading 分支**

把 MyNotes.jsx 展開列的：

```jsx
                            : <p className="nl-note">Loading payoff…</p>}
```

改為：

```jsx
                            : (
                              <div className="nl-chartskel">
                                <span className="sr-only" role="status">Loading payoff…</span>
                              </div>
                            )}
```

- [ ] **Step 2: App.css — 加 `.nl-chartskel`（mask 出階梯線+軸，reuse nl-skel-sweep）**

> 用 CSS mask 把 nacre sweep 限制成「軸 L-frame + 單條階梯線」形狀（呼應 payoff 階梯線，非長條 bar）。**不套 `.nl-skel`**（那是 11px strip）。尺寸 match `PayoffChart size="full"`（420×250、maxWidth 480）以免 swap reflow。

```css
/* ── Expanded-row payoff skeleton (nacre-swept staircase, not bars) ───────── */
.nl-chartskel {
  width: 100%; max-width: 480px; aspect-ratio: 420 / 250; margin: 4px auto 0;
  background: linear-gradient(100deg, var(--surface-sunk) 30%, #efe7f3 50%, var(--surface-sunk) 70%);
  background-size: 200% 100%;
  animation: nl-skel-sweep 1.4s ease-in-out infinite;
  -webkit-mask: var(--nl-chartskel-mask) center / 100% 100% no-repeat;
  mask: var(--nl-chartskel-mask) center / 100% 100% no-repeat;
  --nl-chartskel-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 420 250'%3E%3Cpath d='M50 30 V228 H400' fill='none' stroke='%23000' stroke-width='2'/%3E%3Cpath d='M60 200 H140 V160 H210 V120 H280 V80 H360' fill='none' stroke='%23000' stroke-width='6' stroke-linejoin='round'/%3E%3C/svg%3E");
}
```

- [ ] **Step 3: 擴充既有 reduced-motion block（加一行）**

```css
  .nl-chartskel { animation: none; }
```

- [ ] **Step 4: build green**

Run: `cd frontend && npm run build`
Expected: build 成功（exit 0）。

- [ ] **Step 5: grep 確認沒有新增 keyframe、且沒誤用 `.nl-skel` class**

Run: `cd frontend && grep -rn "nl-skel-sweep\|nl-chartskel" src/App.css; grep -c "@keyframes nl-skel-sweep" src/*.css`
Expected: `.nl-chartskel` 引用 `nl-skel-sweep` 動畫；`@keyframes nl-skel-sweep` 仍**僅 1 次**（在 Leaderboard.css，未新增）。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.css
git commit -m "feat(frontend): chart-shaped nacre skeleton for expanded-row loading"
```

---

## Task 5: 首屏 `#nl-boot` 脈動 + viewport meta + `flushSync` 移除

**Files:**
- Modify: `frontend/index.html`（viewport meta + `#nl-boot` markup + inline `<style>`）
- Modify: `frontend/src/main.jsx`（`flushSync` 包裹 render + `#nl-boot` remove）

**Interfaces:**
- Produces: DOM 約定 `#nl-boot`（在 `#root` 之後 sibling）；`main.jsx` render 後移除。

- [ ] **Step 1: 改 `frontend/index.html`（整檔替換）**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,500;9..144,0,600;9..144,0,700;9..144,1,600&family=Martian+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <title>PearlFoundry</title>
    <style>
      /* first-paint splash — inline so it shows before React/CSS load. Static logo,
         a slow nacre halo pulses behind it (pulsing the logo itself = AI-slop tell). */
      #nl-boot { position: fixed; inset: 0; display: flex; align-items: center;
        justify-content: center; background: #faf6f0; z-index: 9999; }
      #nl-boot .nl-boot-mark { position: relative; display: grid; place-items: center;
        width: 72px; height: 72px; }
      #nl-boot .nl-boot-mark::before { content: ""; position: absolute; inset: -26px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(216,206,242,.55), rgba(216,206,242,0) 70%);
        animation: nl-boot-halo 1.8s ease-in-out infinite; }
      #nl-boot img { position: relative; z-index: 1; width: 72px; height: 72px;
        object-fit: contain; display: block; }
      @keyframes nl-boot-halo {
        0%, 100% { transform: scale(.85); opacity: .45; }
        50% { transform: scale(1.1); opacity: .8; } }
      /* belt-and-suspenders: if React committed, hide the splash even if JS remove fails */
      #root:not(:empty) ~ #nl-boot { display: none; }
      @media (prefers-reduced-motion: reduce) {
        #nl-boot .nl-boot-mark::before { animation: none; } }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="nl-boot"><span class="nl-boot-mark"><img src="/logo-mark.png" alt="" /></span></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 改 `frontend/src/main.jsx`（flushSync 包裹 + remove）**

把 import 區的：

```jsx
import { createRoot } from 'react-dom/client';
```

下方加：

```jsx
import { flushSync } from 'react-dom';
```

把 render 呼叫：

```jsx
createRoot(document.getElementById('root')).render(
  <DAppKitProvider dAppKit={dAppKit}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </DAppKitProvider>,
);
```

改為（concurrent mode 下 `render()` 非阻塞 → `flushSync` 強制同步 commit 後才移除 splash，避免閃白）：

```jsx
const root = createRoot(document.getElementById('root'));
flushSync(() => {
  root.render(
    <DAppKitProvider dAppKit={dAppKit}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DAppKitProvider>,
  );
});
document.getElementById('nl-boot')?.remove();
```

- [ ] **Step 3: build green**

Run: `cd frontend && npm run build`
Expected: build 成功（exit 0）。

- [ ] **Step 4: grep 不變式（boot + flushSync 都在；main.jsx 只多這兩處）**

Run: `cd frontend && grep -n "nl-boot" index.html; grep -n "flushSync\|nl-boot" src/main.jsx`
Expected: `index.html` 有 `#nl-boot` markup + style；`main.jsx` 有 `flushSync` import + 包裹 + `getElementById('nl-boot').remove()`。

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/main.jsx
git commit -m "feat(frontend): first-paint pearl-halo splash, removed after flushSync render"
```

---

## Task 6: 全分支 zero-logic 不變式驗收 + 收尾

**Files:** 無（驗收 only）

- [ ] **Step 1: branch-wide diff 證明零 business-logic 改動**

Run（對照 merge-base，feature branch 名以實際為準）：
`git diff --stat main -- frontend/src/api.js frontend/src/mint.js frontend/src/config.js frontend/src/dapp-kit.js frontend/src/Mascot.jsx scripts/ move/`
Expected: **無輸出**（這些路徑全 byte-unchanged）。

- [ ] **Step 2: main.jsx diff 僅限 flushSync + boot remove**

Run: `git diff main -- frontend/src/main.jsx`
Expected: 僅 `flushSync` import + render 包裹 + `#nl-boot` remove 三處，無其他 logic 改動。

- [ ] **Step 3: 全前端 test + build**

Run: `cd frontend && node --test && npm run build`
Expected: 既有測試全綠（無新增測試也不應退化）、build green。

- [ ] **Step 4: human-deferred browser pass 清單（記入 progress，不阻塞 merge）**

`cd frontend && npm run dev`，於真瀏覽器確認：
- mint 失敗 → 裂殼動畫 on-mount、settle 後靜止；reduced-motion 下靜態。
- pre-connect（未連錢包）→ duotone 56px 揮手珍珠揮 2 下後 rest、文案領銜、disabled 鈕為 hint。
- MyNotes 展開未載入 → 圖表狀 nacre skeleton（階梯線形、非長條），載入後 swap 到 chart **不 reflow**。
- 硬重整 `/app` → 首屏 logo + halo 脈動出現、mount 後消失、不殘留遮畫面。
- error 文字為深 ink（非 rust），rust 只在 border/glyph。

---

## Self-Review

**Spec coverage：** §1 error→Task 1+2；§2 pre-connect→Task 3；§3 skeleton→Task 4；§4 first-paint→Task 5；Testing 不變式→Task 6。全覆蓋。spec「4 site」經讀 code 校正為 3 genuine `nl-error`（MyNotes 底部 msg 是 dual nl-status，不在範圍）——已在 Global Constraints 註明。

**Placeholder scan：** 無 TBD/TODO；每個 code step 給完整 before/after。

**Type consistency：** `ErrorState` props `{title?, message, compact?}` 在 Task 1 定義、Task 2 三處使用一致（compact 只在 MyNotes:282）。`nl-skel-sweep`（既有）、`nl-wave`/`nl-crack-draw`/`nl-shell-top`/`nl-shell-bot`/`nl-boot-halo`（新，互不撞、Task 1/3/4/5 grep 驗證）。`flushSync` from `react-dom`（Task 5）。
