window.__RH_MAIN = function(__mode){
  /* 落雨小幫手 · 雨量查詢工具  rain.js

     v1.1 修正（正確性）：
       P0-1 地圖點選命中判定 → 改用「地圖視窗矩形 → 經緯度 → GeoJSON 命中」
       P0-2 取樣影像來源   → 改抓 _rain.png（雨量）而非 dBZ 回波，含 fallback
       P0-3 紅框繪製       → 改用自建 overlay，由經緯度反推螢幕座標
       P0-4 雨量色盤       → 整組換成官網色階列實測的 17 色階
       P1   模式切換偵測   → 底圖矩形變動即自動重繪紅框

     v1.2 新增（效能與體驗）：
       - 並行載入池（CONC=4），取代 16 張串行
       - 影像清單快取（60 秒 TTL）
       - 判讀結果快取（key = url|px|py）
       - 摘要列：最早降雨時間 / 最強時段
       - 狀態列顯示查詢耗時

     v1.3 修正（準確度）：
       - 取樣範圍改為**鄉鎮實際多邊形遮罩**，取代重心 41×41 方形視窗
         （方形分母含海面與鄰鎮，沿海小鄉鎮覆蓋% 被稀釋成 0）
       - 覆蓋% 不再無條件取整，<10% 顯示一位小數、<0.1% 顯示「<0.1」

     v1.4 改版（呈現）：
       - mm 範圍修正為**每兩個色帶一階**（v1.3 以前的內插推估是錯的）
       - 表格新增「類型」欄（實況／預報），兩者之間畫分隔線
       - 等級欄加上與色階列一致的**色塊**
       - mm 顯示該色帶的實際範圍（如 1~1.5mm），非等級的粗略區間
       - 代表色帶取降雨像素中**面積最大**者，非最大值（單一像素不決定顯示）
       - 面板改深色主題

     v1.5 改版（呈現）：
       - 雨量等級改為**色塊標籤**，底色直接採用動態雨量圖的色帶顏色
       - 文字色依 WCAG 相對亮度自動取黑/白，17 色皆維持可讀

     v1.6 結構（交付方式）：
       - 由 IIFE 改為掛在 window.__RH_MAIN 的具名函式，安裝頁用
         Function.prototype.toString() 還原原始碼、即時組出 javascript: 書籤網址
       - 支援 __RH_MAIN('meta')：不執行工具，只回傳版本 / 色盤 / 等級 / 說明常數，
         供安裝頁自動產生對照表 → 文件與程式碼永遠不會不同步

     詳見 record.md */

  var VER='1.6';
  /* [v1.3] 版本感知的重入保護。
     ⚠️ v1.2 以前只檢查 __RH_ACTIVE：若頁面上已有舊版在跑，
        點新版書籤只會把「舊版面板」重新顯示出來，新版永遠載不進去，
        使用者會誤以為「換了書籤還是壞的」。
     故改為：同版本才復用面板；偵測到舊版殘留就整組拆掉重建。 */
  if(window.__RH_ACTIVE){
    if(window.__RH_VER===VER){
      var ep=document.getElementById('rhpanel');
      if(ep){ep.style.display='block';return;}
    }else{
      ['rhpanel','rhoutline','rhoverlay'].forEach(function(id){
        var n=document.getElementById(id);
        if(n&&n.parentNode)n.parentNode.removeChild(n);
      });
    }
  }
  window.__RH_ACTIVE=true;
  window.__RH_VER=VER;

  var SLON=117.1595, ELON=123.9804, SLAT=21.2646, ELAT=26.5353, IW=3300, IH=2550;
  var API='https://watch.ncdr.nat.gov.tw/appv2/module/nowcast/api/cv_ncdrnowcast_appinfo_v2';
  var BASE='https://watch.ncdr.nat.gov.tw/';
  var SVGNS='http://www.w3.org/2000/svg';

  /* ---------- [v1.1 P0-4] 雨量色盤：直接取自官網色階列 #ctd_colorbar_id ---------- */
  /* 17 個色階，由 DOM 實測而得（見 record.md §2.6）。
     ⚠️ v1.0 用的是 dBZ 回波色盤，與雨量圖完全不同，已整組汰換。
     ⚠️ 重要：白色 (255,255,255) 在雨量圖中是**最低階 0mm**，不是豪雨！
        v1.0 的「白色候選豪雨」邏輯（舊 §6.2）因此不再需要，已移除。 */
  /* [v1.4] mm 範圍改為**每兩個色帶一階**（色階列標籤每 2 個 band 出現一次）。
     v1.3 以前對未標籤 band 用內插推估（0.15 / 0.6 / 1.25 …），是錯的。
     正確：labels 0 / 0.3 / 1 / 1.5 / 3 / 6 / 10 / 17 / 25 各涵蓋兩個 band。 */
  var PAL=[
    /* [R,G,B, mm下限, mm上限(null=無上限), 等級]
       等級: 0無雨 1零星/毛雨 2小雨 3中雨 4大雨 5豪雨 */
    [255,255,255, 0   , 0.1 ,0],
    [152,255,255, 0.1 , 0.3 ,1],
    [  0,206,255, 0.3 , 1   ,2],
    [  0,154,255, 0.3 , 1   ,2],
    [  0,106,247, 1   , 1.5 ,2],
    [ 46,156,  0, 1   , 1.5 ,2],
    [ 43,255,  0, 1.5 , 3   ,3],
    [254,254,  8, 1.5 , 3   ,3],
    [255,203,  0, 3   , 6   ,3],
    [255,156,  0, 3   , 6   ,3],
    [254,  0,  5, 6   , 10  ,4],
    [201,  2,  0, 6   , 10  ,4],
    [157,  0,  0, 10  , 17  ,4],
    [154,  0,157, 10  , 17  ,4],
    [207,  0,215, 17  , 25  ,5],
    [255,  0,247, 17  , 25  ,5],
    [254,203,255, 25  , null,5]
  ];
  function bandRange(i){
    var p=PAL[i];
    return p[4]===null ? '≥'+p[3]+'mm' : p[3]+'~'+p[4]+'mm';
  }
  function bandCss(i){return 'rgb('+PAL[i][0]+','+PAL[i][1]+','+PAL[i][2]+')';}
  /* [v1.5] 文字色取黑/白中**對比度較高**者，確保 17 色都看得清楚。
     ⚠️ 不可用「亮度 > 固定門檻」判斷：實測色帶 3 (0,154,255) 在門檻 0.45 下
        會被判為深色而配白字，對比僅 2.97，低於 WCAG AA-large 的 3.0。
        改為逐一計算兩種前景色的對比度再擇優。 */
  function relLum(r,g,b){
    function lin(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  }
  function contrastRatio(a,b){
    var hi=Math.max(a,b),lo=Math.min(a,b);
    return (hi+0.05)/(lo+0.05);
  }
  var L_DARK=relLum(16,24,32), L_LIGHT=relLum(255,255,255);
  function bandFg(i){
    var L=relLum(PAL[i][0],PAL[i][1],PAL[i][2]);
    return contrastRatio(L,L_DARK)>=contrastRatio(L,L_LIGHT)?'#101820':'#ffffff';
  }
  var MAXD2=60*60;  /* 最近色距離門檻，超過視為非資料像素（地名文字、界線等） */
  function classify(r,g,b,a){
    if(a<30) return {lv:0,mm:0,hit:false};
    var bi=-1,bd=1e9;
    for(var i=0;i<PAL.length;i++){
      var dr=r-PAL[i][0],dg=g-PAL[i][1],db=b-PAL[i][2];
      var d=dr*dr+dg*dg+db*db;
      if(d<bd){bd=d;bi=i;}
    }
    if(bd>MAXD2) return {lv:0,mm:0,hit:false};
    return {lv:PAL[bi][5],mm:PAL[bi][3],hit:true,band:bi};
  }
  var LV=[{n:'無雨'},{n:'零星/毛雨'},{n:'小雨'},{n:'中雨'},{n:'大雨'},{n:'豪雨'}];

  /* [v1.6] 對外中繼資料：安裝說明頁呼叫 __RH_MAIN('meta') 取得，
     用來自動產生雨量等級對照表與版本字樣。
     ⚠️ 這裡回傳的就是工具自己在用的 PAL / LV，不是另外維護的副本，
        所以文件永遠不可能跟程式碼不一致。 */
  if(__mode==='meta'){
    return {
      version: VER,
      palette: PAL,
      levels: LV.map(function(o){return o.n;}),
      geo: {lon:[SLON,ELON], lat:[SLAT,ELAT], px:[IW,IH]},
      notes: {
        querySeconds: '約 1 秒',
        frames: '過去觀測 + 未來預報共 16 格，每格 10 分鐘',
        obsVsFcst: '表格「類型」欄依實際時間標示實況／預報，兩段之間有分隔線',
        coverage: '「覆蓋」為該鄉鎮多邊形範圍內有雨的面積比例',
        peak: '「峰值」為該鄉鎮範圍內最強色帶，主等級則取面積最大的色帶'
      }
    };
  }

  if(location.hostname.indexOf('watch.ncdr.nat.gov.tw')<0){
    alert('請在「落雨小幫手」網站 (watch.ncdr.nat.gov.tw/appv2) 上執行此工具');
    return;
  }

  function getSvg(){var r=null;document.querySelectorAll('svg').forEach(function(s){if(s.querySelectorAll('path').length>=360)r=s;});return r;}

  /* ---------- [v1.1 P0-1/P0-3] 地圖視窗矩形為唯一權威座標來源 ---------- */
  /* 官網 SVG 的 width/height 寫死 1600x1236，切換「雨量/雷達回波」時容器縮放
     但 SVG 不重算，導致與底圖差 1.81 倍 → 改以地圖視窗容器的矩形為準。
     ⚠️ 不可改用底圖 <img>：
        - 時間軸播放時 <img> 會被抽換／短暫不存在
        - #TAIWAN_DBZ_PIC 的祖先 #TAIWAN_DBZ_id 帶 matrix3d 立體傾斜變換，
          其 getBoundingClientRect() 是投影後梯形的外接框，非線性、不可用
     `.domain_cls` (#TAIWAN_TOWN_id_1_do) 實測兩種模式下皆為 [307,0,884,683]，
     長寬比 1.2941 與影像 3300/2550 完全相同 → 正是完整地理範圍的視窗 */
  var ASPECT=IW/IH;
  function mapEl(){
    var e=document.querySelector('.domain_cls')||document.getElementById('TAIWAN_TOWN_id_1_do');
    if(e){var r=e.getBoundingClientRect();if(r.width>50&&r.height>50)return e;}
    /* fallback：找長寬比相符的可見容器 */
    var best=null,bestA=0;
    [].slice.call(document.querySelectorAll('div,img')).forEach(function(n){
      var r=n.getBoundingClientRect();
      if(r.width<200||r.height<150)return;
      if(Math.abs(r.width/r.height-ASPECT)>0.01)return;
      var a=r.width*r.height; if(a>bestA){bestA=a;best=n;}
    });
    return best;
  }
  function rasterRect(){var e=mapEl();return e?e.getBoundingClientRect():null;}
  function screenToLonLat(sx,sy){
    var r=rasterRect(); if(!r) return null;
    var fx=(sx-r.left)/r.width, fy=(sy-r.top)/r.height;
    if(fx<0||fx>1||fy<0||fy>1) return null;
    return [SLON+fx*(ELON-SLON), ELAT-fy*(ELAT-SLAT)];
  }
  function lonLatToScreen(lon,lat,r){
    return [r.left+(lon-SLON)/(ELON-SLON)*r.width, r.top+(ELAT-lat)/(ELAT-SLAT)*r.height];
  }

  /* ---------- [v1.1 P0-1] GeoJSON 射線法命中判定 ---------- */
  function ptInRing(pt,ring){
    var c=false;
    for(var i=0,j=ring.length-1;i<ring.length;j=i++){
      var xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
      if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))c=!c;
    }
    return c;
  }
  function polysOf(g){
    if(!g||!g.coordinates) return [];
    return g.type==='Polygon'?[g.coordinates]:(g.type==='MultiPolygon'?g.coordinates:[]);
  }
  function inGeom(pt,g){
    var polys=polysOf(g);
    for(var i=0;i<polys.length;i++){
      var poly=polys[i];
      if(ptInRing(pt,poly[0])){
        var hole=false;
        for(var k=1;k<poly.length;k++) if(ptInRing(pt,poly[k])) hole=true;
        if(!hole) return true;
      }
    }
    return false;
  }
  /* bbox 預篩，367 條 path 用 */
  var bboxCache=null;
  function buildBBox(){
    bboxCache=[];
    for(var i=0;i<paths.length;i++){
      var d=paths[i].__data__;
      if(!d||!d.geometry){bboxCache.push(null);continue;}
      var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
      polysOf(d.geometry).forEach(function(poly){
        poly[0].forEach(function(c){
          if(c[0]<mnx)mnx=c[0]; if(c[0]>mxx)mxx=c[0];
          if(c[1]<mny)mny=c[1]; if(c[1]>mxy)mxy=c[1];
        });
      });
      bboxCache.push([mnx,mny,mxx,mxy]);
    }
  }
  function findTownByLonLat(ll){
    if(!bboxCache) buildBBox();
    for(var i=0;i<paths.length;i++){
      var bb=bboxCache[i]; if(!bb) continue;
      if(ll[0]<bb[0]||ll[0]>bb[2]||ll[1]<bb[1]||ll[1]>bb[3]) continue;
      if(inGeom(ll,paths[i].__data__.geometry)) return i;
    }
    return -1;
  }

  /* ---------- API / 時間 ---------- */
  /* [v1.2] 影像清單快取：官網每 10 分鐘更新一次，60 秒內重複查詢直接復用 */
  var listCache=null, listCacheAt=0, LIST_TTL=60000;
  function fetchRows(){
    if(listCache&&Date.now()-listCacheAt<LIST_TTL) return Promise.resolve(listCache);
    return fetch(API,{cache:'no-store'}).then(function(r){return r.text();}).then(function(t){
      var lines=t.trim().split(/\r?\n/), rows=[];
      for(var i=1;i<lines.length;i++){var c=lines[i].split(','); if(c.length>=3)rows.push(c);}
      listCache=rows; listCacheAt=Date.now();
      return rows;
    }).catch(function(){return listCache||[];});
  }
  function pad(n){return (n<10?'0':'')+n;}
  function fmtLocal(u){var d=new Date(u.getTime()+8*3600000);return pad(d.getUTCMonth()+1)+'/'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());}
  function parseTime(fn){
    var m=fn.match(/obs_s(\d{12})/);
    if(m){var s=m[1];return new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12)));}
    var n=fn.match(/nowcast_(\d{12})_s(\d+)/);
    if(n){var s2=n[1];var base=new Date(Date.UTC(+s2.slice(0,4),+s2.slice(4,6)-1,+s2.slice(6,8),+s2.slice(8,10),+s2.slice(10,12)));return new Date(base.getTime()+parseInt(n[2],10)*600000);}
    return null;
  }

  /* ---------- [v1.3] 鄉鎮多邊形遮罩 ---------- */
  /* v1.3 以前：以鄉鎮重心取固定 41×41 方形視窗取樣。
     問題：分母是整個方形，含海面與鄰近鄉鎮 →
       - 沿海／小面積鄉鎮的覆蓋% 被稀釋，四捨五入後顯示 0
       - 實測彰化縣大城鄉：方形法 7.0%，多邊形遮罩法 14.5%（差 2 倍）
     v1.3：改用鄉鎮實際多邊形當遮罩，分母 = 鄉鎮內像素數。 */
  var maskCache={};
  function townMask(idx){
    if(maskCache[idx]) return maskCache[idx];
    var d=paths[idx].__data__; if(!d||!d.geometry) return null;
    var polys=polysOf(d.geometry);
    var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    polys.forEach(function(po){po[0].forEach(function(c){
      var p=lonlatToPxF(c[0],c[1]);
      if(p[0]<mnx)mnx=p[0]; if(p[0]>mxx)mxx=p[0];
      if(p[1]<mny)mny=p[1]; if(p[1]>mxy)mxy=p[1];
    });});
    var bx=Math.floor(mnx),by=Math.floor(mny);
    var bw=Math.max(1,Math.ceil(mxx)-bx+1), bh=Math.max(1,Math.ceil(mxy)-by+1);
    /* 尺寸夾在 [48,512]：太小取樣點不足、太大浪費記憶體 */
    var m=Math.max(bw,bh), scale=1;
    if(m>512) scale=512/m; else if(m<48) scale=48/m;
    var cw=Math.max(1,Math.round(bw*scale)), ch=Math.max(1,Math.round(bh*scale));
    var sxr=cw/bw, syr=ch/bh;
    var mc=document.createElement('canvas'); mc.width=cw; mc.height=ch;
    var mx=mc.getContext('2d');
    mx.fillStyle='#fff'; mx.beginPath();
    polys.forEach(function(po){po.forEach(function(ring){
      ring.forEach(function(c,i){
        var p=lonlatToPxF(c[0],c[1]);
        var X=(p[0]-bx)*sxr, Y=(p[1]-by)*syr;
        if(i)mx.lineTo(X,Y); else mx.moveTo(X,Y);
      });
      mx.closePath();
    });});
    mx.fill('evenodd');   /* evenodd 讓內環（飛地/孔洞）正確扣除 */
    var md=mx.getImageData(0,0,cw,ch).data;
    var inside=0;
    for(var i=3;i<md.length;i+=4) if(md[i]>128) inside++;
    if(!inside) return null;
    var o={bx:bx,by:by,bw:bw,bh:bh,cw:cw,ch:ch,mask:md,inside:inside};
    maskCache[idx]=o;
    return o;
  }
  function lonlatToPxF(lon,lat){return [(lon-SLON)/(ELON-SLON)*IW,(ELAT-lat)/(ELAT-SLAT)*IH];}

  /* ---------- 影像取樣 ---------- */
  function sampleOne(url,mk){
    return new Promise(function(res){
      var img=new Image(); img.crossOrigin='anonymous';
      img.onload=function(){
        try{
          var cv=document.createElement('canvas');cv.width=mk.cw;cv.height=mk.ch;
          var ctx=cv.getContext('2d');
          /* 放大時關閉插值，避免產生色盤以外的混色 */
          ctx.imageSmoothingEnabled=false;
          ctx.drawImage(img,mk.bx,mk.by,mk.bw,mk.bh,0,0,mk.cw,mk.ch);
          var d=ctx.getImageData(0,0,mk.cw,mk.ch).data, mask=mk.mask;
          var rain=0,best=0,bestBand=-1,mmSum=0,mmMax=0;
          var bandHist={};
          for(var i=0;i<d.length;i+=4){
            if(mask[i+3]<=128) continue;          /* 鄉鎮範圍外，跳過 */
            var c=classify(d[i],d[i+1],d[i+2],d[i+3]);
            if(!c.hit) continue;
            if(c.lv>0){
              rain++;
              bandHist[c.band]=(bandHist[c.band]||0)+1;
              if(c.band>bestBand)bestBand=c.band;
              if(c.lv>best)best=c.lv;
              mmSum+=c.mm;
              if(c.mm>mmMax)mmMax=c.mm;
            }
          }
          /* [v1.4] 代表色帶：取降雨像素中「面積最大」的色帶當顯示色，
             比取最大值穩定（單一像素不會決定整格顯示） */
          var domBand=-1,domN=0;
          for(var k in bandHist){ if(bandHist[k]>domN){domN=bandHist[k];domBand=+k;} }
          res({
            lv:best,
            band:domBand,
            peakBand:bestBand,
            cover:mk.inside?rain/mk.inside*100:0,
            mmAvg:rain?Math.round(mmSum/rain*100)/100:0,
            mmMax:mmMax
          });
        }catch(e){res({lv:-1,cover:0});}
      };
      img.onerror=function(){res({lv:-1,cover:0});};
      img.src=url;
    });
  }
  /* [v1.3] 覆蓋% 不再無條件四捨五入成整數，避免稀疏降雨顯示為 0 */
  function fmtCover(c){
    if(c<=0) return '0';
    if(c<0.1) return '<0.1';
    if(c<10) return c.toFixed(1);
    return String(Math.round(c));
  }
  /* [v1.1 P0-2] 優先取雨量圖 _rain.png，失敗才退回 dBZ 回波圖 */
  /* [v1.2] 判讀結果快取：key = url|鄉鎮索引，同鄉鎮重查即時完成 */
  var sampleCache={};
  function sampleImage(rainUrl,dbzUrl,mk,idx){
    var key=rainUrl+'|'+idx;
    if(sampleCache[key]) return Promise.resolve(sampleCache[key]);
    return sampleOne(rainUrl,mk).then(function(s){
      if(s.lv>=0) return {s:s,fallback:false};
      return sampleOne(dbzUrl,mk).then(function(s2){return {s:s2,fallback:true};});
    }).then(function(o){ sampleCache[key]=o; return o; });
  }

  /* [v1.2] 並行載入池：限制同時解碼張數，避免 16 張 3300×2550 同時解碼撐爆記憶體
     單張解碼後點陣約 3300×2550×4B ≈ 33 MB，故上限設 4（約 135 MB 峰值） */
  var CONC=4;
  function runPool(items,worker,onProgress){
    return new Promise(function(resolve){
      var idx=0, active=0, done=0, out=new Array(items.length);
      function next(){
        if(done===items.length){resolve(out);return;}
        while(active<CONC && idx<items.length){
          (function(i){
            active++; idx++;
            worker(items[i],i).then(function(r){
              out[i]=r; active--; done++;
              if(onProgress)onProgress(done,items.length);
              next();
            });
          })(idx);
        }
      }
      next();
    });
  }

  /* ---------- UI ---------- */
  var css=document.createElement('style');
  /* [v1.4] 深色主題 */
  css.textContent='#rhpanel{position:fixed;top:70px;right:14px;width:432px;max-height:82vh;overflow-y:auto;overflow-x:hidden;background:#1b2431;border:1px solid #33415a;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.5);font:13px/1.5 "Microsoft JhengHei",sans-serif;z-index:2147483000;color:#e6edf6}'
    +'#rhbar{background:#243147;color:#fff;padding:7px 10px;font-weight:bold;cursor:move;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;border-bottom:1px solid #33415a}'
    +'#rhclose{cursor:pointer;padding:0 6px;opacity:.75}#rhclose:hover{opacity:1}'
    +'#rhbody{padding:10px}'
    +'#rhpanel label,#rhpanel div{color:#e6edf6}'
    +'#rhpanel select{width:100%;padding:5px;margin:2px 0;background:#0f1621;color:#e6edf6;border:1px solid #33415a;border-radius:4px;font:13px inherit}'
    +'#rhpick{width:100%;padding:7px;background:#2563a8;color:#fff;border:0;border-radius:5px;cursor:pointer;margin-top:8px;font:13px inherit}'
    +'#rhpick:hover{background:#2d74c4}'
    +'#rhstatus{margin:6px 0;color:#9fb0c8;min-height:18px;font-size:12px}'
    +'#rhsum{font-size:12px;font-weight:bold;color:#cfe4ff;background:#22344d;border-radius:4px;padding:5px 7px;margin:5px 0}#rhsum:empty{display:none}'
    +'#rhwarn{font-size:11px;color:#ffc069;margin-top:4px}'
    +'#rhresult{width:100%;border-collapse:collapse;margin-top:8px}'
    +'#rhresult th,#rhresult td{padding:4px 3px;text-align:center;font-size:11.5px;border:0;white-space:nowrap}'
    +'#rhresult th{color:#9fb0c8;font-weight:normal;border-bottom:1px solid #33415a}'
    +'#rhresult td{border-bottom:1px solid rgba(255,255,255,.05)}'
    +'#rhresult tr.rhsep td{border-top:2px solid #5b7ba8}'
    +'#rhresult .rhtype{color:#8b9cb5}'
    +'#rhresult .rhlv{padding:3px 4px}'
    +'.rhchip{display:inline-block;min-width:62px;padding:2px 7px;border-radius:9px;font-size:11px;font-weight:bold;line-height:1.45;text-align:center;box-shadow:0 0 0 1px rgba(255,255,255,.18)}'
    +'.rhchip0{background:#39414f;color:#94a2b6;font-weight:normal}';
  document.head.appendChild(css);
  var p=document.createElement('div');p.id='rhpanel';
  p.innerHTML='<div id="rhbar"><span>🌧️ 落雨小幫手 · 雨量查詢 <span style="font-weight:normal;opacity:.7">v1.5</span></span><span id="rhclose">✕</span></div><div id="rhbody"><div>縣市 <select id="rhco"></select></div><div>鄉鎮 <select id="rhtw"></select></div><button id="rhpick">或：點地圖選點</button><div id="rhstatus">請選擇地區</div><div id="rhsum"></div><div id="rhwarn"></div><table id="rhresult"></table></div>';
  document.body.appendChild(p);
  (function(){var bar=document.getElementById('rhbar'),dx,dy,drag=false;
   bar.onmousedown=function(e){if(e.target.id==='rhclose')return;drag=true;dx=e.clientX-p.offsetLeft;dy=e.clientY-p.offsetTop;e.preventDefault();};
   document.addEventListener('mousemove',function(e){if(drag){p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';}});
   document.addEventListener('mouseup',function(){drag=false;});})();
  document.getElementById('rhclose').onclick=function(){p.style.display='none';removeOutline();};

  var svg=getSvg();
  if(!svg){alert('找不到官網鄉鎮圖層，官網可能已改版（見 record.md §2.2）');return;}
  if(!rasterRect()){alert('找不到地圖視窗容器 .domain_cls，官網可能已改版（見 record.md §2.9）');return;}
  var paths=svg.querySelectorAll('path'), byCounty={};
  paths.forEach(function(pt,idx){var d=pt.__data__&&pt.__data__.properties;if(!d)return;(byCounty[d.COUNTYNAME]=byCounty[d.COUNTYNAME]||[]).push({tw:d.TOWNNAME,idx:idx});});
  var coSel=document.getElementById('rhco'),twSel=document.getElementById('rhtw');
  coSel.innerHTML='<option value="">--</option>'+Object.keys(byCounty).map(function(c){return '<option>'+c+'</option>';}).join('');
  coSel.onchange=function(){var c=coSel.value;twSel.innerHTML='<option value="">--</option>'+((byCounty[c]||[]).map(function(t){return '<option value="'+t.idx+'">'+t.tw+'</option>';}).join(''));};
  twSel.onchange=function(){if(twSel.value!=='')selectTown(parseInt(twSel.value,10));};

  /* ---------- [v1.1 P0-3] 紅框：自建 overlay，由經緯度反推螢幕座標 ---------- */
  var curIdx=-1, overlay=null, lastSig='';
  function ensureOverlay(){
    if(overlay&&overlay.parentNode) return overlay;
    overlay=document.createElementNS(SVGNS,'svg');
    overlay.id='rhoverlay';
    overlay.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147482000';
    document.body.appendChild(overlay);
    return overlay;
  }
  function drawOutline(idx){
    removeOutline();
    var d=paths[idx]&&paths[idx].__data__; if(!d||!d.geometry) return;
    var r=rasterRect(); if(!r) return;
    var dstr='';
    polysOf(d.geometry).forEach(function(poly){
      poly.forEach(function(ring){
        ring.forEach(function(c,i){
          var s=lonLatToScreen(c[0],c[1],r);
          dstr+=(i?'L':'M')+s[0].toFixed(1)+' '+s[1].toFixed(1);
        });
        dstr+='Z';
      });
    });
    if(!dstr) return;
    var np=document.createElementNS(SVGNS,'path');
    np.setAttribute('d',dstr);
    np.setAttribute('fill','none');
    np.setAttribute('stroke','red');
    np.setAttribute('stroke-width','2');
    np.setAttribute('stroke-linejoin','round');
    np.setAttribute('id','rhoutline');
    ensureOverlay().appendChild(np);
  }
  function removeOutline(){var o=document.getElementById('rhoutline');if(o&&o.parentNode)o.parentNode.removeChild(o);}
  function rectSig(){
    var r=rasterRect(); if(!r) return '';
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(',');
  }
  /* [v1.1 P1] 底圖矩形一有變動（含左下角雨量/雷達切換）即重繪；
     嚴禁改用 MutationObserver — 會無限迴圈凍結分頁，見 record.md §6.1 */
  setInterval(function(){
    if(curIdx<0) return;
    var sig=rectSig();
    if(sig!==lastSig||!document.getElementById('rhoutline')){ lastSig=sig; drawOutline(curIdx); }
  },600);
  window.addEventListener('resize',function(){
    if(curIdx>=0){setTimeout(function(){drawOutline(curIdx);},300);setTimeout(function(){drawOutline(curIdx);},900);}
  });

  function selectTown(idx){
    curIdx=idx; lastSig=rectSig(); drawOutline(idx);
    var d=paths[idx].__data__.properties;
    /* [v1.3] 改以整個鄉鎮多邊形取樣，不再用重心方形視窗 */
    var mk=townMask(idx);
    if(!mk){document.getElementById('rhstatus').textContent='無法建立此鄉鎮的取樣範圍';return;}
    runQuery(mk,idx,d.COUNTYNAME+d.TOWNNAME);
  }

  function runQuery(mk,idx,label){
    document.getElementById('rhstatus').textContent='查詢 '+label+'（範圍 '+mk.inside+' 像素）…';
    document.getElementById('rhwarn').textContent='';
    document.getElementById('rhsum').textContent='';
    document.getElementById('rhresult').innerHTML='';
    fetchRows().then(function(rows){
      var tasks=[];
      rows.forEach(function(c){
        var raw=(c[2]||'').replace(/^"|"$/g,'');
        if(!/\.png/i.test(raw))return;
        var abs=function(f){return /^https?:/.test(f)?f:(BASE+f.replace(/^\//,''));};
        /* [v1.1 P0-2] API 回傳的是 dBZ 回波檔名，雨量圖為同名加 _rain */
        var rainUrl=abs(raw.replace(/\.png$/i,'_rain.png'));
        var dbzUrl=abs(raw);
        var t=parseTime(raw);
        if(t)tasks.push({rain:rainUrl,dbz:dbzUrl,t:t});
      });
      if(!tasks.length){document.getElementById('rhstatus').textContent='無法取得雷達影像清單';return;}
      tasks.sort(function(a,b){return a.t-b.t;});
      /* [v1.2] 改為並行載入（原為 16 張串行） */
      var t0=Date.now();
      runPool(tasks,function(tk){
        return sampleImage(tk.rain,tk.dbz,mk,idx).then(function(o){
          return {t:tk.t,s:o.s,fallback:o.fallback};
        });
      },function(done,total){
        document.getElementById('rhstatus').textContent='查詢 '+label+' … '+done+'/'+total;
      }).then(function(out){
        var results=[],fellBack=0;
        out.forEach(function(o){ if(!o)return; if(o.fallback)fellBack++; results.push({t:o.t,s:o.s}); });
        results.sort(function(a,b){return a.t-b.t;});
        render(results,label,fellBack,tasks.length,Date.now()-t0);
      });
    });
  }

  function render(results,label,fellBack,total,elapsed){
    var now=Date.now();
    /* [v1.4] 表格改版：新增「實況/預報」欄與色塊，mm 顯示實際色帶範圍，
       觀測與預報之間畫分隔線 */
    var html='<tr><th>時間</th><th>類型</th><th>雨量等級</th><th>10分鐘雨量</th><th>峰值</th><th>覆蓋</th></tr>';
    var prevObs=null;
    results.forEach(function(r){
      if(r.s.lv<0)return;
      /* [v1.4] 等級文字取自**主要色帶**，與色塊、mm 同一來源，避免
         「顯示小雨卻配毛雨色塊」的不一致。最大值另由「峰值」欄表達。 */
      var lvIdx=r.s.band>=0?PAL[r.s.band][5]:0;
      var lv=LV[lvIdx]||LV[0];
      var isNow=Math.abs(r.t.getTime()-now)<300000;
      var isObs=r.t.getTime()<=now;                    /* 已發生 = 實況 */
      var sep=(prevObs===true&&isObs===false)?' class="rhsep"':'';
      prevObs=isObs;
      var b=r.s.band;
      /* [v1.5] 等級做成色塊標籤：底色 = 該色帶的雨量圖顏色，文字自動取對比色 */
      var sw=b>=0
        ? '<span class="rhchip" style="background:'+bandCss(b)+';color:'+bandFg(b)+'">'+lv.n+'</span>'
        : '<span class="rhchip rhchip0">'+lv.n+'</span>';
      var mm=b>=0?bandRange(b):'—';
      var peak=(r.s.peakBand>=0&&r.s.peakBand!==b)?bandRange(r.s.peakBand):'—';
      html+='<tr'+sep+(isNow?' style="background:rgba(255,214,0,.14)"':'')+'>'
        +'<td>'+fmtLocal(r.t)+'</td>'
        +'<td class="rhtype">'+(isObs?'實況':'預報')+'</td>'
        +'<td class="rhlv">'+sw+'</td>'
        +'<td>'+mm+'</td>'
        +'<td>'+peak+'</td>'
        +'<td>'+fmtCover(r.s.cover)+'%</td></tr>';
    });
    document.getElementById('rhresult').innerHTML=html;
    /* [v1.2] 摘要：未來最早降雨時間 / 全時段最強 */
    var future=results.filter(function(r){return r.t.getTime()>now-300000;});
    var firstRain=null,peak=null;
    future.forEach(function(r){
      if(r.s.lv>0&&!firstRain)firstRain=r;
      if(r.s.lv>0&&(!peak||r.s.lv>peak.s.lv))peak=r;
    });
    var sum;
    if(!future.length) sum='';
    else if(!firstRain) sum='☀️ 未來時段內預報不會下雨';
    else{
      var mins=Math.round((firstRain.t.getTime()-now)/60000);
      sum=(mins<=5?'🌧️ 目前正在下雨':'🌧️ 最早降雨 '+fmtLocal(firstRain.t)+'（約 '+mins+' 分鐘後）')
        + (peak?'　最強 '+LV[peak.s.lv].n+' @ '+fmtLocal(peak.t):'');
    }
    document.getElementById('rhsum').textContent=sum;
    document.getElementById('rhstatus').textContent='✅ '+label+'（每 10 分鐘一格）'
      +(elapsed?'　'+(elapsed/1000).toFixed(1)+'s':'');
    document.getElementById('rhwarn').textContent = fellBack>0
      ? '⚠️ '+fellBack+'/'+total+' 張取不到雨量圖，已退回回波強度推估，數值僅供參考'
      : '';
  }

  /* ---------- [v1.1 P0-1] 地圖點選 ---------- */
  document.getElementById('rhpick').onclick=function(){
    document.getElementById('rhstatus').textContent='請點地圖上的位置…';
    function handler(e){
      if(p.contains(e.target))return;
      document.removeEventListener('click',handler,true);
      var ll=screenToLonLat(e.clientX,e.clientY);
      if(!ll){document.getElementById('rhstatus').textContent='請點在地圖範圍內，請重試';return;}
      var found=findTownByLonLat(ll);
      if(found>=0){
        var d=paths[found].__data__.properties;
        coSel.value=d.COUNTYNAME; coSel.onchange(); twSel.value=String(found);
        selectTown(found);
      }else{
        document.getElementById('rhstatus').textContent='該點不在任何鄉鎮範圍內（'+ll[0].toFixed(3)+','+ll[1].toFixed(3)+'），請重試';
      }
    }
    setTimeout(function(){document.addEventListener('click',handler,true);},50);
  };
};
