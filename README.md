# Pickleball Motion Lab

上傳匹克球影片 → 瀏覽器端 MediaPipe 姿勢偵測（33 關節點 2D + 3D）→ 找擊球、判斷球種 → 指標與診斷 → 矯正版骨架 → 3D 動作捕捉實驗室。
影片只在使用者的瀏覽器裡處理，不會上傳。

## 本機執行

```
python -m http.server 8000
```
開 http://localhost:8000 （不能直接雙擊 index.html，瀏覽器會擋模組與模型讀取）。

## 檔案

| 路徑 | 說明 |
| --- | --- |
| `page.html` | 頁面原始檔（標記 + CSS）。改完執行 `python build.py` 產生 `index.html` |
| `index.html` | 產生出來的完整頁面（本機／Vercel 用） |
| `js/pose.js` | 姿勢偵測：裁切追蹤、隊友排除、插值 |
| `js/analyze.js` | 找擊球、球種、指標、診斷、矯正版骨架 |
| `js/lab.js` | three.js 3D 實驗室、播放同步、定格標註、介面 |
| `vendor/mediapipe/` | @mediapipe/tasks-vision 0.10.21（ES module + WASM） |
| `models/` | pose_landmarker heavy / full（float16），切成 ≤15 MB 片段；副檔名 .wasm 只是讓靜態主機以二進位提供 |

## 部署

純靜態網站（不需要後端、資料庫或 build），GitHub `main` → Vercel 自動部署。步驟見 [DEPLOY.md](DEPLOY.md)。
`_test/` 放本機測試素材，已排除在 git 之外。
