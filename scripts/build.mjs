#!/usr/bin/env node
/* 建置腳本：src/rain.js → dist/rain.js
 *
 * 兩步驟：
 *   1. terser 壓縮（版本鎖 terser@5.31.0、原參數：-c -m --comments false）
 *   2. 把產物中的佔位符 __BUILD_ID__ 蓋成建置識別碼 `YYYY-MM-DD.<hash4>`
 *
 * 建置識別碼取代了舊有的手填版本號：面板與安裝頁顯示此值、
 * 防重複注入靠 window.__RH_VER 比對此值。沒有人工版本號要維護。
 *
 * ⚠️ 為什麼要在日期後面加 hash（2026-07-28 修，見 record.md §6.16）：
 *   識別碼原本只有日期，而**同一天的多次 build 會得到相同識別碼** →
 *   重入保護判定「同版本」→ 只把舊面板重新顯示就 return，新程式碼完全沒跑。
 *   當初 §11.5 寫「識別碼只需要每次 build 會變即可」，但日期在同一天不會變，
 *   這個前提從一開始就沒成立（實際開發時一天內就迭代了四、五輪）。
 *
 *   hash 取自 **src/rain.js 的內容**（不是 dist）：
 *     - 不能用 dist：識別碼要寫進 dist 內容本身，會變成循環依賴；
 *     - 取 src 的效果一樣正確——src 沒變、產物就沒變；
 *     - 且是**冪等**的：重跑 build 不會無謂改動 dist（對 pre-commit 門禁友善）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'rain.js');
const out = join(root, 'dist', 'rain.js');

// 1) terser 壓縮（npx 即時取得，免安裝）
execFileSync(
  'npx',
  ['-y', 'terser@5.31.0', src, '-c', '-m', '--comments', 'false', '-o', out],
  { stdio: 'inherit' }
);

// 2) 蓋建置識別碼：當天日期（本地時區，避免 UTC 差一天）+ src 內容 hash 前 4 碼
//    日期給人看、hash 保證「內容不同必然不同」（見檔頭說明）
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const hash4 = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 4);
const buildId = `${date}.${hash4}`;

const before = readFileSync(out, 'utf8');
if (!before.includes('__BUILD_ID__')) {
  console.error('✗ dist/rain.js 內找不到 __BUILD_ID__ 佔位符，請確認 src/rain.js 的 var VER 仍為佔位符');
  process.exit(1);
}
writeFileSync(out, before.split('__BUILD_ID__').join(buildId));
console.log(`✓ build 完成：dist/rain.js 建置識別碼 → ${buildId}`);
