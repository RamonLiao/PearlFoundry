# Indexer Design — Structured Note Factory

**Date**: 2026-06-21
**Status**: APPROVED (brainstorming)
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
[ingest] GraphQL poller ──cursor──▶ [store] SQLite ──▶ [serve] REST (http)
  events query                      4 表 + cursor 表        4 端點
```

換 ingestion（C→production checkpoint stream）只動 ingest 層；store/serve 介面不變。

### 1. Ingest — `scripts/indexer/ingest.js`

- `@mysten/sui/graphql` `SuiGraphQLClient`（testnet endpoint），輪詢 `events(filter:{emittingModule: "<PKG>::events"}, after: cursor)`，分頁。
- **cursor 持久化**進 `cursor` 表（單 row）。重啟續傳，不重掃。
- 每筆 event 依 type 分派到**純函式正規化器** → 寫對應表。
- 輪詢間隔 env `POLL_MS`（預設 3000）。
- **fail-loud**：GraphQL error 不吞，log + exponential backoff，連 3 次失敗停止（dev-rules）。
- PKG 從 `scripts/integration/config.js` 取（`0xa699…b21a`）。

### 2. Store — `scripts/indexer/db.js`（better-sqlite3）

Event-sourced，**冪等 upsert by 主鍵**（GraphQL 重播不產重複 row）：

- `notes`: `note_id PK, strategy, issuer, manager_id, notional, expiry_ts_ms, walrus_blob_id, is_public, minted_at_ms`
- `settlements`: `note_id PK, payout, perf_fee, settled_by, settled_at_ms`
- `fees`: `dedup_key PK (note_id+kind+seq), note_id, kind, amount`（一 note 可多筆 fee，需 dedup key）
- `public_notes`: `note_id PK, issuer, template`
- `cursor`: `id=0, graphql_cursor, last_checkpoint, updated_at`

PnL / leaderboard **不存實體表** — query-time JOIN（`notes ⋈ settlements`），單一真實來源避免聚合 drift。

### 3. Serve — `scripts/indexer/server.js`（node `http`，零框架）

| 端點 | 邏輯 |
|------|------|
| `GET /leaderboard` | `notes ⋈ settlements` group by issuer：`realized_pnl=Σ(payout−notional)`、`win_rate`、`total_perf_fee`、`note_count`，排序 |
| `GET /notes?holder=&issuer=&public=1` | note 狀態（settled = settlements 是否存在）+ 過濾 |
| `GET /pending-settle` | `notes` where `expiry_ts_ms < now AND note_id NOT IN settlements`（keeper 路徑 B 輸入） |
| `GET /fees` | `fees` group by kind 總量 |

## 測試（Rule 9 + test.md monkey）

- **純函式單測**：4 個 event→row 正規化（`vector<u8>` strategy/walrus_blob_id 的 decode、address 格式）。
- **store 單測**：冪等性（同 event 重播兩次不重複）、PnL JOIN 算式（虧損 note payout<notional → 負 PnL）、pending-settle 邊界（expiry==now、已 settled 排除）。
- **monkey**：孤兒 settled（無對應 minted）、cursor 損毀重置、GraphQL 空頁、重複 note_id。
- **live testnet**：跑一輪 ingest 對既有上鏈 note（mint `13ikpdQK…`、claim `EveDmojuk…`），驗 leaderboard 出得來。

## 範圍外（YAGNI / roadmap）

reorg 深度回滾、WebSocket push、多 package、auth、rate limit。

## 已知前提 / 風險

- GraphQL testnet endpoint 與 event filter schema 須在 Task 1 first-run 校準（對既有 event 驗 query 真的回得來；別信文件假設 — lessons SOP）。
- `vector<u8>` 欄位 decode 規則（strategy=utf8 名稱？walrus_blob_id=raw bytes？）須對真實 event payload 驗一次。
