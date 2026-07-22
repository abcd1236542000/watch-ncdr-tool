#!/usr/bin/env node
/* 建置腳本：src/rain.js → dist/rain.js
 *
 * 兩步驟：
 *   1. terser 壓縮（版本鎖 terser@5.31.0、原參數：-c -m --comments false）
 *   2. 把產物中的佔位符 __BUILD_ID__ 蓋成今天日期（YYYY-MM-DD）
 *
 * 建置識別碼取代了舊有的手填版本號：面板與安裝頁顯示此日期、
 * 防重複注入靠 window.__RH_VER 比對此值。沒有人工版本號要維護。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

// 2) 蓋建置識別碼（當天日期，取本地時區避免 UTC 差一天）
const now = new Date();
const buildId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const before = readFileSync(out, 'utf8');
if (!before.includes('__BUILD_ID__')) {
  console.error('✗ dist/rain.js 內找不到 __BUILD_ID__ 佔位符，請確認 src/rain.js 的 var VER 仍為佔位符');
  process.exit(1);
}
writeFileSync(out, before.split('__BUILD_ID__').join(buildId));
console.log(`✓ build 完成：dist/rain.js 建置識別碼 → ${buildId}`);
