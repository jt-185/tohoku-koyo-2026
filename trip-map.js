// 簡易地圖：縣界底圖（tohoku-map.js）加上每天的開車路線，全部畫成 SVG。
// 路線用 OSRM 算，算過的存在手機裡；還沒算好時先畫直線虛線。
(function () {
  'use strict';

  const DAY_COLORS = ['#c0392b', '#e07a2f', '#c39a1e', '#5f8a3a', '#2a8a80', '#3d6aa6', '#8a4f9e'];
  const PREF_FILL = {
    '宮城県': '#f4dcc8', '山形県': '#ead9bb', '福島県': '#e1d7eb', '栃木県': '#d9e6cf',
    '秋田県': '#f0dcdc', '岩手県': '#d9e5ec', '新潟県': '#e6e9d8', '群馬県': '#e9e4d6', '茨城県': '#e4e7dd'
  };
  const PREF_LABEL = {
    '宮城県': { at: [728, 600], color: '#b0643a', name: '宮城縣' },
    '山形県': { at: [360, 250], color: '#8a6a35', name: '山形縣' },
    '福島県': { at: [560, 900], color: '#6e5a8a', name: '福島縣' },
    '栃木県': { at: [370, 1165], color: '#5a7a45', name: '栃木縣' }
  };
  const SEA = '#e2eaec';
  const ROUTE_KEY = 'tohoku-route2:';

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
      const len = Math.hypot(bx - ax, by - ay) || 1e-9;
      let max = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
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

  // days: [{ n, pts: [{ ll, label, start, stay }], alts: [...] }]
  // opts: { vb, focus（0 = 全部）, numbers（在圓點裡寫編號）}
  function render(days, opts) {
    const m = window.TOHOKU_MAP;
    if (!m) return '';
    const [vx, vy, vw, vh] = opts.vb;
    const u = vw / 400;
    const focus = opts.focus || 0;
    let s = '<svg class="trip-svg" viewBox="' + opts.vb.join(' ') + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="路線圖">';
    s += '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="' + SEA + '"/>';
    s += m.prefs.map((p) => '<path d="' + p.d + '" fill="' + (PREF_FILL[p.n] || '#ebe6dc') + '" stroke="#fffdf8" stroke-width="' + (2.2 * u).toFixed(1) + '" stroke-linejoin="round"/>').join('');
    Object.keys(PREF_LABEL).forEach((k) => {
      const L = PREF_LABEL[k];
      const fs = 19 * u;
      const half = textW(L.name, fs) / 2 + 2 * u;
      if (L.at[0] - half < vx || L.at[0] + half > vx + vw || L.at[1] - fs < vy || L.at[1] > vy + vh) return;
      s += '<text x="' + L.at[0] + '" y="' + L.at[1] + '" class="pref-label" fill="' + L.color + '" font-size="' + fs.toFixed(1) + '" letter-spacing="' + (2 * u).toFixed(1) + '">' + L.name + '</text>';
    });

    // 路線：沒被選的先畫（灰），選到的最後畫在最上面
    const order = days.slice().sort((a, b) => (a.n === focus) - (b.n === focus));
    order.forEach((d) => {
      if (d.pts.length < 2) return;
      const lls = d.pts.map((p) => p.ll);
      const line = cachedRoute(lls);
      const dim = focus && d.n !== focus;
      const attrs = ' data-route-day="' + d.n + '" d="' + pathD(line || lls) + '"';
      s += '<path class="route-hit"' + attrs + ' stroke-width="' + (16 * u).toFixed(1) + '"/>';
      s += '<path class="route' + (line ? '' : ' pending') + (dim ? ' dim' : '') + '"' + attrs +
        ' stroke="' + (dim ? '#a9a197' : color(d.n)) + '" stroke-width="' + ((dim ? 2.4 : 4) * u).toFixed(1) + '"' +
        (line ? '' : ' stroke-dasharray="' + (6 * u).toFixed(1) + ' ' + (6 * u).toFixed(1) + '"') + '/>';
    });

    // 點：全部模式畫每個停留點，標出住宿；單日模式只強調那天的點
    const placed = [];
    const labels = [];
    const seen = {};
    const dot = (ll, r, fill, stroke, sw, extra) => {
      const [x, y] = proj(ll);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw.toFixed(1) + '"' + (extra || '') + '/>';
    };
    let dots = '';
    days.forEach((d) => {
      const active = !focus || d.n === focus;
      if (active) return;
      d.pts.forEach((p) => { dots += dot(p.ll, 2.6 * u, '#fffdf8', '#a9a197', 1.4 * u); });
    });
    days.forEach((d) => {
      if (focus && d.n !== focus) return;
      d.pts.forEach((p, i) => {
        const key = p.ll.join(',');
        if (seen[key]) return;
        seen[key] = true;
        const [x, y] = proj(p.ll);
        if (focus && opts.numbers) {
          const r = 9 * u;
          dots += dot(p.ll, r, p.start ? '#2b2622' : color(d.n), '#fff', 2 * u);
          const num = p.start ? '起' : String(d.pts[0].start ? i : i + 1);
          dots += '<text x="' + x.toFixed(1) + '" y="' + (y + 4 * u).toFixed(1) + '" class="pin-num" font-size="' + (11 * u).toFixed(1) + '">' + num + '</text>';
          placed.push([x - r, y - r, x + r, y + r]);
          labels.push({ x: x, y: y, r: r, text: p.label, strong: true });
        } else {
          const r = (p.stay ? 5 : 3.6) * u;
          dots += dot(p.ll, r, p.stay ? color(d.n) : '#fffdf8', p.stay ? '#fff' : color(d.n), (p.stay ? 1.6 : 1.8) * u);
          placed.push([x - r, y - r, x + r, y + r]);
          if (p.stay || focus) labels.push({ x: x, y: y, r: r, text: p.label, strong: p.stay });
        }
      });
      d.alts.forEach((p) => {
        const [x, y] = proj(p.ll);
        dots += dot(p.ll, 6 * u, '#fffdf8', '#8a8178', 1.4 * u, ' stroke-dasharray="' + (2.5 * u).toFixed(1) + ' ' + (2 * u).toFixed(1) + '"');
        if (focus) labels.push({ x: x, y: y, r: 6 * u, text: p.label + '（備案）' });
      });
    });

    // 標籤：依序試右、左、上、下，跟已放的重疊就換位置，四邊都撞到就不畫
    let texts = '';
    labels.forEach((L) => {
      const fs = (L.strong ? 13 : 12) * u;
      const w = textW(L.text, fs), gap = 4 * u;
      const tries = [
        [L.x + L.r + gap, L.y + fs * 0.36, 'start', [L.x + L.r + gap, L.y - fs * 0.6, L.x + L.r + gap + w, L.y + fs * 0.5]],
        [L.x - L.r - gap, L.y + fs * 0.36, 'end', [L.x - L.r - gap - w, L.y - fs * 0.6, L.x - L.r - gap, L.y + fs * 0.5]],
        [L.x, L.y - L.r - gap, 'middle', [L.x - w / 2, L.y - L.r - gap - fs, L.x + w / 2, L.y - L.r - gap]],
        [L.x, L.y + L.r + gap + fs * 0.85, 'middle', [L.x - w / 2, L.y + L.r + gap, L.x + w / 2, L.y + L.r + gap + fs]]
      ];
      const hit = (b) => placed.some((q) => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3])) ||
        b[0] < vx || b[2] > vx + vw || b[1] < vy || b[3] > vy + vh;
      const t = tries.find((c) => !hit(c[3]));
      if (!t) return;
      placed.push(t[3]);
      texts += '<text x="' + t[0].toFixed(1) + '" y="' + t[1].toFixed(1) + '" text-anchor="' + t[2] + '" class="stop-label' + (L.strong ? ' strong' : '') +
        '" font-size="' + fs.toFixed(1) + '" stroke-width="' + (3.4 * u).toFixed(1) + '">' + esc(L.text) + '</text>';
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

  window.TripMap = { render: render, hydrate: hydrate, fitVB: fitVB, color: color };
})();
