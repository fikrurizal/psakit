// Distribution library. Parameterisations and validity rules follow the Ersatz Function Overview v1.35.
(function (Sg) {
  class ErNum extends Error { constructor(m) { super(m || '#NUM!'); this.code = 'NUM'; } }
  class ErValue extends Error { constructor(m) { super(m || '#VALUE!'); this.code = 'VALUE'; } }
  Sg.ErNum = ErNum; Sg.ErValue = ErValue;

  const LG = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    let y = x, t = x + 5.5, s = 1.000000000190015;
    t -= (x + 0.5) * Math.log(t);
    for (let j = 0; j < 6; j++) s += LG[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  Sg.lgamma = lgamma;
  const gammaF = (x) => Math.exp(lgamma(x));

  function normal(u) { // ratio of uniforms with Leva's quadratic bounds
    for (;;) {
      const a = u(), b = 1.7156 * (u() - 0.5), x = a - 0.449871, y = Math.abs(b) + 0.386595;
      const q = x * x + y * (0.196 * y - 0.25472 * x);
      if (q < 0.27597) return b / a;
      if (q <= 0.27846 && b * b <= -4 * a * a * Math.log(a)) return b / a;
    }
  }
  function gamma(u, a, b) { // Marsaglia and Tsang
    if (a < 1) return gamma(u, a + 1, b) * Math.pow(u(), 1 / a);
    const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = normal(u), t = 1 + c * x;
      if (t <= 0) continue;
      const v = t * t * t, w = u();
      if (w < 1 - 0.0331 * x * x * x * x || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * b;
    }
  }
  function beta(u, a, b) { const x = gamma(u, a, 1), y = gamma(u, b, 1); return x / (x + y); }
  function poisson(u, mu) {
    if (mu <= 0) return 0;
    if (mu < 10) { const L = Math.exp(-mu); let k = 0, p = u(); while (p > L) { k++; p *= u(); } return k; }
    const sm = Math.sqrt(mu), b = 0.931 + 2.53 * sm, a = -0.059 + 0.02483 * b, ia = 1.1239 + 1.1328 / (b - 3.4), vr = 0.9277 - 3.6224 / (b - 2), lm = Math.log(mu);
    for (;;) { // PTRS, Hörmann 1993
      const U = u() - 0.5, V = u(), us = 0.5 - Math.abs(U), k = Math.floor((2 * a / us + b) * U + mu + 0.43);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || (us < 0.013 && V > us)) continue;
      if (Math.log(V) + Math.log(ia) - Math.log(a / (us * us) + b) <= -mu + k * lm - lgamma(k + 1)) return k;
    }
  }
  function binomial(u, n, p) {
    if (p <= 0 || n === 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - binomial(u, n, 1 - p);
    const q = 1 - p;
    if (n * p < 10) {
      const s = p / q, a = (n + 1) * s;
      for (;;) {
        let r = Math.pow(q, n), x = 0, v = u(), ok = true;
        while (v > r) { v -= r; x++; if (x > n) { ok = false; break; } r *= a / x - s; }
        if (ok) return x;
      }
    }
    const spq = Math.sqrt(n * p * q), b = 1.15 + 2.53 * spq, a = -0.0873 + 0.0248 * b + 0.01 * p, c = n * p + 0.5;
    const vr = 0.92 - 4.2 / b, alpha = (2.83 + 5.1 / b) * spq, m = Math.floor((n + 1) * p), lr = Math.log(p / q);
    const lm = lgamma(m + 1) + lgamma(n - m + 1);
    for (;;) { // BTRS, Hörmann 1993
      const U = u() - 0.5, V = u(), us = 0.5 - Math.abs(U), k = Math.floor((2 * a / us + b) * U + c);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || k > n) continue;
      if (Math.log(V * alpha / (a / (us * us) + b)) <= lm - lgamma(k + 1) - lgamma(n - k + 1) + (k - m) * lr) return k;
    }
  }
  function hypergeometric(u, n, D, M) {
    const lo = Math.max(0, n + D - M), hi = Math.min(n, D), lc = (a, b) => lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1);
    let k = lo, pr = Math.exp(lc(D, lo) + lc(M - D, n - lo) - lc(M, n)), v = u();
    while (v > pr && k < hi) { v -= pr; pr *= (D - k) * (n - k) / ((k + 1) * (M - D - n + k + 1)); k++; }
    return k;
  }
  Object.assign(Sg, { rNormal: normal, rGamma: gamma, rBeta: beta, rPoisson: poisson, rBinomial: binomial });

  const isInt = (x) => Number.isInteger(x), pos = (x) => x > 0;
  const betaSd = (a, b) => Math.sqrt(a * b / ((a + b) * (a + b) * (a + b + 1)));
  const pertAB = (a, m, b) => [1 + 4 * (m - a) / (b - a), 1 + 4 * (b - m) / (b - a)];

  // Each entry: params, check(args), mean(args), sd(args), sample(u, args), discrete.
  const D = {
    ErBernoulli: { params: ['p'], discrete: true, check: ([p]) => p >= 0 && p <= 1, mean: ([p]) => p, sd: ([p]) => Math.sqrt(p * (1 - p)), sample: (u, [p]) => (u() < p ? 1 : 0) },
    ErBeta: { params: ['alpha1', 'alpha2'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => a / (a + b), sd: ([a, b]) => betaSd(a, b), sample: (u, [a, b]) => beta(u, a, b) },
    ErBeta4: { params: ['alpha1', 'alpha2', 'min', 'max'], check: ([a, b, l, h]) => pos(a) && pos(b) && l < h, mean: ([a, b, l, h]) => l + (h - l) * a / (a + b), sd: ([a, b, l, h]) => (h - l) * betaSd(a, b), sample: (u, [a, b, l, h]) => l + (h - l) * beta(u, a, b) },
    ErBinomial: { params: ['N', 'p'], discrete: true, check: ([n, p]) => isInt(n) && n > 0 && p >= 0 && p <= 1, mean: ([n, p]) => n * p, sd: ([n, p]) => Math.sqrt(n * p * (1 - p)), sample: (u, [n, p]) => binomial(u, n, p) },
    ErChi2: { params: ['k'], check: ([k]) => isInt(k) && k > 0, mean: ([k]) => k, sd: ([k]) => Math.sqrt(2 * k), sample: (u, [k]) => gamma(u, k / 2, 2) },
    ErDelaporte: { params: ['alpha', 'beta', 'gamma'], discrete: true, check: ([a, b, g]) => pos(a) && pos(b) && pos(g), mean: ([a, b, g]) => a * b + g, sd: ([a, b, g]) => Math.sqrt(a * b * (1 + b) + g), sample: (u, [a, b, g]) => poisson(u, gamma(u, a, b)) + poisson(u, g) },
    ErDice: { params: ['sides'], discrete: true, check: ([s]) => isInt(s) && s > 1, mean: ([s]) => (s + 1) / 2, sd: ([s]) => Math.sqrt((s * s - 1) / 12), sample: (u, [s]) => 1 + Math.floor(u() * s) },
    ErErlang: { params: ['m', 'beta'], check: ([m, b]) => isInt(m) && m > 0 && pos(b), mean: ([m, b]) => m * b, sd: ([m, b]) => b * Math.sqrt(m), sample: (u, [m, b]) => gamma(u, m, b) },
    ErExponential: { params: ['beta'], check: ([b]) => pos(b), mean: ([b]) => b, sd: ([b]) => b, sample: (u, [b]) => -b * Math.log(u()) },
    ErGamma: { params: ['alpha', 'beta'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => a * b, sd: ([a, b]) => b * Math.sqrt(a), sample: (u, [a, b]) => gamma(u, a, b) },
    ErGeometric: { params: ['p'], discrete: true, check: ([p]) => p > 0 && p <= 1, mean: ([p]) => (1 - p) / p, sd: ([p]) => Math.sqrt(1 - p) / p, sample: (u, [p]) => (p === 1 ? 0 : Math.floor(Math.log(u()) / Math.log(1 - p))) },
    ErHypergeometric: { params: ['n', 'D', 'M'], discrete: true, check: ([n, d, m]) => isInt(n) && isInt(d) && isInt(m) && m >= 0 && n >= 0 && n <= m && d >= 0 && d <= m, mean: ([n, d, m]) => (m === 0 ? 0 : n * d / m), sd: ([n, d, m]) => (m < 2 ? 0 : Math.sqrt(n * d * (m - d) * (m - n) / (m * m * (m - 1)))), sample: (u, [n, d, m]) => hypergeometric(u, n, d, m) },
    ErInverseGaussian: { params: ['mu', 'lambda'], check: ([m, l]) => pos(m) && pos(l), mean: ([m]) => m, sd: ([m, l]) => Math.sqrt(m * m * m / l),
      sample: (u, [m, l]) => { const z = normal(u), y = z * z, x = m + m * m * y / (2 * l) - (m / (2 * l)) * Math.sqrt(4 * m * l * y + m * m * y * y); return u() <= m / (m + x) ? x : m * m / x; } },
    ErLogistic: { params: ['mu', 's'], check: ([, s]) => pos(s), mean: ([m]) => m, sd: ([, s]) => s * Math.PI / Math.sqrt(3), sample: (u, [m, s]) => { const v = u(); return m + s * Math.log(v / (1 - v)); } },
    ErLoglogistic: { params: ['alpha', 'beta'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => (a > 1 ? (b * Math.PI / a) / Math.sin(Math.PI / a) : NaN),
      sd: ([a, b]) => { if (a <= 2) return NaN; const t = Math.PI / a; return b * Math.sqrt(2 * t / Math.sin(2 * t) - Math.pow(t / Math.sin(t), 2)); }, sample: (u, [a, b]) => { const v = u(); return b * Math.pow(v / (1 - v), 1 / a); } },
    ErLognormal: { params: ['mean', 'std'], check: ([m, s]) => pos(m) && pos(s), mean: ([m]) => m, sd: ([, s]) => s, sample: (u, [m, s]) => { const v = Math.log(1 + s * s / (m * m)); return Math.exp(Math.log(m) - v / 2 + Math.sqrt(v) * normal(u)); } },
    ErLognormal2: { params: ['mu', 'sigma'], check: ([, s]) => pos(s), mean: ([m, s]) => Math.exp(m + s * s / 2), sd: ([m, s]) => Math.sqrt(Math.exp(2 * m + 2 * s * s) - Math.exp(2 * m + s * s)), sample: (u, [m, s]) => Math.exp(m + s * normal(u)) },
    ErNegbinomial: { params: ['s', 'p'], discrete: true, check: ([s, p]) => isInt(s) && s > 0 && p > 0 && p <= 1, mean: ([s, p]) => s * (1 - p) / p, sd: ([s, p]) => Math.sqrt(s * (1 - p)) / p, sample: (u, [s, p]) => (p === 1 ? 0 : poisson(u, gamma(u, s, (1 - p) / p))) },
    ErNormal: { params: ['mu', 'sigma'], check: ([, s]) => pos(s), mean: ([m]) => m, sd: ([, s]) => s, sample: (u, [m, s]) => m + s * normal(u) },
    ErPareto: { params: ['a', 'b'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => (a > 1 ? a * b / (a - 1) : NaN), sd: ([a, b]) => (a > 2 ? Math.sqrt(a * b * b / ((a - 2) * (a - 1) * (a - 1))) : NaN), sample: (u, [a, b]) => b / Math.pow(u(), 1 / a) },
    ErPearson5: { params: ['alpha', 'beta'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => (a > 1 ? b / (a - 1) : NaN), sd: ([a, b]) => (a > 2 ? b / ((a - 1) * Math.sqrt(a - 2)) : NaN), sample: (u, [a, b]) => b / gamma(u, a, 1) },
    ErPearson6: { params: ['alpha1', 'alpha2', 'beta'], check: ([a, c, b]) => pos(a) && pos(c) && pos(b), mean: ([a, c, b]) => (c > 1 ? b * a / (c - 1) : NaN), sd: ([a, c, b]) => (c > 2 ? b * Math.sqrt(a * (a + c - 1) / ((c - 2) * (c - 1) * (c - 1))) : NaN), sample: (u, [a, c, b]) => b * gamma(u, a, 1) / gamma(u, c, 1) },
    ErPert: { params: ['a', 'm', 'b'], check: ([a, m, b]) => a < b && a <= m && m <= b, mean: ([a, m, b]) => (a + 4 * m + b) / 6, sd: ([a, m, b]) => { const [x, y] = pertAB(a, m, b); return (b - a) * betaSd(x, y); }, sample: (u, [a, m, b]) => { const [x, y] = pertAB(a, m, b); return a + (b - a) * beta(u, x, y); } },
    ErPoisson: { params: ['nu'], discrete: true, check: ([v]) => pos(v), mean: ([v]) => v, sd: ([v]) => Math.sqrt(v), sample: (u, [v]) => poisson(u, v) },
    ErPolya: { params: ['alpha', 'beta'], discrete: true, check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => a * b, sd: ([a, b]) => Math.sqrt(a * b * (1 + b)), sample: (u, [a, b]) => poisson(u, gamma(u, a, b)) },
    ErRayleigh: { params: ['sigma'], check: ([s]) => pos(s), mean: ([s]) => s * Math.sqrt(Math.PI / 2), sd: ([s]) => s * Math.sqrt((4 - Math.PI) / 2), sample: (u, [s]) => s * Math.sqrt(-2 * Math.log(u())) },
    // The guide states the mean equals RR after correction, and that is what is implemented. Its printed SD
    // formula is the uncorrected lognormal one; the SD here is the SD of the corrected distribution.
    ErRelativeRisk: { params: ['RR', 'SElnRR'], check: ([r, s]) => pos(r) && pos(s), mean: ([r]) => r, sd: ([r, s]) => r * Math.sqrt(Math.exp(s * s) - 1), sample: (u, [r, s]) => Math.exp(Math.log(r) - s * s / 2 + s * normal(u)) },
    ErStudentst: { params: ['a'], check: ([a]) => pos(a), mean: () => 0, sd: ([a]) => (a > 2 ? Math.sqrt(a / (a - 2)) : NaN), sample: (u, [a]) => normal(u) / Math.sqrt(gamma(u, a / 2, 2) / a) },
    ErTriangle: { params: ['min', 'most', 'max'], check: ([a, m, b]) => a < m && m < b, mean: ([a, m, b]) => (a + m + b) / 3, sd: ([a, m, b]) => Math.sqrt((a * a + m * m + b * b - a * m - m * b - a * b) / 18),
      sample: (u, [a, m, b]) => { const v = u(), f = (m - a) / (b - a); return v < f ? a + Math.sqrt(v * (b - a) * (m - a)) : b - Math.sqrt((1 - v) * (b - a) * (b - m)); } },
    ErUniform01: { params: [], check: () => true, mean: () => 0.5, sd: () => Math.sqrt(1 / 12), sample: (u) => u() },
    ErUniform: { params: ['min', 'max'], check: ([a, b]) => a < b, mean: ([a, b]) => (a + b) / 2, sd: ([a, b]) => (b - a) / Math.sqrt(12), sample: (u, [a, b]) => a + (b - a) * u() },
    ErWeibull: { params: ['alpha', 'beta'], check: ([a, b]) => pos(a) && pos(b), mean: ([a, b]) => (a / b) * gammaF(1 / b), sd: ([a, b]) => (a / b) * Math.sqrt(2 * b * gammaF(2 / b) - Math.pow(gammaF(1 / b), 2)), sample: (u, [a, b]) => a * Math.pow(-Math.log(u()), 1 / b) },
  };

  // Read an Excel range column-wise, as the guide specifies: empty cells are 0, text is #VALUE!.
  const flatMemo = new WeakMap();
  function flatColumnwise(m) {
    if (!Array.isArray(m)) return [num(m)];
    const hit = flatMemo.get(m);
    if (hit) return hit;
    const f = flatten(m);
    flatMemo.set(m, f);
    return f;
  }
  function flatten(m) {
    const out = [], rows = m.length, cols = m[0].length;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push(num(m[r][c]));
    return out;
  }
  function num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v !== 'number' || !isFinite(v)) throw new ErValue();
    return v;
  }
  Sg.flatColumnwise = flatColumnwise; Sg.num = num;

  // ---- ErEmpirical: discrete table, or continuous density from cubic spline interpolation -----------
  const empCache = new Map();
  function naturalSpline(x, y) {
    const n = x.length, y2 = new Array(n).fill(0), w = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const s = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]), p = s * y2[i - 1] + 2;
      y2[i] = (s - 1) / p;
      w[i] = (6 * ((y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1])) / (x[i + 1] - x[i - 1]) - s * w[i - 1]) / p;
    }
    for (let k = n - 2; k >= 0; k--) y2[k] = y2[k] * y2[k + 1] + w[k];
    return (t) => {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (hi + lo) >> 1; if (x[m] > t) hi = m; else lo = m; }
      const h = x[hi] - x[lo], a = (x[hi] - t) / h, b = (t - x[lo]) / h;
      return a * y[lo] + b * y[hi] + ((a * a * a - a) * y2[lo] + (b * b * b - b) * y2[hi]) * h * h / 6;
    };
  }
  function empirical(name, xs, ps, disc) {
    const k = name + '|' + disc, c = empCache.get(k);
    if (c && c.xs === xs && c.ps === ps) return c;
    if (c && c.xs.length === xs.length && c.xs.every((v, i) => v === xs[i]) && c.ps.every((v, i) => v === ps[i])) return c;
    if (!name || xs.length !== ps.length || xs.length < 1 || ps.some((p) => p < 0)) throw new ErNum();
    const tot = ps.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) throw new ErNum();
    const o = { xs, ps };
    if (disc) {
      const cdf = []; let s = 0;
      for (const p of ps) { s += p / tot; cdf.push(s); }
      const mean = xs.reduce((a, x, i) => a + x * ps[i] / tot, 0);
      o.mean = mean; o.sd = Math.sqrt(xs.reduce((a, x, i) => a + (x - mean) * (x - mean) * ps[i] / tot, 0));
      o.sample = (u) => { const v = u(); let i = 0; while (i < xs.length - 1 && v > cdf[i]) i++; return xs[i]; };
    } else {
      if (xs.length < 3) throw new ErNum();
      for (let i = 1; i < xs.length; i++) if (!(xs[i] > xs[i - 1])) throw new ErNum();
      const f = naturalSpline(xs, ps), G = 4000, a = xs[0], step = (xs[xs.length - 1] - a) / G;
      const grid = new Float64Array(G + 1), cum = new Float64Array(G + 1);
      for (let i = 0; i <= G; i++) grid[i] = Math.max(0, f(a + i * step));
      let m1 = 0, m2 = 0;
      for (let i = 1; i <= G; i++) {
        const seg = 0.5 * (grid[i] + grid[i - 1]) * step, t = a + (i - 0.5) * step;
        cum[i] = cum[i - 1] + seg; m1 += seg * t; m2 += seg * t * t;
      }
      const area = cum[G];
      if (!(area > 0)) throw new ErNum();
      o.mean = m1 / area; o.sd = Math.sqrt(Math.max(0, m2 / area - o.mean * o.mean));
      o.sample = (u) => {
        const v = u() * area; let lo = 0, hi = G;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] > v) hi = m; else lo = m; }
        const d = cum[hi] - cum[lo];
        return a + (lo + (d > 0 ? (v - cum[lo]) / d : 0.5)) * step;
      };
    }
    empCache.set(k, o);
    return o;
  }
  D.ErEmpirical = {
    params: ['name', 'x', 'p', 'discrete'], custom: true,
    norm: ([n, x, p, d]) => [String(n), flatColumnwise(x), flatColumnwise(p), !!d],
    check: () => true,
    mean: (a) => empirical(...a).mean, sd: (a) => empirical(...a).sd,
    sample: (u, a) => empirical(...a).sample(u),
  };

  // ---- ErSurvival: conditional failure probabilities by time, returns remaining continuous survival ---
  const survMemo = new WeakMap();
  function survivalModel(x, p) {
    let byP = survMemo.get(x);
    if (byP) { const hit = byP.get(p); if (hit) return hit; } else { byP = new WeakMap(); survMemo.set(x, byP); }
    const model = buildSurvival(x, p);
    byP.set(p, model);
    return model;
  }
  function buildSurvival(x, p) {
    if (x.length !== p.length || x.length < 1 || p.some((v) => v < 0 || v > 1) || !p.some((v) => v > 0)) throw new ErNum();
    for (let i = 1; i < x.length; i++) if (!(x[i] > x[i - 1])) throw new ErNum();
    const n = x.length, S = new Array(n + 1), edge = x.concat([x[n - 1] + 1]);
    S[0] = 1;
    for (let i = 0; i < n; i++) S[i + 1] = S[i] * (1 - p[i]);
    // Constant hazard within an interval. Ersatz does not document its within-interval assumption.
    const Sat = (t) => {
      if (t <= edge[0]) return 1;
      if (t >= edge[n]) return S[n];
      let i = 0; while (t >= edge[i + 1]) i++;
      const f = (t - edge[i]) / (edge[i + 1] - edge[i]);
      return p[i] >= 1 ? S[i] * (1 - f) : S[i] * Math.pow(1 - p[i], f);
    };
    const timeAt = (target) => {
      if (target < S[n] || target <= 0) return edge[n];
      let i = 0; while (i < n - 1 && target < S[i + 1]) i++;
      const w = edge[i + 1] - edge[i];
      if (p[i] <= 0) return edge[i + 1];
      if (p[i] >= 1) return edge[i] + w * (S[i] - target) / S[i];
      return edge[i] + w * Math.log(target / S[i]) / Math.log(1 - p[i]);
    };
    return { Sat, timeAt, edge, S, n };
  }
  function survDraw(m, ct, r) {
    if (ct < 0) throw new ErNum();
    // The Overview: "returns (highest value in x)+1 when survival is longer than that highest value". This is
    // a marker for long survivors, so it isn't reduced by ct the way a remaining survival time is.
    const top = m.edge[m.n];
    if (ct >= top) return top;
    const base = m.Sat(ct);
    if (base <= 0) throw new ErNum();
    const t = m.timeAt(base * (1 - r));
    return t >= top ? top : Math.max(0, t - ct);
  }
  function survMoments(m, ct) {
    if (ct >= m.edge[m.n]) return { mean: m.edge[m.n], sd: 0 };
    const G = 2000, a = ct, b = m.edge[m.n], h = (b - a) / G, base = m.Sat(ct);
    if (!(base > 0)) throw new ErNum();
    let m1 = 0, m2 = 0;
    for (let i = 0; i < G; i++) { const t = a + (i + 0.5) * h, s = m.Sat(t) / base; m1 += s * h; m2 += 2 * (t - a) * s * h; }
    return { mean: m1, sd: Math.sqrt(Math.max(0, m2 - m1 * m1)) };
  }
  const survNorm = ([n, x, p, ct, r]) => {
    if (!n || String(n).length > 25) throw new ErNum();
    const a = [String(n), flatColumnwise(x), flatColumnwise(p), ct];
    if (r !== undefined) { if (!(r > 0 && r < 1)) throw new ErNum(); a.push(r); }
    return a;
  };
  D.ErSurvival = { params: ['name', 'x', 'p', 'ct'], custom: true, norm: survNorm, check: () => true,
    mean: ([, x, p, ct]) => survMoments(survivalModel(x, p), ct).mean, sd: ([, x, p, ct]) => survMoments(survivalModel(x, p), ct).sd,
    sample: (u, [, x, p, ct]) => survDraw(survivalModel(x, p), ct, u()) };
  D.ErSurvival2 = { params: ['name', 'x', 'p', 'ct', 'rnd'], custom: true, norm: survNorm, check: () => true, deterministicGivenArgs: true,
    mean: ([, x, p, ct, r]) => survDraw(survivalModel(x, p), ct, r), sd: () => 0,
    sample: (u, [, x, p, ct, r]) => survDraw(survivalModel(x, p), ct, r) };

  // Mean to show while not running. Where the analytic mean is undefined, use a median from a fixed stream.
  Sg.displayMean = function (name, args) {
    const d = D[name], m = d.mean(args);
    if (isFinite(m)) return m;
    const u = Sg.RNGS.fast.make(12345), v = [];
    for (let i = 0; i < 999; i++) v.push(d.sample(u, args));
    v.sort((a, b) => a - b);
    return v[499];
  };
  Sg.DISTS = D;

  // How far a deterministic sensitivity analysis moves an input. Percentiles come from a large fixed sample, which
  // also covers distributions with no closed-form quantile, so the answer doesn't change between analyses.
  Sg.inputRange = function (fn, args, mode, ci) {
    const d = D[fn], m = Sg.displayMean(fn, args);
    if (mode === 'pct') return [m - Math.abs(m) * 0.1, m + Math.abs(m) * 0.1];
    if (mode === 'sd') {
      const s = d.sd(args);
      const w = Number.isFinite(s) && s > 0 ? s : Math.abs(m) * 0.1;
      return [m - w, m + w];
    }
    const u = Sg.RNGS.fast.make(2024), v = new Float64Array(20000);
    for (let i = 0; i < v.length; i++) v[i] = d.sample(u, args);
    v.sort();
    const tail = (100 - (ci || 95)) / 2;
    return [Sg.stats.percentile(v, tail), Sg.stats.percentile(v, 100 - tail)];
  };

  // ---- Linear algebra --------------------------------------------------------------------------
  // Symmetrise from the lower triangle only, as the guide specifies.
  Sg.lowerToFull = function (C, n) {
    if (!Array.isArray(C) || C.length < n || C[0].length < n) throw new ErNum();
    const M = [];
    for (let i = 0; i < n; i++) { M.push(new Array(n)); for (let j = 0; j < n; j++) M[i][j] = num(i >= j ? C[i][j] : C[j][i]); }
    return M;
  };
  Sg.cholesky = function (A) { // semi-definite allowed; returns null when not positive semi-definite
    const n = A.length, L = A.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s < -1e-10) return null; L[i][i] = Math.sqrt(Math.max(0, s)); }
      else L[i][j] = L[j][j] > 1e-12 ? s / L[j][j] : (Math.abs(s) > 1e-8 ? NaN : 0);
      if (Number.isNaN(L[i][j])) return null;
    }
    return L;
  };
  Sg.jacobiEigen = function (A) {
    const n = A.length, a = A.map((r) => r.slice()), V = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
      }
    }
    return { values: a.map((r, i) => r[i]), vectors: V };
  };
  // Matrix check for the Tools tab. Ersatz shifts the matrix by its lowest eigenvalue, and so does this.
  Sg.checkMatrix = function (A, isCov) {
    const n = A.length, sd = A.map((r, i) => (isCov ? Math.sqrt(Math.max(r[i], 0)) : 1));
    const R = A.map((r, i) => r.map((v, j) => (isCov ? v / (sd[i] * sd[j] || 1) : v)));
    const min = Math.min(...Sg.jacobiEigen(R).values);
    if (min >= -1e-10) return { valid: true, minEigen: min };
    const fixed = R.map((r, i) => r.map((v, j) => (i === j ? 1 : v / (1 - min))));
    return { valid: false, minEigen: min, suggestion: fixed.map((r, i) => r.map((v, j) => (isCov ? v * sd[i] * sd[j] : v))) };
  };
  Sg.invert = function (A) {
    const n = A.length, M = A.map((r, i) => r.concat(A.map((_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r) => r.slice(n));
  };
})(globalThis.Sg = globalThis.Sg || {});
