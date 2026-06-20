# Indexer Design — Structured Note Factory

**Date**: 2026-06-21
**Status**: APPROVED (brainstorming + sui-architect + sui-indexer review integrated)
**Scope**: off-chain custom indexer — leaderboard / note query / pending-settle / fee stats

## Goal

把 4 個鏈上 event 聚合成可查狀態，服務前端與 settlement keeper。**C 方案**：hackathon 用輕量輪詢 + SQLite + REST，但 schema 與 cursor 持久化照 production 設計，未來可換 ingestion 層而不動 query 層。

## 真實來源（events module）

`structured_note_factory::events`（`move/sources/events.move`），4 個 `copy, drop` event：

| Event | 欄位 | 用途 |
|-------|------|------|
| `NoteMinted` | note_id, strategy, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public | note 建立 |
| `NoteSettled` | note_id, payout, perf_fee, settled_by | 結算（join NoteMinted 算 PnL） |
| `PublicNoteRegistered` | note_id, issuer, template | 公開模板（leaderboard A1 純 emit） |
| `FeeCollected` | note_id, kind(0 issuance/1 perf), amount | 金庫對帳 |

PnL = `NoteSettled.payout − NoteMinted.notional`（同 note_id join）。`settled_by` 區分自助 claim vs sponsored。

## 架構（3 層，獨立可測）

```
[ingest] JSON-RPC poller ──cursor──▶ [store] SQLite ──▶ [serve] REST (http)
  suix_queryEvents                   4 表 + cursor 表        4 端點
```

換 ingestion（→ gRPC，見 roadmap）只動 ingest 層；store/serve 介面不變。

### 1. Ingest — `scripts/indexer/ingest.js`

**Ingestion 決策（2026-06-21 翻案，見下方「決策紀錄」）：用 JSON-RPC `suix_queryEvents`，非 GraphQL。**

- `@mysten/sui` `SuiClient.queryEvents({ query: { MoveModule: { package: PKG, module: "events" } }, cursor, order: "ascending" })`。
- **server-side 按 package+module 過濾**，回原生 `nextCursor = { txDigest, eventSeq }`（可靠 forward cursor）+ `hasNextPage`。
- **cursor 持久化**進 `cursor` 表（存 `{ txDigest, eventSeq }`）。重啟續傳。
- **啟動時重掃一小段 trailing window**（從持久 cursor 往回退 N 筆/一段）— 配合冪等 upsert 讓重掃無害，順帶吸收 testnet reorg/restart（reorg 深度回滾仍列 YAGNI）。
- 每筆 event 依 `type` 分派到**純函式正規化器** → 寫對應表。
- 輪詢間隔 env `POLL_MS`（預設 3000）。
- **fail-loud**：RPC error 不吞，log + exponential backoff，連 3 次失敗停止（dev-rules）。
- PKG 從 `scripts/integration/config.js` 取（`0xa699…b21a`，**必須是原始 published package ID**，非 upgrade 後位址，否則 filter 靜默回空）。

### 2. Store — `scripts/indexer/db.js`（better-sqlite3）

Event-sourced，**dedup key = event envelope `(tx_digest, event_seq)`**（reviewer blocker fix：`FeeCollected` 等 event payload 本身無唯一序號，唯一性來自 envelope）。`note_id` 為 **indexed 欄供 JOIN**，非 dedup PK。

- `notes`: `PK(tx_digest, event_seq)`, `note_id`(idx), strategy_bytes, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id_bytes, is_public, minted_at_ms
- `settlements`: `PK(tx_digest, event_seq)`, `note_id`(idx), payout, perf_fee, settled_by, settled_at_ms
- `fees`: `PK(tx_digest, event_seq)`, `note_id`(idx), kind, amount
- `public_notes`: `PK(tx_digest, event_seq)`, `note_id`(idx), issuer, template_bytes
- `cursor`: `id=0, tx_digest, event_seq, updated_at`
- index: `notes.expiry_ts_ms`（pending-settle keeper query）。

**冪等寫入 + cursor advance 為單一 transaction**（better-sqlite3 同步交易）：一頁的 row upserts 與 cursor 更新一起 commit，crash 不丟事件、不破續傳保證。

`vector<u8>` 欄位**存 raw bytes（hex/blob），不在 store 層 decode** — decode 規則未驗，移到 serve 層避免污染來源表。

PnL / leaderboard **不存實體表** — query-time JOIN（`notes ⋈ settlements`），單一真實來源避免聚合 drift。

