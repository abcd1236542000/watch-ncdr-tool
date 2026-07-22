# TODO2 — 去版本號、改記錄式 changelog + 輕量 dist 門禁

> ✅ **已於 2026-07-22 全數落地**（①→⑥ 完成，`docs/record.md` §11.5／§7 已同步）。本檔保留作實作依據與脈絡。

> 目的：讓 AI 與人工都**不需要管版本號**。改完程式 → build → commit 即可，不再決定 major/minor/patch、不再手動同步版號。
> 方向：把「人工維護的 semver」換成「build 自動蓋的建置識別碼（日期）」；版本演進只用 append-only 的 `CHANGELOG.md` 記錄；門禁只保留唯一真正的正確性把關——**改了 src 有沒有一起重編 dist**。
> 原則：**能自動就不要人管，能不擋就只提醒，能輕就不重**。

---

## 決策（已與需求方確認）

- **建置識別碼＝日期式**：build 時自動蓋今天日期（如 `2026-07-22`）到產物，取代原本手填的 `var VER='1.7'`。面板與安裝頁顯示此日期。人與 agent 都不再碰它。
- **完全改用日期、不再有版本號**：README 的「目前版本 v1.7」改成「最後更新 <日期>」；面板 `v1.7` 改顯示日期。v1.x 概念全面退場。
- **門禁走精簡版、package.json 只留 1 個 script（`build`）**：pre-commit 用 **git 層級檢查**——「`src/rain.js` 有 staged 但 `dist/rain.js` 沒 staged 就擋」，不重編、不比對、不需 `check-sync.mjs` / `install-hooks.mjs`。只擋「改了 src 忘了 build」這個唯一實際會發生的疏失。

---

## 實作前必讀（已知坑）

- **`VER` 不能從 `src/rain.js` 移除，但改為 build 自動蓋**：本工具是純前端單檔 Bookmarklet，注入頁面後無法讀 repo 的 `CHANGELOG.md`（無後端、無 fetch）。這個識別碼是執行期必要邏輯：①面板 UI 顯示給使用者；②防重複注入 `if(window.__RH_VER===VER)`（舊版殘留要能被偵測拆掉）。因此**不是刪掉，而是把「手填 semver」換成「build 自動蓋日期」**——`src` 放佔位符，build 蓋真值，零人工。
- **CHANGELOG.md 是新增、與 record.md §7 分工**：`docs/record.md` §7（逐版變更明細、含踩雷脈絡）維持〔歷史·只增不改〕不動。新增的 `CHANGELOG.md` 放專案根目錄，給人快速掃視，改成**日期式一列一筆**（非 semver）。
- **精簡門禁的取捨**：git 層級檢查只擋「忘了 build（dist 沒跟著 staged）」，**擋不住「dist 被手改」或「dist 從更舊的 src 編」**。這靠 CLAUDE.md 鐵則「絕不手改 dist」補足即可，對單檔 POC 是合理取捨。（因為不重編比對，也就沒有「日期讓比對失準」的問題。）
- **pre-commit hook 要能跟著 repo 走**：`.git/hooks/` 不受版控。改用版控的 `.githooks/` 目錄 + 一次性 `git config core.hooksPath .githooks` 啟用（指令寫進 README/CLAUDE.md）。不寫 `install-hooks.mjs`、不加 `prepare` script。
- **升版儀式全面廢除**：不再有 `npm version <type>`、不再自動 `git tag`、不再有 `scripts/version.mjs` 同步版號。改動程式碼不綁定任何版號決策。

---

## ① 改 `src/rain.js`：VER 佔位符化

**現況**：`src/rain.js` L58 硬編 `var VER='1.7'`，靠 `scripts/version.mjs` 手動同步。

**要做**：
- [x] 把 `var VER='1.7'` 改成佔位符，例如 `var VER='__BUILD_ID__'`。
- [x] 確認 L65（防重入比對）、L76（蓋 window）、L154（meta 回傳）、L441（面板顯示）四處引用不變——它們只需要「一個會變的識別碼」，不在意內容格式。
- [x] 面板顯示字樣由 `v'+VER` 改為適合日期的呈現（例如「更新 」+VER，不再有 `v` 前綴）。

**驗收**：`src/rain.js` 內不再有任何人工版本號；佔位符在未 build 時原樣存在。

---

## ② 改 build：自動蓋日期識別碼（`scripts/build.mjs`）

