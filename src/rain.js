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

     v1.7 新增（自動更新）：
       - 選定鄉鎮後表格會**跟著真實時間自動前進**，不再是選取當下的靜態快照。
         驅動器（DRIVE_TICK 常駐定時器）分兩種更新：
         (a) 輕量重繪：每個 tick 用最後一次取樣結果 + 當下時間重畫表格，
             讓黃底「現在」列下移、實況/預報分隔線前進、摘要倒數，**完全不連網**。
         (b) 完整重查：跨過 10 分鐘整點窗口邊界即重跑 runQuery，補進官網新影像、
             整個時間窗往前滑一格。舊格子命中 sampleCache，只有新格子會下載。
       - **對齊官網週期 + 遲發重試**：官網每 10 分鐘才更新，且發佈常晚於整點。
         邊界剛到就抓可能撲空，故 winKey 一變就進入重查，若最新格時間沒前進
         （官網尚未發佈）就於後續 tick 內重試，抓到才把 updWindowKey 推進到本窗口；
         連試 MAXRETRY 次仍無新影像則放棄本輪，等下一個 10 分鐘窗口。
       - **隱藏即停、重開恢復**：driver 先檢查面板 display，按 ✕ 隱藏時直接跳過所有
         連網與運算；面板重新顯示（重點書籤）時 winKey 已過期 → 下一個 tick 自動補查
         追上進度。不需跨執行實例傳遞狀態。

     v1.8 新增（取樣範圍可縮小）：
       - 問題：以「整個鄉鎮」為分母時，大面積鄉鎮的覆蓋% 會被稀釋。
         實測屏東縣獅子鄉約 300 km²（≈6,150 個雷達像素），「覆蓋 1%」代表約 3 km²
         的雨區——可能整場雨都落在鄉的另一角，對「我這裡會不會下雨」沒有參考價值。
       - 官網只有鄉鎮界圖層（properties 僅 COUNTYNAME/TOWNNAME，無村里），
         故不改用行政區細分，而是加入**點位半徑圓**取樣：0.5／1／2／5 km。
         半徑 1 km ≈ 3.14 km² ≈ 64 個雷達像素，分母比全鄉小近 100 倍。
       - 遮罩建立抽成 buildMask()，鄉鎮多邊形與半徑圓共用；圓在像素空間是橢圓
         （雷達圖為等經緯度網格；此段功能 v1.10 已整組移除，設計見 record.md §12）。
       - 判讀快取 key 由「鄉鎮索引」改為「遮罩身分字串 curKey」，
         ⚠️ 這是必須的：否則切換半徑會拿到上一個範圍的結果（靜默的錯答案）。
       - 面板狀態列顯示該範圍等效幾個「雷達格」，讓樣本量透明化。

     v1.9 新增（村里取樣）：
       - v1.8 的半徑圓縮小了範圍，但**沒讓使用者指定是哪一塊**：用下拉選單時圓心是
         鄉鎮質心（程式自動決定），要指定「A 村還是 B 村」只能去點地圖，而地圖上
         看不出村里界。使用者實測後回報：「同一個鄉裡面的村里可能差很遠，
         A 豪大雨、B 小雨或無雨。」
       - 故新增第三層「村里」下拉。官網沒有村里圖層，圖資自備：
         內政部村里界圖（政府開放資料）經 scripts/build-vill.mjs 處理成
         data/vill/<VILL_VER>/<TOWNCODE>.js，由 jsDelivr 按需載入（平均 10.7 KB）。
       - ⚠️ 只能用 <script> 載，不能 fetch：官網 CSP 的 connect-src 不含外部網域，
         script-src-elem 白名單才有 cdn.jsdelivr.net（見 record.md §2.10）。
       - ⚠️ 官網用「台」、政府圖資用「臺」→ normName() 正規化後才對得上
         （實測官網 367 個鄉鎮全數命中，見 record.md §13.1）。
       - 遮罩層再抽一層 polyMask(polys,key)，鄉鎮與村里共用
         （當時還有 polyCenter(mk,key) 供半徑圓取圓心，v1.10 隨半徑功能移除）。
       - **村里圖資載入失敗一律降級**：只有村里下拉停用，鄉鎮／半徑功能完全不受影響。

     v1.10 移除（簡化取樣範圍）：
       - **移除「範圍」下拉與整組半徑圓功能**（v1.8 的 circleMask／圓心／黃色圓圈）。
         取樣範圍改成單純跟著行政區：選到鄉鎮就算整個鄉鎮，選到村里就算那個村里。
       - 動機：v1.9 的村里下拉上線後，「村里」與「範圍→整個村里」是重複表達，
         還得靠「選村里自動把範圍切過去」的隱性行為掩蓋，UI 概念多餘。
       - ⚠️ 這是使用者明確決定的取捨，代價已知並保留在文件：
         (a) 山區大村仍然很大（實測獅子鄉內獅村 81.8 km²，比原本半徑 5 km 的圓還大），
             這些地方失去再細分的能力；
         (b) 村里圖資載入失敗時只能退回整個鄉鎮，沒有零依賴的替代範圍。
         若日後要復原，v1.8 的完整設計仍在 record.md §12。

     v1.11 修正 + 新增（UI 連動與收合）：
       - 修正：切換「縣市」時只重建了鄉鎮選單，村里選單與選取狀態都沒重置，
         畫面會變成「新縣市 ＋ 舊鄉鎮的村里清單 ＋ 舊鄉鎮的外框與表格」。
         改為完整 cascade reset，並**遞增 queryGen 作廢進行中的查詢**
         （否則 in-flight 的舊查詢完成後會把舊資料寫回畫面，同 §6.14）。
       - 新增：面板收合／展開。`✕` 維持「完全隱藏」，另加 `—` 收合成約 200px 膠囊，
         膠囊標題顯示當前選取（如「🌧️ 獅子鄉竹坑村」），點 `＋` 展開。
       - ⚠️ 收合狀態的單一真實來源是 **DOM class `rhmin`**（不是 JS 變數）：
         重點書籤時走的是「重入分支」，那裡只能碰 DOM、碰不到既有閉包的變數；
         用 class 當狀態才能讓兩邊同步（見重入保護區塊）。
       - ⚠️ 收合時**只有 600ms 外框重繪跟著停**（要隱藏外框），
         30 秒自動更新 driver **照常運作**（收合是「縮到旁邊持續追蹤」）。
         兩個定時器的判斷條件因此不同，別誤改成一樣。

     v1.12 修正（點地圖的粒度）：
       - 問題：用「點地圖選點」時結果不像從下拉選鄉鎮那樣停在鄉鎮範圍，
         而是**自動縮到點到的那個村里**——同樣是「選地區」，兩條路徑粒度不一致，
         而且村里名多數人不熟，突然跳到「內獅村」不可預期。
       - 改為：點地圖一律視為「重新選地區」→ 回到**整個鄉鎮**、清掉村里選擇，
         點到的村里只用一行 `#rhhint` 提示（純文字），要縮小自己從村里下拉挑。
       - pickVillAt() 拆成 **findVillAt()：只回傳索引、無副作用**。
         ⚠️ 舊的 pickVillAt 會直接設 curVill 並改動下拉，是不一致的根源。
       - ⚠️ 提示不能塞 #rhstatus（每 30 秒被 driver 的 render 重寫會消失），
         也不能塞 #rhwarn（那是「取不到雨量圖」的警告語意）→ 另開 #rhhint。

     設計文件見 record.md §12（半徑，v1.10 已移除）、§13（村里）、§14.1（點地圖粒度）；
     實作明細見 §7.9、§7.10、§7.11、§7.12、§7.13 */

  var VER='__BUILD_ID__';  /* build 時由 scripts/build.mjs 蓋成「日期.hash」，勿手填 */
  /* [v1.11] 展開狀態的標題文字。收合時會被換成當前選取（見 capsuleTitle()），
     展開與「重點書籤」時還原成這個值，故抽成常數避免兩處字串不同步。 */
  var TITLE='🌧️ 落雨小幫手 · 雨量查詢';
  /* [v1.3] 版本感知的重入保護。
     ⚠️ v1.2 以前只檢查 __RH_ACTIVE：若頁面上已有舊版在跑，
        點新版書籤只會把「舊版面板」重新顯示出來，新版永遠載不進去，
        使用者會誤以為「換了書籤還是壞的」。
     故改為：同版本才復用面板；偵測到舊版殘留就整組拆掉重建。 */
  if(window.__RH_ACTIVE){
    if(window.__RH_VER===VER){
      var ep=document.getElementById('rhpanel');
      if(ep){
        ep.style.display='block';
        /* [v1.11] 重點書籤時一律回到展開狀態——使用者點書籤就是想看資料。
           ⚠️ 這個分支是**新的一次函式呼叫**，碰不到既有閉包的變數，只能操作 DOM；
              所以收合狀態必須以 class `rhmin` 為單一真實來源（既有閉包用
              isCollapsed() 讀 class，這裡一移除，那邊立刻同步）。 */
        ep.classList.remove('rhmin');
        var em=ep.querySelector('#rhmin'); if(em)em.textContent='—';
        var et=ep.querySelector('#rhtitlemain'); if(et)et.textContent=TITLE;
        return;
      }
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

  /* ---------- [v1.9] 村里圖資（唯一的外部相依） ---------- */
  /* VILL_VER = 政府圖資版本（民國年月日），同時是 data/vill/<VER>/ 的路徑。
     換圖資：重跑 npm run build:vill 後改這裡。路徑帶版本號的用意是
     繞過 jsDelivr 對 @main 的快取，也讓舊版仍可用。 */
  var VILL_VER='1150624';
  var VILL_SRC='https://cdn.jsdelivr.net/gh/abcd1236542000/watch-ncdr-tool@main/data/vill/';
  /* 允許以 window.__RH_VILL_BASE 覆寫，供本機測試指向其他來源 */
  var VILL_BASE=window.__RH_VILL_BASE||(VILL_SRC+VILL_VER+'/');
  var VILL_TIMEOUT=8000;
  /* 官網 SVG 用「台南市」，政府圖資用「臺南市」；一律正規化成官網那一套。 */
  function normName(s){return String(s||'').replace(/臺/g,'台');}

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
        coverage: '「覆蓋」為取樣範圍（所選鄉鎮或村里）內有雨的面積比例',
        peak: '「峰值」為取樣範圍內最強色帶，主等級則取面積最大的色帶',
        /* [v1.8] 解析度說明；[v1.10] 改以村里／鄉鎮為例，半徑功能已移除 */
        resolution: '雷達影像 1 像素約 0.21×0.23 km（≈0.05 km²）：'
          + '一個村里大約數百到一千多個像素，整個鄉鎮可達數千個'
          + '（實測屏東縣獅子鄉全鄉 6,374 個、其中楓林村 225 個）。'
          + '面板狀態列會顯示目前範圍等效幾個雷達格，範圍越小、覆蓋% 的刻度越粗',
        /* [v1.11] 面板操作說明。安裝頁原本硬編「若面板消失，再點一次書籤」，
           有了收合功能後說法要改——依鐵則 4，文案一律由這裡產生。 */
        panel: '面板右上角「—」可收合成小膠囊（膠囊上會顯示目前查的地區，'
          + '收合期間仍會持續更新，展開看到的就是最新資料）；'
          + '「✕」則完全關閉，關閉後再點一次書籤即可重新開啟。'
          + '標題列可拖曳，面板位置在收合／展開後都會保留',
        /* [v1.9] 村里功能與其外部相依，安裝頁需照實告知使用者 */
        village: '選完鄉鎮可再選「村里」，直接以該村里的實際邊界統計'
          + '（同一個鄉裡的兩個村，常常一邊在下大雨、另一邊完全沒雨；'
          + '實測屏東縣獅子鄉同一時刻，楓林村覆蓋 100%、南世村 0%）。'
          + '村里邊界圖資為內政部國土測繪中心「村里界圖」開放資料（版本 '
          + VILL_VER + '），由 jsDelivr 於選定鄉鎮時按需載入（平均約 11 KB）；'
          + '載入失敗時只有村里下拉停用，整個鄉鎮的查詢不受影響'
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
  /* [v1.8] 遮罩建立的共通部分抽成 buildMask()：鄉鎮多邊形與半徑圓只差
     「怎麼把形狀畫進 canvas」，bbox → 縮放 → 取 alpha → 算 inside 完全相同。 */
  function buildMask(mnx,mny,mxx,mxy,drawPath){
    /* [v1.8] bbox 夾在影像範圍內。
       ⚠️ 圓可能跨出雷達圖邊界（離島、極端海岸）：界外像素 alpha=0 會被 classify()
          判為 hit:false 而不計入分子，卻仍被算進 inside（分母）→ 覆蓋% 被無聲稀釋。
          夾住後分母跟著縮，語意才正確。鄉鎮遮罩全在影像內，不受影響。 */
    var bx=Math.max(0,Math.floor(mnx)), by=Math.max(0,Math.floor(mny));
    var ex=Math.min(IW,Math.ceil(mxx)+1), ey=Math.min(IH,Math.ceil(mxy)+1);
    var bw=Math.max(1,ex-bx), bh=Math.max(1,ey-by);
    /* 尺寸夾在 [48,512]：太小取樣點不足、太大浪費記憶體 */
    var m=Math.max(bw,bh), scale=1;
    if(m>512) scale=512/m; else if(m<48) scale=48/m;
    var cw=Math.max(1,Math.round(bw*scale)), ch=Math.max(1,Math.round(bh*scale));
    var sxr=cw/bw, syr=ch/bh;
    var mc=document.createElement('canvas'); mc.width=cw; mc.height=ch;
    var mx=mc.getContext('2d');
    mx.fillStyle='#fff';
    drawPath(mx,bx,by,sxr,syr);
    var md=mx.getImageData(0,0,cw,ch).data;
    var inside=0;
    for(var i=3;i<md.length;i+=4) if(md[i]>128) inside++;
    if(!inside) return null;
    return {
      bx:bx,by:by,bw:bw,bh:bh,cw:cw,ch:ch,sxr:sxr,syr:syr,
      mask:md,inside:inside,
      /* [v1.8] raw = 等效的原生雷達像素數。canvas 放大不會增加真實樣本，
         inside 只是 canvas 像素數；狀態列要顯示的「幾個雷達格」是這個。 */
      raw:Math.max(1,Math.round(inside*(bw*bh)/(cw*ch)))
    };
  }
  /* [v1.9] 由 townMask() 再抽一層：吃「polygons 陣列」（= polysOf() 的輸出格式），
     鄉鎮多邊形與村里多邊形共用同一條路。村里圖資的座標本來就存成這個格式。 */
  var maskCache={};
  function polyMask(polys,key){
    if(maskCache[key]) return maskCache[key];
    if(!polys||!polys.length) return null;
    var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    polys.forEach(function(po){po[0].forEach(function(c){
      var p=lonlatToPxF(c[0],c[1]);
      if(p[0]<mnx)mnx=p[0]; if(p[0]>mxx)mxx=p[0];
      if(p[1]<mny)mny=p[1]; if(p[1]>mxy)mxy=p[1];
    });});
    var o=buildMask(mnx,mny,mxx,mxy,function(mx,bx,by,sxr,syr){
      mx.beginPath();
      polys.forEach(function(po){po.forEach(function(ring){
        ring.forEach(function(c,i){
          var p=lonlatToPxF(c[0],c[1]);
          var X=(p[0]-bx)*sxr, Y=(p[1]-by)*syr;
          if(i)mx.lineTo(X,Y); else mx.moveTo(X,Y);
        });
        mx.closePath();
      });});
      mx.fill('evenodd');   /* evenodd 讓內環（飛地/孔洞）正確扣除 */
    });
    if(o) maskCache[key]=o;
    return o;
  }
  function townPolys(idx){
    var d=paths[idx]&&paths[idx].__data__;
    return d&&d.geometry?polysOf(d.geometry):null;
  }
  function townMask(idx){ return polyMask(townPolys(idx),'t'+idx); }
  function lonlatToPxF(lon,lat){return [(lon-SLON)/(ELON-SLON)*IW,(ELAT-lat)/(ELAT-SLAT)*IH];}
  /* ---------- [v1.9] 村里圖資載入 ---------- */
  /* 只能用 <script> 注入：官網 CSP 的 connect-src 不含外部網域（fetch 會被擋），
     script-src-elem 白名單才有 cdn.jsdelivr.net（見 record.md §2.10）。
     圖資檔會自我註冊到 window.__RH_VILL_IDX / window.__RH_VILL[<TOWNCODE>]。 */
  function loadScript(url){
    return new Promise(function(res,rej){
      var s=document.createElement('script'), done=false;
      var timer=setTimeout(function(){
        if(done)return; done=true;
        if(s.parentNode)s.parentNode.removeChild(s);
        rej(new Error('timeout'));
      },VILL_TIMEOUT);
      s.onload=function(){ if(done)return; done=true; clearTimeout(timer); res(); };
      s.onerror=function(){
        if(done)return; done=true; clearTimeout(timer);
        if(s.parentNode)s.parentNode.removeChild(s);
        rej(new Error('load error'));
      };
      s.src=url;
      document.head.appendChild(s);
    });
  }
  /* 兩層都先看 window 上有沒有：既是快取，也讓「預先注入圖資」成為合法用法
     （本機測試就是靠這條路，不需要網路，走的仍是同一套後續邏輯）。 */
  var villIdxP=null;
  function loadVillIndex(){
    if(window.__RH_VILL_IDX) return Promise.resolve(window.__RH_VILL_IDX);
    if(!villIdxP){
      villIdxP=loadScript(VILL_BASE+'index.js').then(function(){
        if(!window.__RH_VILL_IDX) throw new Error('index 未註冊');
        return window.__RH_VILL_IDX;
      },function(e){ villIdxP=null; throw e; });
    }
    return villIdxP;
  }
  var villTownP={};
  function loadVillTown(code){
    var have=window.__RH_VILL&&window.__RH_VILL[code];
    if(have) return Promise.resolve(have);
    if(!villTownP[code]){
      villTownP[code]=loadScript(VILL_BASE+code+'.js').then(function(){
        var v=window.__RH_VILL&&window.__RH_VILL[code];
        if(!v) throw new Error('鄉鎮圖資未註冊');
        return v;
      },function(e){ delete villTownP[code]; throw e; });
    }
    return villTownP[code];
  }

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
            if(mask[i+3]<=128) continue;          /* 取樣範圍外，跳過 */
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
  /* [v1.2] 判讀結果快取：key = url|遮罩身分，同範圍重查即時完成 */
  /* [v1.8] 第二段 key 由「鄉鎮索引」改為 curKey（`t<idx>` 或 `c<lon>,<lat>|<km>`）。
     ⚠️ 這是必須的：同一鄉鎮的不同半徑若共用 key，切換半徑會拿到上一個範圍的
        判讀結果——畫面正常、數字全錯的靜默錯誤。 */
  var sampleCache={};
  function sampleImage(rainUrl,dbzUrl,mk,mkKey){
    var key=rainUrl+'|'+mkKey;
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
    +'#rhclose,#rhmin{cursor:pointer;padding:0 6px;opacity:.75;user-select:none}'
    +'#rhclose:hover,#rhmin:hover{opacity:1}'
    /* [v1.11] 收合狀態：面板縮成膠囊，只留標題列。
       width:auto 讓寬度跟著標題文字，min/max 避免太窄或撐太寬。 */
    +'#rhpanel.rhmin{width:auto;min-width:150px;max-width:260px;overflow:visible}'
    +'#rhpanel.rhmin #rhbody{display:none}'
    +'#rhpanel.rhmin #rhver{display:none}'
    +'#rhpanel.rhmin #rhbar{border-radius:8px;border-bottom:0}'
    +'#rhbody{padding:10px}'
    +'#rhpanel label,#rhpanel div{color:#e6edf6}'
    +'#rhpanel select{width:100%;padding:5px;margin:2px 0;background:#0f1621;color:#e6edf6;border:1px solid #33415a;border-radius:4px;font:13px inherit}'
    +'#rhpick{width:100%;padding:7px;background:#2563a8;color:#fff;border:0;border-radius:5px;cursor:pointer;margin-top:8px;font:13px inherit}'
    +'#rhpick:hover{background:#2d74c4}'
    +'#rhstatus{margin:6px 0;color:#9fb0c8;min-height:18px;font-size:12px}'
    /* [v1.12] 點地圖後的位置提示。獨立一列：不能併進 #rhstatus（會被 driver 重寫）
       或 #rhwarn（語意是警告）。:empty 讓沒提示時不佔高度。 */
    +'#rhhint{font-size:11.5px;color:#9ad0ff;margin:4px 0}#rhhint:empty{display:none}'
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
  /* [v1.10] 取樣範圍不再有選單：跟著行政區——有選村里就是那個村里，否則整個鄉鎮。 */
  /* [v1.11] 標題列拆成 #rhtitlemain（收合時換成當前選取）與 #rhver（收合時 CSS 隱藏），
     控制項為 #rhmin（收合／展開）＋ #rhclose（完全關閉）。 */
  p.innerHTML='<div id="rhbar"><span><span id="rhtitlemain">'+TITLE+'</span> <span id="rhver" style="font-weight:normal;opacity:.7">更新 '+VER+'</span></span><span><span id="rhmin" title="收合面板">—</span><span id="rhclose" title="關閉面板">✕</span></span></div><div id="rhbody"><div>縣市 <select id="rhco"></select></div><div>鄉鎮 <select id="rhtw"></select></div><div>村里 <select id="rhvill"><option value="">（先選鄉鎮）</option></select></div><button id="rhpick">或：點地圖選點</button><div id="rhstatus">請選擇地區</div><div id="rhhint"></div><div id="rhsum"></div><div id="rhwarn"></div><table id="rhresult"></table></div>';
  document.body.appendChild(p);
  (function(){var bar=document.getElementById('rhbar'),dx,dy,drag=false;
   /* [v1.11] 控制項（—／✕）不觸發拖曳。收合狀態下標題列仍可拖曳，
      展開改用專用的 #rhmin 按鈕 → 不必做「拖曳 vs 點擊」的位移判定。 */
   bar.onmousedown=function(e){if(e.target.id==='rhclose'||e.target.id==='rhmin')return;drag=true;dx=e.clientX-p.offsetLeft;dy=e.clientY-p.offsetTop;e.preventDefault();};
   document.addEventListener('mousemove',function(e){if(drag){p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';}});
   document.addEventListener('mouseup',function(){drag=false;});})();
  document.getElementById('rhclose').onclick=function(){p.style.display='none';clearShapes();};

  /* ---------- [v1.11] 收合／展開 ---------- */
  /* ⚠️ 狀態的單一真實來源是 class `rhmin`，不是 JS 變數——「重點書籤」走的重入分支
     只能碰 DOM（見檔頭重入保護），用 class 才能讓兩邊同步。 */
  function isCollapsed(){return p.classList.contains('rhmin');}
  /* 收合時標題換成當前選取，讓膠囊本身就是資訊 */
  function capsuleTitle(){
    /* ⚠️ 這段可能在「官網改版 → alert 後 return」的情況下被呼叫（#rhmin 早於 svg 檢查
       就綁好了），那時 paths／curIdx 還沒賦值，故用寬鬆判斷而非 curIdx<0。 */
    if(!paths||!(curIdx>=0)) return TITLE;
    var d=paths[curIdx].__data__.properties;
    return '🌧️ '+(curVill?d.TOWNNAME+curVill.name:d.COUNTYNAME+d.TOWNNAME);
  }
  function setCollapsed(on){
    var mn=document.getElementById('rhmin'), tm=document.getElementById('rhtitlemain');
    if(on){
      p.classList.add('rhmin'); mn.textContent='＋'; mn.title='展開面板';
      tm.textContent=capsuleTitle();
      clearShapes();          /* 收合時隱藏地圖外框（決策 D1）*/
    }else{
      p.classList.remove('rhmin'); mn.textContent='—'; mn.title='收合面板';
      tm.textContent=TITLE;
      drawShapes();           /* 立即重畫，不必等 600ms 定時器 */
      renderStored();         /* 立即用最新結果＋當下時間重畫（driver 沒停過，不需連網）*/
    }
  }
  document.getElementById('rhmin').onclick=function(){setCollapsed(!isCollapsed());};

  var svg=getSvg();
  if(!svg){alert('找不到官網鄉鎮圖層，官網可能已改版（見 record.md §2.2）');return;}
  if(!rasterRect()){alert('找不到地圖視窗容器 .domain_cls，官網可能已改版（見 record.md §2.9）');return;}
  var paths=svg.querySelectorAll('path'), byCounty={};
  paths.forEach(function(pt,idx){var d=pt.__data__&&pt.__data__.properties;if(!d)return;(byCounty[d.COUNTYNAME]=byCounty[d.COUNTYNAME]||[]).push({tw:d.TOWNNAME,idx:idx});});
  var coSel=document.getElementById('rhco'),twSel=document.getElementById('rhtw');
  coSel.innerHTML='<option value="">--</option>'+Object.keys(byCounty).map(function(c){return '<option>'+c+'</option>';}).join('');
  /* [v1.11] 拆成兩個函式。
     ⚠️ 點地圖流程（見 #rhpick）會在程式內部設好 coSel.value 後只重建鄉鎮選項，
        不能走完整 reset——否則點一下地圖畫面會先被清空再重查，表格閃一下空白。 */
  function rebuildTownOptions(county){
    twSel.innerHTML='<option value="">--</option>'
      +((byCounty[county]||[]).map(function(t){return '<option value="'+t.idx+'">'+t.tw+'</option>';}).join(''));
  }
  /* [v1.11] 換縣市時的 cascade reset：舊鄉鎮／村里的一切都要清乾淨。
     不做的話畫面會變成「新縣市 ＋ 舊鄉鎮的村里清單 ＋ 舊鄉鎮的外框與表格」，
     因為 curIdx 還在，600ms 重繪與 30 秒 driver 都會繼續跟著舊鄉鎮跑。 */
  function resetSelection(){
    /* ⚠️ 最關鍵的一行：作廢進行中的查詢。切縣市時可能有 in-flight 的 runQuery
       （剛選鄉鎮、還在抓 16 張 PNG），不遞增世代它完成後會照樣把舊資料寫回畫面（§6.14）。 */
    queryGen++;
    curIdx=-1; curKey=''; curMk=null; curLabel=''; lastRender=null;
    curVill=null; villList=[]; villCode=''; pendingLL=null;
    villSel.innerHTML='<option value="">（先選鄉鎮）</option>';
    villSel.disabled=false;
    clearShapes();
    setHint('');
    document.getElementById('rhstatus').textContent='請選擇地區';
    document.getElementById('rhsum').textContent='';
    document.getElementById('rhwarn').textContent='';
    document.getElementById('rhresult').innerHTML='';
    if(isCollapsed()) document.getElementById('rhtitlemain').textContent=capsuleTitle();
  }
  coSel.onchange=function(){ rebuildTownOptions(coSel.value); resetSelection(); };
  twSel.onchange=function(){if(twSel.value!=='')selectTown(parseInt(twSel.value,10));};
  var villSel=document.getElementById('rhvill');
  /* [v1.9] 選村里即改變取樣範圍；選回「（整個鄉鎮）」就是整個鄉鎮。
     [v1.10] 不再需要「自動切換範圍選單」那段隱性行為——選單已移除。
     PNG 走瀏覽器 HTTP 快取不重新下載，但遮罩不同故需重新解碼掃描（約 1 秒）。 */
  villSel.onchange=function(){
    /* [v1.12] 手動選村里 = 使用者已自行決定範圍，點地圖留下的提示就沒用了 */
    setHint('');
    var i=villSel.value;
    if(i===''){ curVill=null; }
    else{
      var v=villList[parseInt(i,10)];
      curVill=v?{code:villCode,name:v[0],polys:v[1]}:null;
    }
    if(curIdx>=0) applySel();
  };

  /* ---------- [v1.1 P0-3] 紅框：自建 overlay，由經緯度反推螢幕座標 ---------- */
  var curIdx=-1, overlay=null, lastSig='';
  /* 取樣範圍狀態（[v1.10] 起只有兩種可能）。
     curVill：{code,name,polys} 或 null——**有值就是取樣範圍，null 則取整個鄉鎮**。
     villList/villCode：目前鄉鎮已載入的村里清單與 TOWNCODE。
     pendingLL：點地圖的座標，等村里清單載入後用來自動選中所在村里。
     curKey：遮罩身分字串，判讀快取的第二段 key（見 sampleImage）。
     ⚠️ v1.8 的半徑狀態（curKm／curCenter／curScope）已隨功能移除，
        歷史設計見 record.md §12。 */
  var curKey='';
  var curVill=null, villList=[], villCode='', pendingLL=null;
  /* [v1.7] 自動更新狀態。
     curMk/curLabel：目前鄉鎮的取樣遮罩與標籤，供 driver 重查時復用。
     lastRender：最後一次完整查詢的結果，供輕量重繪（不連網）復用。
     updWindowKey：已完成完整重查的 10 分鐘窗口鍵（floor(ms/600000)）。
     lastLatestT：該次重查看到的最新格時間(ms)，用來判斷官網是否已發佈新影像。
     updRetry：邊界後等待官網新影像的重試次數；updBusy：避免重查疊發。 */
  var curMk=null, curLabel='', lastRender=null;
  /* [v1.9] 查詢世代，避免並行查詢的舊結果覆蓋新選取（見 applySel／runQuery） */
  var queryGen=0;
  var updWindowKey=-1, lastLatestT=0, updRetry=0, updBusy=false;
  var DRIVE_TICK=30000, MAXRETRY=5;
  function winKey(ms){return Math.floor(ms/600000);}
  function ensureOverlay(){
    if(overlay&&overlay.parentNode) return overlay;
    overlay=document.createElementNS(SVGNS,'svg');
    overlay.id='rhoverlay';
    overlay.style.cssText='position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147482000';
    document.body.appendChild(overlay);
    return overlay;
  }
  /* [v1.8] 地圖標示改由 drawShapes() 統籌：
       #rhoutline     鄉鎮外框（選了村里時淡化，保留作方位參考）
       #rhvilloutline 村里外框（v1.9）
     兩者都掛在既有 #rhoverlay，螢幕座標一律由經緯度反推（§5.2）。 */
  function drawShapes(){
    clearShapes();
    if(curIdx<0) return;
    var r=rasterRect(); if(!r) return;
    /* [v1.9] 有村里時鄉鎮外框淡化成參考線，讓真正的取樣範圍突出，
       同時還看得出「這個村里在鄉裡的哪個位置」。 */
    var dim=!!curVill;
    drawPolyOutline(townPolys(curIdx),r,dim?'rgba(255,80,80,.45)':'red',dim?1:2,'rhoutline');
    if(curVill) drawPolyOutline(curVill.polys,r,'red',2,'rhvilloutline');
  }
  function drawPolyOutline(polys,r,stroke,width,id){
    if(!polys||!polys.length) return;
    var dstr='';
    polys.forEach(function(poly){
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
    np.setAttribute('stroke',stroke);
    np.setAttribute('stroke-width',String(width));
    np.setAttribute('stroke-linejoin','round');
    np.setAttribute('id',id);
    ensureOverlay().appendChild(np);
  }
  function clearShapes(){
    ['rhoutline','rhvilloutline'].forEach(function(id){
      var o=document.getElementById(id); if(o&&o.parentNode)o.parentNode.removeChild(o);
    });
  }
  function rectSig(){
    var r=rasterRect(); if(!r) return '';
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(',');
  }
  /* [v1.1 P1] 底圖矩形一有變動（含左下角雨量/雷達切換）即重繪；
     嚴禁改用 MutationObserver — 會無限迴圈凍結分頁，見 record.md §6.1 */
  setInterval(function(){
    if(curIdx<0) return;
    /* [v1.8] 面板隱藏時不重繪。
       ⚠️ v1.7 以前少了這個檢查：按 ✕ 時 removeOutline() 清掉紅框，但下一個
          tick 的「!rhoutline → 重畫」條件立刻成立，框又被畫回來，關不掉。
          v1.8 半徑模式多了黃色圓圈，這個既有缺陷會變得更顯眼，故一併修正。
       [v1.11] 收合時同理要停——收合會 clearShapes()，不擋這裡就 600ms 後畫回來。
          ⚠️ 但 30 秒自動更新 driver **不能**跟著停（收合仍要持續追蹤，決策 D2），
             所以兩個定時器的條件刻意不同，別「順手」改成一樣。 */
    if(isCollapsed()||p.style.display==='none') return;
    var sig=rectSig();
    if(sig!==lastSig||!document.getElementById('rhoutline')){ lastSig=sig; drawShapes(); }
  },600);
  window.addEventListener('resize',function(){
    if(curIdx>=0&&!isCollapsed()&&p.style.display!=='none'){setTimeout(drawShapes,300);setTimeout(drawShapes,900);}
  });

  /* [v1.9] 換鄉鎮就清掉村里選擇，並在背景載入該鄉鎮的村里清單。
     [v1.12] ll = 點地圖的座標。**點地圖一律視為「重新選地區」**：
       回到整個鄉鎮、清掉村里選擇，ll 只用來產生 #rhhint 提示。
       ⚠️ v1.9–v1.11 是「自動選中點到的村里」，與「下拉選鄉鎮」粒度不一致
          且不可預期（使用者回報），見 record.md §14.1。 */
  function selectTown(idx,ll){
    var changed=(idx!==curIdx);
    curIdx=idx;
    if(changed){ villList=[]; villCode=''; }
    /* 有 ll（點地圖）或換了鄉鎮 → 一律退回整個鄉鎮 */
    if(ll||changed){ curVill=null; villSel.value=''; }
    setHint('');
    if(changed){ pendingLL=ll||null; fillVillList(idx); }
    else if(ll) showHintFor(ll);   /* 同鄉鎮再點：清單已在手上，直接提示 */
    applySel();
  }
  /* [v1.12] 找出座標落在哪個村里，**只回傳索引、不改任何狀態**。
     ⚠️ 前身 pickVillAt() 會直接設 curVill 並改動下拉——副作用藏在查詢函式裡，
        就是「點地圖自己選了村里」的根源。查詢與變更要分開。 */
  function findVillAt(ll){
    for(var i=0;i<villList.length;i++){
      var polys=villList[i][1];
      for(var j=0;j<polys.length;j++){
        if(!ptInRing(ll,polys[j][0])) continue;
        var hole=false;
        for(var k=1;k<polys[j].length;k++) if(ptInRing(ll,polys[j][k])) hole=true;
        if(!hole) return i;
      }
    }
    return -1;
  }
  function setHint(t){ var h=document.getElementById('rhhint'); if(h) h.textContent=t; }
  /* [v1.12] 產生「你點的位置在 ○○村」提示。村里圖資沒載到就靜靜不顯示。 */
  function showHintFor(ll){
    var i=villList.length?findVillAt(ll):-1;
    setHint(i>=0 ? '📍 你點的位置在 '+villList[i][0]+'（要只看該村里，請從上面的「村里」選單挑）' : '');
  }
  /* [v1.9] 載入並填入村里下拉。任何失敗都只影響這個下拉，不影響查詢。 */
  function fillVillList(idx){
    var d=paths[idx].__data__.properties;
    var key=normName(d.COUNTYNAME)+'|'+normName(d.TOWNNAME);
    villSel.innerHTML='<option value="">（載入中…）</option>';
    villSel.disabled=true;
    var mine=idx;
    loadVillIndex().then(function(map){
      var code=map[key];
      if(!code) throw new Error('索引無此鄉鎮：'+key);
      return loadVillTown(code).then(function(arr){return [code,arr];});
    }).then(function(r){
      if(curIdx!==mine) return;          /* 使用者已換鄉鎮，丟棄這次結果 */
      villCode=r[0]; villList=r[1];
      villSel.innerHTML='<option value="">（整個鄉鎮）</option>'
        +villList.map(function(v,i){return '<option value="'+i+'">'+v[0]+'</option>';}).join('');
      villSel.disabled=false;
      /* [v1.12] 點地圖進來的：清單載好後只產生提示，**不改變查詢範圍**
         （村里清單是非同步載入的，所以只能等到這裡才判斷點在哪個村里）。
         因為範圍沒變，這裡不需要再 applySel()。 */
      if(pendingLL){
        var ll=pendingLL; pendingLL=null;
        showHintFor(ll);
      }
    }).catch(function(){
      if(curIdx!==mine) return;
      villList=[]; villCode=''; curVill=null;
      /* [v1.10] 半徑功能已移除，失敗時的唯一退路就是整個鄉鎮 */
      villSel.innerHTML='<option value="">（村里圖資載入失敗，只能查整個鄉鎮）</option>';
      villSel.disabled=false;
      applySel();
    });
  }
  /* [v1.8] 依目前選取組出遮罩／快取 key／標籤，然後查詢。
     [v1.10] 只剩兩種範圍：有選村里就取該村里，否則取整個鄉鎮；
     其餘流程（取樣、表格、自動更新、快取）完全共用。 */
  function applySel(){
    if(curIdx<0) return;
    var d=paths[curIdx].__data__.properties, mk, key, label;
    var base=d.COUNTYNAME+d.TOWNNAME;
    if(curVill){
      key='v'+curVill.code+'|'+curVill.name;
      mk=polyMask(curVill.polys,key);
      label=base+curVill.name;
    }else{
      /* [v1.3] 整個鄉鎮以實際多邊形取樣，不用重心方形視窗 */
      mk=townMask(curIdx);
      key='t'+curIdx;
      label=base;
    }
    if(!mk){document.getElementById('rhstatus').textContent='無法建立此範圍的取樣遮罩';return;}
    /* [v1.9] 查詢世代：使用者連續切換（換鄉鎮時「鄉鎮查詢」與「村里清單載好後
       自動選中村里」會各發一次）時會有多個 runQuery 並行，
       ⚠️ 先發後到的舊查詢會覆蓋新結果——畫面出現「A 村的名稱配 B 村的數字」，
          甚至整張表是上一個選擇的資料。故每次選取遞增世代，render 前驗證。 */
    var gen=++queryGen;
    lastSig=rectSig(); drawShapes();
    /* [v1.7] 記住目前範圍並重置自動更新狀態：把 updWindowKey 設為當下窗口，
       避免剛查完下一個 tick 又立刻重查；lastLatestT 由本次查詢結果回填。 */
    curMk=mk; curKey=key; curLabel=label;
    updWindowKey=winKey(Date.now()); updRetry=0; lastLatestT=0; lastRender=null;
    runQuery(mk,key,label,false,gen).then(function(latest){ if(latest!=null) lastLatestT=latest; });
  }

  /* [v1.7] silent=true 為背景自動重查：不清空表格、不顯示「查詢…」進度，
     讓舊表格一直留在畫面上，直到新結果 render 時原子替換，避免每 10 分鐘閃爍。
     回傳 Promise，resolve 為本次最新一格的時間(ms)，null 表示取不到清單。 */
  /* [v1.8] 第二參數由鄉鎮索引改為遮罩身分 key（見 sampleImage 註解）。 */
  /* [v1.9] gen = 發起時的查詢世代；render 前若已被更新的選取取代就整批丟棄。 */
  function runQuery(mk,mkKey,label,silent,gen){
    if(!silent){
      document.getElementById('rhstatus').textContent='查詢 '+label+'（'+mk.raw+' 個雷達格）…';
      document.getElementById('rhwarn').textContent='';
      document.getElementById('rhsum').textContent='';
      document.getElementById('rhresult').innerHTML='';
    }
    return fetchRows().then(function(rows){
      /* [v1.11] 一進來就先驗世代：過期的查詢連 16 張圖都不必發，
         也就不會有任何後續的 DOM 寫入（見下方 progress 回呼的教訓）。 */
      if(gen!=null&&gen!==queryGen) return null;
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
      if(!tasks.length){if(!silent)document.getElementById('rhstatus').textContent='無法取得雷達影像清單';return null;}
      tasks.sort(function(a,b){return a.t-b.t;});
      /* [v1.2] 改為並行載入（原為 16 張串行） */
      var t0=Date.now();
      return runPool(tasks,function(tk){
        return sampleImage(tk.rain,tk.dbz,mk,mkKey).then(function(o){
          return {t:tk.t,s:o.s,fallback:o.fallback};
        });
      },silent?null:function(done,total){
        /* [v1.11] ⚠️ §6.14 只修了 render 前的世代檢查，漏了這裡——
           進度回呼每載完一張圖就寫狀態列。切換縣市後舊查詢的 16 張圖會把
           「請選擇地區」一路蓋成「查詢 舊鄉鎮 … 16/16」，而且**永遠停在那裡**
           （render 已被世代擋住，不會再有 ✅ 來覆蓋它）。
           教訓：世代檢查要放在「所有會寫 DOM 的地方」，不是只有最後那一次。 */
        if(gen!=null&&gen!==queryGen) return;
        document.getElementById('rhstatus').textContent='查詢 '+label+' … '+done+'/'+total;
      }).then(function(out){
        /* [v1.9] 已被更新的選取取代 → 整批丟棄，別覆蓋畫面 */
        if(gen!=null&&gen!==queryGen) return null;
        var results=[],fellBack=0;
        out.forEach(function(o){ if(!o)return; if(o.fallback)fellBack++; results.push({t:o.t,s:o.s}); });
        results.sort(function(a,b){return a.t-b.t;});
        /* [v1.7] 存下結果供輕量重繪（每個 tick 用當下時間重畫「現在」列，不連網） */
        /* [v1.9] raw（雷達格數）跟著這一次的結果存，不再從全域 curMk 讀——
           否則並行查詢時會出現「A 的名稱配 B 的格數」。 */
        lastRender={results:results,label:label,fellBack:fellBack,total:tasks.length,
                    elapsed:Date.now()-t0,raw:mk.raw};
        render(results,label,fellBack,tasks.length,Date.now()-t0,mk.raw);
        return results.length?results[results.length-1].t.getTime():0;
      });
    });
  }
  /* [v1.7] 輕量重繪：不連網，只用最後一次結果 + 當下時間重畫，
     讓黃底「現在」列、實況/預報分隔線、摘要倒數隨真實時間前進。 */
  function renderStored(){
    if(!lastRender)return;
    render(lastRender.results,lastRender.label,lastRender.fellBack,lastRender.total,
           lastRender.elapsed,lastRender.raw);
  }
  /* [v1.7] 自動更新驅動器：常駐定時器，面板隱藏或未選鄉鎮時完全跳過。 */
  setInterval(function(){
    if(curIdx<0||!curMk) return;
    if(p.style.display==='none') return;           /* 隱藏即停，重開自動恢復 */
    /* ⚠️ [v1.11] 這裡**刻意不檢查 isCollapsed()**：收合是「縮到旁邊持續追蹤」，
       仍要每 10 分鐘補進官網新影像，展開時才會是最新資料（決策 D2）。
       render() 只寫 #rhbody 內的元素（收合時隱藏中），沒有視覺成本；
       driver 也不呼叫 drawShapes()，所以不會把收合時清掉的外框畫回來。 */
    var wk=winKey(Date.now());
    if(wk===updWindowKey){ renderStored(); return; } /* 同窗口：只輕量重繪 */
    /* 跨過 10 分鐘窗口邊界 → 完整重查（背景 silent，不閃爍） */
    if(updBusy) return;
    updBusy=true;
    listCacheAt=0;                                 /* 強制重抓清單，讓遲發重試每次真的問官網 */
    /* [v1.9] 帶入當下世代（不遞增）：期間使用者若換了選取，這次背景結果會被丟棄 */
    runQuery(curMk,curKey,curLabel,true,queryGen).then(function(latest){
      updBusy=false;
      if(latest==null) return;                     /* 取不到清單，下個 tick 再試 */
      if(latest>lastLatestT){                       /* 官網已發佈新影像 */
        lastLatestT=latest; updWindowKey=wk; updRetry=0;
      }else{                                        /* 官網尚未發佈，稍後重試 */
        updRetry++;
        if(updRetry>=MAXRETRY){ updWindowKey=wk; updRetry=0; } /* 放棄本輪，等下個窗口 */
      }
    },function(){updBusy=false;});
  },DRIVE_TICK);

  function render(results,label,fellBack,total,elapsed,raw){
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
    /* [v1.8] 狀態列附上等效雷達格數，讓樣本量透明化（半徑 0.5km 只有約 16 格）*/
    /* [v1.9] raw 由這次查詢傳入，不從全域讀（見 runQuery 註解）*/
    document.getElementById('rhstatus').textContent='✅ '+label
      +'（'+(raw?raw+' 個雷達格 · ':'')+'每 10 分鐘一格）'
      +(elapsed?'　'+(elapsed/1000).toFixed(1)+'s':'');
    document.getElementById('rhwarn').textContent = fellBack>0
      ? '⚠️ '+fellBack+'/'+total+' 張取不到雨量圖，已退回回波強度推估，數值僅供參考'
      : '';
  }

  /* ---------- [v1.1 P0-1] 地圖點選 ---------- */
  /* [v1.9] 點地圖 = 選中該點所在的鄉鎮，村里圖資載入後再自動選中所在村里。
     [v1.10] 不再有半徑模式，按鈕文字固定，syncPickLabel 已移除。 */
  document.getElementById('rhpick').onclick=function(){
    document.getElementById('rhstatus').textContent='請點地圖上的位置…';
    function handler(e){
      if(p.contains(e.target))return;
      document.removeEventListener('click',handler,true);
      var ll=screenToLonLat(e.clientX,e.clientY);
      /* [v1.12] 點失敗時也要清掉上一次的位置提示——否則畫面會同時出現
         「該點不在任何鄉鎮範圍內」與「你點的位置在 ○○村」，兩行互相矛盾
         （實測 A-6 抓到）。 */
      if(!ll){setHint('');document.getElementById('rhstatus').textContent='請點在地圖範圍內，請重試';return;}
      var found=findTownByLonLat(ll);
      if(found>=0){
        var d=paths[found].__data__.properties;
        /* [v1.11] 只重建鄉鎮選項，不走 resetSelection()——否則點一下地圖
           畫面會先被清空再重查，表格閃一下空白。 */
        coSel.value=d.COUNTYNAME; rebuildTownOptions(d.COUNTYNAME); twSel.value=String(found);
        /* [v1.9] 把實際點擊座標交給 selectTown，用來自動選中所在村里 */
        selectTown(found,ll);
      }else{
        setHint('');
        document.getElementById('rhstatus').textContent='該點不在任何鄉鎮範圍內（'+ll[0].toFixed(3)+','+ll[1].toFixed(3)+'），請重試';
      }
    }
    setTimeout(function(){document.addEventListener('click',handler,true);},50);
  };
};
