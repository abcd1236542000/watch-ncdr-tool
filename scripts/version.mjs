#!/usr/bin/env node
/* 版本號單一來源同步腳本
 *
 * 唯一來源：package.json 的 "version"（semver，例如 1.8.0）
 * 顯示版本：取 major.minor（例如 1.8），寫入下列兩處活字串：
 *   - src/rain.js      var VER='X.Y'
 *   - README.md        「目前版本 **vX.Y**」（僅此一句，歷史標記 (vN 新增) 不動）
 *
 * 由 npm 的 version 生命週期自動呼叫（見 package.json）；也可手動 `node scripts/version.mjs`。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const full = pkg.version;                       // 1.8.0
const m = /^(\d+)\.(\d+)\./.exec(full);
if (!m) {
  console.error(`✗ package.json version 格式非預期：${full}`);
  process.exit(1);
}
const short = `${m[1]}.${m[2]}`;                 // 1.8

/** 對單一檔案做一次正則取代，並回報是否命中，避免靜默失敗 */
function stamp(relPath, pattern, replacement, label) {
  const p = join(root, relPath);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(pattern, replacement);
  if (before === after) {
    if (!pattern.test(before)) {
      console.error(`✗ ${relPath} 找不到 ${label} 目標，版本未同步（請檢查 pattern）`);
      process.exit(1);
    }
    console.log(`· ${relPath} ${label} 已是 v${short}，略過`);
    return;
  }
  writeFileSync(p, after);
  console.log(`✓ ${relPath} ${label} → v${short}`);
}

stamp('src/rain.js', /var VER='[\d.]+'/, `var VER='${short}'`, 'VER');
stamp('README.md', /目前版本 \*\*v[\d.]+\*\*/, `目前版本 **v${short}**`, '目前版本');

console.log(`版本同步完成：package.json ${full} → 顯示 v${short}`);
