/* 多邊形遮罩 —— 對應 src/rain.js 的 lonlatToPxF / buildMask / polyMask
 *
 * 瀏覽器版用 <canvas> 的 fill('evenodd') 柵格化；Node 沒有 canvas，
 * 這裡用掃描線（scanline）演算法自己實作，even-odd 規則相同。
 *
 * ⚠️ 差異（已知並接受，見 record.md §15.6）：canvas 的 fill 有反鋸齒，
 *    邊緣像素 alpha 介於 0~255，工具用 >128 判定等於「覆蓋率 > 50%」；
 *    本檔用「像素中心是否落在多邊形內」判定。兩者在邊緣會有極少數像素差異，
 *    反映到覆蓋% 是小數點級落差，等級判定（取最大值）幾乎不受影響。
 */

/* 影像地理範圍與尺寸（record.md §2.4）。
   ⚠️ 與 scripts/build-vill.mjs 的 BBOX 完全相同——村里圖資就是照這個範圍裁切的。 */
export const IW = 3300, IH = 2550;
export const SLON = 117.1595, ELON = 123.9804;
export const SLAT = 21.2646, ELAT = 26.5353;

export function lonlatToPxF(lon, lat) {
  return [
    (lon - SLON) / (ELON - SLON) * IW,
    (ELAT - lat) / (ELAT - SLAT) * IH
  ];
}

/* polys 格式：[ [ ring, ring… ], … ]，ring = [[lon,lat], …]
   第一個 ring 是外環，其餘是內環（孔洞／飛地）——與村里圖資存的格式相同。 */
export function buildMask(polys) {
  if (!polys || !polys.length) return null;

  /* --- 1. 以外環算 bbox（照抄 polyMask：只掃 po[0]） --- */
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (const po of polys) {
    for (const c of po[0]) {
      const p = lonlatToPxF(c[0], c[1]);
      if (p[0] < mnx) mnx = p[0];
      if (p[0] > mxx) mxx = p[0];
      if (p[1] < mny) mny = p[1];
      if (p[1] > mxy) mxy = p[1];
    }
  }

  /* --- 2. bbox 夾在影像範圍內（v1.8 修正，src/rain.js:405） ---
     界外像素 alpha=0 會被 classify() 判為 hit:false 不計入分子，
     卻仍被算進 inside（分母）→ 覆蓋% 被無聲稀釋。夾住後分母跟著縮才正確。 */
  const bx = Math.max(0, Math.floor(mnx)), by = Math.max(0, Math.floor(mny));
  const ex = Math.min(IW, Math.ceil(mxx) + 1), ey = Math.min(IH, Math.ceil(mxy) + 1);
  const bw = Math.max(1, ex - bx), bh = Math.max(1, ey - by);

  /* --- 3. 尺寸夾在 [48,512]：太小取樣點不足、太大浪費記憶體 --- */
  const m = Math.max(bw, bh);
  let scale = 1;
  if (m > 512) scale = 512 / m;
  else if (m < 48) scale = 48 / m;
  const cw = Math.max(1, Math.round(bw * scale)), ch = Math.max(1, Math.round(bh * scale));
  const sxr = cw / bw, syr = ch / bh;

  /* --- 4. 把所有環轉成遮罩座標系的邊，供掃描線使用 --- */
  const edges = [];
  for (const po of polys) {
    for (const ring of po) {
      const n = ring.length;
      if (n < 2) continue;
      let prev = null;
      for (let i = 0; i < n; i++) {
        const p = lonlatToPxF(ring[i][0], ring[i][1]);
        const cur = [(p[0] - bx) * sxr, (p[1] - by) * syr];
        if (prev) edges.push([prev[0], prev[1], cur[0], cur[1]]);
        prev = cur;
      }
      /* 閉合環（對應 canvas 的 closePath()）：GeoJSON 的環通常已閉合，
         但不保證，補一條回到起點的邊才不會漏填。 */
      const first = lonlatToPxF(ring[0][0], ring[0][1]);
      const f = [(first[0] - bx) * sxr, (first[1] - by) * syr];
      if (prev && (prev[0] !== f[0] || prev[1] !== f[1])) {
        edges.push([prev[0], prev[1], f[0], f[1]]);
      }
    }
  }

  /* --- 5. 掃描線填充，even-odd 規則 ---
     even-odd 讓內環（孔洞／飛地）正確扣除；也讓「同一鄉鎮的多個村里」
     疊在一起時不會互相抵消（村里彼此不重疊，每點只被一個環包住 → 奇數 → 填充）。 */
  const mask = new Uint8Array(cw * ch);
  let inside = 0;
  const xs = [];
  for (let y = 0; y < ch; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < edges.length; i++) {
      const [x1, y1, x2, y2] = edges[i];
      /* 半開區間規則：避免頂點落在掃描線上時被重複計數 */
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) {
        xs.push(x1 + (cy - y1) / (y2 - y1) * (x2 - x1));
      }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = xs[k], xb = xs[k + 1];
      let px = Math.max(0, Math.ceil(xa - 0.5));
      const pxEnd = Math.min(cw - 1, Math.floor(xb - 0.5));
      for (; px <= pxEnd; px++) {
        const idx = y * cw + px;
        if (!mask[idx]) { mask[idx] = 1; inside++; }
      }
    }
  }
  if (!inside) return null;

  return {
    bx, by, bw, bh, cw, ch, sxr, syr, mask, inside,
    /* raw = 等效的原生雷達像素數。放大不會增加真實樣本，
       inside 只是遮罩像素數；要回報的「幾個雷達格」是這個（v1.8）。 */
    raw: Math.max(1, Math.round(inside * (bw * bh) / (cw * ch)))
  };
}
