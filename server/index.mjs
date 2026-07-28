/* 落雨小幫手 API —— 本機 Node HTTP 服務（設計見 record.md §15）
 *
 * 用法：
 *   npm run api            預設 http://localhost:8787
 *   PORT=9000 npm run api
 *
 *   GET /rain?county=臺北市&town=大安區
 *   GET /rain?county=臺北市&town=大安區&village=龍門里
 *   GET /rain?lon=121.5436&lat=25.0264
 *   GET /meta              色盤與等級對照
 */

import { createServer } from 'node:http';
import { LV, bandRange, PAL } from './lib/palette.mjs';
import { buildMask } from './lib/mask.mjs';
import { listFrames } from './lib/ncdr.mjs';
import { sampleFrame, runPool } from './lib/sample.mjs';
import {
  VILL_VER, findTown, findAt, townPolys, findVillage, villagesOf
} from './lib/geo.mjs';

const PORT = +(process.env.PORT || 8787);

/* 台灣時間 ISO 字串（+08:00）。影像檔名時間戳本身是 UTC。 */
function iso8(d) {
  const t = new Date(d.getTime() + 8 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
         `T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00+08:00`;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* 三種查詢輸入 → 統一的「取樣範圍」表示
   ⚠️ 座標查詢刻意只回鄉鎮層級：v1.12（§14.1）才把「點地圖選點」的粒度
      統一到鄉鎮，API 若在座標查詢直接回村里，等於把那個不一致重新引進來。
      點到的村里只當 hintVillage 附註。 */
function resolveArea(q) {
  const hasLL = q.has('lon') || q.has('lat');
  const hasName = q.has('county') || q.has('town');

  if (hasLL) {
    const lon = parseFloat(q.get('lon')), lat = parseFloat(q.get('lat'));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new HttpError(400, 'lon／lat 需為數字');
    }
    const hit = findAt(lon, lat);
    if (!hit) throw new HttpError(404, `座標 (${lon}, ${lat}) 不在任何鄉鎮範圍內`);
    return {
      county: hit.county, town: hit.town, code: hit.code,
      village: null, hintVillage: hit.village,
      level: 'town', matchedBy: 'lonlat',
      polys: townPolys(hit.code)
    };
  }

  if (!hasName) throw new HttpError(400, '請提供 county+town，或 lon+lat');
  const inCounty = q.get('county'), inTown = q.get('town');
  if (!inCounty || !inTown) throw new HttpError(400, 'county 與 town 都要提供');

  /* ⚠️ 用 hit.county／hit.town（圖資的權威寫法），不是呼叫端輸入的字串——
     「臺」和「台」都能查，但回應一律用圖資寫法，才不會同一個地方兩種寫法，
     也才與 bookmarklet 面板顯示的地名一致。詳見 geo.mjs 的 findTown()。 */
  const hit = findTown(inCounty, inTown);
  if (!hit) throw new HttpError(404, `找不到行政區「${inCounty}${inTown}」`);
  const { code, county, town } = hit;

  const inVillage = q.get('village');
  if (inVillage) {
    const v = findVillage(code, inVillage);
    if (!v) {
      const names = (villagesOf(code) || []).map(x => x[0]);
      throw new HttpError(404,
        `「${county}${town}」底下找不到「${inVillage}」（可選：${names.join('、')}）`);
    }
    return {
      county, town, code, village: v.name, hintVillage: null,
      level: 'village', matchedBy: 'name', polys: v.polys
    };
  }

  return {
    county, town, code, village: null, hintVillage: null,
    level: 'town', matchedBy: 'name', polys: townPolys(code)
  };
}

async function handleRain(q) {
  const area = resolveArea(q);
  const mk = buildMask(area.polys);
  if (!mk) throw new HttpError(500, '無法建立取樣遮罩（圖資可能有誤）');

  const { tasks: frames, stale, staleAt, staleReason } = await listFrames();
  if (!frames.length) throw new HttpError(502, '取不到 NCDR 影像清單');

  const results = await runPool(frames, t => sampleFrame(t, mk));

  const now = Date.now();
  const series = frames.map((f, i) => {
    const { s, fallback } = results[i];
    if (!s) return { time: iso8(f.t), kind: f.kind, ok: false };

    /* ⚠️⚠️ level 必須取自**主要色帶**，不是 s.lv（範圍內最大值）。
       這是照 src/rain.js:1026 `PAL[r.s.band][5]`——v1.4 刻意的設計：
       等級文字與色塊、mm 同一來源，避免「顯示小雨卻配毛雨色塊」的不一致，
       最大值另由「峰值」欄表達。
       實測佐證（2026-07-28 逐格比對）：滿州鄉 22:40 面板顯示「小雨 / 0.3~1mm /
       峰值 1.5~3mm」，若用 s.lv 會變成「中雨」——**與工具不一致**。
       s.lv 另存為 peakLevel，資訊不遺失。 */
    const level = s.band >= 0 ? PAL[s.band][5] : 0;

    return {
      time: iso8(f.t),
      /* kind = 資料的**真實來源**（檔名前綴 obs_s／nowcast_）。
         ⚠️ 面板的「實況/預報」欄不是看這個，是看時間有沒有過（src/rain.js:1029
            `isObs = r.t <= now`）——所以已過期的 nowcast 在面板上顯示為「實況」。
            要完全比照面板請改看 isPast。 */
      kind: f.kind,
      isPast: f.t.getTime() <= now,
      /* 以下三欄對應面板的「雨量等級 / 10分鐘雨量 / 峰值」 */
      level,
      levelText: LV[level] || String(level),
      mmRange: s.band >= 0 ? bandRange(s.band) : null,
      peakMmRange: s.peakBand >= 0 ? bandRange(s.peakBand) : null,
      /* 範圍內最強的那一格（面板不直接顯示，但覆蓋%低時可作為佐證） */
      peakLevel: s.lv,
      dominantBand: s.band,
      peakBand: s.peakBand,
      mmAvg: s.mmAvg,
      mmMax: s.mmMax,
      cover: Math.round(s.cover * 100) / 100,
      /* true = 雨量圖取不到，退回 dBZ 回波圖，數值僅供參考 */
      fallback,
      ok: true
    };
  });

  return {
    area: {
      county: area.county, town: area.town, village: area.village,
      hintVillage: area.hintVillage, level: area.level, matchedBy: area.matchedBy,
      townCode: area.code
    },
    source: {
      villVer: VILL_VER,
      fetchedAt: iso8(new Date()),
      /* 等效原生雷達像素數（放大不會增加真實樣本） */
      radarPixels: mk.raw,
      /* true = NCDR 清單當下取不到，用的是先前快取的舊清單（見 ncdr.mjs 的三層對策）。
         時間序列仍然正確，只是可能少了最新一格；呼叫端有權知道。 */
      listStale: stale,
      ...(stale ? { listStaleAt: iso8(new Date(staleAt)), listStaleReason: staleReason } : {})
    },
    series
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    });
    res.end(JSON.stringify(body, null, 2));
  };

  try {
    if (url.pathname === '/meta') {
      return send(200, {
        villVer: VILL_VER,
        levels: LV.map((n, i) => ({ level: i, name: n })),
        bands: PAL.map((p, i) => ({
          band: i, rgb: p.slice(0, 3), mmRange: bandRange(i), level: p[5]
        }))
      });
    }
    if (url.pathname === '/rain') {
      return send(200, await handleRain(url.searchParams));
    }
    send(404, { error: '未知路徑', paths: ['/rain', '/meta'] });
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e);
    send(500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`落雨小幫手 API  http://localhost:${PORT}`);
  console.log(`  /rain?county=臺北市&town=大安區`);
  console.log(`  /rain?county=臺北市&town=大安區&village=龍門里`);
  console.log(`  /rain?lon=121.5436&lat=25.0264`);
});