**要做**：
- [x] 新增 `scripts/build.mjs` 包裝：跑 terser（`terser@5.31.0`、原參數）→ 讀 `dist/rain.js` → 把 `__BUILD_ID__` 取代成今天日期（`YYYY-MM-DD`）→ 寫回。
- [x] `package.json` 的 `build` 指向 `node scripts/build.mjs`。
- [x] build 產物 `dist/rain.js` 內含當天日期作為識別碼。

**驗收**：`npm run build` 後 `dist/rain.js` 的識別碼＝當天日期；面板與安裝頁顯示該日期。

---

## ③ 新增 `CHANGELOG.md`（日期式、append-only）

**現況問題**：`docs/record.md` §7 是含踩雷脈絡的重量級明細，不利快速掃「最近改了什麼」。

**要做**：
- [x] 專案根目錄新增 `CHANGELOG.md`，格式為**日期式一列一筆**（日期＋一句話摘要，可連回 `docs/record.md` §7 找細節）。首次建立時把既有 v1.x 歷史濃縮成對應日期條目。
- [x] 純手動維護（一列文字，門檻極低）；不寫自動化腳本，避免又長機器。
- [x] `docs/record.md` §7 維持〔歷史·只增不改〕不動；不搬遷既有內容。

**驗收**：`CHANGELOG.md` 存在、日期式、一眼看得出最近變更；與 record.md §7 分工不重複手動維護。

---

## ④ 精簡 `package.json`（只留 `build`）

**要做**：
- [x] `scripts` 精簡成單一項：
  ```json
  "scripts": {
    "build": "node scripts/build.mjs"
  }
  ```
- [x] **移除** `"version": "..."` 這條 npm version 生命週期腳本。
- [x] `scripts/version.mjs` 刪除（不再被任何流程呼叫）。

**驗收**：`npm run build` 可獨立跑；`package.json` 內不再有 `npm version` 相關流程與多餘 script。

---

## ⑤ 可攜式 pre-commit（git 層級 dist 檢查）

**現況問題**：改了 `src/rain.js` 卻忘了重編 `dist/rain.js`，安裝頁會載到舊碼。

**要做**：
- [x] 版控目錄新增 `.githooks/pre-commit`（shell，數行）：
  - 若本次 staged 含 `src/rain.js` 但**未**含 `dist/rain.js` → **擋 commit**，印修復指引（`npm run build && git add dist/rain.js`）。
  - （選配·提示不擋）若 staged 含 `src/rain.js` 但未動 `CHANGELOG.md` → 印提醒。
- [x] 啟用方式：一次性 `git config core.hooksPath .githooks`，指令寫進 README「開發前置」與 CLAUDE.md。
- [x] 給 `.githooks/pre-commit` 執行權限（`chmod +x`）。

**驗收**：
- 只 stage `src/rain.js`、沒 stage `dist/rain.js` 時 `git commit` 被擋；兩者都 stage 時放行。
- 設過 `core.hooksPath` 後，hook 隨 repo 走，不需再手動放檔。

---

## ⑥ 更新 `CLAUDE.md`（作廢升版鐵則）

**要做**：
- [x] **鐵則 2 整條作廢改寫**：從「升版只改 package.json version、跑 npm version」→「**不需管版本號**。改完 `src/rain.js` → `npm run build` → 到 `CHANGELOG.md` 加一列（日期＋摘要）→ commit。識別碼由 build 自動蓋日期，勿手填。」
- [x] **鐵則 4 改寫**：版本字串不再來自 package.json；識別碼是 build 時蓋的日期，`meta` 即時產生，勿硬編。
- [x] 「檔案角色」表：新增 `CHANGELOG.md` 一列；移除 `scripts/version.mjs`，新增 `scripts/build.mjs`、`.githooks/pre-commit`。
- [x] 「常用指令」：移除 `npm version minor`；補一次性 `git config core.hooksPath .githooks`（開發前置）。
- [x] 補交付 SOP：每次程式異動 → build → 確認 `docs/record.md` §7 與 `CHANGELOG.md` 已同步。

**驗收**：`CLAUDE.md` 不再出現任何「升版 / semver / npm version」指示，改為「build + changelog」流程，供未來 AI 代理遵照。

---

## 落地順序建議

①（src 佔位符）→ ②（build 蓋日期）→ ③（CHANGELOG）→ ④（package.json）→ ⑤（hook）→ ⑥（CLAUDE.md），最後同步 `docs/record.md`。
