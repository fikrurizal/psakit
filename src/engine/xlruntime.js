// Worksheet function implementations for compiled models.
// Storage: every cell has one slot. N holds numbers (errors are NaN), M is 1 when the slot counts as a number inside
// a range, and V holds text, booleans and other non-numbers.
(function (Sg) {
  const lg = (x) => Sg.lgamma(x);
  function erfcx(x) { // complementary error function, Numerical Recipes rational approximation refined for accuracy
    const z = Math.abs(x), t = 2 / (2 + z), ty = 4 * t - 2;
    const cof = [-1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15, -1.523e-15, -9.4e-17, 1.21e-16, -2.8e-17];
    let d = 0, dd = 0;
    for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
    const r = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
    return x >= 0 ? r : 2 - r;
  }
  const normCdf = (x) => 0.5 * erfcx(-x / Math.SQRT2);
  function normInv(p) { // Acklam, with one Halley refinement
    if (!(p > 0 && p < 1)) return NaN;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    let x;
    if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - 0.02425) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  // Excel treats numbers equal to 15 significant digits as equal when comparing.
  const near = (a, b) => a === b || Math.abs(a - b) <= 1.5e-15 * Math.max(Math.abs(a), Math.abs(b));
  const roundDec = (x, d, fn) => {
    const f = Math.pow(10, d), y = x * f, r = fn(Math.abs(+(Math.abs(y)).toPrecision(15)));
    return x < 0 ? -r / f : r / f;
  };
  const excelRound = (v) => Math.floor(v + 0.5);
  const numToStr = (x) => {
    if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
    return String(parseFloat(x.toPrecision(15))).replace('e+', 'E+').replace('e-', 'E-');
  };

  Sg.makeRuntime = function (N, M, V, ranges, E) {
    const $ = {};
    $.val = (s) => (M[s] === 1 ? N[s] : V[s] === undefined ? null : V[s]);
    $.setV = (s, x) => {
      if (typeof x === 'number') { if (x - x !== 0) { N[s] = NaN; } else N[s] = x; M[s] = 1; V[s] = undefined; }
      else if (x === null || x === undefined) { N[s] = 0; M[s] = 1; V[s] = undefined; }
      else if (typeof x === 'boolean') { N[s] = x ? 1 : 0; M[s] = 0; V[s] = x; }
      else { N[s] = NaN; M[s] = 0; V[s] = x; }
    };
    $.setB = (s, x) => { if (x !== x) { N[s] = NaN; M[s] = 1; V[s] = NaN; } else { N[s] = x; M[s] = 0; V[s] = x !== 0; } };
    $.num = (x) => {
      if (typeof x === 'number') return x;
      if (x === null || x === undefined || x === '') return x === '' ? NaN : 0;
      if (typeof x === 'boolean') return x ? 1 : 0;
      const t = String(x).trim();
      if (t === '') return NaN;
      const n = Number(t);
      if (Number.isFinite(n)) return n;
      if (/%$/.test(t)) { const p = Number(t.slice(0, -1)); if (Number.isFinite(p)) return p / 100; }
      return NaN;
    };
    $.str = (x) => {
      if (typeof x === 'string') return x;
      if (typeof x === 'number') return x !== x ? NaN : numToStr(x);
      if (x === null || x === undefined) return '';
      return x ? 'TRUE' : 'FALSE';
    };
    $.cat = (a, b) => { const x = $.str(a), y = $.str(b); return x !== x || y !== y ? NaN : x + y; };
    $.bool = (x) => {
      if (typeof x === 'number') return x !== x ? NaN : x !== 0 ? 1 : 0;
      if (typeof x === 'boolean') return x ? 1 : 0;
      if (x === null || x === undefined) return 0;
      const t = String(x).toUpperCase();
      return t === 'TRUE' ? 1 : t === 'FALSE' ? 0 : NaN;
    };
    $.b2v = (x) => (x !== x ? NaN : x !== 0);
    $.fin = (x) => (x - x === 0 ? x : NaN);
    $.div = (a, b) => (b === 0 ? NaN : a / b);
    $.pow = (a, b) => { if (a === 0 && b === 0) return NaN; const r = Math.pow(a, b); return r - r === 0 ? r : NaN; };
    $.eq = (a, b) => (a !== a || b !== b ? NaN : near(a, b) ? 1 : 0);
    $.ne = (a, b) => (a !== a || b !== b ? NaN : near(a, b) ? 0 : 1);
    $.lt = (a, b) => (a !== a || b !== b ? NaN : a < b && !near(a, b) ? 1 : 0);
    $.gt = (a, b) => (a !== a || b !== b ? NaN : a > b && !near(a, b) ? 1 : 0);
    $.le = (a, b) => (a !== a || b !== b ? NaN : a <= b || near(a, b) ? 1 : 0);
    $.ge = (a, b) => (a !== a || b !== b ? NaN : a >= b || near(a, b) ? 1 : 0);
    // Comparison across types. Excel's order is number < text < boolean, and blank matches 0, "" and FALSE.
    const rank = (x) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
    const cmp3 = (a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
      if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return near(a, b) ? 0 : a - b;
      if (ra === 1) { const x = a.toUpperCase(), y = b.toUpperCase(); return x < y ? -1 : x > y ? 1 : 0; }
      return (a ? 1 : 0) - (b ? 1 : 0);
    };
    $.cmp = (op, a, b) => {
      if (a !== a || b !== b) return NaN;
      const c = cmp3(a === undefined ? null : a, b === undefined ? null : b);
      switch (op) {
        case '=': return c === 0 ? 1 : 0; case '<>': return c !== 0 ? 1 : 0;
        case '<': return c < 0 ? 1 : 0; case '>': return c > 0 ? 1 : 0;
        case '<=': return c <= 0 ? 1 : 0; default: return c >= 0 ? 1 : 0;
      }
    };

    // ---- Ranges ------------------------------------------------------------------------------
    $.sumR = (r) => { const x = r.idx; let s = 0; for (let i = 0; i < x.length; i++) { const k = x[i]; if (M[k] === 1) s += N[k]; } return s; };
    $.countR = (r) => { const x = r.idx; let c = 0; for (let i = 0; i < x.length; i++) { const k = x[i]; if (M[k] === 1 && !r.blank[i]) { if (N[k] !== N[k]) return c; c++; } } return c; };
    $.minR = (r) => { const x = r.idx; let m = Infinity, any = false; for (let i = 0; i < x.length; i++) { const k = x[i]; if (M[k] === 1 && !r.blank[i]) { const v = N[k]; if (v !== v) return NaN; if (v < m) m = v; any = true; } } return any ? m : 0; };
    $.maxR = (r) => { const x = r.idx; let m = -Infinity, any = false; for (let i = 0; i < x.length; i++) { const k = x[i]; if (M[k] === 1 && !r.blank[i]) { const v = N[k]; if (v !== v) return NaN; if (v > m) m = v; any = true; } } return any ? m : 0; };
    // Flattens a mix of ranges, array values and scalars to the numbers an aggregate function counts.
    const collect = (list) => {
      const out = [];
      for (let a = 0; a < list.length; a++) {
        const it = list[a];
        if (typeof it === 'number') { out.push(it); continue; }
        if (it && it.idx) { const x = it.idx; for (let i = 0; i < x.length; i++) { const k = x[i]; if (M[k] === 1 && !it.blank[i]) out.push(N[k]); } }
        else if (it && it.d) { for (let i = 0; i < it.d.length; i++) out.push(it.d[i]); }
      }
      return out;
    };
    const hasNaN = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) return true; return false; };
    const stat = (f) => (list) => { const a = collect(list); return hasNaN(a) ? NaN : f(a); };
    const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
    const ssd = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return s; };
    const nums = (a) => Float64Array.from(a).sort();
    const pctInc = (a, p) => { if (!a.length || p < 0 || p > 1) return NaN; const s = nums(a), h = (s.length - 1) * p, l = Math.floor(h); return l + 1 < s.length ? s[l] + (h - l) * (s[l + 1] - s[l]) : s[l]; };
    const pctExc = (a, p) => { const n = a.length; if (!n || p <= 0 || p >= 1) return NaN; const h = (n + 1) * p; if (h < 1 || h > n) return NaN; const s = nums(a), l = Math.floor(h); return l >= n ? s[n - 1] : s[l - 1] + (h - l) * (s[l] - s[l - 1]); };
    $.SUM = stat((a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; });
    $.AVERAGE = stat((a) => (a.length ? mean(a) : NaN));
    $.COUNT = (list) => collect(list).filter((v) => v === v).length;
    $.MIN = stat((a) => (a.length ? a.reduce((m, v) => (v < m ? v : m), Infinity) : 0));
    $.MAX = stat((a) => (a.length ? a.reduce((m, v) => (v > m ? v : m), -Infinity) : 0));
    $.PRODUCT = stat((a) => (a.length ? a.reduce((m, v) => m * v, 1) : 0));
    $.MEDIAN = stat((a) => { if (!a.length) return NaN; const s = nums(a), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; });
    $.STDEV = stat((a) => (a.length < 2 ? NaN : Math.sqrt(ssd(a) / (a.length - 1))));
    $.STDEVP = stat((a) => (a.length < 1 ? NaN : Math.sqrt(ssd(a) / a.length)));
    $.VAR = stat((a) => (a.length < 2 ? NaN : ssd(a) / (a.length - 1)));
    $.VARP = stat((a) => (a.length < 1 ? NaN : ssd(a) / a.length));
    $.SUMSQ = stat((a) => a.reduce((s, v) => s + v * v, 0));
    $.GEOMEAN = stat((a) => (a.length && a.every((v) => v > 0) ? Math.exp(a.reduce((s, v) => s + Math.log(v), 0) / a.length) : NaN));
    $.HARMEAN = stat((a) => (a.length && a.every((v) => v > 0) ? a.length / a.reduce((s, v) => s + 1 / v, 0) : NaN));
    $.LARGE = (r, k) => { const a = collect([r]); if (hasNaN(a) || !(k >= 1) || k > a.length) return NaN; const s = nums(a); return s[s.length - Math.ceil(k)]; };
    $.SMALL = (r, k) => { const a = collect([r]); if (hasNaN(a) || !(k >= 1) || k > a.length) return NaN; return nums(a)[Math.ceil(k) - 1]; };
    $.PCTINC = (r, p) => { const a = collect([r]); return hasNaN(a) ? NaN : pctInc(a, p); };
    $.PCTEXC = (r, p) => { const a = collect([r]); return hasNaN(a) ? NaN : pctExc(a, p); };
    $.QUARTINC = (r, q) => { const t = Math.floor(q); return t < 0 || t > 4 ? NaN : $.PCTINC(r, t / 4); };
    $.RANK = (x, r, ord) => { const a = collect([r]); if (hasNaN(a)) return NaN; let k = 1, f = false; for (const v of a) { if (near(v, x)) f = true; else if (ord ? v < x : v > x) k++; } return f ? k : NaN; };
    $.COUNTA = (list) => {
      let c = 0;
      for (const it of list) { if (it && it.idx) { for (let i = 0; i < it.idx.length; i++) if (!it.blank[i]) c++; } else if (it !== undefined) c++; }
      return c;
    };
    $.COUNTBLANK = (r) => { let c = 0; for (let i = 0; i < r.idx.length; i++) { const k = r.idx[i]; if (r.blank[i] || V[k] === '') c++; } return c; };
    // Pairs of equally sized ranges. Excel ignores a pair when either side isn't a number.
    const pairsOf = (x, y) => {
      if (x.idx.length !== y.idx.length) return null;
      const a = [], b = [];
      for (let i = 0; i < x.idx.length; i++) {
        const p = x.idx[i], q = y.idx[i];
        if (M[p] === 1 && M[q] === 1 && !x.blank[i] && !y.blank[i]) { a.push(N[p]); b.push(N[q]); }
      }
      return hasNaN(a) || hasNaN(b) ? null : [a, b];
    };
    const sxy = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s; };
    $.CORREL = (x, y) => { const p = pairsOf(x, y); if (!p || p[0].length < 2) return NaN; const d = Math.sqrt(ssd(p[0]) * ssd(p[1])); return d > 0 ? sxy(p[0], p[1]) / d : NaN; };
    $.SLOPE = (y, x) => { const p = pairsOf(x, y); if (!p || p[0].length < 2) return NaN; const d = ssd(p[0]); return d > 0 ? sxy(p[0], p[1]) / d : NaN; };
    $.INTERCEPT = (y, x) => { const p = pairsOf(x, y); if (!p || p[0].length < 2) return NaN; const d = ssd(p[0]); return d > 0 ? mean(p[1]) - (sxy(p[0], p[1]) / d) * mean(p[0]) : NaN; };
    $.FORECAST = (v, y, x) => { const b = $.SLOPE(y, x), a = $.INTERCEPT(y, x); return a + b * v; };
    $.COVARP = (x, y) => { const p = pairsOf(x, y); return !p || !p[0].length ? NaN : sxy(p[0], p[1]) / p[0].length; };
    $.COVARS = (x, y) => { const p = pairsOf(x, y); return !p || p[0].length < 2 ? NaN : sxy(p[0], p[1]) / (p[0].length - 1); };
    $.SUMXMY2 = (x, y) => { const p = pairsOf(x, y); if (!p) return NaN; let s = 0; for (let i = 0; i < p[0].length; i++) s += (p[0][i] - p[1][i]) * (p[0][i] - p[1][i]); return s; };
    $.NPV = (rate, list) => { const a = collect(list); if (hasNaN(a) || rate === -1) return NaN; let s = 0, f = 1 + rate, d = f; for (let i = 0; i < a.length; i++) { s += a[i] / d; d *= f; } return s; };

    // ---- Lookup -------------------------------------------------------------------------------
    const lookupEq = (k, x) => {
      if (typeof x === 'number' && M[k] === 1) return near(N[k], x);
      if (typeof x === 'string') return typeof V[k] === 'string' && V[k].toUpperCase() === x.toUpperCase();
      if (typeof x === 'boolean') return V[k] === x;
      return false;
    };
    // Position of the last value <= x (dir 1) or the first exact match, within slots `pos` and same-type values.
    const approx = (x, n, at) => {
      let lo = 0, hi = n - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, k = at(mid), v = $.val(k);
        if (v === null) { hi = mid - 1; continue; }
        if (typeof v !== typeof x) { hi = mid - 1; continue; }
        if (cmp3(v, x) <= 0) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    $.MATCH = (x, r, type) => {
      if (x !== x) return NaN;
      if (r.rows !== 1 && r.cols !== 1) return NaN;
      const n = r.idx.length, idx = r.idx;
      if (type === 0) { for (let i = 0; i < n; i++) if (!r.blank[i] && lookupEq(idx[i], x)) return i + 1; return NaN; }
      if (type > 0) { const b = approx(x, n, (i) => idx[i]); return b < 0 ? NaN : b + 1; }
      let best = -1;
      for (let i = 0; i < n; i++) { const v = $.val(idx[i]); if (v === null || typeof v !== typeof x) continue; if (cmp3(v, x) >= 0) best = i; else break; }
      return best < 0 ? NaN : best + 1;
    };
    $.indexSlot = (r, row, col) => {
      let i;
      if (col === undefined) {
        if (r.rows === 1) i = Math.trunc(row) - 1; else if (r.cols === 1) i = Math.trunc(row) - 1; else return -1;
      } else {
        const a = Math.trunc(row), b = Math.trunc(col);
        if (a < 1 || b < 1 || a > r.rows || b > r.cols) return -1;
        i = (a - 1) * r.cols + (b - 1);
      }
      if (!(i >= 0 && i < r.idx.length)) return -1;
      return r.idx[i];
    };
    $.INDEXN = (r, row, col) => { if (row !== row || col !== col) return NaN; const s = $.indexSlot(r, row, col); return s < 0 ? NaN : N[s]; };
    $.INDEXV = (r, row, col) => { if (row !== row || col !== col) return NaN; const s = $.indexSlot(r, row, col); if (s < 0) return NaN; const v = $.val(s); return v === null ? 0 : v; };
    const vl = (x, r, c, exact, vertical) => {
      if (x !== x || c !== c) return NaN;
      const ci = Math.trunc(c) - 1, keys = vertical ? r.rows : r.cols;
      if (ci < 0 || ci >= (vertical ? r.cols : r.rows)) return NaN;
      const at = vertical ? (i) => r.idx[i * r.cols] : (i) => r.idx[i];
      let hit = -1;
      if (exact) { for (let i = 0; i < keys; i++) if (lookupEq(at(i), x)) { hit = i; break; } }
      else hit = approx(x, keys, at);
      if (hit < 0) return NaN;
      const s = vertical ? r.idx[hit * r.cols + ci] : r.idx[ci * r.cols + hit], v = $.val(s);
      return v === null ? 0 : v;
    };
    $.VLOOKUP = (x, r, c, a) => vl(x, r, c, a === 0 || a === false, true);
    $.HLOOKUP = (x, r, c, a) => vl(x, r, c, a === 0 || a === false, false);
    $.LOOKUP = (x, r, r2) => {
      if (x !== x) return NaN;
      const b = approx(x, r.idx.length, (i) => r.idx[i]);
      if (b < 0) return NaN;
      const v = $.val((r2 || r).idx[b]);
      return v === null ? 0 : v;
    };

    // ---- Criteria -----------------------------------------------------------------------------
    const critCache = new Map();
    const parseCrit = (c) => {
      const key = typeof c + ':' + c;
      let f = critCache.get(key);
      if (f) return f;
      let op = '=', operand = c;
      if (typeof c === 'string') {
        const m = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(c);
        if (m) { op = m[1]; operand = m[2]; }
        const n = operand === '' ? NaN : Number(operand);
        if (Number.isFinite(n)) operand = n;
        else if (/^(true|false)$/i.test(operand)) operand = /^true$/i.test(operand);
      }
      if (typeof operand === 'string') {
        const hasWild = /[*?]/.test(operand);
        const re = hasWild ? new RegExp('^' + operand.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is') : null;
        const U = operand.toUpperCase();
        const eq = (k, blank) => (operand === '' ? blank || V[k] === '' : typeof V[k] === 'string' && (re ? re.test(V[k]) : V[k].toUpperCase() === U));
        if (op === '=') f = eq;
        else if (op === '<>') f = (k, blank) => !eq(k, blank);
        else f = (k) => { if (typeof V[k] !== 'string') return false; const u = V[k].toUpperCase(); return op === '<' ? u < U : op === '>' ? u > U : op === '<=' ? u <= U : u >= U; };
      } else if (typeof operand === 'boolean') {
        f = op === '<>' ? (k) => V[k] !== operand : (k) => V[k] === operand;
      } else {
        const x = operand;
        switch (op) {
          case '=': f = (k, b) => !b && M[k] === 1 && near(N[k], x); break;
          case '<>': f = (k, b) => b || M[k] !== 1 || !near(N[k], x); break;
          case '<': f = (k, b) => !b && M[k] === 1 && N[k] < x; break;
          case '>': f = (k, b) => !b && M[k] === 1 && N[k] > x; break;
          case '<=': f = (k, b) => !b && M[k] === 1 && N[k] <= x; break;
          default: f = (k, b) => !b && M[k] === 1 && N[k] >= x;
        }
      }
      if (critCache.size < 5000) critCache.set(key, f);
      return f;
    };
    const ifsLoop = (target, pairs, visit) => {
      const n = pairs[0].idx.length;
      for (const p of pairs) if (p.idx.length !== n) return false;
      if (target && target.idx.length !== n) return false;
      const fs = [];
      for (let j = 0; j < pairs.length; j += 2) fs.push(parseCrit(pairs[j + 1]));
      for (let i = 0; i < n; i++) {
        let ok = true;
        for (let j = 0; j < fs.length && ok; j++) { const r = pairs[2 * j]; ok = fs[j](r.idx[i], r.blank[i]); }
        if (ok) visit(i);
      }
      return true;
    };
    const flatPairs = (args) => { const o = []; for (let i = 0; i < args.length; i += 2) o.push(args[i], args[i + 1]); return { pairs: o.filter((_, i) => i % 2 === 0), crits: o.filter((_, i) => i % 2 === 1) }; };
    const runIfs = (target, args, visit) => {
      const list = [];
      for (let i = 0; i < args.length; i += 2) { if (args[i + 1] !== args[i + 1]) return false; list.push(args[i], args[i + 1]); }
      const n = list[0].idx.length;
      if (target && target.idx.length !== n) return false;
      const fs = [];
      for (let j = 0; j < list.length; j += 2) { if (list[j].idx.length !== n) return false; fs.push(parseCrit(list[j + 1])); }
      for (let i = 0; i < n; i++) {
        let ok = true;
        for (let j = 0; j < fs.length && ok; j++) { const r = list[2 * j]; ok = fs[j](r.idx[i], r.blank[i]); }
        if (ok) visit(i);
      }
      return true;
    };
    void ifsLoop; void flatPairs;
    const numAt = (r, i, cb) => { const k = r.idx[i]; if (M[k] === 1 && !r.blank[i]) cb(N[k]); };
    $.SUMIFS = (t, args) => { let s = 0; return runIfs(t, args, (i) => numAt(t, i, (v) => { s += v; })) ? s : NaN; };
    $.COUNTIFS = (args) => { let c = 0; return runIfs(null, args, () => { c++; }) ? c : NaN; };
    $.AVERAGEIFS = (t, args) => { let s = 0, c = 0; if (!runIfs(t, args, (i) => numAt(t, i, (v) => { s += v; c++; }))) return NaN; return c ? s / c : NaN; };
    $.MAXIFS = (t, args) => { let m = -Infinity, any = false; if (!runIfs(t, args, (i) => numAt(t, i, (v) => { if (v > m) m = v; any = true; }))) return NaN; return any ? m : 0; };
    $.MINIFS = (t, args) => { let m = Infinity, any = false; if (!runIfs(t, args, (i) => numAt(t, i, (v) => { if (v < m) m = v; any = true; }))) return NaN; return any ? m : 0; };

    // ---- Array values, for SUMPRODUCT and for aggregates over expressions like A1:A5*B1:B5 --------
    $.arr = (r) => {
      const d = new Float64Array(r.idx.length);
      for (let i = 0; i < d.length; i++) { const k = r.idx[i]; d[i] = M[k] === 1 ? N[k] : typeof V[k] === 'boolean' ? (V[k] ? 1 : 0) : 0; }
      return { d, rows: r.rows, cols: r.cols };
    };
    $.lit = (rows) => ({ d: Float64Array.from(rows.flat().map((v) => (typeof v === 'number' ? v : v === true ? 1 : 0))), rows: rows.length, cols: rows[0].length });
    const OPS = {
      '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? NaN : a / b), '^': (a, b) => $.pow(a, b),
      '=': $.eq, '<>': $.ne, '<': $.lt, '>': $.gt, '<=': $.le, '>=': $.ge,
    };
    $.aop = (op, x, y) => {
      const f = OPS[op];
      const X = typeof x === 'number' ? null : x, Y = typeof y === 'number' ? null : y;
      const base = X || Y;
      if (X && Y && (X.rows !== Y.rows || X.cols !== Y.cols)) { const d = new Float64Array(Math.max(X.d.length, Y.d.length)).fill(NaN); return { d, rows: Math.max(X.rows, Y.rows), cols: Math.max(X.cols, Y.cols) }; }
      const d = new Float64Array(base.d.length);
      for (let i = 0; i < d.length; i++) d[i] = f(X ? X.d[i] : x, Y ? Y.d[i] : y);
      return { d, rows: base.rows, cols: base.cols };
    };
    $.aneg = (x) => ({ d: x.d.map((v) => -v), rows: x.rows, cols: x.cols });
    $.SUMPRODUCT = (list) => {
      if (!list.length) return NaN;
      const n = list[0].d.length;
      for (const a of list) if (a.d.length !== n) return NaN;
      let s = 0;
      for (let i = 0; i < n; i++) { let p = 1; for (let j = 0; j < list.length; j++) p *= list[j].d[i]; s += p; }
      return s;
    };

    // ---- Scalars ------------------------------------------------------------------------------
    $.ROUND = (x, d) => { if (x !== x || d !== d) return NaN; return roundDec(x, Math.trunc(d), excelRound); };
    $.ROUNDUP = (x, d) => { if (x !== x || d !== d) return NaN; return roundDec(x, Math.trunc(d), Math.ceil); };
    $.ROUNDDOWN = (x, d) => { if (x !== x || d !== d) return NaN; return roundDec(x, Math.trunc(d), Math.floor); };
    $.INT = (x) => Math.floor(x);
    $.TRUNC = (x, d) => { if (d === undefined || d === 0) return Math.trunc(x); return roundDec(x, Math.trunc(d), Math.floor); };
    $.MOD = (a, b) => { if (b === 0 || a !== a || b !== b) return NaN; const r = a - b * Math.floor(a / b); return near(r, b) ? 0 : r; };
    $.SIGN = (x) => (x !== x ? NaN : x > 0 ? 1 : x < 0 ? -1 : 0);
    $.CEILING = (x, s) => { if (s === 0) return 0; if (x > 0 && s < 0) return NaN; return Math.ceil(+(x / s).toPrecision(15)) * s; };
    $.FLOOR = (x, s) => { if (s === 0) return NaN; if (x > 0 && s < 0) return NaN; return Math.floor(+(x / s).toPrecision(15)) * s; };
    $.MROUND = (x, m) => { if (m === 0) return 0; if (x * m < 0) return NaN; return excelRound(+(x / m).toPrecision(15)) * m; };
    $.LOG = (x, b) => (x > 0 && (b === undefined || (b > 0 && b !== 1)) ? (b === undefined || b === 10 ? Math.log10(x) : Math.log(x) / Math.log(b)) : NaN);
    $.LN = (x) => (x > 0 ? Math.log(x) : NaN);
    $.LOG10 = (x) => (x > 0 ? Math.log10(x) : NaN);
    $.SQRT = (x) => (x >= 0 ? Math.sqrt(x) : NaN);
    $.EXP = (x) => $.fin(Math.exp(x));
    $.FACT = (x) => { if (!(x >= 0)) return NaN; const k = Math.floor(x); if (k > 170) return NaN; let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; };
    $.COMBIN = (n, k) => { n = Math.trunc(n); k = Math.trunc(k); if (!(n >= 0) || !(k >= 0) || k > n) return NaN; return Math.round(Math.exp(lg(n + 1) - lg(k + 1) - lg(n - k + 1))); };
    $.GAMMALN = (x) => (x > 0 ? lg(x) : NaN);
    $.GAMMA = (x) => (x > 0 ? $.fin(Math.exp(lg(x))) : NaN);
    $.ATAN2 = (x, y) => (x === 0 && y === 0 ? NaN : Math.atan2(y, x));
    $.ASIN = (x) => (x >= -1 && x <= 1 ? Math.asin(x) : NaN);
    $.ACOS = (x) => (x >= -1 && x <= 1 ? Math.acos(x) : NaN);
    $.AND = (list) => { let any = false, res = 1; for (const it of list) { if (it && it.idx) { for (let i = 0; i < it.idx.length; i++) { const k = it.idx[i]; if (it.blank[i]) continue; if (M[k] === 1) { if (N[k] !== N[k]) return NaN; any = true; if (N[k] === 0) res = 0; } else if (typeof V[k] === 'boolean') { any = true; if (!V[k]) res = 0; } } } else { if (it !== it) return NaN; any = true; if (!it) res = 0; } } return any ? res : NaN; };
    $.OR = (list) => { let any = false, res = 0; for (const it of list) { if (it && it.idx) { for (let i = 0; i < it.idx.length; i++) { const k = it.idx[i]; if (it.blank[i]) continue; if (M[k] === 1) { if (N[k] !== N[k]) return NaN; any = true; if (N[k] !== 0) res = 1; } else if (typeof V[k] === 'boolean') { any = true; if (V[k]) res = 1; } } } else { if (it !== it) return NaN; any = true; if (it) res = 1; } } return any ? res : NaN; };
    $.XOR = (list) => { let c = 0; for (const it of list) { if (it !== it) return NaN; if (it) c++; } return c % 2; };
    $.NORMSDIST = (x) => (x !== x ? NaN : normCdf(x));
    $.NORMSINV = (p) => normInv(p);
    $.NORMDIST = (x, m, s, cum) => { if (!(s > 0)) return NaN; const z = (x - m) / s; return cum ? normCdf(z) : Math.exp(-z * z / 2) / (s * Math.sqrt(2 * Math.PI)); };
    $.NORMINV = (p, m, s) => (s > 0 ? m + s * normInv(p) : NaN);
    $.LOGNORMDIST = (x, m, s, cum) => { if (!(x > 0) || !(s > 0)) return NaN; const z = (Math.log(x) - m) / s; return cum ? normCdf(z) : Math.exp(-z * z / 2) / (x * s * Math.sqrt(2 * Math.PI)); };
    $.LOGNORMINV = (p, m, s) => (s > 0 ? Math.exp(m + s * normInv(p)) : NaN);
    $.EXPONDIST = (x, l, cum) => { if (!(x >= 0) || !(l > 0)) return NaN; return cum ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x); };
    $.BINOMDIST = (k, n, p, cum) => {
      k = Math.trunc(k); n = Math.trunc(n);
      if (!(k >= 0) || k > n || !(p >= 0 && p <= 1)) return NaN;
      const pmf = (i) => (p === 0 ? (i === 0 ? 1 : 0) : p === 1 ? (i === n ? 1 : 0) : Math.exp(lg(n + 1) - lg(i + 1) - lg(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p)));
      if (!cum) return pmf(k);
      let s = 0; for (let i = 0; i <= k; i++) s += pmf(i);
      return Math.min(1, s);
    };
    $.POISSONDIST = (k, m, cum) => {
      k = Math.trunc(k);
      if (!(k >= 0) || !(m >= 0)) return NaN;
      const pmf = (i) => (m === 0 ? (i === 0 ? 1 : 0) : Math.exp(i * Math.log(m) - m - lg(i + 1)));
      if (!cum) return pmf(k);
      let s = 0; for (let i = 0; i <= k; i++) s += pmf(i);
      return Math.min(1, s);
    };
    $.LEN = (x) => { const s = $.str(x); return s !== s ? NaN : s.length; };
    $.LEFT = (x, n) => { const s = $.str(x); return s !== s || !(n >= 0) ? NaN : s.slice(0, Math.trunc(n)); };
    $.RIGHT = (x, n) => { const s = $.str(x); return s !== s || !(n >= 0) ? NaN : Math.trunc(n) === 0 ? '' : s.slice(-Math.trunc(n)); };
    $.MID = (x, a, n) => { const s = $.str(x); return s !== s || !(a >= 1) || !(n >= 0) ? NaN : s.substr(Math.trunc(a) - 1, Math.trunc(n)); };
    $.UPPER = (x) => { const s = $.str(x); return s !== s ? NaN : s.toUpperCase(); };
    $.LOWER = (x) => { const s = $.str(x); return s !== s ? NaN : s.toLowerCase(); };
    $.TRIM = (x) => { const s = $.str(x); return s !== s ? NaN : s.trim().replace(/ +/g, ' '); };
    $.VALUE = (x) => $.num(x === null ? 0 : x);
    $.EXACT = (a, b) => { const x = $.str(a), y = $.str(b); return x !== x || y !== y ? NaN : x === y ? 1 : 0; };
    $.istext = (x) => (typeof x === 'string' ? 1 : 0);
    $.isnum = (x) => (typeof x === 'number' && x === x ? 1 : 0);
    $.islog = (x) => (typeof x === 'boolean' ? 1 : 0);
    $.iserr = (x) => (x !== x ? 1 : 0);

    // ---- Calls into the engine ----------------------------------------------------------------
    const onThrow = (e, fn, addr) => {
      if (e && (e.code === 'NUM' || e.code === 'VALUE')) { E.noteError(addr, fn); return NaN; }
      if (!E.fatal) E.fatal = `Unexpected error in ${fn} at ${addr}: ${e && e.message}`;
      return NaN;
    };
    $.er0 = (f, n, a) => { try { return f(a); } catch (e) { return onThrow(e, n, a); } };
    $.er1 = (f, n, a, x) => { if (x !== x) return NaN; try { return f(a, x); } catch (e) { return onThrow(e, n, a); } };
    $.er2 = (f, n, a, x, y) => { if (x !== x || y !== y) return NaN; try { return f(a, x, y); } catch (e) { return onThrow(e, n, a); } };
    $.er3 = (f, n, a, x, y, z) => { if (x !== x || y !== y || z !== z) return NaN; try { return f(a, x, y, z); } catch (e) { return onThrow(e, n, a); } };
    $.er4 = (f, n, a, x, y, z, w) => { if (x !== x || y !== y || z !== z || w !== w) return NaN; try { return f(a, x, y, z, w); } catch (e) { return onThrow(e, n, a); } };
    $.er5 = (f, n, a, x, y, z, w, u) => { if (x !== x || y !== y || z !== z || w !== w || u !== u) return NaN; try { return f(a, x, y, z, w, u); } catch (e) { return onThrow(e, n, a); } };
    $.er6 = (f, n, a, x, y, z, w, u, t) => { if (x !== x || y !== y || z !== z || w !== w || u !== u || t !== t) return NaN; try { return f(a, x, y, z, w, u, t); } catch (e) { return onThrow(e, n, a); } };
    // Range argument as Excel passes it to a custom function. Fixed ranges build once and are reused, which lets the
    // engine memoise the tables it derives from them. Any error cell means the function isn't called.
    $.mat = (r) => {
      if (r.fixed && r.m) return r.m;
      // A live range often holds the same values as last time, such as a table that only changes once per run. Handing
      // back the same array then lets the engine reuse whatever it derived from it.
      const prev = r.m;
      let same = !!prev;
      if (same) {
        outer: for (let i = 0, p = 0; i < r.rows; i++) {
          const row = prev[i];
          for (let j = 0; j < r.cols; j++, p++) {
            const k = r.idx[p], v = r.blank[p] ? '' : $.val(k);
            if (v !== row[j] && !(v === null && row[j] === '')) { same = false; break outer; }
          }
        }
        if (same) return prev;
      }
      const out = [];
      for (let i = 0, p = 0; i < r.rows; i++) {
        const row = new Array(r.cols);
        for (let j = 0; j < r.cols; j++, p++) {
          const k = r.idx[p], v = r.blank[p] ? '' : $.val(k);
          if (v !== v) return NaN;
          row[j] = v === null ? '' : v;
        }
        out.push(row);
      }
      r.m = out;
      return out;
    };
    $.spill = (r, x) => {
      if (x !== x || !Array.isArray(x)) { for (let i = 0; i < r.idx.length; i++) $.setV(r.idx[i], NaN); return; }
      for (let i = 0, p = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++, p++) {
        const row = x[i];
        // Beyond the returned shape Excel shows #N/A in a legacy array range. A spill would stop there instead.
        $.setV(r.idx[p], row === undefined || row[j] === undefined ? NaN : row[j]);
      }
    };
    $.rand = (a) => E.u(a + '|RAND')();
    $.randbetween = (a, lo, hi) => { const l = Math.ceil(lo), h = Math.floor(hi); return l > h ? NaN : l + Math.floor(E.u(a + '|RAND')() * (h - l + 1)); };
    return $;
  };
})(globalThis.Sg = globalThis.Sg || {});
