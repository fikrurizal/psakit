(function (Sg) {
  const clean = (a) => { const o = []; for (const v of a) if (Number.isFinite(v)) o.push(v); return o; };
  function percentile(sorted, p) {
    const n = sorted.length;
    if (!n) return NaN;
    const h = (n - 1) * p / 100, l = Math.floor(h), f = h - l;
    return l + 1 < n ? sorted[l] + f * (sorted[l + 1] - sorted[l]) : sorted[l];
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  function sd(a) {
    if (a.length < 2) return 0;
    let m = 0, s = 0, k = 0;
    for (const v of a) { k++; const d = v - m; m += d / k; s += d * (v - m); }
    return Math.sqrt(s / (a.length - 1));
  }
  // Following the Ersatz rule: a failed iteration means no summary statistics for that output, however few failed.
  function summary(values, ci) {
    const a = clean(values).sort((x, y) => x - y), tail = (100 - ci) / 2, total = values.length;
    if (a.length < total) return { n: total, failed: total - a.length, mean: NaN, sd: NaN, median: NaN, lo: NaN, hi: NaN, min: NaN, max: NaN, se: NaN };
    return { n: a.length, failed: 0, se: a.length > 1 ? sd(a) / Math.sqrt(a.length) : NaN, mean: mean(a), sd: sd(a), median: percentile(a, 50), lo: percentile(a, tail), hi: percentile(a, 100 - tail), min: a[0], max: a[a.length - 1] };
  }
  function pearson(x, y) {
    const n = x.length; let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  function ranks(a) { // ties get their average rank
    const idx = Array.from(a, (_, i) => i).sort((p, q) => a[p] - a[q]), r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }
  const spearman = (x, y) => pearson(ranks(x), ranks(y));
  function kendall(x, y) { // tau-b; thinned evenly to 3000 pairs of points to keep this O(n^2) step responsive
    const st = Math.max(1, Math.ceil(x.length / 3000)), a = [], b = [];
    for (let i = 0; i < x.length; i += st) { a.push(x[i]); b.push(y[i]); }
    let c = 0, tx = 0, ty = 0;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const s = Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
      c += s;
      if (a[i] !== a[j]) tx++;
      if (b[i] !== b[j]) ty++;
    }
    return tx && ty ? c / Math.sqrt(tx * ty) : NaN;
  }
  // Partial rank correlation of each input with the output, controlling for the other inputs.
  function prcc(inputs, y) {
    const cols = inputs.map(ranks).concat([ranks(y)]), k = cols.length, R = cols.map(() => new Array(k));
    for (let i = 0; i < k; i++) for (let j = i; j < k; j++) R[i][j] = R[j][i] = i === j ? 1 : pearson(cols[i], cols[j]);
    const P = Sg.invert(R);
    if (!P) return inputs.map(() => NaN);
    return inputs.map((_, i) => -P[i][k - 1] / Math.sqrt(P[i][i] * P[k - 1][k - 1]));
  }
  function histogram(values, bins) {
    const a = clean(values);
    if (!a.length) return [];
    let lo = Infinity, hi = -Infinity;
    for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) return [{ x0: lo - 0.5, x1: lo + 0.5, count: a.length }];
    if (!bins) { const s = a.slice().sort((p, q) => p - q), iqr = percentile(s, 75) - percentile(s, 25), w = 2 * iqr / Math.cbrt(a.length); bins = Math.max(8, Math.min(40, w > 0 ? Math.ceil((hi - lo) / w) : 20)); }
    const w = (hi - lo) / bins, out = [];
    for (let i = 0; i < bins; i++) out.push({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 });
    for (const v of a) out[Math.min(bins - 1, Math.floor((v - lo) / w))].count++;
    return out;
  }
  Sg.stats = { clean, percentile, mean, sd, summary, pearson, ranks, spearman, kendall, prcc, histogram };
})(globalThis.Sg = globalThis.Sg || {});
