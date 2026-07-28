/* 行政區圖資與地理查詢 —— 對應 src/rain.js 的 normName / ptInRing / inGeom
 *
 * 【與 bookmarklet 最大的架構差異】
 * 瀏覽器版的**鄉鎮**界線是讀官網 SVG 裡 D3 綁在 path.__data__.geometry 的 GeoJSON
 * （record.md §2.2）；伺服器端沒有那個頁面，必須自備。
 *
 * 但**不需要**額外圖資或 mapshaper dissolve：遮罩是 even-odd 柵格化的，
 * 把一個鄉鎮底下所有村里的環丟進同一張遮罩，結果就等於鄉鎮範圍
 * （村里彼此不重疊，每點只被一個環包住 → 奇數 → 填充）。
 * 精度佐證（§15.3）：村里圖資 simplify 容差 60 m、precision ≈11 m，
 * 而一個雷達像素約 211×228 m —— 誤差遠小於單一像素。
 *
 * 另一個好消息：官網 CSP 那套「只能用 <script> 載、不能 fetch」的繞道
 * （§13.3）在伺服器端完全不需要，直接讀本地檔即可。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* 換圖資時要同步改 src/rain.js 的 VILL_VER 與 scripts/build-vill.mjs 的 VER */
export const VILL_VER = '1150624';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VILL_DIR = join(ROOT, 'data', 'vill', VILL_VER);

/* 臺→台：官網與政府圖資的異體字不一致，比對前一律正規化 */
export function normName(s) {
  return String(s || '').replace(/臺/g, '台');
}

/* 圖資檔是「自我註冊到 window」的 JS（為了繞官網 CSP 而設計的格式），
   伺服器端沒有 window，就給它一個假的讓它註冊進來。 */
function runVillScript(file) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, 'utf8'), sandbox);
  return sandbox.window;
}

let _idx = null;
/* index.js → { "縣市|鄉鎮": "TOWNCODE" } */
export function villIndex() {
  if (_idx) return _idx;
  const f = join(VILL_DIR, 'index.js');
  if (!existsSync(f)) {
    throw new Error(`找不到村里圖資 ${f}，請先跑 npm run build:vill`);
  }
  _idx = runVillScript(f).__RH_VILL_IDX || {};
  return _idx;
}

const _townCache = new Map();
/* <TOWNCODE>.js → [ [村里名, polys], … ]，polys = [ [ring,…], … ] */
export function villagesOf(townCode) {
  if (_townCache.has(townCode)) return _townCache.get(townCode);
  const f = join(VILL_DIR, `${townCode}.js`);
  if (!existsSync(f)) { _townCache.set(townCode, null); return null; }
  const list = (runVillScript(f).__RH_VILL || {})[townCode] || null;
  _townCache.set(townCode, list);
  return list;
}

/* 鄉鎮多邊形 = 該鄉鎮所有村里多邊形的聯集（見檔頭說明） */
export function townPolys(townCode) {
  const vills = villagesOf(townCode);
  if (!vills) return null;
  const out = [];
  for (const [, polys] of vills) for (const po of polys) out.push(po);
  return out.length ? out : null;
}

/* 回傳 { name, polys }：name 是**圖資裡的權威寫法**，不是呼叫端輸入的字串。
   輸入寫「臺」也找得到，但回應一律用圖資的寫法（見 findTown 的說明）。 */
export function findVillage(townCode, villName) {
  const vills = villagesOf(townCode);
  if (!vills) return null;
  const want = normName(villName);
  for (const [name, polys] of vills) {
    if (normName(name) === want) return { name, polys };
  }
  return null;
}

/* 射線法（照抄 src/rain.js:319） */
function ptInRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/* 在外環內、且不在任何內環（孔洞）內才算命中（照抄 inGeom 的語意） */
export function inPolys(pt, polys) {
  if (!polys) return false;
  for (const poly of polys) {
    if (ptInRing(pt, poly[0])) {
      let hole = false;
      for (let k = 1; k < poly.length; k++) if (ptInRing(pt, poly[k])) hole = true;
      if (!hole) return true;
    }
  }
  return false;
}

/* 依「縣市|鄉鎮」找行政區，回傳 { code, county, town }。
 *
 * ⚠️ **回傳的 county／town 是圖資裡的權威寫法，不是呼叫端輸入的字串。**
 *    「臺」與「台」是同一個地名的兩種寫法（官方公文用「臺」，一般用「台」）：
 *      - 官網 SVG（工具的資料源）用「台」：台北市／台南市／台中市／台東縣
 *      - 政府村里圖資（API 的資料源）也用「台」（實測 96 個 key 全部是「台」，「臺」0 個）
 *    normName() 的用途是**容許輸入寫「臺」**，不是拿來當輸出。
 *    早期版本直接把呼叫端輸入的字串塞進回應，導致查「臺北市」回「臺北市」、
 *    查「台北市」回「台北市」——同一個地方兩種寫法，與工具面板顯示的也不一致。
 *    一律回權威寫法後，API 與 bookmarklet 面板的地名完全相同。
 */
export function findTown(county, town) {
  const idx = villIndex();
  const key = `${normName(county)}|${normName(town)}`;
  for (const k of Object.keys(idx)) {
    if (normName(k) === key) {
      const [c, t] = k.split('|');
      return { code: idx[k], county: c, town: t };
    }
  }
  return null;
}

/* 經緯度反查所屬鄉鎮與村里。
   ⚠️ 全台 368 個鄉鎮逐一比對太慢，先用村里外環的 bbox 粗篩再精算。 */
let _bboxes = null;
function townBBoxes() {
  if (_bboxes) return _bboxes;
  _bboxes = [];
  const idx = villIndex();
  for (const [key, code] of Object.entries(idx)) {
    const polys = townPolys(code);
    if (!polys) continue;
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (const po of polys) for (const c of po[0]) {
      if (c[0] < mnx) mnx = c[0];
      if (c[0] > mxx) mxx = c[0];
      if (c[1] < mny) mny = c[1];
      if (c[1] > mxy) mxy = c[1];
    }
    const [county, town] = key.split('|');
    _bboxes.push({ code, county, town, mnx, mny, mxx, mxy });
  }
  return _bboxes;
}

export function findAt(lon, lat) {
  const pt = [lon, lat];
  for (const b of townBBoxes()) {
    if (lon < b.mnx || lon > b.mxx || lat < b.mny || lat > b.mxy) continue;
    const vills = villagesOf(b.code);
    if (!vills) continue;
    for (const [name, polys] of vills) {
      if (inPolys(pt, polys)) {
        return { county: b.county, town: b.town, code: b.code, village: name };
      }
    }
  }
  return null;
}
