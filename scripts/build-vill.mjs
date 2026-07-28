#!/usr/bin/env node
/* 村里圖資管線：政府開放資料 → 按鄉鎮切檔的 JS 包裝檔
 *
 *   npm run build:vill            # 已有產物就跳過
 *   npm run build:vill -- --force # 強制重跑
 *
 * 為什麼要包成 JS 而不是 JSON（見 docs/record.md §2.10、§13.1）：
 *   官網 CSP 的 connect-src 不含外部網域 → fetch 外部 JSON 會被擋；
 *   script-src-elem 白名單有 cdn.jsdelivr.net → 只能載「可執行的 JS」。
 *   故每個檔案自我註冊到 window.__RH_VILL[<TOWNCODE>]。
 *
 * 為什麼要切成 368 檔：
 *   ① jsDelivr 拒絕單檔 > 20 MB，全台一個檔（5.8 MB GeoJSON）雖然沒超標，
 *      但使用者只需要當下那個鄉鎮 → 按需載入平均 16 KB 就好；
 *   ② 路徑帶資料版本（data/vill/<VER>/），換圖資即換路徑，
 *      不必等 jsDelivr 對 @main 的快取失效。
 *
 * ⚠️ 產物是建置結果，跟 dist/rain.js 一樣**不要手改**。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync,
         writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- 資料來源（data.gov.tw dataset 7438「村里界圖(TWD97經緯度)」）---- */
/* 換圖資時只改這三行；VER 會成為 data/vill/<VER>/ 路徑，
   並且要同步改 src/rain.js 的 VILL_VER 常數。 */
const VER  = '1150624';
const ZIP  = 'https://www.tgos.tw/tgos/VirtualDir/Product/a04697c8-64db-450a-a105-3eb471c45abd/'
           + encodeURIComponent('村(里)界(TWD97經緯度)1150624.zip');
const SHP  = `VILLAGE_NLSC_${VER}.shp`;

/* 雷達影像涵蓋範圍（與 src/rain.js 的 SLON/SLAT/ELON/ELAT 一致）：
   範圍外的村里（東沙、南沙）永遠取不到雨量，先裁掉不佔體積。 */
const BBOX = '117.1595,21.2646,123.9804,26.5353';
/* 簡化容差 60 m：雷達 1 像素約 213×229 m，60 m 誤差在半個像素內，
   對覆蓋% 的影響遠小於判讀本身的誤差；keep-shapes 避免小村里被整個抹掉。 */
const SIMPLIFY = 'interval=60';
/* 座標小數 4 位 ≈ 10 m，再多是浪費體積。 */
const PRECISION = '0.0001';
const MAPSHAPER = 'mapshaper@0.6.102';

const OUT = join(ROOT, 'data', 'vill', VER);
const force = process.argv.includes('--force');

if (existsSync(join(OUT, 'index.js')) && !force) {
  const n = readdirSync(OUT).filter(f => f.endsWith('.js')).length;
  console.log(`✓ data/vill/${VER}/ 已存在（${n} 個檔案），略過。要重跑請加 -- --force`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'rh-vill-'));
