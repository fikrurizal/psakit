// Runs a compiled model across worker threads, in blocks whose size doesn't depend on the thread count, so a seed gives
// the same results on any machine. Each block is either whole runs, or a stretch of iterations of one run.
(function (Sg) {
  const blocksFor = (plan, N, R) => {
    if (plan.mode === 'runs') return Array.from({ length: R }, (_, i) => ({ id: i, run: i + 1, start: 1, count: N, runEnd: true }));
    const size = Math.max(512, Math.ceil(N / 256)), out = [];
    for (let s = 1, id = 0; s <= N; s += size, id++) out.push({ id, run: 1, start: s, count: Math.min(size, N - s + 1), runEnd: false });
    return out;
  };

  // The piece that runs inside a worker. Also used directly by tests, without threads.
  Sg.BlockRunner = class {
    constructor(init) {
      const E = (this.E = new Sg.Engine());
      E.settings = Object.assign(E.settings, init.settings);
      this.host = new Sg.CompiledHost(init.model, E);
      this.runner = new Sg.Runner(E, this.host);
      this.ctx = init.ctx;
      E.beginPrime(Object.assign({}, init.settings, { seed: init.seed }));
      this.host.calculate();
      E.finishPrime();
      E.iterations = init.N; E.runs = init.R; E.keepAll = true;
    }
    async run(b) {
      const E = this.E, r = this.runner, ctx = Object.assign({}, this.ctx, { evals: 0 });
      E.setSalt(String(b.id));
      E.fatal = null;
      E.clearIterationResults();
      E.errors = new Map();
      if (b.runEnd) { for (const o of E.runOutputs.values()) o.values = []; for (const k of E.runSensVals.keys()) E.runSensVals.set(k, []); }
      E.beginRun(b.run);
      for (let i = 0; i < b.count; i++) await r.iterate(b.start + i, ctx);
      if (b.runEnd) {
        E.beginRunEnd();
        await r.calc();
        await r.collect(ctx.runAddrs, `at the end of run ${b.run}`);
        E.endRun();
      }
      const res = { id: b.id, count: b.count, run: b.run, evals: ctx.evals || 0, errors: [...E.errors.values()], outputs: {}, inputs: {}, sens: {}, runOutputs: {}, runSens: {} };
      if (b.wantIterations !== false) {
        for (const [a, o] of E.outputs) res.outputs[a] = Float64Array.from(o.values);
        for (const [k, i] of E.inputs) res.inputs[k] = { addr: i.addr, fn: i.fn, values: Float64Array.from(i.values) };
        for (const [k, v] of E.sensVals) res.sens[k] = Float64Array.from(v);
      }
      for (const [a, o] of E.runOutputs) res.runOutputs[a] = o.values[o.values.length - 1];
      for (const [k, v] of E.runSensVals) res.runSens[k] = v[v.length - 1];
      if (b.runEnd) {
        res.state = {
          accum: [...E.accum].map(([a, v]) => [a, { gen: -1, xs: v.xs, ys: v.ys }]),
          dataAt: [...E.dataAt], dataArr: [...E.dataArr].map(([a, v]) => [a, { gen: -1, xs: v.xs }]),
          runData: [...E.runDataArr].map(([a, v]) => [a, v.xs.slice()]),
        };
        E.runDataArr.clear();
      }
      return res;
    }
  };

  // Message protocol shared by the real worker script and in-process test workers.
  Sg.workerHandle = async function (state, msg, post) {
    try {
      if (msg.type === 'init') { state.br = new Sg.BlockRunner(msg.init); post({ type: 'ready' }); return; }
      if (msg.type === 'block') {
        const res = await state.br.run(msg.block);
        const buf = [];
        for (const v of Object.values(res.outputs)) buf.push(v.buffer);
        for (const v of Object.values(res.inputs)) buf.push(v.values.buffer);
        for (const v of Object.values(res.sens)) buf.push(v.buffer);
        post({ type: 'done', res }, buf);
      }
    } catch (e) { post({ type: 'error', message: e && e.message ? e.message : String(e) }); }
  };

  // Plain data sent to each worker. Fixed ranges and strings are sent once.
  const modelPayload = (m) => ({ src: m.src, nSlots: m.nSlots, N0: m.N0, M0: m.M0, Vinit: m.Vinit, ranges: m.ranges.map((r) => ({ idx: r.idx, blank: r.blank, rows: r.rows, cols: r.cols, fixed: r.fixed })), addrs: m.addrs, fnList: m.fnList, checks: m.checks, stat: m.stat, usedEr: m.usedEr });

  Sg.WorkerPool = class {
    constructor(runner, plan, model, ctx, cfg) { this.runner = runner; this.plan = plan; this.model = model; this.ctx = ctx; this.cfg = cfg; this.workers = []; this.stopped = false; runner.pool = this; }
    cancel() { this.stopped = true; }
    async run(onProgress) {
      const { N, R, seed, settings, keepAll } = this.cfg, E = this.runner.E, plan = this.plan;
      const blocks = blocksFor(plan, N, R);
      // Iteration detail is kept for the last run unless the user wants all of it.
      const lastRun = R;
      for (const b of blocks) b.wantIterations = keepAll || b.run === lastRun;
      const n = Math.min(plan.threads, blocks.length);
      const init = { model: modelPayload(this.model), ctx: this.ctx, settings: JSON.parse(JSON.stringify(settings)), seed, N, R };
      const results = new Array(blocks.length);
      let nextB = 0, done = 0, doneIter = 0, failure = null, finished = 0;
      const total = blocks.reduce((s, b) => s + b.count, 0);
      await new Promise((resolve) => {
        const finishWorker = () => { finished++; if (finished === n) resolve(); };
        for (let w = 0; w < n; w++) {
          let worker;
          try { worker = Sg.makeWorker(); } catch (e) { failure = failure || e; finishWorker(); continue; }
          this.workers.push(worker);
          const give = () => {
            if (this.stopped || failure || nextB >= blocks.length) { try { worker.terminate(); } catch (e) { /* already gone */ } finishWorker(); return; }
            worker.postMessage({ type: 'block', block: blocks[nextB++] });
          };
          worker.onmessage = (ev) => {
            const m = ev.data;
            if (m.type === 'ready') { give(); return; }
            if (m.type === 'error') { failure = failure || new Error(m.message); try { worker.terminate(); } catch (e) { /* gone */ } finishWorker(); return; }
            results[m.res.id] = m.res; done++; doneIter += m.res.count;
            onProgress(doneIter, total);
            give();
          };
          worker.onerror = (ev) => { failure = failure || new Error(ev.message || 'A worker thread failed.'); finishWorker(); };
          worker.postMessage({ type: 'init', init });
        }
      });
      if (failure) throw failure;
      return this.merge(blocks, results, E);
    }
    // Reassembles results in block order, so the order never depends on which thread finished first.
    merge(blocks, results, E) {
      const have = results.filter(Boolean), outLen = have.filter((r) => Object.keys(r.outputs).length).reduce((s, r) => s + r.count, 0);
      const ordered = blocks.map((b) => results[b.id]).filter(Boolean);
      const runIndex = new Float64Array(outLen);
      const outs = new Map(), inps = new Map(), sens = new Map();
      let off = 0, evals = 0;
      const put = (map, k, make, v, at) => { let o = map.get(k); if (!o) { o = make(); o.values = new Float64Array(outLen).fill(NaN); map.set(k, o); } o.values.set(v, at); };
      const errors = new Map();
      for (const r of ordered) {
        evals += r.evals;
        for (const e of r.errors) { const k = e.addr + '|' + e.fn, x = errors.get(k); if (x) x.count += e.count; else errors.set(k, Object.assign({}, e)); }
        if (!Object.keys(r.outputs).length) continue;
        runIndex.fill(r.run, off, off + r.count);
        for (const [a, v] of Object.entries(r.outputs)) put(outs, a, () => ({ name: E.outputsReg.get(a).name, addr: a }), v, off);
        for (const [k, i] of Object.entries(r.inputs)) put(inps, k, () => ({ key: k, addr: i.addr, fn: i.fn, args: (E.inputs.get(k) || {}).args }), i.values, off);
        for (const [k, v] of Object.entries(r.sens)) { let o = sens.get(k); if (!o) { o = new Float64Array(outLen).fill(NaN); sens.set(k, o); } o.set(v, off); }
        off += r.count;
      }
      E.runIndex = runIndex; E.outputs = outs; E.inputs = inps; E.sensVals = sens; E.errors = errors;
      const runOut = new Map(), runSens = new Map();
      for (const r of ordered) {
        for (const [a, v] of Object.entries(r.runOutputs)) { if (!runOut.has(a)) runOut.set(a, { name: E.runOutputsReg.get(a).name, addr: a, values: [] }); runOut.get(a).values.push(v); }
        for (const [k, v] of Object.entries(r.runSens)) { if (!runSens.has(k)) runSens.set(k, []); runSens.get(k).push(v); }
        if (r.state) for (const [a, xs] of r.state.runData) { let d = E.runDataArr.get(a); if (!d) { d = { gen: -1, xs: [] }; E.runDataArr.set(a, d); } d.xs.push(...xs); }
      }
      E.runOutputs = runOut; E.runSensVals = runSens;
      const last = ordered[ordered.length - 1];
      if (last && last.state) { E.accum = new Map(last.state.accum); E.dataAt = new Map(last.state.dataAt); E.dataArr = new Map(last.state.dataArr); }
      E.iteration = this.cfg.N; E.run = this.cfg.R;
      return { completed: ordered.reduce((s, r) => s + r.count, 0), evals };
    }
  };
})(globalThis.Sg = globalThis.Sg || {});
