# CLAUDE.md

給接手此專案的 AI／開發者的**規則入口**。詳細架構與歷史見 `docs/record.md`。

## 這是什麼

「落雨小幫手」——一支 **Bookmarklet**，注入 NCDR 官網（`watch.ncdr.nat.gov.tw/appv2/`）後，把雨量雲圖轉成單一鄉鎮的「時間 × 雨量等級」表格。純前端、單檔、無後端、無外部圖資。

## 檔案角色（先搞懂再動手）

| 路徑 | 角色 | 能不能手改 |
| --- | --- | --- |
| `src/rain.js` | 原始碼（含註解），工具本體 | ✅ **開發只改這支** |
| `dist/rain.js` | terser 壓縮產物，安裝頁載入的就是它 | ❌ build 產生，手改會被覆蓋 |
| `dist/落雨小幫手…安裝說明.html` | 安裝頁；`<script src="rain.js">` 相對載入 | 內容固定，須與 `dist/rain.js` **同層** |
| `docs/record.md` | 開發紀錄簿：架構、踩雷、每輪變更、待辦 | ✅ 每次異動必同步（見該檔頂部「維護鐵則」） |
| `scripts/version.mjs` | 版本單一來源同步腳本 | 一般不用動 |

## 鐵則

1. **改 `src/rain.js`，不改 `dist/rain.js`**；改完 `npm run build`。
2. **升版只改 `package.json` 的 `version`**，跑 `npm version <major|minor|patch>`——會自動同步 `src` 的 `VER`、README、重建 `dist`、打 tag。**不要手改 `VER` 或 README 版本號。**
3. **任何程式碼異動都要回頭更新 `docs/record.md`**（變更紀錄、現況、待辦），這是本專案的接手依據；`docs/record.md` 是歷史(§6,7)＋外部系統參考(§2)，規則勿複製回去。
4. 版本字串唯一來源是 `package.json`；HTML 的版本／對照表由 `dist/rain.js` 執行時 `__RH_MAIN('meta')` 即時產生，勿另外硬編。
5. 面板／判讀依賴官網 SVG 圖層與雷達 PNG 命名規則，**官網改版可能整支失效**——動到互動方式時先核對 `record.md` §2「架構特性」。

## 常用指令

```bash
npm run build        # 由 src/rain.js 產生 dist/rain.js（npx terser，免安裝）
npm version minor    # 升版 + 同步 + 重建 + tag（git 工作區需乾淨）
```
