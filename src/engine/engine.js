// Simulation state and the implementation of every worksheet function.
// Phases: idle (Excel recalculating on its own), prime (one pass to discover the model), iter (a draw),
// runEnd (one pass after a run, replaying the last draws so end-of-run statistics can be picked up),
// fixed (deterministic pass for univariate sensitivity).
(function (Sg) {
  const { ErNum, ErValue, DISTS, stats } = Sg;
  const RANK_OK = new Set(['ErUniform01', 'ErUniform', 'ErDice', 'ErNormal', 'ErExponential', 'ErWeibull', 'ErLognormal', 'ErGamma', 'ErBeta', 'ErRelativeRisk', 'ErBinomial', 'ErPoisson', 'ErGeometric', 'ErNegbinomial', 'ErEmpirical', 'ErSurvival', 'ErStudentst']);
  const TRUNC_OK = new Set(['ErNormal', 'ErExponential', 'ErWeibull', 'ErLognormal', 'ErGamma', 'ErBeta', 'ErRelativeRisk', 'ErBinomial', 'ErPoisson', 'ErGeometric', 'ErNegbinomial', 'ErEmpirical', 'ErSurvival', 'ErStudentst']);
  const normAddr = (a) => String(a || '').replace(/\$/g, '').replace(/'/g, '').replace(/^\[[^\]]*\]/, '');
  const DEFAULTS = { rng: 'fast', seed: null, showMeans: true, ci: 95, maxTruncate: 10, useSetItno: true, conditionalOn: false, conditional: {} };

  class Engine {
    constructor() {
      this.settings = Object.assign({}, DEFAULTS, { conditional: {} });
      this.phase = 'idle'; this.gen = 0; this.iteration = 0; this.run = 0; this.iterations = 1000; this.runs = 1;
      this.idleU = Sg.RNGS.fast.make((Math.random() * 4294967296) >>> 0);
      this.keyCache = new Map();
      this.resetAll();
      this.fns = this._buildFns();
    }
    resetAll() {
      this.fatal = null; this.finished = false; this.setItno = null; this.salt = ''; this.frozen = false; this.replay = null;
      this.errors = new Map(); this.keepAll = true;
      this.streams = new Map(); this.masterSeed = 0;
      this.outputsReg = new Map(); this.runOutputsReg = new Map(); this.names = new Map();
      this.reports = new Map();
      this.inputs = new Map(); this.current = new Map(); this.last = new Map(); this.heldOnce = new Set();
      this.nested = new Map();
      this.sensReg = new Map(); this.runSensReg = new Map();
      this.outputs = new Map(); this.runOutputs = new Map(); this.sensVals = new Map(); this.runSensVals = new Map();
      this.masters = new Map(); this.comReg = new Map();
      this.conditionalHold = new Map(); this.accum = new Map();
      this.dataAt = new Map(); this.dataArr = new Map(); this.runDataArr = new Map();
      this.stores = new Map(); this.arrStores = new Map(); this.condStores = new Map(); this.condRetr = new Map();
      this.minStart = new Map(); this.minLossAddr = new Map(); this.minX = new Map(); this.minBest = new Map();
      this.override = null;
      this.runIndex = [];
    }
    get running() { return this.phase === 'iter' || this.phase === 'runEnd' || this.phase === 'frozen'; }

    die(msg) { if (!this.fatal) this.fatal = msg; throw new ErNum(msg); }
    u(key) {
      let s = this.streams.get(key);
      if (!s) { s = Sg.RNGS[this.settings.rng].make(Sg.hashSeed(this.masterSeed, this.salt === '' ? key : key + '@' + this.salt)); this.streams.set(key, s); }
      return s;
    }
    // Each block of a parallel run gets its own streams, so results don't depend on how many threads ran it.
    setSalt(salt) { this.salt = salt; this.streams.clear(); }
    noteError(addr, fn) {
      const k = addr + '|' + fn;
      let e = this.errors.get(k);
      if (!e) { e = { addr, fn, run: this.run, iteration: this.iteration, count: 0 }; this.errors.set(k, e); }
      e.count++;
    }
    rep(key) { return this.replay ? this.replay.get(key) : undefined; }
    checkName(n, max) {
      if (typeof n !== 'string' || n.length === 0 || n.length > max) this.die(`A name must be 1 to ${max} characters long; got "${n}".`);
    }
    claim(kind, name, addr, max) {
      this.checkName(name, max);
      if (this.phase !== 'prime') return;
      const k = kind + '|' + name, prev = this.names.get(k);
      if (prev && prev !== addr) this.die(`Two ${kind} functions use the name "${name}" (${prev} and ${addr}). Names must be unique.`);
      this.names.set(k, addr);
    }
    condFor(key) {
      if (!this.settings.conditionalOn) return 'every';
      return this.settings.conditional[key] || this.settings.conditional.__default || 'every';
    }

    // ---- Sampling -----------------------------------------------------------------------------
    sampleCall(addr, name, rawArgs) {
      const d = DISTS[name], args = d.norm ? d.norm(rawArgs) : rawArgs;
      if (!d.check(args)) throw new ErNum();
      let keys = this.keyCache.get(name);
      if (!keys) { keys = new Map(); this.keyCache.set(name, keys); }
      let key = keys.get(addr);
      if (key === undefined) { key = addr + '|' + name; keys.set(addr, key); }
      let n = this.nested.get(addr);
      if (!n) { n = { key, name, args, gen: this.gen }; this.nested.set(addr, n); } else { n.key = key; n.name = name; n.args = args; n.gen = this.gen; }
      switch (this.phase) {
        case 'idle':
          return this.settings.showMeans ? Sg.displayMean(name, args) : d.sample(this.idleU, args);
        case 'prime':
          if (!this.inputs.has(key)) this.inputs.set(key, { key, addr, fn: name, args, values: [] });
          else this.inputs.get(key).args = args;
          return Sg.displayMean(name, args);
        case 'fixed':
          return this.override && this.override.has(key) ? this.override.get(key) : Sg.displayMean(name, args);
        case 'iter': {
          if (this.frozen) { const h = this.last.get(key); return h === undefined ? Sg.displayMean(name, args) : h; }
          const c = this.settings.conditionalOn ? this.condFor(key) : 'every';
          let v = this.rep(key);
          if (v === undefined) {
            if (c === 'none') v = Sg.displayMean(name, args);
            else if (c === 'once' && this.heldOnce.has(key)) v = this.last.get(key);
            else { v = d.sample(this.u(key), args); this.heldOnce.add(key); }
          }
          this.record(key, addr, name, args, v);
          return v;
        }
        default: {
          const v = this.last.get(key);
          return v === undefined ? Sg.displayMean(name, args) : v;
        }
      }
    }
    record(key, addr, fn, args, v) {
      if (!this.inputs.has(key)) { // first seen mid-run, for example behind an IF: backfill so columns stay aligned
        const n = this.runIndex.length, values = new Array(n).fill(NaN);
        this.inputs.set(key, { key, addr, fn, args, values });
      }
      this.current.set(key, v); this.last.set(key, v);
    }
    nestedFor(addr, fnLabel, allowed) {
      const n = this.nested.get(addr);
      if (!n || n.gen !== this.gen) this.die(`${fnLabel} in ${addr} needs a random function embedded directly in its formula.`);
      if (!allowed.has(n.name)) this.die(`${n.name} cannot be embedded in ${fnLabel} (${addr}).`);
      return n;
    }

    // ---- Lifecycle, driven by the runner ------------------------------------------------------
    beginPrime(settings) {
      this.resetAll();
      if (settings) this.settings = Object.assign(this.settings, settings);
      this.masterSeed = this.settings.seed === null || this.settings.seed === '' || this.settings.seed === undefined ? (Math.random() * 4294967296) >>> 0 : (Number(this.settings.seed) >>> 0);
      this.phase = 'prime'; this.iteration = 1; this.run = 1; this.gen++; this.frozen = false; this.keyCache.clear();
    }
    finishPrime() {
      for (const [name, m] of this.masters) {
        if ((m.kind === 'multinomial' || m.kind === 'dirichlet')) {
          const reg = this.comReg.get(name) || new Map();
          let sum = 0; for (const v of reg.values()) sum += v;
          if (reg.size !== m.catnum) this.die(`"${name}" expects ${m.catnum} categories but ${reg.size} component functions are linked to it.`);
          if (Math.abs(sum - m.N) > 1e-6 * Math.max(1, m.N)) this.die(`The cases linked to "${name}" sum to ${sum}, but N is ${m.N}.`);
        }
      }
    }
    beginRun(run) {
      this.run = run; this.iteration = 0;
      if (!this.keepAll) this.clearIterationResults();
      this.heldOnce.clear(); this.conditionalHold.clear(); this.accum.clear(); this.dataAt.clear(); this.dataArr.clear();
      for (const m of this.masters.values()) { m.drawnGen = -1; m.drawnRun = -1; m.prep = null; }
    }
    clearIterationResults() {
      this.runIndex = [];
      for (const o of this.outputs.values()) o.values = [];
      for (const i of this.inputs.values()) i.values = [];
      for (const k of this.sensVals.keys()) this.sensVals.set(k, []);
    }
    beginIter(i) { this.phase = 'iter'; this.iteration = i; this.gen++; this.frozen = false; this.current.clear(); }
    // Optimising within an iteration: random functions hold this iteration's draws while the optimiser searches.
    beginFrozenEval() { this.phase = 'frozen'; this.frozen = true; this.gen++; }
    // The last pass of an optimised iteration. It re-uses the iteration's generation, so anything that accumulates
    // or records per iteration sees the optimised values once and only once.
    beginFinalEval(gen) { this.phase = 'iter'; this.frozen = true; this.gen = gen; }
    endIter() {
      this.runIndex.push(this.run);
      for (const [addr, reg] of this.outputsReg) {
        let o = this.outputs.get(addr);
        if (!o) { o = { name: reg.name, addr, values: [] }; this.outputs.set(addr, o); }
        const r = this.reports.get(addr);
        o.values.push(r && r.gen === this.gen ? r.value : NaN);
      }
      for (const inp of this.inputs.values()) {
        const v = this.current.get(inp.key);
        inp.values.push(v === undefined ? NaN : v);
      }
      for (const [name, s] of this.sensReg) {
        let a = this.sensVals.get(name);
        if (!a) { a = []; this.sensVals.set(name, a); }
        a.push(s.gen === this.gen ? s.value : NaN);
      }
    }
    beginRunEnd() { this.phase = 'runEnd'; this.gen++; }
    endRun() {
      for (const [addr, reg] of this.runOutputsReg) {
        let o = this.runOutputs.get(addr);
        if (!o) { o = { name: reg.name, addr, values: [] }; this.runOutputs.set(addr, o); }
        const r = this.reports.get(addr);
        o.values.push(r && r.gen === this.gen ? r.value : NaN);
      }
      for (const [name, s] of this.runSensReg) {
        let a = this.runSensVals.get(name);
        if (!a) { a = []; this.runSensVals.set(name, a); }
        a.push(s.gen === this.gen ? s.value : NaN);
      }
    }
    finish() { this.phase = 'idle'; this.finished = true; this.gen++; }
    beginFixed(override) { this.phase = 'fixed'; this.override = override; this.gen++; }
    report(addr, value) { this.reports.set(addr, { gen: this.gen, value }); }

    // Scanning a model and deterministic analysis both prime the engine. Results of the last run, which the sheet may
    // be showing through ER.ERDATAARRAY and the statistical functions, must survive that.
    saveResultState() {
      const k = ['finished', 'accum', 'dataAt', 'dataArr', 'runDataArr', 'condStores', 'condRetr', 'minX', 'arrShape'], o = {};
      for (const x of k) o[x] = this[x];
      return o;
    }
    restoreResultState(o) { Object.assign(this, o); }

    // ---- Component machinery ------------------------------------------------------------------
    master(name, label) {
      const m = this.masters.get(name);
      if (!m) this.die(`${label} refers to "${name}", but no master function has that name. Link its name argument to the master cell.`);
      return m;
    }
    // Redraw at most once per iteration, whichever component reaches the master first.
    ensure(m) {
      if (this.phase !== 'iter' || m.drawnGen === this.gen) return;
      const c = this.condFor(m.addr + '|' + m.fnName);
      if (c === 'none') { m.frozen = true; m.drawnGen = this.gen; return; }
      if (c === 'once' && m.drawnRun === this.run) { m.drawnGen = this.gen; return; }
      m.frozen = false; m.drawnGen = this.gen; m.drawnRun = this.run;
      m.redraw();
      if (this.replay && m.map) { const r = this.replay.get(m.addr + '|' + m.fnName); if (r) m.map = r; }
    }
    regMaster(name, addr, fnName, kind, props, redraw) {
      let m = this.masters.get(name);
      if (!m) { m = { kind, name, addr, fnName, drawnGen: -1, drawnRun: -1 }; this.masters.set(name, m); }
      Object.assign(m, props, { redraw: redraw(m) });
      this.ensure(m);
      return name;
    }
    regCom(name, id, val) {
      let r = this.comReg.get(name);
      if (!r) { r = new Map(); this.comReg.set(name, r); }
      r.set(id, val);
    }
    tableMaster(addr, fnName, name, recnum, fieldnum, shuffle) {
      this.claim(fnName, name, addr, 25);
      if (!Number.isInteger(recnum) || recnum < 2 || !Number.isInteger(fieldnum) || fieldnum < 1) throw new ErNum();
      return this.regMaster(name, addr, fnName, 'table', { recnum, fieldnum, table: (this.masters.get(name) || {}).table || new Map() }, () => {
        const u = this.u(addr + '|' + fnName);
        return function () {
          const map = new Array(recnum);
          if (shuffle) {
            for (let i = 0; i < recnum; i++) map[i] = i;
            for (let i = recnum - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [map[i], map[j]] = [map[j], map[i]]; }
          } else for (let i = 0; i < recnum; i++) map[i] = Math.floor(u() * recnum);
          this.map = map;
        };
      });
    }
    tableCom(addr, label, name, rec, field, val) {
      const m = this.master(name, label);
      if (!(rec >= 1 && rec <= m.recnum && field >= 1 && field <= m.fieldnum)) throw new ErNum();
      m.table.set(rec + ',' + field, val);
      if (this.running) {
        this.ensure(m);
        if (m.frozen || !m.map) return val;
        const v = m.table.get((m.map[rec - 1] + 1) + ',' + field);
        if (v === undefined) throw new ErNum();
        return v;
      }
      return val;
    }
    corrMatrix(C, n, label, name) {
      if (!Number.isInteger(n) || n < 1) throw new ErNum();
      const M = Sg.lowerToFull(C, n), L = Sg.cholesky(M);
      if (!L) this.die(`The correlation matrix for "${name}" in ${label} is not valid (not positive semi-definite). Check it under Tools.`);
      return L;
    }
    // N rows of ranks (0-based) per variable, from correlated standard normals.
    correlatedRanks(L, N, u) {
      const n = L.length, z = L.map(() => new Float64Array(N));
      for (let i = 0; i < N; i++) {
        const e = L.map(() => Sg.rNormal(u));
        for (let a = 0; a < n; a++) { let s = 0; for (let b = 0; b <= a; b++) s += L[a][b] * e[b]; z[a][i] = s; }
      }
      return z.map((col) => { const idx = Array.from(col, (_, i) => i).sort((p, q) => col[p] - col[q]), r = new Int32Array(N); idx.forEach((id, rk) => { r[id] = rk; }); return r; });
    }
    corrMulti(addr, fnName, name, C, n, kind) {
      this.claim(fnName, name, addr, 25);
      const L = this.corrMatrix(C, n, fnName, name);
      return this.regMaster(name, addr, fnName, kind, { L, n, inputs: (this.masters.get(name) || {}).inputs || new Map() }, () => function () {});
    }
    corrMultiIn(name, inp, num, label) {
      const m = this.master(name, label);
      if (!Number.isInteger(num) || num < 1 || num > m.n) throw new ErNum();
      const flat = Sg.flatColumnwise(inp);
      if (flat.some((v) => !(v > 0))) throw new ErNum();
      m.inputs.set(num, { flat, rows: inp.length, cols: inp[0].length });
      return name;
    }
    corrMultiPrep(m, label) {
      if (m.prep) return m.prep;
      const specs = []; for (let i = 1; i <= m.n; i++) { const s = m.inputs.get(i); if (!s) this.die(`${label}: input ${i} of "${m.name}" is missing.`); specs.push(s); }
      const K = specs[0].flat.length;
      if (specs.some((s) => s.flat.length !== K)) this.die(`Correlated distributions in "${m.name}" must all have the same number of categories.`);
      const N = this.iterations, u = this.u(m.addr + '|' + m.fnName), gam = [];
      for (let k = 0; k < K; k++) {
        const ranks = this.correlatedRanks(m.L, N, u);
        gam.push(specs.map((s, d) => { const g = new Float64Array(N); for (let i = 0; i < N; i++) g[i] = Sg.rGamma(u, s.flat[k], 1); g.sort(); const o = new Float64Array(N); for (let i = 0; i < N; i++) o[i] = g[ranks[d][i]]; return o; }));
      }
      m.prep = { specs, K, gam };
      return m.prep;
    }
    corrMultiOut(addr, name, num, label) {
      const m = this.master(name, label);
      if (!Number.isInteger(num) || num < 1 || num > m.n) throw new ErNum();
      const s = m.inputs.get(num);
      if (!s) throw new ErNum();
      const tot = s.flat.reduce((a, b) => a + b, 0), multi = m.kind === 'multinomialCorr', K = s.flat.length;
      const shape = (vals) => { const out = []; for (let r = 0; r < s.rows; r++) { out.push([]); for (let c = 0; c < s.cols; c++) out[r].push(vals[c * s.rows + r]); } return out; };
      if (!this.running) return shape(s.flat.map((v) => (multi ? v : v / tot)));
      const p = this.corrMultiPrep(m, label), i = Math.min(this.iteration, this.iterations) - 1, row = new Array(K);
      let sum = 0; for (let k = 0; k < K; k++) { row[k] = p.gam[k][num - 1][i]; sum += row[k]; }
      let vals;
      if (multi) { let rem = Math.round(tot); vals = row.map((g, k) => { const x = k === K - 1 ? rem : Math.min(rem, Math.round(tot * g / sum)); rem -= x; return x; }); }
      else vals = row.map((g) => g / sum);
      if (this.replay) vals = vals.map((v, k) => { const r = this.rep(`${addr}#${k + 1}|${label}`); return r === undefined ? v : r; });
      if (this.phase === 'iter' && !this.frozen) vals.forEach((v, k) => this.record(`${addr}#${k + 1}|${label}`, `${addr}#${k + 1}`, label, null, v));
      return shape(vals);
    }

    // Accumulator for statistical functions, safe against a cell being evaluated twice in one pass.
    acc(addr, v, w) {
      let a = this.accum.get(addr);
      if (!a) { a = { gen: -1, xs: [], ys: [] }; this.accum.set(addr, a); }
      if (this.phase === 'iter') {
        if (a.gen === this.gen) { a.xs[a.xs.length - 1] = v; if (w !== undefined) a.ys[a.ys.length - 1] = w; }
        else { a.xs.push(v); if (w !== undefined) a.ys.push(w); a.gen = this.gen; }
      }
      return a;
    }
    statFn(addr, v, f) {
      if (this.phase === 'prime' || this.phase === 'fixed') return v;
      if (this.phase === 'idle' && !this.accum.has(addr)) return v;
      const r = f(this.acc(addr, v).xs);
      return Number.isFinite(r) ? r : v;
    }

    _buildFns() {
      const E = this, F = {};
      for (const name of Object.keys(DISTS)) F[name] = (addr, ...a) => E.sampleCall(addr, name, a);

      // Component pairs
      F.ErNonparam = (addr, n, r, f) => E.tableMaster(addr, 'ErNonparam', n, r, f, false);
      F.ErNonparamCom = (addr, n, r, f, v) => E.tableCom(addr, 'ErNonparamCom', n, r, f, v);
      F.ErRandomise = (addr, n, r, f) => E.tableMaster(addr, 'ErRandomise', n, r, f, true);
      F.ErRandomiseCom = (addr, n, r, f, v) => E.tableCom(addr, 'ErRandomiseCom', n, r, f, v);

      F.ErMultinomial = (addr, name, catnum, N) => {
        E.claim('ErMultinomial', name, addr, 25);
        if (!Number.isInteger(catnum) || catnum < 2 || !Number.isInteger(N) || N <= 0) throw new ErNum();
        return E.regMaster(name, addr, 'ErMultinomial', 'multinomial', { catnum, N }, () => function () { this.remN = N; this.remPop = N; this.drawn = new Map(); });
      };
      F.ErMultinomialCom = (addr, name, cat, cases) => {
        const m = E.master(name, 'ErMultinomialCom');
        if (!Number.isInteger(cat) || cat < 1 || cat > m.catnum || !Number.isInteger(cases) || cases <= 0) throw new ErNum();
        if (E.phase === 'prime') E.regCom(name, cat, cases);
        if (!E.running) return cases;
        E.ensure(m);
        if (m.frozen || !m.drawn) return cases;
        if (m.drawn.has(cat)) return m.drawn.get(cat);
        const rm = E.rep(`${addr}|ErMultinomialCom`);
        if (rm !== undefined) { m.drawn.set(cat, rm); E.record(`${addr}|ErMultinomialCom`, addr, 'ErMultinomialCom', null, rm); return rm; }
        const p = m.remPop > 0 ? Math.min(1, cases / m.remPop) : 0;
        const x = Sg.rBinomial(E.u(m.addr + '|ErMultinomial'), m.remN, p);
        m.remN -= x; m.remPop -= cases; m.drawn.set(cat, x);
        E.record(`${addr}|ErMultinomialCom`, addr, 'ErMultinomialCom', null, x);
        return x;
      };
      F.ErDirichlet = (addr, name, catnum, N) => {
        E.claim('ErDirichlet', name, addr, 25);
        if (!Number.isInteger(catnum) || catnum < 2 || !(N > 0)) throw new ErNum();
        return E.regMaster(name, addr, 'ErDirichlet', 'dirichlet', { catnum, N }, () => function () { this.remF = 1; this.remPop = N; this.drawn = new Map(); });
      };
      F.ErDirichletCom = (addr, name, cat, cases) => {
        const m = E.master(name, 'ErDirichletCom');
        if (!Number.isInteger(cat) || cat < 1 || cat > m.catnum || !(cases > 0)) throw new ErNum();
        if (E.phase === 'prime') E.regCom(name, cat, cases);
        if (!E.running) return cases / m.N;
        E.ensure(m);
        if (m.frozen || !m.drawn) return cases / m.N;
        if (m.drawn.has(cat)) return m.drawn.get(cat);
        const rd = E.rep(`${addr}|ErDirichletCom`);
        if (rd !== undefined) { m.drawn.set(cat, rd); E.record(`${addr}|ErDirichletCom`, addr, 'ErDirichletCom', null, rd); return rd; }
        const rest = m.remPop - cases;
        const x = rest > 1e-9 * m.N ? m.remF * Sg.rBeta(E.u(m.addr + '|ErDirichlet'), cases, rest) : m.remF;
        m.remF -= x; m.remPop = rest; m.drawn.set(cat, x);
        E.record(`${addr}|ErDirichletCom`, addr, 'ErDirichletCom', null, x);
        return x;
      };
      F.ErCorrNormal = (addr, name, C, n, corm) => {
        E.claim('ErCorrNormal', name, addr, 25);
        if (!Number.isInteger(n) || n < 1) throw new ErNum();
        let M = Sg.lowerToFull(C, n);
        if (!corm) { const d = M.map((r, i) => Math.sqrt(r[i])); if (d.some((v) => !(v > 0))) throw new ErNum(); M = M.map((r, i) => r.map((v, j) => v / (d[i] * d[j]))); }
        const L = Sg.cholesky(M);
        if (!L) E.die(`The matrix for "${name}" in ErCorrNormal is not valid (not positive semi-definite). Check it under Tools.`);
        return E.regMaster(name, addr, 'ErCorrNormal', 'corrNormal', { L, n }, () => {
          const u = E.u(addr + '|ErCorrNormal');
          return function () { const e = L.map(() => Sg.rNormal(u)); this.z = L.map((row) => row.reduce((s, l, j) => s + l * e[j], 0)); };
        });
      };
      F.ErCorrNormalCom = (addr, name, num, mu, sig) => {
        const m = E.master(name, 'ErCorrNormalCom');
        if (!Number.isInteger(num) || num < 1 || num > m.n || !(sig > 0)) throw new ErNum();
        if (!E.running) return mu;
        E.ensure(m);
        if (m.frozen || !m.z) return mu;
        const rc = E.rep(`${addr}|ErCorrNormalCom`);
        const v = rc !== undefined ? rc : mu + sig * m.z[num - 1];
        if (E.phase === 'iter' && !E.frozen) E.record(`${addr}|ErCorrNormalCom`, addr, 'ErCorrNormalCom', null, v);
        return v;
      };
      F.ErRankCorr = (addr, name, C, n) => {
        E.claim('ErRankCorr', name, addr, 25);
        const L = E.corrMatrix(C, n, 'ErRankCorr', name);
        return E.regMaster(name, addr, 'ErRankCorr', 'rankCorr', { L, n }, () => function () {});
      };
      F.ErRankCorrCom = (addr, name, num, func) => {
        const m = E.master(name, 'ErRankCorrCom');
        if (!Number.isInteger(num) || num < 1 || num > m.n) throw new ErNum();
        if (E.phase === 'idle' || E.phase === 'prime' || E.phase === 'fixed') return func;
        const nest = E.nestedFor(addr, 'ErRankCorrCom', RANK_OK);
        if (E.phase === 'runEnd' || E.phase === 'frozen' || E.frozen) { const v = E.last.get(nest.key); return v === undefined ? func : v; }
        const rr = E.rep(nest.key);
        if (rr !== undefined) { E.record(nest.key, addr, nest.name, nest.args, rr); return rr; }
        if (!m.prep) m.prep = { ranks: E.correlatedRanks(m.L, E.iterations, E.u(m.addr + '|ErRankCorr')), sorted: new Map() };
        let s = m.prep.sorted.get(num);
        if (!s) {
          s = new Float64Array(E.iterations);
          const u = E.u(nest.key + '#rc'), d = DISTS[nest.name];
          for (let i = 0; i < E.iterations; i++) s[i] = d.sample(u, nest.args);
          s.sort(); m.prep.sorted.set(num, s);
        }
        const v = s[m.prep.ranks[num - 1][Math.min(E.iteration, E.iterations) - 1]];
        E.record(nest.key, addr, nest.name, nest.args, v);
        return v;
      };
      F.ErDirichletCorr = (addr, n, C, k) => E.corrMulti(addr, 'ErDirichletCorr', n, C, k, 'dirichletCorr');
      F.ErDirichletCorrIn = (addr, n, inp, num) => E.corrMultiIn(n, inp, num, 'ErDirichletCorrIn');
      F.ErDirichletCorrOut = (addr, n, num) => E.corrMultiOut(addr, n, num, 'ErDirichletCorrOut');
      F.ErMultinomialCorr = (addr, n, C, k) => E.corrMulti(addr, 'ErMultinomialCorr', n, C, k, 'multinomialCorr');
      F.ErMultinomialCorrIn = (addr, n, inp, num) => E.corrMultiIn(n, inp, num, 'ErMultinomialCorrIn');
      F.ErMultinomialCorrOut = (addr, n, num) => E.corrMultiOut(addr, n, num, 'ErMultinomialCorrOut');

      // Outputs
      F.ErOutput = (addr, name, value) => {
        E.claim('ErOutput', name, addr, 225);
        if (E.phase === 'prime') E.outputsReg.set(addr, { name });
        E.report(addr, value);
        return value;
      };
      F.ErRunOutput = (addr, name, value) => {
        E.claim('ErRunOutput', name, addr, 225);
        if (E.phase === 'prime') E.runOutputsReg.set(addr, { name });
        E.report(addr, value);
        return value;
      };
      F.ErSensInput = (addr, name, value) => {
        E.claim('ErSensInput', name, addr, 225);
        E.sensReg.set(name, { addr, gen: E.gen, value });
        return value;
      };
      F.ErRunSensInput = (addr, name, value) => {
        E.claim('ErRunSensInput', name, addr, 225);
        E.runSensReg.set(name, { addr, gen: E.gen, value });
        return value;
      };
      F.ErData = (addr, inp, itnum) => {
        if (!Number.isInteger(itnum) || itnum < 1 || (E.phase === 'iter' && itnum > E.iterations)) throw new ErNum();
        if (E.phase === 'iter' && E.iteration === itnum) E.dataAt.set(addr, inp);
        if (E.phase === 'iter' || E.phase === 'prime' || E.phase === 'fixed') return 0;
        if (!E.finished && E.phase === 'idle') return 0;
        return E.dataAt.has(addr) ? E.dataAt.get(addr) : 0;
      };
      F.ErDataArray = (addr, name, v) => {
        E.claim('ErDataArray', name, addr, 225);
        if (E.phase === 'idle' && !E.finished) throw new ErNum();
        if (E.phase === 'iter') {
          let a = E.dataArr.get(addr);
          if (!a) { a = { gen: -1, xs: [] }; E.dataArr.set(addr, a); }
          if (a.gen === E.gen) a.xs[a.xs.length - 1] = v; else { a.xs.push(v); a.gen = E.gen; }
        }
        if (E.phase === 'iter' || E.phase === 'prime' || E.phase === 'fixed') return [[0]];
        const a = E.dataArr.get(addr);
        return a && a.xs.length ? a.xs.map((x) => [x]) : [[0]];
      };
      F.ErRunDataArray = (addr, name, v) => {
        E.claim('ErRunDataArray', name, addr, 225);
        if (E.phase === 'idle' && !E.finished) throw new ErNum();
        if (E.phase === 'runEnd') {
          let a = E.runDataArr.get(addr);
          if (!a) { a = { gen: -1, xs: [] }; E.runDataArr.set(addr, a); }
          if (a.gen === E.gen) a.xs[a.xs.length - 1] = v; else { a.xs.push(v); a.gen = E.gen; }
        }
        if (E.phase !== 'idle') return [[0]];
        const a = E.runDataArr.get(addr);
        return a && a.xs.length ? a.xs.map((x) => [x]) : [[0]];
      };

      // Optimisation
      F.ErMinimize = (addr, name, ir) => {
        E.claim('ErMinimize', name, addr, 225);
        const flat = Sg.flatColumnwise(ir), rows = ir.length, cols = ir[0].length;
        E.minStart.set(name, { flat, rows, cols });
        const x = E.minX.get(name) || flat;
        const out = [];
        for (let r = 0; r < rows; r++) { out.push([]); for (let c = 0; c < cols; c++) out[r].push(x[c * rows + r]); }
        return out;
      };
      F.ErMinimizeResult = (addr, name, lf) => {
        E.claim('ErMinimizeResult', name, addr, 225);
        if (!(lf >= 0)) throw new ErNum();
        if (E.phase === 'prime') E.minLossAddr.set(name, addr);
        E.report(addr, lf);
        return lf;
      };

      // Discounting. Costs and years accrue continuously between sy and ly.
      const annuity = (by, sy, ly, r) => {
        if (r === 0) return ly - sy;
        const g = Math.log(1 + r);
        return (Math.exp(-g * (sy - by)) - Math.exp(-g * (ly - by))) / g;
      };
      F.ErOneOffCostDisc = (addr, by, cy, co, r) => { if (r < 0 || by > cy || co < 0) throw new ErNum(); return co / Math.pow(1 + r, cy - by); };
      F.ErAnnualCostDisc = (addr, by, sy, ly, co, r) => { if (r < 0 || by > sy || co < 0) throw new ErNum(); return ly < sy ? 0 : co * annuity(by, sy, ly, r); };
      F.ErLYDisc = (addr, by, sy, ly, r) => { if (r < 0 || by > sy) throw new ErNum(); return ly < sy ? 0 : annuity(by, sy, ly, r); };
      F.ErHALYDisc = (addr, by, sy, ly, r, ag, ha) => {
        const ages = Sg.flatColumnwise(ag), w = Sg.flatColumnwise(ha);
        if (r < 0 || by > sy || ages.length !== w.length || !ages.length) throw new ErNum();
        if (ly < sy) return 0;
        const weight = new Map(ages.map((a, i) => [Math.floor(a), w[i]])), lo = Math.min(...ages), hi = Math.max(...ages);
        let t = sy, s = 0;
        while (t < ly - 1e-12) {
          const y = Math.floor(t + 1e-12), e = Math.min(ly, y + 1), k = Math.max(lo, Math.min(hi, y)), wt = weight.has(k) ? weight.get(k) : 0;
          s += wt * annuity(by, t, e, r);
          t = e;
        }
        return s;
      };

      // Controls
      F.ErFixed = (addr, x, num) => {
        const a = Sg.flatColumnwise(x);
        if (!Number.isInteger(num) || num < 1 || !a.length) throw new ErNum();
        return E.running ? a[(num - 1) % a.length] : a[0];
      };
      F.ErConditional = (addr, con, value) => {
        if (!E.running) return value;
        if (E.phase === 'iter' && !E.frozen && con) E.conditionalHold.set(addr, value);
        return E.conditionalHold.has(addr) ? E.conditionalHold.get(addr) : 0;
      };
      F.ErTruncate = (addr, min, max, func) => {
        if (!(min < max)) throw new ErNum();
        const clamp = (v) => Math.min(max, Math.max(min, v));
        if (!E.running) return clamp(func);
        const n = E.nestedFor(addr, 'ErTruncate', TRUNC_OK);
        if (E.phase === 'runEnd' || E.phase === 'frozen' || E.frozen) { const v = E.last.get(n.key); return v === undefined ? func : v; }
        if (func >= min && func <= max) return func;
        const u = E.u(n.key), d = DISTS[n.name];
        for (let i = 1; i < E.settings.maxTruncate; i++) {
          const v = d.sample(u, n.args);
          if (v >= min && v <= max) { E.record(n.key, addr, n.name, n.args, v); return v; }
        }
        throw new ErNum();
      };
      F.ErIteration = () => (E.running ? E.iteration : 1);
      F.ErSetItno = (addr, num) => {
        if (!Number.isInteger(num) || num < 1) throw new ErNum();
        if (E.phase === 'prime') E.setItno = num;
        return num;
      };
      F.ErRunno = () => (E.running ? E.run : 1);
      F.ErRunning = () => E.running;
      F.ErVersion = () => 'Surrogate ' + Sg.VERSION;

      // Store and retrieve: a retrieve sees what was stored on the previous iteration, in either calc order.
      const put = (map, name, v) => {
        const s = map.get(name) || { gen: -1, value: undefined, prev: undefined };
        if (s.gen !== E.gen) { s.prev = s.value; s.gen = E.gen; }
        s.value = v; map.set(name, s);
      };
      const get = (map, name) => {
        const s = map.get(name);
        if (!s) return undefined;
        return s.gen === E.gen ? s.prev : s.value;
      };
      F.ErStore = (addr, name, inp) => {
        E.claim('ErStore', name, addr, 225);
        if (E.phase === 'iter') put(E.stores, name, inp);
        return name;
      };
      F.ErRetrieve = (addr, name) => { E.checkName(name, 225); if (!E.running) return 0; const v = E.phase === 'iter' ? get(E.stores, name) : (E.stores.get(name) || {}).prev; return v === undefined ? 0 : v; };
      F.ErStoreArray = (addr, name, a) => {
        E.claim('ErStoreArray', name, addr, 225);
        const m = a.map((r) => r.map(Sg.num));
        (E.arrShape = E.arrShape || new Map()).set(name, m);
        if (E.phase === 'iter') put(E.arrStores, name, m);
        return name;
      };
      F.ErRetrieveArray = (addr, name) => {
        E.checkName(name, 225);
        const shape = (E.arrShape || new Map()).get(name);
        const zeros = shape ? shape.map((r) => r.map(() => 0)) : [[0]];
        if (!E.running) return zeros;
        const v = E.phase === 'iter' ? get(E.arrStores, name) : (E.arrStores.get(name) || {}).prev;
        return v === undefined ? zeros : v;
      };
      F.ErCondStoreArray = (addr, name, cond, a, mode) => {
        E.claim('ErCondStoreArray', name, addr, 225);
        if (![0, 1, 2].includes(mode)) throw new ErNum();
        if (E.phase !== 'iter' || !cond) return name;
        const m = a.map((r) => r.map(Sg.num));
        let s = E.condStores.get(name);
        if (s && s.gen === E.gen) return name;
        if (!s) s = { value: null };
        // "On the first iteration ... the range is stored as such": a sum or product restarts at iteration 1 of each
        // run, and otherwise carries on, including across runs when the store only fires at the end of a run.
        const first = E.iteration === 1;
        s.value = first || mode === 0 || !s.value ? m : m.map((r, i) => r.map((v, j) => (mode === 1 ? v * s.value[i][j] : v + s.value[i][j])));
        s.gen = E.gen;
        E.condStores.set(name, s);
        return name;
      };
      F.ErCondRetrieveArray = (addr, name, cond) => {
        E.checkName(name, 225);
        if (E.phase === 'idle' && !E.finished) throw new ErNum();
        const s = E.condStores.get(name);
        if (cond && s && s.value) E.condRetr.set(addr, s.value);
        const v = E.condRetr.get(addr);
        if (v) return v;
        if (E.phase === 'prime' || E.phase === 'fixed' || E.running) return [[0]];
        throw new ErNum();
      };
      F.ErSortedArray = (addr, a, mode) => {
        const flat = Sg.flatColumnwise(a).sort((p, q) => (mode === 1 ? p - q : q - p)), rows = a.length, cols = a[0].length, out = [];
        for (let r = 0; r < rows; r++) { out.push([]); for (let c = 0; c < cols; c++) out[r].push(flat[c * rows + r]); }
        return out;
      };

      // Statistics
      F.ErMean = (addr, v) => E.statFn(addr, v, stats.mean);
      F.ErStDev = (addr, v) => E.statFn(addr, v, stats.sd);
      F.ErMin = (addr, v) => E.statFn(addr, v, (a) => a.reduce((m, x) => (x < m ? x : m), Infinity));
      F.ErMax = (addr, v) => E.statFn(addr, v, (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity));
      F.ErTotal = (addr, v) => E.statFn(addr, v, (a) => a.reduce((s, x) => s + x, 0));
      F.ErCorrelation = (addr, x, y) => {
        if (E.phase === 'prime' || E.phase === 'fixed' || (E.phase === 'idle' && !E.accum.has(addr))) return 0;
        const a = E.acc(addr, x, y), r = a.xs.length > 1 ? stats.pearson(a.xs, a.ys) : 0;
        return Number.isFinite(r) ? r : 0;
      };
      F.ErPercentile = (addr, v, p) => {
        if (!(p >= 0 && p <= 100)) throw new ErNum();
        return E.statFn(addr, v, (a) => stats.percentile(a.slice().sort((x, y) => x - y), p));
      };
      return F;
    }
    // Entry point for callers holding a raw address string.
    call(name, address, args) { return this.fns[name](normAddr(address), ...args); }
  }
  Sg.Engine = Engine;
  Sg.normAddr = normAddr;
})(globalThis.Sg = globalThis.Sg || {});