### 3. Serve — `scripts/indexer/server.js`（node `http`，零框架）

`vector<u8>` 在此層 decode（Sui RPC 回 `number[]`）：`Buffer.from(arr)` → `strategy`/`template` utf8 字串；`walrus_blob_id` 存/回 base64 或 hex（**不 utf8-decode**，raw blob id）。

| 端點 | 邏輯 |
|------|------|
| `GET /leaderboard` | `notes ⋈ settlements` group by issuer：`realized_pnl=Σ(payout−notional)`、`win_rate=wins/settled_count`、`total_perf_fee`、`note_count`，排序。**`settled_count=0` 的 issuer omit row**（防除零） |
| `GET /notes?holder=&issuer=&public=1` | note 狀態（settled = settlements 是否存在）+ 過濾 |
| `GET /pending-settle` | `notes` where `expiry_ts_ms < now AND note_id NOT IN settlements`（keeper 路徑 B 輸入） |
| `GET /fees` | `fees` group by kind 總量 |

## 測試（Rule 9 + test.md monkey）

- **純函式單測**：4 個 event→row 正規化。**decode 測試**：`vector<u8>` = `number[]` → strategy/template utf8、walrus_blob_id base64/hex 不 utf8（encode intent，別 runtime 才發現）。
- **store 單測**：冪等性（同 `(tx_digest,event_seq)` 重播兩次不重複）、cursor+write 同交易（crash-mid 模擬不丟）、PnL JOIN 算式（虧損 note payout<notional → 負 PnL）、pending-settle 邊界（expiry==now、已 settled 排除）、win_rate 零結算 omit。
- **monkey**：孤兒 settled（無對應 minted）、cursor 損毀重置、RPC 回空頁、重複 event、trailing-window 重掃冪等。
- **live testnet**：跑一輪 ingest 對既有上鏈 note（mint `13ikpdQK…`、claim `EveDmojuk…`），驗 leaderboard 出得來 + `vector<u8>` decode 對真實 payload 校準一次。

## 決策紀錄 — Ingestion: GraphQL → JSON-RPC（2026-06-21）

brainstorming 初選 GraphQL（因「JSON-RPC 已棄用」這個**未驗證文件假設**，spec A3）。sui-indexer + sui-architect review 實證推翻：

- **GraphQL `events` forward cursor 不可靠**（連線分頁 backwards-oriented，`after` cursor 跨多次輪詢無法可靠續傳）+ GraphQL 仍 beta、schema 不穩 → 我們 poller 核心機制破功。
- **JSON-RPC `suix_queryEvents`** 雖被 signaled 棄用（testnet 仍可用），但有原生可靠 `nextCursor {txDigest,eventSeq}` + server-side MoveModule filter + battle-tested，且 cursor 本身就是 store 層要的 dedup envelope — 一石二鳥。

結論：可靠續傳 > 未來相容性（3 層架構讓日後換 gRPC 成本低）。

## Roadmap — 升級 gRPC（延後，非 hackathon 範圍）

JSON-RPC 棄用方向是 **gRPC**（非 GraphQL）。未來把 ingest 層換成 `@mysten/sui/grpc` `SuiGrpcClient`（testnet `fullnode.testnet.sui.io:443`，client 原生、免手編 protobuf）。兩條路：
- `SubscriptionService.SubscribeCheckpoint`（streaming，最低延遲）：訂閱全域 checkpoint，client 端按 package 濾，自管 checkpoint-seq cursor + 斷線 backfill。
- `EventService.ListAuthenticatedEvents`（unary，按 package + `next_page_token`）：乾淨，但**只涵蓋 "Authenticated events"** — 我們的普通 `event::emit` 是否被涵蓋**未證實**，升級前須先 spike 驗證（撈得到既有 event 才採用）。

升級觸發點：需要 sub-second 延遲、或 JSON-RPC 在 testnet 真正下線。store/serve 不動，只換 ingest + cursor 型別（checkpoint-seq vs `{txDigest,eventSeq}`）。

## 範圍外（YAGNI / roadmap）

reorg 深度回滾、WebSocket push、多 package、auth、rate limit。

## 已知前提 / 風險

- `suix_queryEvents` MoveModule filter 的 package 須為原始 published ID；first-run 對既有 event（mint `13ikpdQK…`）校準 filter 真的回得來。
- `vector<u8>` decode 規則（strategy=utf8 名稱、walrus_blob_id=raw、template=utf8）須對真實 event payload 驗一次再鎖死測試。
