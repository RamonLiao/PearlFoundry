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
