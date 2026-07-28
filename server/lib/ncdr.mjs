/* NCDR 影像清單與影像抓取 —— 對應 src/rain.js 的 fetchRows / parseTime / abs
 *
 * 【伺服器端比瀏覽器單純的地方】
 * CORS 是瀏覽器限制，不是伺服器的。清單 API 與 PNG 都能裸請求直接抓，
 * 不需要 Referer/Cookie（2026-07-28 實測，record.md §15.3）。
 */

import { PNG } from 'pngjs';

export const API = 'https://watch.ncdr.nat.gov.tw/appv2/module/nowcast/api/cv_ncdrnowcast_appinfo_v2';
export const BASE = 'https://watch.ncdr.nat.gov.tw/';

/* 相對路徑 → 絕對網址（照抄 src/rain.js:943）
   ⚠️ 一定要去掉開頭的斜線再串接：BASE 已帶尾斜線，少做這步會變成
      「//00_Wxmap/…」而 404 —— §15.3 那個一度誤判為「抓不到圖」的坑。 */
export function abs(f) {
  return /^https?:/.test(f) ? f : (BASE + f.replace(/^\//, ''));
}

/* 檔名時間戳是 UTC（實測：obs_s202607281440 對應台灣時間 22:40）。
   ⚠️ 不能改用 CSV 的 timestamp 欄——那是清單「發布時間」，三筆實測全一樣。 */
export function parseTime(fn) {
  const m = fn.match(/obs_s(\d{12})/);
  if (m) {
    const s = m[1];
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                             +s.slice(8, 10), +s.slice(10, 12)));
  }
  const n = fn.match(/nowcast_(\d{12})_s(\d+)/);
  if (n) {
    const s = n[1];
    const base = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                          +s.slice(8, 10), +s.slice(10, 12));
    /* 預報每個 s 索引 = 10 分鐘一步 */
    return new Date(base + parseInt(n[2], 10) * 600000);
  }
  return null;
}

const LIST_TTL = 60000;
const RETRY = 3, RETRY_WAIT = 400;
let listCache = null, listCacheAt = 0;

async function fetchRowsOnce() {
  const r = await fetch(API, { cache: 'no-store' });
  if (!r.ok) throw new Error(`NCDR 清單 API 回應 ${r.status}`);
  const t = await r.text();
  const lines = t.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length >= 3) rows.push(c);
  }
  if (!rows.length) throw new Error('NCDR 清單 API 回傳空清單');
  return rows;
}

/* 【官網清單 API 會瞬時回空】—— 不是理論風險，2026-07-28 開發驗收時就撞到一次：
   同一個鄉鎮前一秒查得到，下一秒回空清單。record.md §10 也記過這個現象。
   對策三層，缺一不可：
     ① 重試 3 次（瞬時異常通常下一次就好）
     ② 全失敗才回舊快取，即使已過 TTL —— 這是 bookmarklet 原有的韌性
        （src/rain.js:380 `.catch(() => listCache || [])`），不能為了「不快取失敗」
        而把它一起丟掉，否則比原版更脆弱。回舊快取時標記 stale 讓呼叫端知情。
     ③ 連舊快取都沒有（服務剛啟動就遇到異常）才拋錯
   ⚠️ 但**不快取失敗結果**——工具版把空結果也快取 60 秒，官網瞬時異常後會連續
      一分鐘查不到（§10 列為已知未修），那個缺陷不要複製過來。 */
export async function fetchRows() {
  if (listCache && Date.now() - listCacheAt < LIST_TTL) {
    return { rows: listCache, stale: false };
  }
  let lastErr;
  for (let i = 0; i < RETRY; i++) {
    try {
      const rows = await fetchRowsOnce();
      listCache = rows; listCacheAt = Date.now();
      return { rows, stale: false };
    } catch (e) {
      lastErr = e;
      if (i < RETRY - 1) await new Promise(r => setTimeout(r, RETRY_WAIT));
    }
  }
  if (listCache) {
    return { rows: listCache, stale: true, staleAt: listCacheAt, reason: String(lastErr.message) };
  }
  throw lastErr;
}

/* 清單 → 待取樣任務（雨量圖優先、dBZ 為備援，照抄 v1.1 P0-2 的策略） */
export async function listFrames() {
  const { rows, stale, staleAt, reason } = await fetchRows();
  const tasks = [];
  for (const c of rows) {
    const raw = (c[2] || '').replace(/^"|"$/g, '');
    if (!/\.png/i.test(raw)) continue;
    const t = parseTime(raw);
    if (!t) continue;
    tasks.push({
      t,
      kind: /obs_s/.test(raw) ? 'obs' : 'fcst',
      rain: abs(raw.replace(/\.png$/i, '_rain.png')),
      dbz: abs(raw)
    });
  }
  tasks.sort((a, b) => a.t - b.t);
  return { tasks, stale: !!stale, staleAt, staleReason: reason };
}

export async function fetchPNG(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`影像 ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return PNG.sync.read(buf);
}
