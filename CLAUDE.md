# CLAUDE.md

給接手此專案的 AI／開發者的**規則入口**。詳細架構與歷史見 `docs/record.md`。

## 這是什麼

「落雨小幫手」——一支 **Bookmarklet**，注入 NCDR 官網（`watch.ncdr.nat.gov.tw/appv2/`）後，把雨量雲圖轉成「時間 × 雨量等級」表格。取樣範圍**跟著行政區**：選到鄉鎮就算整個鄉鎮，選到村里就算那個村里。純前端、無後端。

> 曾有「點位半徑圓」取樣（v1.8），因與村里選擇語意重疊，已於 v1.10 移除；設計與復原依據見 `record.md` §12、決策見 §7.11。**不要在沒讀過那兩節前重新加回來。**

**工具本體仍是單檔且無外部相依**；唯一例外是 **v1.9 的村里功能**——官網沒有村里圖層，故圖資自備放在 `data/vill/`，執行時經 jsDelivr 按需載入（官網 CSP 只放行 jsDelivr／unpkg，`fetch` 外部網域會被擋，見 `record.md` §2.10）。載入失敗只停用村里下拉，其餘功能不受影響。

## 檔案角色（先搞懂再動手）

| 路徑 | 角色 | 能不能手改 |
| --- | --- | --- |
| `src/rain.js` | 原始碼（含註解），工具本體 | ✅ **開發只改這支** |
| `dist/rain.js` | terser 壓縮產物，安裝頁載入的就是它 | ❌ build 產生，手改會被覆蓋 |
| `index.html` | 安裝頁（放根目錄供 GitHub Pages 部署）；`<script src="dist/rain.js">` 載入 | 內容固定，改版只換 `dist/rain.js` |
| `docs/record.md` | 開發紀錄簿：架構、踩雷、每輪變更、待辦 | ✅ 每次異動必同步（見該檔頂部「維護鐵則」） |
| `CHANGELOG.md` | 給人快速掃視的精簡變更清單（日期式、一列一筆） | ✅ 每次異動加一列 |
| `data/vill/<版本>/` | 村里圖資（`index.js` + 368 個 `<TOWNCODE>.js`），jsDelivr 按需載入 | ❌ `npm run build:vill` 產生 |
| `scripts/build.mjs` | build：terser 壓縮 + 蓋當天日期建置識別碼 | 一般不用動 |
| `scripts/build-vill.mjs` | 村里圖資管線：下載政府開放資料 → mapshaper 簡化切檔 → 包 JS | 換圖資版本才動 |
| `.githooks/pre-commit` | 門禁：src 改了但 dist 沒重編就擋 commit | 一般不用動 |
| `server/` | **API 服務**（`npm run api`）：不開瀏覽器直接查雨量，回 JSON。與 bookmarklet **完全獨立**，設計與驗收見 `record.md` §15 | ✅ 直接改，不用 build |

## 鐵則

1. **改 `src/rain.js`，不改 `dist/rain.js`**；改完 `npm run build`。
2. **不需管版本號**。流程：改 `src/rain.js` → `npm run build` → 在 `CHANGELOG.md` 最上方加一列（日期＋一句摘要）→ commit。建置識別碼（面板／安裝頁顯示的 `日期.hash4`）由 build 自動蓋，`src` 裡是佔位符 `__BUILD_ID__`，**勿手填**。hash 取自 `src/rain.js` 內容，同一天多次 build 也不會撞號（原因見 `record.md` §6.16）。沒有 `npm version`、沒有 semver、沒有 git tag。
3. **任何程式碼異動都要回頭更新 `docs/record.md`**（變更紀錄、現況、待辦），這是本專案的接手依據；`docs/record.md` 是歷史(§6,7)＋外部系統參考(§2)，規則勿複製回去。
4. 面板／安裝頁顯示的是建置識別碼 `日期.hash4`（不是版本號）；HTML 的顯示字樣／對照表由 `dist/rain.js` 執行時 `__RH_MAIN('meta')` 即時產生，勿另外硬編。
5. 面板／判讀依賴官網 SVG 圖層與雷達 PNG 命名規則，**官網改版可能整支失效**——動到互動方式時先核對 `record.md` §2「架構特性」。
6. **村里圖資只能用 `<script>` 載**（官網 CSP 擋外部 `fetch`，白名單只有 jsDelivr／unpkg 等）。
   - **要讓真實使用者能用** → 圖資必須放在白名單上的公開網域（push 到公開 repo 經 jsDelivr／發 npm 經 unpkg）。`http://localhost` 永遠不在白名單。
   - **開發測試不必 push** → 用 DevTools Local Overrides（CSP 只看請求 URL，回應可換成本機檔案），或直接注入 `window.__RH_VILL_IDX`／`window.__RH_VILL[code]`（載入函式會先看 `window`，這是設計好的合法路徑）。步驟見 `record.md` §13.10。
   - 動到村里功能前先讀 `record.md` §13；換圖資版本要同步改 `src/rain.js` 的 `VILL_VER` 與 `scripts/build-vill.mjs` 的 `VER`。
7. **非同步查詢一定要帶世代（`queryGen`）**：UI 能在前一次查詢完成前再次觸發，舊結果會覆蓋新選擇。踩過兩次，見 `record.md` §6.14。
8. **色盤有兩份副本，改一份就要改另一份**：`src/rain.js` 的 `PAL`／`classify()` 與
   `server/lib/palette.mjs` 是**刻意的重複**（API 選了「獨立新增、工具本體一行不動」，
   取捨見 `record.md` §15.2）。只改一邊 → API 與工具判讀不一致，而且**不會有任何錯誤訊息**。
   動到色盤、`classify()`、`sampleOne()` 的統計語意時，兩邊一起改並重跑 §15.10 的逐格比對。
9. **API 不是「包一層」，是第二條判讀管線**：`server/` 自己抓 PNG、自己柵格化遮罩、
   自己算統計。鄉鎮界線用**村里聯集**（不是官網 SVG，也不需要 dissolve）。
   因此 API 與面板的覆蓋% 會系統性差 2~3 個百分點，這是已量化並接受的取捨（§15.10），不是 bug。

## 常用指令

```bash
npm run api          # 啟動 API 服務（預設 8787）；不影響 bookmarklet
                     # port 被自己的舊行程佔住會自動關掉舊的再接手（§15.11）；
                     # 被別的程式佔用則不殺，改用 PORT=8788 npm run api
npm run build        # 由 src/rain.js 產生 dist/rain.js（terser 壓縮 + 蓋當天日期）
npm run build:vill   # 產生 data/vill/<版本>/（已存在則略過；加 -- --force 重跑）
git config core.hooksPath .githooks   # 每台機器一次性：啟用 pre-commit 門禁
```
