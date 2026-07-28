/* 影像取樣 —— 對應 src/rain.js 的 sampleOne / sampleImage / runPool */

import { classify } from './palette.mjs';
import { fetchPNG } from './ncdr.mjs';

/* 並行度：每張 3300×2550 解出來約 33 MB，4 張峰值約 135 MB。
   與 bookmarklet 相同（v1.2），沒有依裝置記憶體動態調整。 */
export const CONC = 4;

/* 對單一張已解碼的 PNG 套遮罩取樣。
 * ⚠️ 三個必須照抄 sampleOne（src/rain.js:512）的語意，不能自行重推：
 *   1. cover 的分母是「遮罩內全部像素」（不扣透明）——雨量圖 98.3% 是透明底，
 *      透明像素被 classify() 判 hit:false 不計入分子，自然當成無雨，語意正確。
 *   2. band 0 白色 (255,255,255) 雖然 hit=true，但 lv=0，**不計入降雨**。
 *   3. 縮放必須是最近鄰（工具用 imageSmoothingEnabled=false）——
 *      一旦平滑插值就會製造色盤以外的混色，污染判讀。
 */
export function sampleDecoded(png, mk) {
  const { width: iw, data: d } = png;
  const { bx, by, bw, bh, cw, ch, sxr, syr, mask, inside } = mk;

  let rain = 0, best = 0, bestBand = -1, mmSum = 0, mmMax = 0;
  const bandHist = {};

  for (let y = 0; y < ch; y++) {
    /* 最近鄰：目標像素中心回推來源像素 */
    const sy = Math.min(bh - 1, Math.floor((y + 0.5) / syr)) + by;
    for (let x = 0; x < cw; x++) {
      if (!mask[y * cw + x]) continue;            /* 取樣範圍外，跳過 */
      const sx = Math.min(bw - 1, Math.floor((x + 0.5) / sxr)) + bx;
      const p = (sy * iw + sx) * 4;
      const c = classify(d[p], d[p + 1], d[p + 2], d[p + 3]);
      if (!c.hit || c.lv <= 0) continue;
      rain++;
      bandHist[c.band] = (bandHist[c.band] || 0) + 1;
      if (c.band > bestBand) bestBand = c.band;
      if (c.lv > best) best = c.lv;
      mmSum += c.mm;
      if (c.mm > mmMax) mmMax = c.mm;
    }
  }

  /* [v1.4] 代表色帶取「面積最大」者當顯示色，比取最大值穩定
     （單一像素不會決定整格顯示） */
  let domBand = -1, domN = 0;
  for (const k in bandHist) {
    if (bandHist[k] > domN) { domN = bandHist[k]; domBand = +k; }
  }

  return {
    lv: best,
    band: domBand,
    peakBand: bestBand,
    cover: inside ? rain / inside * 100 : 0,
    mmAvg: rain ? Math.round(mmSum / rain * 100) / 100 : 0,
    mmMax
  };
}

/* [v1.1 P0-2] 優先取雨量圖 _rain.png，失敗才退回 dBZ 回波圖 */
export async function sampleFrame(task, mk) {
  try {
    return { s: sampleDecoded(await fetchPNG(task.rain), mk), fallback: false };
  } catch {
    try {
      return { s: sampleDecoded(await fetchPNG(task.dbz), mk), fallback: true };
    } catch {
      return { s: null, fallback: false };
    }
  }
}

/* 固定並行度的工作池（對應 runPool），保持輸入順序 */
export async function runPool(items, worker, conc = CONC) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, lane));
  return out;
}
