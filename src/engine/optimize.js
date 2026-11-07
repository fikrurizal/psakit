// The four optimisers described in the Ersatz User Guide, with its option names and defaults.
// Quasi-Newton (BFGS with finite differences) and Down-hill Simplex (with the noisy stopping rule) are deterministic.
// Simulated Annealing (the stochastic simplex variant) and Cross-Entropy are stochastic.
// Each is a generator that yields a candidate and receives its loss back.
(function (Sg) {
  const EPS = 1e-10;
  const add = (a, b, k) => a.map((v, i) => v + k * b[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const safe = (f) => (Number.isFinite(f) ? f : 1e300);

  function* quasiNewton(x0, o) {
    const n = x0.length, tol = o.tolerance, h = (x) => Math.max(1e-6, 1e-5 * Math.abs(x));
    let evals = 0;
    function* loss(x) { evals++; return safe(yield x); }
    function* grad(x, fx) {
      const g = new Array(n);
      for (let i = 0; i < n; i++) { const d = h(x[i]), y = x.slice(); y[i] += d; g[i] = ((yield* loss(y)) - fx) / d; }
      return g;
    }
    let x = x0.slice(), f = yield* loss(x), g = yield* grad(x, f);
    let H = x.map((_, i) => x.map((__, j) => (i === j ? 1 : 0)));
    const stepMax = 100 * Math.max(Math.sqrt(dot(x, x)), n);
    for (;;) {
      if (evals >= o.maxTries) return;
      let d = H.map((row) => -dot(row, g));
      let slope = dot(g, d);
      if (!(slope < 0)) { H = x.map((_, i) => x.map((__, j) => (i === j ? 1 : 0))); d = g.map((v) => -v); slope = dot(g, d); }
      if (slope === 0) return;
      const len = Math.sqrt(dot(d, d));
      if (len > stepMax) d = d.map((v) => v * stepMax / len);
      // Backtracking line search with the Armijo condition.
      let a = 1, xn = null, fn = f;
      for (let tries = 0; tries < 30; tries++) {
        xn = add(x, d, a); fn = yield* loss(xn);
        if (fn <= f + 1e-4 * a * slope) break;
        a *= 0.5;
        if (evals >= o.maxTries) return;
      }
      const conv = 2 * Math.abs(fn - f) / (Math.abs(fn) + Math.abs(f) + EPS);
      if (!(fn < f) && fn !== f) return;
      if (conv <= tol) return;
      const gn = yield* grad(xn, fn), s = add(xn, x, -1), y = add(gn, g, -1), sy = dot(s, y);
      if (sy > 1e-12) {
        const Hy = H.map((row) => dot(row, y)), yHy = dot(y, Hy);
        H = H.map((row, i) => row.map((v, j) => v + (1 + yHy / sy) * s[i] * s[j] / sy - (Hy[i] * s[j] + s[i] * Hy[j]) / sy));
      }
      x = xn; f = fn; g = gn;
    }
  }

  // Start simplex as the guide describes: each point equals the start with one value times (1 + initial simplex).
  const startSimplex = (x0, init) => x0.map((_, i) => { const p = x0.slice(); p[i] = p[i] !== 0 ? p[i] * (1 + init) : init; return p; });

  function* simplexSearch(pts, o, temp, u) {
    // pts: [{x,f}] with n+1 points. With temp > 0 this is the thermal variant from Numerical Recipes (amebsa).
    const n = pts.length - 1;
    const noise = () => (temp > 0 ? -temp * Math.log(u()) : 0);
    const flip = (f) => f + noise();
    let tries = 0;
    for (;;) {
      const scored = pts.map((p) => ({ p, y: flip(p.f) })).sort((a, b) => a.y - b.y);
      pts = scored.map((s) => s.p);
      const lo = scored[0].y, hi = scored[n].y, nh = scored[n - 1 < 0 ? 0 : n - 1].y;
      if (2 * Math.abs(hi - lo) / (Math.abs(hi) + Math.abs(lo) + EPS) < o.tolerance) return pts;
      if (o.noisy) {
        // The extra rule for noisy problems: stop once the simplex has become small.
        let size = 0;
        for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) size = Math.max(size, Math.abs(pts[i].x[j] - pts[0].x[j]) / (Math.abs(pts[0].x[j]) + EPS));
        if (size < o.noiseTolerance) return pts;
      }
      if (tries >= o.maxTries) return pts;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
      const worst = pts[n];
      const trial = (k) => add(c, add(worst.x, c, -1), k);
      const xr = trial(-1), fr = safe(yield xr); tries++;
      const yr = flip(fr);
      if (yr < lo) {
        const xe = trial(-2), fe = safe(yield xe); tries++;
        pts[n] = flip(fe) < yr ? { x: xe, f: fe } : { x: xr, f: fr };
      } else if (yr < nh) pts[n] = { x: xr, f: fr };
      else {
        const xc = yr < hi ? trial(-0.5) : trial(0.5), fc = safe(yield xc); tries++;
        if (flip(fc) < Math.min(yr, hi)) pts[n] = { x: xc, f: fc };
        else {
          for (let i = 1; i <= n; i++) { const x = add(pts[0].x, add(pts[i].x, pts[0].x, -1), 0.5); pts[i] = { x, f: safe(yield x) }; tries++; }
        }
      }
    }
  }
  function* downhill(x0, o) {
    const pts = [{ x: x0.slice(), f: safe(yield x0.slice()) }];
    for (const p of startSimplex(x0, o.initialSimplex)) pts.push({ x: p, f: safe(yield p) });
    yield* simplexSearch(pts, o, 0, null);
  }
  function* annealing(x0, o) {
    // Each level restarts from the best point seen so far, so a wild hot phase can't strand the search far away.
    let best = { x: x0.slice(), f: safe(yield x0.slice()) };
    const level = function* (T) {
      const pts = [best];
      for (const p of startSimplex(best.x, o.initialSimplex)) { const f = safe(yield p); pts.push({ x: p, f }); }
      const end = yield* simplexSearch(pts, o, T, o.u, (p) => { if (p.f < best.f) best = p; });
      for (const p of end) if (p.f < best.f) best = p;
    };
    // Cooling can't reach 0 by multiplication, so treat a small fraction of the start as 0 and finish at exactly 0.
    for (let T = o.startTemperature; T > o.startTemperature * 1e-9; T *= o.coolingFactor) yield* level(T);
    yield* level(0);
  }
  function* crossEntropy(x0, o) {
    const u = o.u, n = x0.length, size = Math.max(4, Math.round(o.sampleSize)), elite = Math.max(2, Math.round(size * o.proportionElite));
    let m = x0.slice(), sd = x0.map((v) => (v !== 0 ? Math.abs(v) * o.coefficientOfVariation : o.coefficientOfVariation));
    for (let it = 0; it < o.maxTries; it++) {
      const s = [];
      for (let k = 0; k < size; k++) {
        const x = m.map((v, j) => v + sd[j] * Sg.rNormal(u));
        s.push({ x, f: safe(yield x) });
      }
      s.sort((a, b) => a.f - b.f);
      const best = s.slice(0, elite);
      m = m.map((_, j) => best.reduce((t, p) => t + p.x[j], 0) / elite);
      sd = sd.map((_, j) => { const v = best.reduce((t, p) => t + (p.x[j] - m[j]) * (p.x[j] - m[j]), 0) / elite; return Math.sqrt(v); });
      const cv = sd.reduce((t, v, j) => t + v / (Math.abs(m[j]) + EPS), 0) / n;
      if (cv < o.varianceThreshold) { yield m.slice(); return; }
    }
    yield m.slice();
  }
  Sg.OPTIMIZERS = {
    quasiNewton: { label: 'Quasi-Newton', make: quasiNewton, kind: 'deterministic', options: [['tolerance', 'Tolerance', 0.01], ['maxTries', 'Maximum tries', 500]] },
    downhill: { label: 'Down-hill Simplex', make: downhill, kind: 'deterministic', options: [['initialSimplex', 'Initial simplex', 0.1], ['maxTries', 'Maximum tries', 500], ['tolerance', 'Tolerance', 0.01], ['noisy', 'Noisy optimisation', false], ['noiseTolerance', 'Noise tolerance', 0.0001]] },
    annealing: { label: 'Simulated Annealing', make: annealing, kind: 'stochastic', options: [['initialSimplex', 'Initial simplex', 0.1], ['maxTries', 'Maximum tries per level', 500], ['startTemperature', 'Starting temperature', 10000], ['tolerance', 'Tolerance', 0.01], ['coolingFactor', 'Cooling factor', 0.1]] },
    crossEntropy: { label: 'Cross-Entropy', make: crossEntropy, kind: 'stochastic', options: [['proportionElite', 'Proportion elite', 0.1], ['coefficientOfVariation', 'Coefficient of variation', 1], ['sampleSize', 'Sample size', 150], ['maxTries', 'Maximum tries', 100], ['varianceThreshold', 'Variance threshold', 0.01]] },
  };
  Sg.optimizerDefaults = (method) => Object.fromEntries(Sg.OPTIMIZERS[method].options.map((o) => [o[0], o[2]]));

  // Tracks the best result seen and handles restarts from it.
  Sg.Optimizer = class {
    constructor(method, x0, opts) {
      this.method = method; this.opts = Object.assign(Sg.optimizerDefaults(method), opts);
      this.restartsLeft = Math.max(0, Math.min(10, Math.floor(opts.restarts || 0)));
      this.best = { x: x0.slice(), f: Infinity }; this.trace = []; this.done = false; this.cap = opts.hardLimit || Infinity;
      this.start(x0);
    }
    start(x0) {
      this.g = Sg.OPTIMIZERS[this.method].make(x0.slice(), this.opts);
      const r = this.g.next();
      if (r.done) this.done = true; else this.cur = r.value;
    }
    tell(loss) {
      const f = Number.isFinite(loss) ? loss : Infinity;
      if (f < this.best.f) this.best = { x: this.cur.slice(), f };
      this.trace.push(this.best.f);
      if (this.trace.length >= this.cap) { this.done = true; this.limit = true; return; }
      const r = this.g.next(f);
      if (!r.done) { this.cur = r.value; return; }
      if (this.restartsLeft > 0) { this.restartsLeft--; this.start(this.best.x); return; }
      this.done = true;
    }
  };
})(globalThis.Sg = globalThis.Sg || {});
