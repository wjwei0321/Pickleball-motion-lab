# 部署指示：Pickleball Motion Lab → GitHub + Vercel

> 給 Antigravity 執行。請從頭讀到尾，照順序做，每一步完成後簡短回報。
> 這是**獨立的新專案**，跟 `Sensesoil_Org_Structure`、`Sensesoilhunting_APP` 無關，不要動那兩個資料夾。

## 0. 基本資料

| 項目 | 值 |
| --- | --- |
| 專案資料夾 | `C:\Users\User\.antigravity\pickleball-motion-lab` |
| GitHub repo | `https://github.com/SENSESOIL/pickleball-motion-lab`（**先跟使用者確認網址**；使用者有提供不同網址就以使用者的為準） |
| 分支 | `main` |
| 網站類型 | 純靜態網站：沒有 build 步驟、沒有後端、不需要資料庫（不需要 Supabase）、不需要任何環境變數 |

## 1. 推送前檢查

在專案資料夾執行：

```powershell
git status
git log --oneline -3
```

- 應該已經有一個 commit（Claude Code 已做好 `git init` 與第一次 commit）。
- **確認 `_test/` 沒有被追蹤**：`git ls-files _test` 必須是空的。`_test/` 裡有使用者 App 的螢幕錄影，**絕對不能推上公開的 GitHub**。如果有被追蹤，先停下來問使用者。
- 確認追蹤的檔案大約是這些（總共約 48 MB，單檔最大約 10 MB，在 GitHub 100 MB 限制內）：

```
.gitignore  CLAUDE.md  DEPLOY.md  README.md  build.py  index.html  page.html  vercel.json
js/analyze.js  js/lab.js  js/pose.js
models/full.part0.wasm  models/heavy.part0.wasm  models/heavy.part1.wasm  models/heavy.part2.wasm
vendor/mediapipe/vision_bundle.js  vendor/mediapipe/wasm/vision_wasm_internal.js  vendor/mediapipe/wasm/vision_wasm_internal.wasm
```

## 2. 推到 GitHub

GitHub 上的 repo 如果還不存在，請使用者先在 GitHub 建立（空的 repo，不要勾選加 README／.gitignore／license），或用你可用的工具建立。然後：

```powershell
git remote add origin https://github.com/SENSESOIL/pickleball-motion-lab.git
git push -u origin main
```

- 如果 `origin` 已存在，改用 `git remote set-url origin <網址>`。
- 如果遠端已經有內容（例如建 repo 時勾了 README）導致 push 被拒：**不要 force push**，先 `git pull --rebase origin main` 合併後再推；有衝突就停下來問使用者。

## 3. 部署到 Vercel

在 Vercel 匯入這個 GitHub repo（Dashboard → Add New → Project → Import），設定：

| 設定 | 值 |
| --- | --- |
| Framework Preset | **Other** |
| Root Directory | `./`（repo 根目錄） |
| Build Command | 留空（不要 build） |
| Output Directory | 留空（直接用根目錄） |
| Install Command | 留空 |
| Environment Variables | 不需要 |

或用 Vercel CLI（在專案資料夾）：

```powershell
vercel --prod
```

`vercel.json` 已經設定好模型與引擎檔的長期快取，不要改它。之後每次 push 到 `main`，Vercel 會自動重新部署。

## 4. 部署後驗證（必做）

打開 Vercel 給的網址（例如 `https://pickleball-motion-lab.vercel.app`）：

1. 頁面正常顯示標題「把你的匹克球動作，拆成一格一格來看」，瀏覽器 console 沒有紅色錯誤。
2. 把滑鼠移到「選一支匹克球影片」區塊，等 10–30 秒，下方「偵測引擎：」那行要變成 **「就緒（heavy，GPU）」**（或「就緒（heavy，CPU）」也可以）。
3. 確認這幾個檔案能直接打開、回應 200：
   - `/models/heavy.part0.wasm`
   - `/vendor/mediapipe/wasm/vision_wasm_internal.wasm`
   - `/js/pose.js`

任何一項失敗，把錯誤訊息原文回報給使用者，不要自行修改 `js/`、`vendor/`、`models/` 裡的檔案。

## 5. 回報給使用者

- GitHub repo 網址
- Vercel 正式網址
- 第 4 步三項驗證的結果

## 之後更新網站

程式由 Claude Code 維護：改的是 `page.html` 和 `js/`，改完執行 `python build.py` 重新產生 `index.html`，再 commit。
Antigravity 只負責 `git push`（Vercel 會自動部署）。**不要手動編輯 `index.html`**，它是 `page.html` 產生的。
