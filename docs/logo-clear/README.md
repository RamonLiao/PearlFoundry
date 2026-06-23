# Logo 變體（去白底）

來源：`docs/logo_1.png` / `logo_2.png` / `logo_3.png`（kawaii 笑臉珍珠貝殼），
用 corner flood-fill 去外圍白底（中央圖案不動，內部高光保留），透明底 PNG 341².

| 檔案 | 說明 |
|------|------|
| `logo_1-clear.png` | 睜眼大笑、表情有神，sparkle 在貝殼內 |
| `logo_2-clear.png` | 珍珠最大最亮、右上藤蔓捲飾、貝殼偏粉 |
| `logo_3-clear.png` | 閉眼微笑、貝殼最立體、molten 金光暈最強 — **目前 masthead default**（= `frontend/public/logo-mark.png`） |
| `*-ondark.png` | 合成 obsidian 暗背景的預覽，看 masthead 上效果用 |

## 用途
- 目前只 `logo_3` 上線（masthead）。
- 三張 clear 版保留，**之後可加進前端讓畫面更活潑**（e.g. mint 成功動畫、空狀態插圖、loading、彩蛋輪播）。
- 加進前端時把要用的 clear 版 copy 到 `frontend/public/`，沿用既有命名慣例。
