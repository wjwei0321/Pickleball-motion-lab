# Pickleball Motion Lab — 給 AI 助理的常駐指示

- 這是獨立專案，跟 `Sensesoil_Org_Structure`、`Sensesoilhunting_APP` 無關。
- 部署：GitHub `main` → Vercel 自動部署。完整步驟見 `DEPLOY.md`。
- 分工：Claude Code 改程式並 commit；Antigravity 負責 push 與 Vercel。
- 頁面原始檔是 `page.html`；改完執行 `python build.py` 產生 `index.html`。不要直接改 `index.html`。
- `_test/` 含使用者 App 的螢幕錄影，已在 `.gitignore`，不可推上 GitHub。
- 純靜態網站，所有分析在使用者瀏覽器裡跑，不需要後端或 Supabase。
- 回覆使用者用繁體中文。
