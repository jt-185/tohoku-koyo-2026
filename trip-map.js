// 簡易地圖：縣界底圖（tohoku-map.js）加上每天的開車路線，全部畫成 SVG。
// 路線用 OSRM 算，算過的存在手機裡；還沒算好時先畫直線虛線。
(function () {
  'use strict';

  const DAY_COLORS = ['#c0392b', '#e07a2f', '#c39a1e', '#5f8a3a', '#2a8a80', '#3d6aa6', '#8a4f9e'];
  const PREF_FILL = {
    '宮城県': '#f4dcc8', '山形県': '#ead9bb', '福島県': '#e1d7eb', '栃木県': '#d9e6cf',
    '秋田県': '#f0dcdc', '岩手県': '#d9e5ec', '新潟県': '#e6e9d8', '群馬県': '#e9e4d6', '茨城県': '#e4e7dd'
  };
  const SEA = '#e2eaec';
  const ROUTE_KEY = 'tohoku-route3:';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const color = (n) => DAY_COLORS[(n - 1) % DAY_COLORS.length];

  function proj(ll) {
    const m = window.TOHOKU_MAP;
    return [(ll[1] - m.lng0) * m.k * m.s, (m.lat1 - ll[0]) * m.s];
  }

  // Douglas–Peucker，減少路線點數
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const len = Math.hypot(bx - ax, by - ay);
      let max = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        // 起終點重疊（繞一圈回原地）時改用到起點的距離
        const d = len ? Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len
          : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
        if (d > max) { max = d; idx = i; }
      }
      if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // ── 路線快取 ──
  const memo = {};
  const pending = {};
  let queue = Promise.resolve();
  const routeKey = (lls) => lls.map((l) => l.join(',')).join(';');

  function cachedRoute(lls) {
    const k = routeKey(lls);
    if (memo[k]) return memo[k];
    if (window.ROUTE_CACHE && window.ROUTE_CACHE[k]) return (memo[k] = window.ROUTE_CACHE[k]);
    try {
      const v = JSON.parse(localStorage.getItem(ROUTE_KEY + k) || 'null');
      if (v) return (memo[k] = v);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function fetchRoute(lls) {
    const k = routeKey(lls);
    const hit = cachedRoute(lls);
    if (hit) return Promise.resolve(hit);
    if (pending[k]) return pending[k];
    // 一次只送一個請求，避免超過 OSRM 公開服務的頻率限制
    pending[k] = queue = queue.then(async () => {
      try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lls.map((l) => l[1] + ',' + l[0]).join(';') + '?overview=full&geometries=geojson';
        const json = await (await fetch(url)).json();
        if (json.code !== 'Ok') throw new Error(json.code);
        const line = simplify(json.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]), 0.0004)
          .map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
        memo[k] = line;
        try { localStorage.setItem(ROUTE_KEY + k, JSON.stringify(line)); } catch (e) { /* ignore */ }
        await new Promise((r) => setTimeout(r, 900));
        return line;
      } catch (e) {
        return null;
      } finally {
        delete pending[k];
      }
    });
    return pending[k];
  }

  const pathD = (lls) => lls.map((ll, i) => {
    const [x, y] = proj(ll);
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join('');

  // 依點的範圍算 viewBox；ratio 是寬/高，不給就照點的形狀
  function fitVB(lls, pad, ratio, minW) {
    const xy = lls.map(proj);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    let w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    let h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    w = Math.max(w, minW || 0);
    if (ratio) { if (w / h < ratio) w = h * ratio; else h = w / ratio; }
    return [cx - w / 2, cy - h / 2, w, h].map((v) => Math.round(v));
  }

  function textW(s, size) {
    let w = 0;
    for (const ch of String(s)) w += /[\x00-\xff]/.test(ch) ? size * 0.58 : size;
    return w;
  }

  // ── 縣名標籤：放在縣內「離邊界、路線、地點最遠」的位置，所以縮放到哪裡都不會被擋住 ──
  const LABEL_PREFS = {
    '宮城県': { name: '宮城縣', color: '#b0643a' },
    '山形県': { name: '山形縣', color: '#8a6a35' },
    '福島県': { name: '福島縣', color: '#6e5a8a' },
    '栃木県': { name: '栃木縣', color: '#5a7a45' }
  };
  const ringCache = new WeakMap();
  function ringsOf(p) {
    let r = ringCache.get(p);
    if (!r) {
      r = p.d.split('M').filter(Boolean).map((seg) => seg.replace(/Z$/, '').split('L').map((pt) => pt.split(',').map(Number)));
      ringCache.set(p, r);
    }
    return r;
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function ringEdgeDist(x, y, ring) {
    let d = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, distSeg(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
    return d;
  }
  function boxDist(x, y, b) {
    const dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]);
    return Math.hypot(dx, dy);
  }
  function placePrefLabel(pref, vb, obs, cap) {
    const [vx, vy, vw, vh] = vb;
    const rings = ringsOf(pref);
    const [cx, cy] = pref.c;
    const cols = 30, rowsN = 24;
    let best = null;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rowsN; j++) {
        const x = vx + ((i + 0.5) / cols) * vw, y = vy + ((j + 0.5) / rowsN) * vh;
        const ring = rings.find((r) => inRing(x, y, r));
        if (!ring) continue;
        let d = Math.min(ringEdgeDist(x, y, ring), x - vx, vx + vw - x, y - vy, vy + vh - y);
        for (const sg of obs.segs) { d = Math.min(d, distSeg(x, y, sg[0], sg[1], sg[2], sg[3])); if (d <= 0) break; }
        for (const c of obs.circles) d = Math.min(d, Math.hypot(x - c[0], y - c[1]) - c[2]);
        for (const b of obs.boxes) d = Math.min(d, boxDist(x, y, b));
        const score = Math.min(d, cap) - 0.01 * Math.hypot(x - cx, y - cy) * (cap / 100);
        if (!best || score > best.score) best = { x: x, y: y, d: d, score: score };
      }
    }
    return best;
  }

  // days: [{ n, pts: [{ ll, label, start, stay }], alts: [...] }]
  // opts: { vb, focus（0 = 全部）, numbers（在圓點裡寫編號）}
  function render(days, opts) {
    const m = window.TOHOKU_MAP;
    if (!m) return '';
    const [vx, vy, vw, vh] = opts.vb;
    const u = vw / 400;
    const focus = opts.focus || 0;
    const numbered = !!(focus && opts.numbers);

    // 1) 每個點的位置：單日模式下靠太近的點拉開一點，避免圓圈和名字疊在一起
    const spots = [];
    const seen = {};
    days.forEach((d) => {
      const isActive = !focus || d.n === focus;
      d.pts.forEach((p, i) => {
        const [x, y] = proj(p.ll);
        if (!isActive) { spots.push({ x: x, y: y, ox: x, oy: y, kind: 'grey', r: 2.6 * u, p: p, d: d }); return; }
        const key = p.ll.join(',');
        if (seen[key]) return;
        seen[key] = true;
        spots.push({ x: x, y: y, ox: x, oy: y, kind: 'stop', r: (numbered ? 8 : p.stay ? 5 : 3.6) * u, p: p, d: d, i: i });
      });
      if (isActive) d.alts.forEach((p) => { const [x, y] = proj(p.ll); spots.push({ x: x, y: y, ox: x, oy: y, kind: 'alt', r: 6 * u, p: p, d: d }); });
    });
    if (numbered) {
      const mv = spots.filter((sp) => sp.kind !== 'grey');
      for (let pass = 0; pass < 8; pass++) {
        for (let i = 1; i < mv.length; i++) {
          for (let j = 0; j < i; j++) {
            let dx = mv[i].x - mv[j].x, dy = mv[i].y - mv[j].y, dd = Math.hypot(dx, dy);
            const minD = mv[i].r + mv[j].r + 4 * u;
            if (dd < minD) {
              if (dd < 1e-6) { dx = 1; dy = -0.4; dd = Math.hypot(dx, dy); }
              const k = (minD - dd) / dd;
              mv[i].x += dx * k; mv[i].y += dy * k;
            }
          }
        }
      }
    }

    // 2) 路線（SVG 座標）
    const routes = days.filter((d) => d.pts.length >= 2).map((d) => {
      const lls = d.pts.map((p) => p.ll);
      const line = cachedRoute(lls);
      return { d: d, line: line, xy: (line || lls).map(proj) };
    });

    // 3) 地點名稱：依序試右、左、上、下，跟已放的重疊就換位置
    const placed = spots.map((sp) => [sp.x - sp.r, sp.y - sp.r, sp.x + sp.r, sp.y + sp.r]);
    const labelBoxes = [];
    let texts = '';
    spots.forEach((sp) => {
      if (sp.kind === 'grey') return;
      let text, strong;
      if (sp.kind === 'alt') { if (!focus) return; text = sp.p.label + '（備案）'; strong = false; }
      else if (numbered) { text = sp.p.label; strong = true; }
      else if (sp.p.stay || focus) { text = sp.p.label; strong = !!sp.p.stay; } else return;
      const fs = (strong ? 12 : 11) * u;
      const w = textW(text, fs), gap = 3.5 * u, x = sp.x, y = sp.y, r = sp.r;
      const tries = [
        [x + r + gap, y + fs * 0.36, 'start', [x + r + gap, y - fs * 0.6, x + r + gap + w, y + fs * 0.5]],
        [x - r - gap, y + fs * 0.36, 'end', [x - r - gap - w, y - fs * 0.6, x - r - gap, y + fs * 0.5]],
        [x, y - r - gap, 'middle', [x - w / 2, y - r - gap - fs, x + w / 2, y - r - gap]],
        [x, y + r + gap + fs * 0.85, 'middle', [x - w / 2, y + r + gap, x + w / 2, y + r + gap + fs]]
      ];
      const hit = (b) => placed.some((q) => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3])) ||
        b[0] < vx || b[2] > vx + vw || b[1] < vy || b[3] > vy + vh;
      const t = tries.find((c) => !hit(c[3]));
      if (!t) return;
      placed.push(t[3]);
      labelBoxes.push(t[3]);
      texts += '<text x="' + t[0].toFixed(1) + '" y="' + t[1].toFixed(1) + '" text-anchor="' + t[2] + '" class="stop-label' + (strong ? ' strong' : '') +
        '" font-size="' + fs.toFixed(1) + '" stroke-width="' + (3.4 * u).toFixed(1) + '">' + esc(text) + '</text>';
    });

    // 4) 組 SVG
    let s = '<svg class="trip-svg" viewBox="' + opts.vb.join(' ') + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="路線圖">';
    s += '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="' + SEA + '"/>';
    s += m.prefs.map((p) => '<path d="' + p.d + '" fill="' + (PREF_FILL[p.n] || '#ebe6dc') + '" stroke="#fffdf8" stroke-width="' + (2.2 * u).toFixed(1) + '" stroke-linejoin="round"/>').join('');

    // 縣名：避開路線、地點和地點名稱
    const obs = { segs: [], circles: [], boxes: labelBoxes };
    routes.filter((rt) => !focus || rt.d.n === focus).forEach((rt) => {
      for (let i = 1; i < rt.xy.length; i++) obs.segs.push([rt.xy[i - 1][0], rt.xy[i - 1][1], rt.xy[i][0], rt.xy[i][1]]);
    });
    spots.forEach((sp) => { if (sp.kind !== 'grey') obs.circles.push([sp.x, sp.y, sp.r + 2 * u]); });
    const pfs = 17 * u;
    m.prefs.forEach((p) => {
      const L = LABEL_PREFS[p.n];
      if (!L) return;
      const best = placePrefLabel(p, opts.vb, obs, pfs * 1.6);
      if (!best || best.d < pfs * 0.55) return;
      s += '<text x="' + best.x.toFixed(1) + '" y="' + (best.y + pfs * 0.35).toFixed(1) + '" class="pref-label" fill="' + L.color + '" font-size="' + pfs.toFixed(1) + '" letter-spacing="' + (2 * u).toFixed(1) + '">' + L.name + '</text>';
    });

    // 路線：沒被選的先畫（灰），選到的最後畫在最上面
    routes.slice().sort((a, b) => (a.d.n === focus) - (b.d.n === focus)).forEach((rt) => {
      const dim = focus && rt.d.n !== focus;
      const attrs = ' data-route-day="' + rt.d.n + '" d="' + pathD(rt.line || rt.d.pts.map((p) => p.ll)) + '"';
      s += '<path class="route-hit"' + attrs + ' stroke-width="' + (16 * u).toFixed(1) + '"/>';
      s += '<path class="route' + (rt.line ? '' : ' pending') + (dim ? ' dim' : '') + '"' + attrs +
        ' stroke="' + (dim ? '#a9a197' : color(rt.d.n)) + '" stroke-width="' + ((dim ? 2.4 : 4) * u).toFixed(1) + '"' +
        (rt.line ? '' : ' stroke-dasharray="' + (6 * u).toFixed(1) + ' ' + (6 * u).toFixed(1) + '"') + '/>';
    });

    // 點：被拉開的點用細線連回真正的位置
    const circle = (x, y, r, fill, stroke, sw, extra) =>
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw.toFixed(1) + '"' + (extra || '') + '/>';
    let dots = '';
    spots.forEach((sp) => {
      if (sp.kind === 'grey') { dots += circle(sp.x, sp.y, sp.r, '#fffdf8', '#a9a197', 1.4 * u); return; }
      if (Math.hypot(sp.x - sp.ox, sp.y - sp.oy) > 1) {
        dots += '<line x1="' + sp.ox.toFixed(1) + '" y1="' + sp.oy.toFixed(1) + '" x2="' + sp.x.toFixed(1) + '" y2="' + sp.y.toFixed(1) + '" stroke="#2b2622" stroke-width="' + (1.2 * u).toFixed(1) + '" stroke-linecap="round"/>' +
          circle(sp.ox, sp.oy, 2.2 * u, '#2b2622', '#fff', 0.8 * u);
      }
      if (sp.kind === 'alt') { dots += circle(sp.x, sp.y, sp.r, '#fffdf8', '#8a8178', 1.4 * u, ' stroke-dasharray="' + (2.5 * u).toFixed(1) + ' ' + (2 * u).toFixed(1) + '"'); return; }
      const p = sp.p, d = sp.d;
      if (numbered) {
        dots += circle(sp.x, sp.y, sp.r, p.start ? '#2b2622' : color(d.n), '#fff', 2 * u);
        const num = p.start ? '起' : String(d.pts[0].start ? sp.i : sp.i + 1);
        dots += '<text x="' + sp.x.toFixed(1) + '" y="' + (sp.y + 3.6 * u).toFixed(1) + '" class="pin-num" font-size="' + (10 * u).toFixed(1) + '">' + num + '</text>';
      } else {
        dots += circle(sp.x, sp.y, sp.r, p.stay ? color(d.n) : '#fffdf8', p.stay ? '#fff' : color(d.n), (p.stay ? 1.6 : 1.8) * u);
      }
    });

    return s + dots + texts + '</svg>';
  }

  // 把還沒算好的路線抓回來，更新畫面上的虛線
  function hydrate(container, days) {
    days.forEach((d) => {
      if (d.pts.length < 2) return;
      const lls = d.pts.map((p) => p.ll);
      if (cachedRoute(lls)) return;
      fetchRoute(lls).then((line) => {
        if (!line || !container.isConnected) return;
        container.querySelectorAll('[data-route-day="' + d.n + '"]').forEach((el) => {
          el.setAttribute('d', pathD(line));
          el.classList.remove('pending');
          el.removeAttribute('stroke-dasharray');
        });
      });
    });
  }

  // 已經算好的路線（地圖座標點），沒有就回傳 null
  function routeOf(lls) { return cachedRoute(lls); }

  window.TripMap = { render: render, hydrate: hydrate, fitVB: fitVB, color: color, routeOf: routeOf };
})();