try {
  console.log(`▸ 下載政府村里界圖 ${VER} …`);
  const zipPath = join(tmp, 'vill.zip');
  const res = await fetch(ZIP);
  if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${(statSync(zipPath).size / 1048576).toFixed(1)} MB`);

  console.log('▸ 解壓 …');
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp]);
  if (!existsSync(join(tmp, SHP))) {
    throw new Error(`解壓後找不到 ${SHP}（政府可能改了檔名，請確認 VER 與 zip 內容）`);
  }

  /* mapshaper 經 npx 取得，與 dist 的 terser 同一策略：不進 devDependencies */
  console.log('▸ mapshaper 裁切 / 簡化 / 依鄉鎮切檔 …');
  const geo = join(tmp, 'geo');
  mkdirSync(geo);
  execFileSync('npx', ['-y', MAPSHAPER, join(tmp, SHP),
    '-clip', `bbox=${BBOX}`,
    '-filter-fields', 'COUNTYNAME,TOWNNAME,VILLNAME,TOWNCODE',
    '-simplify', SIMPLIFY, 'keep-shapes',
    '-split', 'TOWNCODE',
    '-o', geo + '/', 'format=geojson', `precision=${PRECISION}`
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  /* ---- 轉成精簡 JS ---- */
  /* 官網 SVG 用「台」，政府圖資用「臺」；索引 key 一律正規化成官網那一套，
     前端才對得上（實測 367/367 命中，見 record.md §13.1）。 */
  const norm = s => s.replace(/臺/g, '台');

  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const idx = {};
  let files = 0, villages = 0, bytes = 0, biggest = ['', 0];
  let skippedNoName = 0, merged = 0;

  for (const f of readdirSync(geo).filter(f => f.endsWith('.json'))) {
    const fc = JSON.parse(readFileSync(join(geo, f), 'utf8'));
    if (!fc.features || !fc.features.length) continue;
    const p0 = fc.features[0].properties;
    const code = String(p0.TOWNCODE);

    /* 每個村里壓成 [村里名, polygons]，polygons 直接是
       GeoJSON MultiPolygon 的 coordinates 格式（= 前端 polysOf() 的輸出），
       前端拿到就能直接餵給 buildMask，不必再解 GeoJSON 包裝。
       ⚠️ 兩件必須處理的資料現實（實測踩到）：
         ① VILLNAME 為空的記錄：連江縣有大量無名島礁多邊形（北竿 44 筆、南竿 35 筆），
            不濾掉會讓村里下拉冒出一堆空選項；
         ② 同一村里被拆成多筆 feature（飛地／離島）：要合併成一個 MultiPolygon，
            否則下拉出現同名選項，且每筆只涵蓋村里的一部分。 */
    const byName = new Map();
    for (const ft of fc.features) {
      const nm = (ft.properties.VILLNAME || '').trim();
      if (!nm) { skippedNoName++; continue; }
      const g = ft.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates]
                  : g.type === 'MultiPolygon' ? g.coordinates : [];
      if (!polys.length) continue;
      if (byName.has(nm)) { byName.get(nm).push(...polys); merged++; }
      else byName.set(nm, polys.slice());
    }
    if (!byName.size) continue;

    /* 村里名排序，下拉選單才好找 */
    const arr = [...byName.entries()];
    arr.sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));

    const js = `window.__RH_VILL=window.__RH_VILL||{};window.__RH_VILL["${code}"]=`
             + JSON.stringify(arr) + ';';
    const dst = join(OUT, code + '.js');
    writeFileSync(dst, js);

    idx[norm(p0.COUNTYNAME) + '|' + norm(p0.TOWNNAME)] = code;
    files++; villages += arr.length;
    const sz = statSync(dst).size; bytes += sz;
    if (sz > biggest[1]) biggest = [`${p0.COUNTYNAME}${p0.TOWNNAME} (${code})`, sz];
  }

  writeFileSync(join(OUT, 'index.js'),
    `window.__RH_VILL_IDX=${JSON.stringify(idx)};`);

  const idxSz = statSync(join(OUT, 'index.js')).size;
  console.log(`✓ data/vill/${VER}/ 完成`);
  console.log(`  索引 index.js  ${(idxSz / 1024).toFixed(1)} KB（${Object.keys(idx).length} 個鄉鎮）`);
  console.log(`  鄉鎮檔 ${files} 個、村里 ${villages} 個、合計 ${(bytes / 1048576).toFixed(2)} MB`);
  console.log(`  平均 ${(bytes / files / 1024).toFixed(1)} KB／最大 ${biggest[0]} ${(biggest[1] / 1024).toFixed(1)} KB`);
  console.log(`  跳過無村里名的多邊形 ${skippedNoName} 筆（多為連江縣無名島礁）、`
            + `合併同名村里的額外多邊形 ${merged} 筆（飛地／離島）`);
  console.log(`\n  提醒：src/rain.js 的 VILL_VER 需為 '${VER}'；`);
  console.log('  且圖資必須 push 到公開 repo，jsDelivr 才讀得到（官網 CSP 只放行 jsDelivr／unpkg）。');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
