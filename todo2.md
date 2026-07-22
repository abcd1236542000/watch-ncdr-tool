# TODO2 — 發版防呆與版本一致性門禁機制

> 目的：消除 AI 與人工開發時「修改程式漏升版」、「dist 未編譯」、「record.md 沒同步」等疏失，確保版本迭代 100% 正確。
> 範圍：建立自動化檢查腳本、整合 npm script 與 Git 門禁、強化 CLAUDE.md 規範。
> 原則：**不增加繁瑣手續**，透過單一命令與自動檢查把關。

---

## ① 新增一致性檢查腳本 `scripts/check-sync.mjs`

**現況問題**：若有人/AI 改了 `src/rain.js` 卻忘記跑 `npm version` 或忘記重新編譯 `dist/rain.js`，系統目前不會警告。

**要做**：
- [ ] 撰寫 `scripts/check-sync.mjs` 腳本，檢查以下項目：
  1. **版號一致性**：`package.json` 的版本號（M.N）與 `src/rain.js` 中的 `var VER` 是否完全吻合。
  2. **產物最新度**：比對當前 `dist/rain.js` 與由 `src/rain.js` 經 terser 編譯後的產物是否一致（防止手改 `dist` 或編譯遺漏）。
  3. **變更未升版檢查**：若 git 工作區中 `src/rain.js` 有變更，提示是否需執行升版。
- [ ] 檢查失敗時輸出清晰的錯誤原因並以退出碼 `1` 退出；通過時輸出成功訊息並回傳 `0`。

**驗收**：手動跑 `node scripts/check-sync.mjs` 能精準攔截版號錯配或 `dist` 過期。

---

## ② 整合 `package.json` 指令

**要做**：
- [ ] 在 `package.json` 的 `scripts` 新增 `"check"` 欄位：
  ```json
  "scripts": {
    "build": "npx -y terser@5.31.0 src/rain.js -c -m --comments false -o dist/rain.js",
    "check": "node scripts/check-sync.mjs",
    "version": "node scripts/version.mjs && npm run build && node scripts/check-sync.mjs && git add -A"
  }
  ```
- [ ] 確保 `npm version` 升版流程中自動包含 `check` 驗證。

**驗收**：`npm run check` 可手動獨立執行，且 `npm version` 升版會自動通過合規檢查。

---

## ③ 設定 Git Hook 防呆門禁 (Pre-commit)

**要做**：
- [ ] 設定 `.git/hooks/pre-commit` 腳本，在每一次 `git commit` 前自動觸發 `npm run check`。
- [ ] 若檢查不通過（如 `dist` 未 build、版號錯配），攔截 commit 並提示修復指引。

**驗收**：當 `dist` 與 `src` 不一致時，執行 `git commit` 會被自動擋下。

---

## ④ 強化 `CLAUDE.md` 交付 SOP 規範

**要做**：
- [ ] 在 `CLAUDE.md` 的「鐵則」或「常用指令」補充發版與交付 SOP：
  - 程式碼修改完成後，交付前需執行 `npm run check` 驗證。
  - 升版嚴禁手動改檔，必須統一執行 `npm version <patch|minor|major>`。
  - 每次程式異動需確認 `docs/record.md` §7 變更紀錄與 §4 現況已同步。

**驗收**：`CLAUDE.md` 清晰標示交付檢查點，供未來 AI 代理自動遵照執行。
