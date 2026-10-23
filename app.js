(function () {
  'use strict';

  const CFG = window.TRIP_CONFIG || {};
  const CACHE_KEY = 'tohoku-trip-data';
  const ME_KEY = 'tohoku-trip-me';
  const LOCAL_CHECKS_KEY = 'tohoku-trip-checks';
  const VIEWS = ['plan', 'stay', 'move', 'spots', 'prep'];

  const TYPE_COLORS = {
    '航班': 'var(--sky)', '抵達': 'var(--sky)', '交通': 'var(--ink-3)', '景點': 'var(--maple)',
    '溫泉': 'var(--gold)', '用餐': 'var(--gold)', '住宿': 'var(--moss)', '備案': 'var(--ink-3)'
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
      let src = safeUrl(url);
      if (!/^https:/i.test(src)) return null;
      const drive = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
      if (drive) src = 'https://drive.google.com/thumbnail?id=' + drive[1] + '&sz=w1600';
      const thumb = drive ? src.replace('sz=w1600', 'sz=w600') : src.replace('/1280px-', '/500px-');
      return { src: src, thumb: thumb, caption: rest.join('|').trim() };
    }).filter(Boolean);
  }

  let galleries = [];
  function coverHtml(title, imgs, cls) {
    if (!imgs.length) return '';
    galleries.push({ title: title, imgs: imgs });
    return '<button class="' + (cls || 'cover') + '" data-gallery="' + (galleries.length - 1) + '" aria-label="看「' + esc(title) + '」的照片">' +
      '<img src="' + esc(imgs[0].thumb) + '" alt="" loading="lazy">' +
      (imgs.length > 1 ? '<span class="cover-count">' + imgs.length + ' 張</span>' : '') + '</button>';
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
    const when = data && data.updated ? new Date(data.updated).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const label = { live: '試算表即時資料', cache: '上次載入的資料', backup: '備份資料' }[source] || '';
    $('#sync').textContent = [label, when && '更新於 ' + when].filter(Boolean).join('・');
    const edit = $('#edit-link');
    if (CFG.SHEET_URL) edit.href = CFG.SHEET_URL; else edit.parentElement.hidden = true;
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
      const spot = spots.find((s) => (s['日文'] && s['日文'] === it['地圖']) || (s['名稱'] && it['項目'].indexOf(s['名稱']) >= 0));
      const thumb = spot ? coverHtml(spot['名稱'], parseImages(spot['圖片']), 'thumb') : '';
      return '<li class="tl' + (type === '備案' ? ' is-alt' : '') + '" style="--c:' + color + '">' +
        '<div class="tl-time">' + esc(it['時間']) + '</div>' +
        '<div class="tl-rail"><span class="tl-dot"></span></div>' +
        '<div class="tl-body"><div class="tl-main"><div class="tl-type">' + esc(type) + '</div>' +
        '<div class="tl-title">' + esc(it['項目']) + '</div>' +
        (it['說明'] ? '<p class="tl-desc">' + txt(it['說明']) + '</p>' : '') + links + '</div>' + thumb + '</div></li>';
    }).join('');

    dayMap = dayPoints(currentDay);
    const legend = dayMap.pts.map((p, i) => '<span><i class="pin-mini' + (p.start ? ' start' : '') + '">' + pinLabel(dayMap, i) + '</i>' + esc(p.name) + '</span>').join('<b>→</b>');
    const mapHtml = dayMap.pts.length
      ? '<div class="day-map-wrap"><div id="day-map" class="day-map"></div>' +
        '<p class="map-legend">' + legend + '</p>' +
        (dayMap.pts.length >= 2 ? '<a class="btn" href="' + esc(routeUrl(dayMap.pts)) + '" target="_blank" rel="noopener">' + ICON.map + '用 Google 地圖看這天的路線</a>' : '') +
        '</div>'
      : '';

    const prev = days.find((d) => Number(d['Day']) === currentDay - 1);
    const next = days.find((d) => Number(d['Day']) === currentDay + 1);

    return '<div class="section-title"><h2>每日行程</h2><p>點日期切換</p></div>' +
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

  // ── day map ──
  let dayMap = null;
  let mapInst = null;
  const ROUTE_KEY = 'tohoku-route:';

  // 起點是前一晚的住宿，接著是當天有座標的地點（備案另外標示，不連線）
  function dayPoints(n) {
    const items = rows('行程');
    const pts = [], alts = [];
    const prevStays = items.filter((it) => Number(it['Day']) < n && it['類型'] === '住宿' && parseLatLng(it['座標']));
    if (prevStays.length) {
      const p = prevStays[prevStays.length - 1];
      pts.push({ ll: parseLatLng(p['座標']), name: p['項目'].replace(/\s*入住$/, ''), start: true });
    }
    items.filter((it) => Number(it['Day']) === n).forEach((it) => {
      const ll = parseLatLng(it['座標']);
      if (!ll) return;
      const pt = { ll: ll, name: it['項目'].replace(/\s*入住$/, '') };
      if (it['類型'] === '備案') { alts.push(pt); return; }
      const last = pts[pts.length - 1];
      if (last && last.ll[0] === ll[0] && last.ll[1] === ll[1]) return;
      pts.push(pt);
    });
    return { pts: pts, alts: alts };
  }
  function pinLabel(dm, i) {
    if (dm.pts[i].start) return '起';
    return String(dm.pts[0].start ? i : i + 1);
  }
  function routeUrl(pts) {
    const ll = (p) => p.ll.join(',');
    const mid = pts.slice(1, -1).slice(0, 9).map(ll).join('|');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + ll(pts[0]) +
      '&destination=' + ll(pts[pts.length - 1]) + (mid ? '&waypoints=' + encodeURIComponent(mid) : '');
  }

  function initDayMap() {
    if (mapInst) { mapInst.remove(); mapInst = null; }
    const el = document.getElementById('day-map');
    if (!el || !window.L || !dayMap || !dayMap.pts.length) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const map = mapInst = L.map(el, { scrollWheelZoom: false, dragging: !touch, tap: false, zoomControl: !touch });
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>', minZoom: 5, maxZoom: 18
    }).addTo(map);
    map.fitBounds(dayMap.pts.concat(dayMap.alts).map((p) => p.ll), { padding: [30, 30], maxZoom: 12 });

    const pin = (cls, label) => L.divIcon({ className: 'pin ' + cls, html: '<span>' + label + '</span>', iconSize: [26, 26], iconAnchor: [13, 13] });
    dayMap.pts.forEach((p, i) => {
      L.marker(p.ll, { icon: pin(p.start ? 'pin-start' : '', pinLabel(dayMap, i)) })
        .bindTooltip(p.name, { direction: 'top', offset: [0, -12] }).addTo(map);
    });
    dayMap.alts.forEach((p) => {
      L.marker(p.ll, { icon: pin('pin-alt', '備') }).bindTooltip(p.name + '（備案）', { direction: 'top', offset: [0, -12] }).addTo(map);
    });
    if (dayMap.pts.length >= 2) drawRoute(dayMap.pts.map((p) => p.ll), map);
  }

  // 開車路線用 OSRM 算，算過的存在手機裡；連不上時改畫虛線
  async function drawRoute(lls, map) {
    const key = ROUTE_KEY + lls.map((l) => l.join(',')).join(';');
    let line = null;
    try { line = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    if (!line) {
      try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lls.map((l) => l[1] + ',' + l[0]).join(';') + '?overview=full&geometries=geojson';
        const json = await (await fetch(url)).json();
        if (json.code !== 'Ok') throw new Error(json.code);
        line = json.routes[0].geometry.coordinates.map((c) => [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5]);
        try { localStorage.setItem(key, JSON.stringify(line)); } catch (e) { /* ignore */ }
      } catch (e) { line = null; }
    }
    if (map !== mapInst) return;
    if (line) L.polyline(line, { color: '#b23a2a', weight: 4, opacity: 0.85 }).addTo(map);
    else L.polyline(lls, { color: '#b23a2a', weight: 3, dashArray: '6 8' }).addTo(map);
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

  function viewStay() {
    const s = settings();
    const start = s['出發日'];
    const stays = rows('住宿');
    const totalNights = stays.reduce((sum, h) => sum + (Number(h['晚數']) || 1), 0);
    const cards = stays.map((h) => {
      const nights = Number(h['晚數']) || 1;
      let dateLabel = esc(h['日期']);
      if (start && /^\d+\/\d+$/.test(h['日期'])) {
        const [m, d] = h['日期'].split('/').map(Number);
        const iso = start.slice(0, 4) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        dateLabel = esc(h['日期']) + ' – ' + addDays(iso, nights);
      }
      const kv = [
        ['房間', h['房間']], ['入住', h['入住']], ['退房', h['退房']], ['餐食', h['餐食']],
        ['溫泉', h['溫泉']], ['停車', h['停車']], ['地址', h['地址']]
      ].filter(([, v]) => v).map(([k, v]) => '<dt>' + k + '</dt><dd>' + txt(v) + '</dd>').join('');
      const q = h['地址'] || h['日文名'] || h['名稱'];
      const tel = h['電話'] ? '<a class="btn" href="tel:' + esc(h['電話'].replace(/[^\d+]/g, '')) + '">' + ICON.phone + esc(h['電話']) + '</a>' : '';
      return '<article class="card stay">' + coverHtml(h['名稱'], parseImages(h['圖片'])) +
        '<div class="stay-top"><div><div class="stay-date">' + dateLabel + '・' + nights + ' 晚・' + esc(h['地區']) + '</div>' +
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
      (drive ? '<h3 class="sub-title">開車時間（粗估）</h3><p class="hint">點一段路線，Google 地圖會從你目前的位置導航到目的地。</p>' +
        '<article class="card"><ul class="drive-list">' + drive + '</ul></article>' : '');
  }

  function viewSpots() {
    const all = rows('景點');
    const tabs = ['全部', '行程', '備案'];
    const list = all
      .filter((s) => spotFilter === '全部' || s['狀態'] === spotFilter)
      .sort((a, b) => (a['狀態'] === b['狀態'] ? 0 : a['狀態'] === '行程' ? -1 : 1) || Number(a['Day']) - Number(b['Day']));
    const cards = list.map((s) => {
      const facts = [['開放', s['開放時間']], ['費用', s['費用']], ['停車', s['停車']]]
        .filter(([, v]) => v).map(([k, v]) => '<span><b>' + k + '</b>' + esc(v) + '</span>').join('');
      const koyo = s['紅葉見頃'] ? '<span class="badge maple">🍁 ' + esc(s['紅葉見頃']) + '</span>' : '';
      return '<article class="card spot' + (s['狀態'] === '備案' ? ' is-alt' : '') + '">' + coverHtml(s['名稱'], parseImages(s['圖片'])) +
        '<div class="spot-head"><div><h3>' + esc(s['名稱']) + '</h3>' +
        '<div class="where">Day ' + esc(s['Day']) + '・' + esc(s['地區']) + (s['狀態'] === '備案' ? '・備案' : '') + '</div></div>' + koyo + '</div>' +
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
    dayMap = null;
    $('#app').innerHTML = fn();
    initDayMap();
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
    const gal = e.target.closest('[data-gallery]');
    if (gal) { openLightbox(galleries[Number(gal.dataset.gallery)], 0); return; }
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn) {
      currentDay = Number(dayBtn.dataset.day);
      renderView();
      if (dayBtn.closest('.day-nav')) document.querySelector('.days').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
