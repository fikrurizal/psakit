// Small hand-written SVG charts, with no chart library so the add-in has no dependencies.
(function (Sg) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const text = (parent, x, y, s, attrs) => { const t = el('text', Object.assign({ x, y }, attrs), parent); t.textContent = s; return t; };

  function fmt(v, decimals) {
    if (v === undefined || v === null || !Number.isFinite(v)) return 'n/a';
    if (decimals !== undefined && decimals !== 'auto') return v.toLocaleString(undefined, { minimumFractionDigits: +decimals, maximumFractionDigits: +decimals });
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-4 || a >= 1e9)) return v.toExponential(2);
    if (a >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  Sg.fmt = fmt;

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return out;
  }
  function setup(host, height) {
    host.innerHTML = '';
    host.classList.add('chart');
    const width = Math.max(200, host.clientWidth || 300);
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' }, host);
    const tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true; host.appendChild(tip);
    const showTip = (s, x, y) => {
      tip.textContent = s; tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(width - w, x - w / 2)) + 'px';
      tip.style.top = Math.max(0, y - 26) + 'px';
    };
    return { svg, width, height, showTip, hideTip: () => { tip.hidden = true; } };
  }

  // Histogram. Bars inside the confidence interval are solid and tail bars are pale, so the interval
  // can be read directly off the shape.
  Sg.histogram = function (host, values, opt) {
    opt = opt || {};
    const H = opt.height || 170, axis = opt.axis !== false, c = setup(host, H), bins = opt.binData || Sg.stats.histogram(values, opt.bins);
    if (!bins.length) return;
    const mt = 14, mb = axis ? 20 : 2, W = c.width, plotH = H - mt - mb, lo = bins[0].x0, hi = bins[bins.length - 1].x1, max = Math.max(...bins.map((b) => b.count));
    const x = (v) => ((v - lo) / (hi - lo)) * W, y = (v) => mt + plotH * (1 - v / max), total = bins.reduce((a, b) => a + b.count, 0);
    c.svg.setAttribute('aria-label', `Histogram: mean ${fmt(opt.mean)}, interval ${fmt(opt.lo)} to ${fmt(opt.hi)}`);
    const baseY = mt + plotH;
    bins.forEach((b) => {
      const x0 = x(b.x0), bw = Math.max(1, x(b.x1) - x0 - (W / bins.length > 4 ? 2 : 1));
      if (b.count) {
        const top = y(b.count), h = Math.max(1.5, baseY - top), r = Math.min(3, bw / 2, h), mid = (b.x0 + b.x1) / 2;
        const inCi = opt.lo === undefined || (mid >= opt.lo && mid <= opt.hi);
        el('path', { d: `M${x0} ${baseY}V${baseY - h + r}Q${x0} ${baseY - h} ${x0 + r} ${baseY - h}H${x0 + bw - r}Q${x0 + bw} ${baseY - h} ${x0 + bw} ${baseY - h + r}V${baseY}Z`, class: inCi ? 'bar-ci' : 'bar-tail' }, c.svg);
      }
      if (opt.tooltip !== false) {
        const hit = el('rect', { x: x0, y: mt, width: W / bins.length, height: plotH, class: 'hit' }, c.svg);
        hit.addEventListener('mousemove', () => c.showTip(`${fmt(b.x0)} to ${fmt(b.x1)}: ${(100 * b.count / total).toFixed(1)}%`, x0 + bw / 2, y(b.count)));
        hit.addEventListener('mouseleave', c.hideTip);
      }
    });
    el('line', { x1: 0, x2: W, y1: baseY, y2: baseY, class: 'base' }, c.svg);
    if (opt.mean !== undefined && Number.isFinite(opt.mean) && opt.mean >= lo && opt.mean <= hi) {
      const mx = x(opt.mean);
      el('line', { x1: mx, x2: mx, y1: mt - 4, y2: baseY, class: 'meanline', 'pointer-events': 'none' }, c.svg);
      if (axis) text(c.svg, Math.max(14, Math.min(W - 14, mx)), 10, 'mean', { 'text-anchor': mx < 14 ? 'start' : 'middle' });
    }
    if (axis) {
      const ticks = niceTicks(lo, hi, Math.max(2, Math.floor(W / 80)));
      ticks.forEach((t) => {
        const tx = x(t), anchor = tx < 16 ? 'start' : tx > W - 16 ? 'end' : 'middle';
        el('line', { x1: tx, x2: tx, y1: baseY, y2: baseY + 3, class: 'base' }, c.svg);
        text(c.svg, tx, H - 5, fmt(t), { 'text-anchor': anchor });
      });
    }
  };

  // Line chart with a crosshair readout. One y axis only.
  Sg.lineChart = function (host, ys, opt) {
    opt = opt || {};
    const H = opt.height || 170, c = setup(host, H), n = ys.length;
    if (!n) return;
    const st = Math.max(1, Math.floor(n / 400)), pts = [];
    for (let i = 0; i < n; i += st) pts.push([i, ys[i]]);
    if (pts[pts.length - 1][0] !== n - 1) pts.push([n - 1, ys[n - 1]]);
    const finite = ys.filter(Number.isFinite);
    let lo = opt.yMin !== undefined ? opt.yMin : Math.min(...finite), hi = opt.yMax !== undefined ? opt.yMax : Math.max(...finite);
    if (lo === hi) { lo -= 1; hi += 1; }
    const yt = niceTicks(lo, hi, 4), labels = yt.map((t) => fmt(t)), ml = Math.min(70, 8 + Math.max(...labels.map((s) => s.length)) * 6.2), mt = 8, mb = 20, W = c.width, pw = W - ml - 6, ph = H - mt - mb;
    lo = Math.min(lo, yt[0]); hi = Math.max(hi, yt[yt.length - 1]);
    const X = (i) => ml + (n > 1 ? (i / (n - 1)) * pw : 0), Y = (v) => mt + ph * (1 - (v - lo) / (hi - lo));
    yt.forEach((t, k) => { el('line', { x1: ml, x2: W - 6, y1: Y(t), y2: Y(t), class: 'tick' }, c.svg); text(c.svg, ml - 5, Y(t) + 4, labels[k], { 'text-anchor': 'end' }); });
    el('line', { x1: ml, x2: W - 6, y1: mt + ph, y2: mt + ph, class: 'base' }, c.svg);
    el('path', { d: 'M' + pts.filter((p) => Number.isFinite(p[1])).map((p) => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('L'), class: 'line' }, c.svg);
    text(c.svg, ml, H - 5, opt.xLeft !== undefined ? opt.xLeft : '1', {});
    text(c.svg, W - 6, H - 5, opt.xRight !== undefined ? opt.xRight : (n).toLocaleString() + (opt.xLabel ? ' ' + opt.xLabel : ''), { 'text-anchor': 'end' });
    const cross = el('line', { y1: mt, y2: mt + ph, class: 'base', visibility: 'hidden' }, c.svg);
    const hit = el('rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent' }, c.svg);
    hit.addEventListener('mousemove', (e) => {
      const r = c.svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.max(0, Math.min(n - 1, Math.round(((px - ml) / pw) * (n - 1))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      c.showTip(opt.tip ? opt.tip(i) : `${(i + 1).toLocaleString()}: ${fmt(ys[i])}`, X(i), Y(ys[i]));
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); c.hideTip(); });
  };

  Sg.scatter = function (host, xs, ys, opt) {
    opt = opt || {};
    const H = opt.height || 200, c = setup(host, H), idx = [];
    for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) idx.push(i);
    if (!idx.length) return;
    const st = Math.max(1, Math.ceil(idx.length / 1500));
    let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
    for (const i of idx) { xl = Math.min(xl, xs[i]); xh = Math.max(xh, xs[i]); yl = Math.min(yl, ys[i]); yh = Math.max(yh, ys[i]); }
    if (xl === xh) { xl -= 1; xh += 1; } if (yl === yh) { yl -= 1; yh += 1; }
    const yt = niceTicks(yl, yh, 4), xt = niceTicks(xl, xh, 3), labels = yt.map((t) => fmt(t)), ml = Math.min(70, 8 + Math.max(...labels.map((s) => s.length)) * 6.2), mt = 8, mb = 20, W = c.width, pw = W - ml - 8, ph = H - mt - mb;
    const X = (v) => ml + ((v - xl) / (xh - xl)) * pw, Y = (v) => mt + ph * (1 - (v - yl) / (yh - yl));
    yt.forEach((t, k) => { el('line', { x1: ml, x2: W - 8, y1: Y(t), y2: Y(t), class: 'tick' }, c.svg); text(c.svg, ml - 5, Y(t) + 4, labels[k], { 'text-anchor': 'end' }); });
    xt.forEach((t) => text(c.svg, X(t), H - 5, fmt(t), { 'text-anchor': 'middle' }));
    el('line', { x1: ml, x2: W - 8, y1: mt + ph, y2: mt + ph, class: 'base' }, c.svg);
    for (let k = 0; k < idx.length; k += st) el('circle', { cx: X(xs[idx[k]]).toFixed(1), cy: Y(ys[idx[k]]).toFixed(1), r: 2.2, class: 'dot' }, c.svg);
  };

  // Signed bars around zero. A label row sits above each bar, because a narrow pane has no room beside it.
  Sg.signedBars = function (host, rows, opt) {
    opt = opt || {};
    const rowH = 38, H = rows.length * rowH + 4, c = setup(host, H), W = c.width, max = opt.max || Math.max(1e-12, ...rows.map((r) => Math.abs(r.value) || 0)), mid = W / 2, scale = (W / 2 - 1) / max;
    rows.forEach((r, i) => {
      const y = i * rowH;
      text(c.svg, 0, y + 13, r.label, { class: 'label' });
      text(c.svg, W, y + 13, Number.isFinite(r.value) ? r.value.toFixed(3) : 'n/a', { 'text-anchor': 'end', class: 'value' });
      if (Number.isFinite(r.value)) {
        const w = Math.max(1, Math.abs(r.value) * scale), x = r.value >= 0 ? mid : mid - w;
        el('rect', { x, y: y + 19, width: w, height: 11, rx: 2, class: r.value >= 0 ? 'pos' : 'neg' }, c.svg);
      }
      el('line', { x1: mid, x2: mid, y1: y + 17, y2: y + 32, class: 'base' }, c.svg);
    });
  };

  // Two-way heatmap. Diverging around the base case: teal above it, rust below, neutral at the base.
  Sg.heatmap = function (host, opt) {
    const nx = opt.xs.length, ny = opt.ys.length, labels = opt.ys.map((y) => fmt(y)), ml = Math.min(72, 10 + Math.max(...labels.map((s) => s.length)) * 6.2), mt = 6, mb = 22;
    const W0 = Math.max(200, host.clientWidth || 300), cell = (W0 - ml - 4) / nx, ch = Math.max(16, Math.min(cell * 0.7, 30)), H = mt + mb + ch * ny, c = setup(host, H), W = c.width;
    const css = getComputedStyle(document.documentElement), parse = (v) => { const d = document.createElement('canvas').getContext('2d'); d.fillStyle = v; const h = d.fillStyle; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); };
    const pos = parse(css.getPropertyValue('--mark').trim()), neg = parse(css.getPropertyValue('--rust').trim()), mid = parse(css.getPropertyValue('--well').trim());
    const span = Math.max(1e-300, ...opt.values.flat().filter(Number.isFinite).map((v) => Math.abs(v - opt.base)));
    const showVals = nx <= 7 && cell > 36;
    const lum = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    opt.values.forEach((row, j) => row.forEach((v, i) => {
      const x = ml + i * cell, y = mt + (ny - 1 - j) * ch;
      let rgb = mid;
      if (Number.isFinite(v)) { const t = Math.min(1, Math.abs(v - opt.base) / span), to = v >= opt.base ? pos : neg; rgb = mid.map((m, k) => Math.round(m + (to[k] - m) * t)); }
      const r = el('rect', { x, y, width: Math.max(1, cell - 2), height: Math.max(1, ch - 2), rx: 2, fill: `rgb(${rgb.join(',')})` }, c.svg);
      if (showVals) {
        const t = text(c.svg, x + (cell - 2) / 2, y + (ch - 2) / 2 + 4, Number.isFinite(v) ? fmt(v) : 'n/a', { 'text-anchor': 'middle', 'pointer-events': 'none' });
        t.style.fill = lum(rgb) > 0.55 ? '#16302b' : '#ffffff';
      }
      r.addEventListener('mousemove', () => c.showTip(`${fmt(opt.xs[i])}, ${fmt(opt.ys[j])}: ${Number.isFinite(v) ? fmt(v) : 'failed'}`, x + cell / 2, y));
      r.addEventListener('mouseleave', c.hideTip);
    }));
    opt.ys.forEach((yv, j) => text(c.svg, ml - 5, mt + (ny - 1 - j) * ch + ch / 2 + 3, labels[j], { 'text-anchor': 'end' }));
    const every = Math.ceil(nx / Math.max(2, Math.floor((W - ml) / 56)));
    opt.xs.forEach((xv, i) => { if (i % every === 0 || i === nx - 1) text(c.svg, ml + i * cell + (cell - 2) / 2, H - 6, fmt(xv), { 'text-anchor': 'middle' }); });
  };

  // Tornado for one-at-a-time sensitivity: output at the low and high input, around the base case.
  Sg.tornado = function (host, rows, base) {
    const rowH = 40, H = rows.length * rowH + 4, c = setup(host, H), W = c.width;
    let lo = base, hi = base;
    rows.forEach((r) => { lo = Math.min(lo, r.low, r.high); hi = Math.max(hi, r.low, r.high); });
    if (lo === hi) { lo -= 1; hi += 1; }
    const X = (v) => 1 + ((v - lo) / (hi - lo)) * (W - 2), bx = X(base);
    rows.forEach((r, i) => {
      const y = i * rowH;
      text(c.svg, 0, y + 13, r.label, { class: 'label' });
      text(c.svg, W, y + 13, `${fmt(r.low)} to ${fmt(r.high)}`, { 'text-anchor': 'end', class: 'value' });
      for (const [v, cls] of [[r.low, 'neg'], [r.high, 'pos']]) {
        const x = Math.min(X(v), bx), w = Math.max(1, Math.abs(X(v) - bx));
        el('rect', { x, y: y + 19, width: w, height: 11, rx: 2, class: cls }, c.svg);
      }
      el('line', { x1: bx, x2: bx, y1: y + 17, y2: y + 32, class: 'base' }, c.svg);
    });
  };
})(globalThis.Sg = globalThis.Sg || {});
