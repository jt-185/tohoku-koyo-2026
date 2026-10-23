(function () {
  'use strict';

  const CFG = window.TRIP_CONFIG || {};
  const CACHE_KEY = 'tohoku-trip-data';
  const ME_KEY = 'tohoku-trip-me';
  const LOCAL_CHECKS_KEY = 'tohoku-trip-checks';
  const VIEWS = ['plan', 'stay', 'move', 'spots', 'prep'];

  const TYPE_COLORS = {
    '航班': 'var(--sky)', '抵達': 'var(--sky)', '交通': 'var(--ink-3)', '景點': 'var(--maple)',
    '溫泉': 'var(--gold)', '用餐': 'var(--gold)', '住宿': 'var(--moss)', '備案': 'var(--ink-3)', '可選擇': 'var(--ink-3)'
  };

  const ICON = {
    map: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    car: '<svg viewBox="0 0 24 24"><path d="M5 16V11l2-4h10l2 4v5M5 16h14M5 11h14"/></svg>',
    bed: '<svg viewBox="0 0 24 24"><path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 15.8 7.4 18.3l.9-5.2-3.8-3.6 5.2-.7z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plane: '<svg viewBox="0 0 64 24"><path d="M2 12h60" stroke-dasharray="3 4"/><path d="M28 12l-6-7h3l9 7-9 7h-3z" fill="currentColor" stroke="none"/></svg>'
  };

  let data = null;          // { updated, sheets: { 名稱: 2D array } }
  let source = '';          // 'live' | 'cache' | 'backup'
  let currentDay = null;
  let spotFilter = '全部';

  // ── helpers ──
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const txt = (s) => esc(s).replace(/\n/g, '<br>');
  const safeUrl = (u) => (/^(https?:|tel:)/i.test(String(u || '').trim()) ? String(u).trim() : '');
  // 「可選擇」：不一定要去、看當天狀況決定的景點（試算表裡寫「可選擇」或舊的「備案」都可以）
  const OPTIONAL = '可選擇';
  const isOptional = (v) => v === OPTIONAL || v === '備案';
  const mapUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  // 沒給起點時 Google 地圖會用手機目前位置當起點
  const navUrl = (q) => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(q);

  function parseLatLng(s) {
    const m = String(s || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  // 圖片格：一行一張，「網址 | 說明」。支援一般圖片網址和 Google 雲端硬碟的分享連結
  function parseImages(text) {
    return String(text || '').split('\n').map((line) => {
      const [url, ...rest] = line.split('|');
      let src = String(url || '').trim();
      let thumb;
      const local = src.match(/^(?:\.\/)?(photos\/[\w\-.]+?)(-s)?\.(jpe?g|png|webp)$/i);
      if (local) {
        // 放在網站 photos 資料夾的照片：大圖 name.jpg，縮圖 name-s.jpg
        src = local[1] + '.' + local[3];
        thumb = local[1] + '-s.' + local[3];
      } else {
        src = safeUrl(src);
        if (!/^https:/i.test(src)) return null;
        const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
        if (drive) src = 'https://drive.google.com/thumbnail?id=' + drive[1] + '&sz=w1600';
        thumb = drive ? src.replace('sz=w1600', 'sz=w600') : src.replace('/1280px-', '/500px-');
      }
      return { src: src, thumb: thumb, caption: rest.join('|').trim() };
    }).filter(Boolean);
  }

  let galleries = [];
  function coverHtml(title, imgs, cls) {
    if (!imgs.length) return '';
    galleries.push({ title: title, imgs: imgs });
    const gi = galleries.length - 1;
    const img = '<img src="' + esc(imgs[0].thumb) + '" alt="" loading="lazy">';
    if (cls === 'thumb') {
      return '<button class="thumb" data-gallery="' + gi + '" aria-label="看「' + esc(title) + '」的照片">' + img +
        (imgs.length > 1 ? '<span class="cover-count">' + imgs.length + '</span>' : '') + '</button>';
    }
    // 大封面：多張時直接在卡片上左右切換，點照片再放大
    const multi = imgs.length > 1;
    return '<div class="cover" data-gi="' + gi + '" data-idx="0">' +
      '<button class="cover-img" data-gallery="' + gi + '" aria-label="放大「' + esc(title) + '」的照片">' + img + '</button>' +
      (multi
        ? '<button class="cover-arrow prev" data-cover="-1" aria-label="上一張">‹</button>' +
          '<button class="cover-arrow next" data-cover="1" aria-label="下一張">›</button>' +
          '<span class="cover-dots">' + imgs.map((_, i) => '<i' + (i === 0 ? ' class="on"' : '') + '></i>').join('') + '</span>'
        : '') +
      '</div>';
  }
  function stepCover(cover, d) {
    const g = galleries[Number(cover.dataset.gi)];
    if (!g || g.imgs.length < 2) return;
    const i = (Number(cover.dataset.idx) + d + g.imgs.length) % g.imgs.length;
    cover.dataset.idx = i;
    cover.querySelector('.cover-img img').src = g.imgs[i].thumb;
    cover.querySelectorAll('.cover-dots i').forEach((dot, k) => dot.classList.toggle('on', k === i));
  }

  function rows(name) {
    const grid = (data && data.sheets && data.sheets[name]) || [];
    if (!grid.length) return [];
    const head = grid[0].map((h) => String(h).trim());
    return grid.slice(1)
      // 勾選欄空白時也會顯示 FALSE，所以只看其他欄位有沒有內容
      .filter((r) => r.some((c) => !/^(|TRUE|FALSE)$/.test(String(c).trim())))
      .map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] == null ? '' : r[i]).trim()])));
  }
  function settings() {
    const out = {};
    rows('設定').forEach((r) => { out[r['欄位']] = r['內容']; });
    return out;
  }
  function tokyoToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  function addDays(iso, n) {
    const d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }
  function tripDayToday() {
    const s = settings();
    if (!s['出發日']) return null;
    const n = daysBetween(s['出發日'], tokyoToday()) + 1;
    const total = rows('每日').length;
    return n >= 1 && n <= total ? n : null;
  }
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ── data loading ──
  async function load() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.sheets) { data = cached; source = 'cache'; renderAll(); }
    } catch (e) { /* storage unavailable */ }

    const url = CFG.SCRIPT_URL || 'data.json';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!json.sheets) throw new Error('no data');
      data = json;
      source = CFG.SCRIPT_URL ? 'live' : 'backup';
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch (e) { /* ignore */ }
    } catch (err) {
      if (!data) {
        try {
          const res = await fetch('data.json', { cache: 'no-store' });
          data = await res.json();
          source = 'backup';
        } catch (e) {
          $('#app').innerHTML = '<p class="loading">資料載入失敗，請稍後重新整理。</p>';
          return;
        }
      }
    }
    applyLocalChecks();
    renderAll();
  }

  // ── header & footer ──
  function renderHeader() {
    const s = settings();
    if (s['標題']) { $('#title').textContent = s['標題']; document.title = s['標題'] + ' 2026'; }
    $('#subtitle').textContent = s['副標'] || '';
    const start = s['出發日'], end = s['回程日'];
    const dateText = start && end ? start.replace(/-/g, '/') + ' – ' + end.slice(5).replace('-', '/') : '';
    $('#meta').textContent = [dateText, s['人數']].filter(Boolean).join('　・　');

    const cd = $('#countdown');
    if (start) {
      const today = tokyoToday();
      const until = daysBetween(today, start);
      const dayN = tripDayToday();
      if (until > 0) cd.innerHTML = '距離出發還有 <b>' + until + '</b> 天';
      else if (dayN) cd.innerHTML = '旅程第 <b>' + dayN + '</b> 天';
      else cd.innerHTML = '旅程結束，辛苦大家了';
    }
    const notice = $('#notice');
    notice.hidden = !s['公告'];
    notice.textContent = s['公告'] || '';
  }

  function renderFooter() {
    let text = '';
    if (data && data.updated) {
      const d = new Date(data.updated);
      if (!isNaN(d)) {
        const p = (n) => String(n).padStart(2, '0');
        text = '更新於 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      }
    }
    $('#sync').textContent = text;
  }

  // ── views ──
  function viewPlan() {
    const days = rows('每日');
    const items = rows('行程');
    const todayN = tripDayToday();
    if (currentDay == null) currentDay = todayN || 1;
    const day = days.find((d) => Number(d['Day']) === currentDay) || days[0];
    if (!day) return '<p class="muted">還沒有行程資料。</p>';

    const chips = days.map((d) => {
      const n = Number(d['Day']);
      return '<button class="day-chip' + (n === currentDay ? ' active' : '') + (n === todayN ? ' today' : '') + '" data-day="' + n + '">' +
        '<span class="d">DAY ' + n + '</span><span class="n">' + esc(d['日期']) + '</span><span class="w">' + esc(d['星期']) + '</span></button>';
    }).join('');

    const facts = [
      day['開車'] && ['car', day['開車']],
      day['住宿'] && ['bed', day['住宿']],
      day['重點'] && ['star', day['重點']]
    ].filter(Boolean).map(([icon, t]) => '<div class="fact">' + ICON[icon] + '<span>' + txt(t) + '</span></div>').join('');

    const spots = rows('景點');
    const list = items.filter((it) => Number(it['Day']) === currentDay).map((it) => {
      const type = it['類型'];
      const color = TYPE_COLORS[type] || 'var(--ink-3)';
      const links = it['地圖']
        ? '<div class="tl-links"><a class="tl-map" href="' + esc(mapUrl(it['地圖'])) + '" target="_blank" rel="noopener">' + ICON.map + '地圖</a>' +
          '<a class="tl-map" href="' + esc(navUrl(it['地圖'])) + '" target="_blank" rel="noopener">' + ICON.car + '導航</a></div>'
        : '';
      const spot = type !== '交通' && spots.find((s) => (s['日文'] && s['日文'] === it['地圖']) || (s['名稱'] && it['項目'].indexOf(s['名稱']) >= 0));
      const thumb = spot ? coverHtml(spot['名稱'], parseImages(spot['圖片']), 'thumb') : '';
      return '<li class="tl' + (isOptional(type) ? ' is-alt' : '') + '" style="--c:' + color + '">' +
        '<div class="tl-time">' + esc(it['時間']) + '</div>' +
        '<div class="tl-rail"><span class="tl-dot"></span></div>' +
        '<div class="tl-body"><div class="tl-main"><div class="tl-type">' + esc(type) + '</div>' +
        '<div class="tl-title">' + esc(it['項目']) + '</div>' +
        (it['說明'] ? '<p class="tl-desc">' + txt(it['說明']) + '</p>' : '') + links + '</div>' + thumb + '</div></li>';
    }).join('');

    const all = allDayPoints();
    const dm = all.find((d) => d.n === currentDay) || dayPoints(currentDay);
    const legend = dm.pts.map((p, i) => '<span><i class="pin-mini' + (p.start ? ' start' : '') + '" style="--dc:' + TripMap.color(currentDay) + '">' + pinLabel(dm, i) + '</i>' + esc(p.label) + '</span>').join('<b>→</b>');
    const mapHtml = dm.pts.length
      ? '<div class="day-map-wrap">' +
        '<div class="map-switch" role="tablist"><button data-mapmode="simple" class="' + (mapMode === 'simple' ? 'active' : '') + '">簡易地圖</button>' +
        '<button data-mapmode="google" class="' + (mapMode === 'google' ? 'active' : '') + '">Google 地圖</button></div>' +
        '<div id="day-map" class="day-map' + (mapMode === 'google' ? ' is-google' : '') + '">' + dayMapInner(dm, all) + '</div>' +
        '<p class="map-legend">' + legend + '</p>' +
        (dm.pts.length >= 2 ? '<a class="btn" href="' + esc(routeUrl(dm.pts)) + '" target="_blank" rel="noopener">' + ICON.map + '用 Google 地圖 App 開這天的路線</a>' : '') +
        '</div>'
      : '';

    const prev = days.find((d) => Number(d['Day']) === currentDay - 1);
    const next = days.find((d) => Number(d['Day']) === currentDay + 1);

    return overviewHtml(days, all) +
      '<div class="section-title days-title"><h2>每日行程</h2><p>點日期切換</p></div>' +
      '<div class="days">' + chips + '</div>' +
      '<article class="card day-head">' +
        '<div class="eyebrow">DAY ' + esc(day['Day']) + '・' + esc(day['日期']) + '（' + esc(day['星期']) + '）</div>' +
        '<h2>' + esc(day['標題']) + '</h2>' +
        '<p class="route">' + esc(day['路線']) + '</p>' +
        (facts ? '<div class="day-facts">' + facts + '</div>' : '') +
        mapHtml +
        (list ? '<ol class="timeline">' + list + '</ol>' : '') +
      '</article>' +
      '<div class="day-nav">' +
        (prev ? '<button class="btn" data-day="' + (currentDay - 1) + '">← Day ' + (currentDay - 1) + '</button>' : '<span></span>') +
        (next ? '<button class="btn" data-day="' + (currentDay + 1) + '">Day ' + (currentDay + 1) + ' →</button>' : '<span></span>') +
      '</div>';
  }

  // ── maps ──
  let mapMode = 'simple';
  try { mapMode = localStorage.getItem('tohoku-map-mode') || 'simple'; } catch (e) { /* ignore */ }
  let overviewDay = 0; // 0 = 全程
  let ovOpen = true;
  try { ovOpen = localStorage.getItem('tohoku-ov-open') !== '0'; } catch (e) { /* ignore */ }

  // 起點是前一晚的住宿，接著是當天有座標的地點（可選擇的另外標示，不連線）
  function dayPoints(n) {
    const items = rows('行程');
    const pts = [], alts = [];
    const toPt = (it) => ({
      ll: parseLatLng(it['座標']),
      name: it['項目'].replace(/\s*入住$/, ''),
      label: it['地圖標籤'] || it['項目'].replace(/\s*入住$/, ''),
      q: it['地圖'],
      stay: it['類型'] === '住宿'
    });
    const prevStays = items.filter((it) => Number(it['Day']) < n && it['類型'] === '住宿' && parseLatLng(it['座標']));
    if (prevStays.length) pts.push(Object.assign(toPt(prevStays[prevStays.length - 1]), { start: true }));
    items.filter((it) => Number(it['Day']) === n).forEach((it) => {
      if (!parseLatLng(it['座標'])) return;
      const pt = toPt(it);
      if (isOptional(it['類型'])) { alts.push(pt); return; }
      const last = pts[pts.length - 1];
      if (last && last.ll[0] === pt.ll[0] && last.ll[1] === pt.ll[1]) return;
      pts.push(pt);
    });
    return { n: n, pts: pts, alts: alts };
  }
  function allDayPoints() {
    return rows('每日').map((d) => dayPoints(Number(d['Day'])));
  }
  function pinLabel(dm, i) {
    if (dm.pts[i].start) return '起';
    return String(dm.pts[0].start ? i : i + 1);
  }
  const placeOf = (p) => p.q || p.ll.join(',');
  function routeUrl(pts) {
    const mid = pts.slice(1, -1).slice(0, 9).map(placeOf).join('|');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(placeOf(pts[0])) +
      '&destination=' + encodeURIComponent(placeOf(pts[pts.length - 1])) + (mid ? '&waypoints=' + encodeURIComponent(mid) : '');
  }
  function googleEmbedUrl(pts, fit) {
    const key = CFG.GOOGLE_MAPS_EMBED_KEY;
    if (key) {
      const ll = (p) => p.ll.join(',');
      const base = 'https://www.google.com/maps/embed/v1/';
      if (pts.length === 1) return base + 'place?key=' + encodeURIComponent(key) + '&q=' + ll(pts[0]) + '&language=zh-TW';
      const mid = pts.slice(1, -1).map(ll).join('|');
      return base + 'directions?key=' + encodeURIComponent(key) + '&mode=driving&language=zh-TW&origin=' + ll(pts[0]) +
        '&destination=' + ll(pts[pts.length - 1]) + (mid ? '&waypoints=' + encodeURIComponent(mid) : '') +
        (fit ? '&zoom=' + fit.zoom + '&center=' + fit.center : '');
    }
    // 沒有金鑰時用舊版免金鑰嵌入；地名常找不到路線，所以用座標
    const loc = (p) => p.ll.join(',');
    if (pts.length === 1) return 'https://maps.google.com/maps?q=' + loc(pts[0]) + '&hl=zh-TW&output=embed';
    return 'https://maps.google.com/maps?saddr=' + loc(pts[0]) + '&daddr=' + pts.slice(1).map(loc).join('+to:') + '&dirflg=d&hl=zh-TW&output=embed';
  }

  // Google 嵌入版地圖左上角一定會有「起點／終點」資訊卡，沒辦法關掉。
  // 做法：iframe 比顯示區域高一截、往上推，把資訊卡裁掉，並自己算中心點和縮放，讓整段路線落在看得到的範圍內。
  const GM_CROP = 120;
  function gmFit(pts, w, h) {
    const lls = [].concat(...[TripMap.routeOf(pts.map((p) => p.ll)) || pts.map((p) => p.ll)]);
    const mx = (lng) => (lng + 180) / 360;
    const my = (lat) => (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI));
    const xs = lls.map((l) => mx(l[1])), ys = lls.map((l) => my(l[0]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 36;
    const need = Math.min((w - pad * 2) / (Math.max(x1 - x0, 1e-6) * 256), (h - pad * 2) / (Math.max(y1 - y0, 1e-6) * 256));
    const zoom = Math.max(3, Math.min(15, Math.floor(Math.log2(need))));
    const world = 256 * Math.pow(2, zoom);
    const cx = ((x0 + x1) / 2) * world, cy = ((y0 + y1) / 2) * world - GM_CROP / 2;
    const lng = (cx / world) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * cy) / world;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return { zoom: zoom, center: lat.toFixed(5) + ',' + lng.toFixed(5) };
  }
  function buildGoogle(box) {
    const iframe = box.querySelector('iframe');
    if (!iframe) return;
    const dm = dayPoints(Number(box.dataset.day));
    const fit = CFG.GOOGLE_MAPS_EMBED_KEY && dm.pts.length >= 2 ? gmFit(dm.pts, box.clientWidth || 360, box.clientHeight || 320) : null;
    iframe.src = googleEmbedUrl(dm.pts, fit);
  }
  function dayMapInner(dm, all) {
    if (mapMode === 'google') {
      const crop = CFG.GOOGLE_MAPS_EMBED_KEY && dm.pts.length >= 2;
      return '<div class="gmap-box' + (crop ? ' crop' : '') + '" data-day="' + dm.n + '"><iframe class="gmap" title="Google 地圖路線" allowfullscreen></iframe></div>';
    }
    const lls = dm.pts.concat(dm.alts).map((p) => p.ll);
    return TripMap.render(all, { vb: TripMap.fitVB(lls, 60, 4 / 3, 300), focus: dm.n, numbers: true });
  }

  function overviewHtml(days, all) {
    const chips = '<button class="ov-chip' + (overviewDay ? '' : ' active') + '" data-ov="0">全程</button>' +
      days.map((d) => {
        const n = Number(d['Day']);
        return '<button class="ov-chip' + (overviewDay === n ? ' active' : '') + '" data-ov="' + n + '" style="--dc:' + TripMap.color(n) + '"><i></i>D' + n + '</button>';
      }).join('');
    return '<section class="card overview' + (ovOpen ? '' : ' is-closed') + '">' +
      '<button class="ov-toggle" data-ovtoggle aria-expanded="' + ovOpen + '"><h2>全程路線</h2>' +
      '<span class="ov-hint">' + (ovOpen ? '點 Day 看那天開哪一段' : '點開來看 7 天的路線') + '</span>' +
      '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="ov-body">' +
      '<div class="ov-chips">' + chips + '</div>' +
      '<div class="ov-map" id="ov-map">' + overviewMap(all) + '</div>' +
      '<p class="ov-note" id="ov-note">' + overviewNote(days) + '</p>' +
      '</div></section>';
  }
  function overviewMap(all) {
    const lls = [].concat(...all.map((d) => d.pts.concat(d.alts).map((p) => p.ll)));
    return lls.length ? TripMap.render(all, { vb: TripMap.fitVB(lls, 70, null, 400), focus: overviewDay }) : '';
  }
  function overviewNote(days) {
    if (!overviewDay) return '7 天的路線用不同顏色標示，實心圓點是住宿。';
    const d = days.find((x) => Number(x['Day']) === overviewDay);
    if (!d) return '';
    return '<b style="color:' + TripMap.color(overviewDay) + '">Day ' + overviewDay + '</b>　' + esc(d['路線']) +
      '　<button class="link-btn" data-day="' + overviewDay + '">看詳細行程 ↓</button>';
  }
  function setOverviewDay(n) {
    overviewDay = n;
    const all = allDayPoints();
    const box = $('#ov-map');
    if (!box) return;
    box.innerHTML = overviewMap(all);
    $('#ov-note').innerHTML = overviewNote(rows('每日'));
    document.querySelectorAll('.ov-chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.ov) === n));
    TripMap.hydrate(box, all);
  }
  function setMapMode(mode) {
    mapMode = mode;
    try { localStorage.setItem('tohoku-map-mode', mode); } catch (e) { /* ignore */ }
    const box = $('#day-map');
    if (!box) return;
    const all = allDayPoints();
    box.innerHTML = dayMapInner(dayPoints(currentDay), all);
    box.classList.toggle('is-google', mode === 'google');
    const gb = box.querySelector('.gmap-box');
    if (gb) buildGoogle(gb);
    document.querySelectorAll('[data-mapmode]').forEach((b) => b.classList.toggle('active', b.dataset.mapmode === mode));
    if (mode === 'simple') TripMap.hydrate(box, all);
  }
  function hydrateMaps() {
    const all = allDayPoints();
    const gb = document.querySelector('#day-map .gmap-box');
    if (gb) buildGoogle(gb);
    ['#ov-map', '#day-map'].forEach((sel) => { const el = $(sel); if (el && el.querySelector('svg')) TripMap.hydrate(el, all); });
  }

  // ── lightbox ──
  let lb = null;
  function openLightbox(g, i) {
    lb = { g: g, i: i };
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    showLightbox();
  }
  function showLightbox() {
    const img = lb.g.imgs[lb.i];
    $('#lb-img').src = img.src;
    $('#lb-title').textContent = lb.g.title;
    $('#lb-count').textContent = lb.g.imgs.length > 1 ? (lb.i + 1) + ' / ' + lb.g.imgs.length : '';
    $('#lb-caption').textContent = img.caption;
    document.querySelectorAll('.lb-nav').forEach((b) => { b.hidden = lb.g.imgs.length < 2; });
  }
  function stepLightbox(d) {
    if (!lb) return;
    lb.i = (lb.i + d + lb.g.imgs.length) % lb.g.imgs.length;
    showLightbox();
  }
  function closeLightbox() {
    lb = null;
    $('#lightbox').hidden = true;
    $('#lb-img').removeAttribute('src');
    document.body.style.overflow = '';
  }

  function statusBadge(s) {
    if (!s) return '';
    const cls = /部分|待|未/.test(s) ? 'warn' : /已/.test(s) ? 'ok' : '';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }

  // 「宮城縣,大崎市 - 鳴子溫泉」拆成縣、市、區域，各自一個標籤，獨立一行
  function placeTags(region) {
    const parts = String(region || '').split(/[,，\-－–]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    return '<div class="stay-place">' + ICON.map + '<span class="place-text">' + parts.map(esc).join('<i>・</i>') + '</span></div>';
  }

  function viewStay() {
    const s = settings();
    const start = s['出發日'];
    const stays = rows('住宿');
    const totalNights = stays.reduce((sum, h) => sum + (Number(h['晚數']) || 1), 0);
    const cards = stays.map((h) => {
      const nights = Number(h['晚數']) || 1;
      let dateLabel = esc(h['日期']);
      let dayNo = 0;
      if (start && /^\d+\/\d+$/.test(h['日期'])) {
        const [m, d] = h['日期'].split('/').map(Number);
        const iso = start.slice(0, 4) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        dateLabel = esc(h['日期']) + ' – ' + addDays(iso, nights);
        dayNo = daysBetween(start, iso) + 1;
      }
      const kv = [
        ['房間', h['房間']], ['入住', h['入住']], ['退房', h['退房']], ['餐食', h['餐食']],
        ['溫泉', h['溫泉']], ['停車', h['停車']], ['地址', h['地址']]
      ].filter(([, v]) => v).map(([k, v]) => '<dt>' + k + '</dt><dd>' + txt(v) + '</dd>').join('');
      const q = h['地址'] || h['日文名'] || h['名稱'];
      const tel = h['電話'] ? '<a class="btn" href="tel:' + esc(h['電話'].replace(/[^\d+]/g, '')) + '">' + ICON.phone + esc(h['電話']) + '</a>' : '';
      return '<article class="card stay">' + '<div class="day-corner">' + (dayNo > 0 ? '<b class="seg-day">DAY ' + dayNo + '</b>' : '') + '<span class="seg-date">' + dateLabel + '</span><span class="seg-nights">' + nights + ' 晚</span></div>' + coverHtml(h['名稱'], parseImages(h['圖片'])) +
        '<div class="stay-top"><div>' +
        placeTags(h['地區']) +
        '<h3>' + esc(h['名稱']) + '</h3>' + (h['日文名'] && h['日文名'] !== h['名稱'] ? '<div class="jp">' + esc(h['日文名']) + '</div>' : '') + '</div>' +
        statusBadge(h['狀態']) + '</div>' +
        (kv ? '<dl class="kv">' + kv + '</dl>' : '') +
        (h['備註'] ? '<p class="note">' + txt(h['備註']) + '</p>' : '') +
        '<div class="btn-row"><a class="btn" href="' + esc(mapUrl(q)) + '" target="_blank" rel="noopener">' + ICON.map + 'Google 地圖</a>' + tel + '</div>' +
        '</article>';
    }).join('');
    return '<div class="section-title"><h2>住宿</h2><p>共 ' + totalNights + ' 晚</p></div><div class="stack">' + cards + '</div>';
  }

  function viewMove() {
    const groups = {};
    rows('交通').forEach((r) => { (groups[r['區塊']] = groups[r['區塊']] || []).push(r); });
    const get = (g, k) => ((groups[g] || []).find((r) => r['項目'] === k) || {})['內容'] || '';

    const flight = (g) => {
      if (!groups[g]) return '';
      const [fromPlace, fromTime] = get(g, '出發').split('|');
      const [toPlace, toTime] = get(g, '抵達').split('|');
      const end = (place, time, cls) => {
        const parts = String(place || '').trim().split(/\s+/);
        return '<div class="flight-end ' + cls + '"><div class="code">' + esc(parts[0]) + '</div>' +
          '<div class="time">' + esc(time || '') + '</div><div class="place">' + esc(parts.slice(1).join(' ')) + '</div></div>';
      };
      return '<article class="card flight">' +
        '<div class="flight-top"><span>' + esc(g) + '・' + esc(get(g, '日期')) + '</span><b>' + esc(get(g, '航班')) + '</b></div>' +
        '<div class="flight-route">' + end(fromPlace, fromTime, 'from') + '<div class="flight-mid">' + ICON.plane + '</div>' + end(toPlace, toTime, 'to') + '</div>' +
        (get(g, '行李') ? '<div class="flight-foot">行李：' + esc(get(g, '行李')) + '</div>' : '') +
        '</article>';
    };

    // 第四欄放導航目的地（車程）或圖片（租車）
    const extra = (r) => r['導航／圖片'] || r['導航'] || r['圖片'] || '';
    const carRows = groups['租車'] || [];
    const carPic = carRows.find((r) => r['項目'] === '圖片');
    const carCover = carPic ? coverHtml(get('租車', '車款') || '租車', parseImages(extra(carPic))) : '';
    const car = carRows.filter((r) => r !== carPic).map((r) => '<dt>' + esc(r['項目']) + '</dt><dd>' + txt(r['內容']) + '</dd>').join('');
    const drive = (groups['車程'] || []).map((r) => {
      const inner = '<span>' + esc(r['項目']) + '</span><span>' + esc(r['內容']) + '</span>';
      return extra(r)
        ? '<li><a href="' + esc(navUrl(extra(r))) + '" target="_blank" rel="noopener">' + inner + '<span class="nav-go">' + ICON.car + '導航</span></a></li>'
        : '<li><div>' + inner + '</div></li>';
    }).join('');

    return '<div class="section-title"><h2>航班</h2><p>星宇航空</p></div>' +
      '<div class="stack">' + flight('去程') + flight('回程') + '</div>' +
      (car ? '<h3 class="sub-title">租車</h3><article class="card">' + carCover + '<dl class="kv">' + car + '</dl></article>' : '') +
      (drive ? '<h3 class="sub-title">開車時間（Google 地圖）</h3><p class="hint">點一段路線，Google 地圖會從你目前的位置導航到目的地。</p>' +
        '<article class="card"><ul class="drive-list">' + drive + '</ul></article>' : '');
  }

  function viewSpots() {
    const all = rows('景點');
    const tabs = ['全部', '行程', OPTIONAL];
    const list = all
      .filter((s) => spotFilter === '全部' || (spotFilter === OPTIONAL ? isOptional(s['狀態']) : s['狀態'] === spotFilter))
      .sort((a, b) => (isOptional(a['狀態']) - isOptional(b['狀態'])) || Number(a['Day']) - Number(b['Day']));
    const cards = list.map((s) => {
      const facts = [['開放', s['開放時間']], ['費用', s['費用']], ['停車', s['停車']]]
        .filter(([, v]) => v).map(([k, v]) => '<span><b>' + k + '</b>' + esc(v) + '</span>').join('');
      const koyo = s['紅葉見頃'] ? '<span class="badge maple">🍁 ' + esc(s['紅葉見頃']) + '</span>' : '';
      return '<article class="card spot' + (isOptional(s['狀態']) ? ' is-alt' : '') + '">' + coverHtml(s['名稱'], parseImages(s['圖片'])) +
        '<div class="spot-head"><div><h3>' + esc(s['名稱']) + '</h3>' +
        '<div class="where">Day ' + esc(s['Day']) + '・' + esc(s['地區']) + (isOptional(s['狀態']) ? '・' + OPTIONAL : '') + '</div></div>' + koyo + '</div>' +
        (s['介紹'] ? '<p class="desc">' + txt(s['介紹']) + '</p>' : '') +
        (facts ? '<div class="facts">' + facts + '</div>' : '') +
        '<div class="btn-row"><a class="btn" href="' + esc(mapUrl(s['日文'] || s['名稱'])) + '" target="_blank" rel="noopener">' + ICON.map + '地圖</a>' +
        '<a class="btn" href="' + esc(navUrl(s['日文'] || s['名稱'])) + '" target="_blank" rel="noopener">' + ICON.car + '導航</a></div>' +
        '</article>';
    }).join('');
    return '<div class="section-title"><h2>景點介紹</h2><p>🍁 為 2026 見頃預測</p></div>' +
      '<div class="filters">' + tabs.map((t) => '<button class="filter' + (t === spotFilter ? ' active' : '') + '" data-filter="' + t + '">' + t + '</button>').join('') + '</div>' +
      '<div class="stack">' + cards + '</div>';
  }

  // ── checklist ──
  function checkPeople() {
    const grid = (data.sheets['清單'] || [])[0] || [];
    const start = grid.indexOf('連結') + 1;
    return start > 0 ? grid.slice(start).map(String).filter(Boolean) : [];
  }
  function isOn(v) { return String(v).toUpperCase() === 'TRUE'; }

  function localChecks() {
    try { return JSON.parse(localStorage.getItem(LOCAL_CHECKS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function applyLocalChecks() {
    if (CFG.SCRIPT_URL || !data || !data.sheets['清單']) return;
    const saved = localChecks();
    const grid = data.sheets['清單'];
    const head = grid[0];
    const itemCol = head.indexOf('項目');
    Object.keys(saved).forEach((key) => {
      const [item, person] = key.split('\u0001');
      const r = grid.findIndex((row, i) => i > 0 && row[itemCol] === item);
      const c = head.indexOf(person);
      if (r > 0 && c >= 0) grid[r][c] = saved[key] ? 'TRUE' : 'FALSE';
    });
  }

  function viewPrep() {
    const people = checkPeople();
    const items = rows('清單');
    let me = '';
    try { me = localStorage.getItem(ME_KEY) || ''; } catch (e) { /* ignore */ }

    const progress = people.map((p) => {
      const done = items.filter((it) => isOn(it[p])).length;
      const pct = items.length ? Math.round(done / items.length * 100) : 0;
      return '<div class="prog' + (p === me ? ' me' : '') + '"><div class="name">' + esc(p) + '</div>' +
        '<div class="num">' + done + '<span class="small muted"> / ' + items.length + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');

    const ordered = me ? [me].concat(people.filter((p) => p !== me)) : people;
    const list = items.map((it) => {
      const link = safeUrl(it['連結']);
      const chips = ordered.map((p) => '<button class="person' + (isOn(it[p]) ? ' on' : '') + '" data-item="' + esc(it['項目']) + '" data-person="' + esc(p) + '">' +
        '<span class="box">' + ICON.check + '</span>' + esc(p) + '</button>').join('');
      return '<article class="card check-item">' +
        '<div class="cat">' + esc(it['分類']) + '</div><div class="t">' + esc(it['項目']) + '</div>' +
        (it['說明'] ? '<p class="d">' + txt(it['說明']) + '</p>' : '') +
        (link ? '<p class="d"><a href="' + esc(link) + '" target="_blank" rel="noopener">開啟連結 ↗</a></p>' : '') +
        '<div class="people">' + chips + '</div></article>';
    }).join('');

    const whoChips = people.map((p) => '<button class="filter' + (p === me ? ' active' : '') + '" data-me="' + esc(p) + '">' + esc(p) + '</button>').join('');
    const hint = CFG.SCRIPT_URL
      ? '勾選後會存回試算表，大家都看得到。'
      : '目前還沒連上試算表，勾選只會存在這台裝置。';

    return '<div class="section-title"><h2>出發準備</h2><p>每個人自己勾</p></div>' +
      '<p class="hint">我是：</p><div class="who">' + whoChips + '</div>' +
      '<div class="progress">' + progress + '</div>' +
      '<p class="hint">' + hint + '</p>' +
      '<div class="stack">' + list + '</div>' +
      viewLinks();
  }

  function viewLinks() {
    const groups = {};
    rows('連結').forEach((r) => { (groups[r['分類']] = groups[r['分類']] || []).push(r); });
    const html = Object.keys(groups).map((g) => {
      const items = groups[g].map((r) => {
        const url = safeUrl(r['連結']);
        if (!url) return '';
        const isTel = url.startsWith('tel:');
        return '<a class="link-row' + (g === '緊急' ? ' emergency' : '') + '" href="' + esc(url) + '"' + (isTel ? '' : ' target="_blank" rel="noopener"') + '>' +
          '<span>' + esc(r['名稱']) + (r['說明'] ? '<small>' + esc(r['說明']) + '</small>' : '') + '</span>' +
          '<span class="go">' + (isTel ? esc(url.slice(4)) : '↗') + '</span></a>';
      }).join('');
      return '<div class="link-group"><h3>' + esc(g) + '</h3><div class="card links-card">' + items + '</div></div>';
    }).join('');
    return html ? '<h3 class="sub-title">實用連結</h3>' + html : '';
  }

  async function toggleCheck(btn) {
    const item = btn.dataset.item, person = btn.dataset.person;
    const grid = data.sheets['清單'];
    const head = grid[0];
    const r = grid.findIndex((row, i) => i > 0 && row[head.indexOf('項目')] === item);
    const c = head.indexOf(person);
    if (r < 1 || c < 0) return;
    const next = !isOn(grid[r][c]);
    grid[r][c] = next ? 'TRUE' : 'FALSE';

    if (!CFG.SCRIPT_URL) {
      const saved = localChecks();
      saved[item + '\u0001' + person] = next;
      try { localStorage.setItem(LOCAL_CHECKS_KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ }
      renderView();
      return;
    }

    renderView();
    const el = document.querySelector('.person[data-item="' + CSS.escape(item) + '"][data-person="' + CSS.escape(person) + '"]');
    if (el) el.classList.add('saving');
    try {
      const res = await fetch(CFG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ item: item, person: person, checked: next })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    } catch (err) {
      grid[r][c] = next ? 'FALSE' : 'TRUE';
      toast('沒有存成功，請再試一次');
    }
    renderView();
  }

  // ── routing ──
  function currentView() {
    const v = location.hash.replace('#', '');
    return VIEWS.includes(v) ? v : 'plan';
  }
  function renderView() {
    const v = currentView();
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
    const fn = { plan: viewPlan, stay: viewStay, move: viewMove, spots: viewSpots, prep: viewPrep }[v];
    galleries = [];
    $('#app').innerHTML = fn();
    hydrateMaps();
  }
  function renderAll() {
    renderHeader();
    renderFooter();
    renderView();
  }

  document.addEventListener('click', (e) => {
    const lbBtn = e.target.closest('[data-lb]');
    if (lbBtn) {
      const act = lbBtn.dataset.lb;
      if (act === 'close') closeLightbox(); else stepLightbox(act === 'next' ? 1 : -1);
      return;
    }
    if (e.target.id === 'lightbox' || e.target.classList.contains('lb-figure')) { closeLightbox(); return; }
    const ovT = e.target.closest('[data-ovtoggle]');
    if (ovT) {
      ovOpen = !ovOpen;
      try { localStorage.setItem('tohoku-ov-open', ovOpen ? '1' : '0'); } catch (err) { /* ignore */ }
      const card = ovT.closest('.overview');
      card.classList.toggle('is-closed', !ovOpen);
      ovT.setAttribute('aria-expanded', ovOpen);
      ovT.querySelector('.ov-hint').textContent = ovOpen ? '點 Day 看那天開哪一段' : '點開來看 7 天的路線';
      return;
    }
    const ov = e.target.closest('[data-ov]');
    if (ov) { setOverviewDay(Number(ov.dataset.ov)); return; }
    const routeEl = e.target.closest('#ov-map [data-route-day]');
    if (routeEl) { setOverviewDay(Number(routeEl.dataset.routeDay)); return; }
    const mode = e.target.closest('[data-mapmode]');
    if (mode) { setMapMode(mode.dataset.mapmode); return; }
    const coverBtn = e.target.closest('[data-cover]');
    if (coverBtn) { stepCover(coverBtn.closest('.cover'), Number(coverBtn.dataset.cover)); return; }
    const gal = e.target.closest('[data-gallery]');
    if (gal) {
      const cover = gal.closest('.cover');
      openLightbox(galleries[Number(gal.dataset.gallery)], cover ? Number(cover.dataset.idx) : 0);
      return;
    }
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn) {
      currentDay = Number(dayBtn.dataset.day);
      renderView();
      if (dayBtn.closest('.day-nav, .ov-note')) document.querySelector('.days-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const active = document.querySelector('.day-chip.active');
      if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f) { spotFilter = f.dataset.filter; renderView(); return; }
    const meBtn = e.target.closest('[data-me]');
    if (meBtn) {
      try { localStorage.setItem(ME_KEY, meBtn.dataset.me); } catch (err) { /* ignore */ }
      renderView();
      return;
    }
    const p = e.target.closest('.person');
    if (p) toggleCheck(p);
  });

  document.addEventListener('keydown', (e) => {
    if (!lb) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') stepLightbox(1);
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
  });
  // 卡片封面也可以左右滑
  let coverTouch = null;
  document.addEventListener('touchstart', (e) => {
    const cover = e.target.closest('.cover');
    coverTouch = cover ? { cover: cover, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!coverTouch) return;
    const dx = e.changedTouches[0].clientX - coverTouch.x;
    const dy = e.changedTouches[0].clientY - coverTouch.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) stepCover(coverTouch.cover, dx < 0 ? 1 : -1);
    coverTouch = null;
  });

  let touchX = null;
  $('#lightbox').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
  });

  window.addEventListener('hashchange', () => {
    renderView();
    const heroH = document.querySelector('.hero').offsetHeight;
    if (window.scrollY > heroH) window.scrollTo({ top: heroH });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data) load(); });

  load();
})();
