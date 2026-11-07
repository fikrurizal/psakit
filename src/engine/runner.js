// Drives a simulation. A host only has to recalculate, read cells and list formulas. Excel, the simulated workbook
// used in tests, and a compiled model are all hosts. The fast path swaps in the compiled model after checking that
// it gives the same answers as the workbook.
(function (Sg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FORMULA_RE = /\bER\.ER[A-Z0-9]+\s*\(/i;

  // Sheet order, not Excel's calculation order, so lists stay stable between runs.
  const addrKey = (a) => { const m = /^(.*)!([A-Z]+)(\d+)/.exec(a) || [null, a, '', 0]; return [m[1], +m[3], m[2].length, m[2]]; };
  const byAddr = (f) => (p, q) => {
    const a = addrKey(f(p)), b = addrKey(f(q));
    for (let i = 0; i < 4; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
    return 0;
  };
  // State that ties one iteration or run to another. Models using these can't be split across threads in that way.
  const TIES_ITERATIONS = new Set(['ErStore', 'ErRetrieve', 'ErStoreArray', 'ErRetrieveArray', 'ErCondStoreArray', 'ErCondRetrieveArray', 'ErConditional', 'ErRankCorr', 'ErRankCorrCom', 'ErDirichletCorr', 'ErDirichletCorrIn', 'ErDirichletCorrOut', 'ErMultinomialCorr', 'ErMultinomialCorrIn', 'ErMultinomialCorrOut', 'ErMean', 'ErStDev', 'ErMin', 'ErMax', 'ErTotal', 'ErCorrelation', 'ErPercentile', 'ErData', 'ErDataArray', 'ErRunOutput', 'ErRunSensInput', 'ErRunDataArray']);
  const TIES_RUNS = new Set(['ErCondStoreArray', 'ErCondRetrieveArray', 'ErStore', 'ErRetrieve', 'ErStoreArray', 'ErRetrieveArray']);

  class Runner {
    constructor(engine, host, opts) {
      this.E = engine; this.real = host; this.host = host; this.cancelled = false; this.active = false; this.opts = opts || {};
    }
    cancel() { this.cancelled = true; if (this.pool) this.pool.cancel(); }
    fail(msg) { const e = new Error(msg); e.simFailure = true; throw e; }

    async calc() {
      const p = this.host.calculate();
      if (p) await p;
      if (this.E.fatal) this.fail(this.E.fatal);
    }
    // Excel may deliver custom function results after the calculate call returns, and it never calls a function whose
    // argument is an error. So wait briefly, then read what's still missing from the sheet. An error there is recorded
    // for that iteration and the run carries on, as Ersatz does. That output then gets no summary statistics.
    allReported(addrs) {
      const E = this.E;
      for (let i = 0; i < addrs.length; i++) { const r = E.reports.get(addrs[i]); if (!r || r.gen !== E.gen) return false; }
      return true;
    }
    async collect(addrs, where) {
      const E = this.E, missing = () => addrs.filter((a) => { const r = E.reports.get(a); return !r || r.gen !== E.gen; });
      let m = missing();
      if (!m.length) return;
      const start = Date.now();
      if (!this.host.sync) for (let wait = 1; m.length && Date.now() - start < 300; wait = Math.min(wait * 2, 50)) { await sleep(wait); m = missing(); }
      while (m.length) {
        const vals = await this.host.readCells(m);
        let busy = false;
        m.forEach((a, i) => {
          const v = vals[i];
          if (v === '#BUSY!') { busy = true; return; }
          if (typeof v !== 'number') { E.noteError(a, String(v === '' ? 'no value' : v)); E.reports.set(a, { gen: E.gen, value: NaN }); return; }
          E.reports.set(a, { gen: E.gen, value: v });
        });
        if (!busy) return;
        if (Date.now() - start > 30000) this.fail(`Excel was still calculating after 30 seconds ${where}.`);
        await sleep(50); m = missing();
      }
    }

    async scan() {
      const cells = await this.real.scanFormulas();
      const live = cells.filter((c) => FORMULA_RE.test(c.formula));
      const legacy = cells.filter((c) => Sg.hasLegacy(c.formula));
      return { cells: live, legacy };
    }

    // Excel never calls a function whose argument is an error, so an output downstream of a bad input is invisible
    // to the engine. Ersatz treats errors showing before a run as fatal, and so does this.
    async checkReporters(cells) {
      const E = this.E, RE = /\bER\.(EROUTPUT|ERRUNOUTPUT|ERMINIMIZERESULT)\s*\(/i;
      const silent = cells.filter((c) => RE.test(c.formula) && !E.reports.has(Sg.normAddr(c.address)));
      if (!silent.length) return;
      // In real Excel, custom function results can land after calculate() returns, so a cell may read #BUSY! for a
      // moment. Wait that out (as collect() does) instead of treating it as a broken input.
      let vals;
      for (const start = Date.now(); ; await sleep(50)) {
        vals = await this.host.readCells(silent.map((c) => c.address));
        if (!vals.includes('#BUSY!')) break;
        if (Date.now() - start > 30000) this.fail('Excel was still calculating after 30 seconds before the run started.');
      }
      silent.forEach((c, i) => {
        if (typeof vals[i] === 'string' && vals[i][0] === '#') this.fail(`Output cell ${c.address} shows ${vals[i]} before the run has started, so an input it depends on is invalid. Fix that input and run again.`);
      });
    }

    // Prime pass: registers the model so it can be listed and checked.
    async inspect(settings) {
      const E = this.E;
      const s = await this.scan();
      const saved = E.saveResultState();
      E.beginPrime(settings);
      try {
        await this.calc();
        E.finishPrime();
        return {
          formulas: s.cells.length, legacy: s.legacy.length,
          inputs: [...E.inputs.values()].map((i) => ({ key: i.key, addr: i.addr, fn: i.fn, args: i.args })).sort(byAddr((x) => x.addr)),
          outputs: [...E.outputsReg].map(([addr, r]) => ({ addr, name: r.name })).sort(byAddr((x) => x.addr)),
          runOutputs: [...E.runOutputsReg].map(([addr, r]) => ({ addr, name: r.name })).sort(byAddr((x) => x.addr)),
          sens: [...E.sensReg.keys()], setItno: E.setItno,
          minimizers: [...E.minLossAddr.keys()],
          masters: [...E.masters.values()].map((m) => ({ name: m.name, addr: m.addr, fn: m.fnName })).sort(byAddr((x) => x.addr)),
        };
      } finally { E.phase = 'idle'; E.restoreResultState(saved); }
    }

    // ---- Fast path ---------------------------------------------------------------------------
    // Compiles the workbook, or says why it can't. A compile failure is never an error for the user: the run goes on
    // through Excel, slower, and the status line says what stopped it.
    async tryCompile(settings) {
      if (!this.real.readWorkbook) return { why: 'This host cannot supply its formulas for compiling.' };
      const E = this.E;
      E.phase = 'idle';
      const was = E.settings.showMeans;
      E.settings.showMeans = true;
      try {
        await this.real.calculate();
        const wb = await this.real.readWorkbook();
        return { model: Sg.compileWorkbook(wb) };
      } catch (e) {
        if (e && e.unsupported) return { why: e.message, cell: e.cell, fn: e.fn };
        return { why: 'The workbook could not be read for compiling: ' + (e && e.message) };
      } finally { E.settings.showMeans = was; void settings; }
    }
    // Runs the first iterations of the compiled model, then gives Excel the same random draws, and compares every
    // compiled cell. This is what lets the fast path be trusted on a particular workbook.
    async matchCheck(model, settings, N, iterations) {
      if (model.stat.usesRand) return { ok: true, skipped: 'it uses RAND, which can\'t be replayed in Excel' };
      const E2 = new Sg.Engine(), H2 = new Sg.CompiledHost(model, E2), E = this.E, draws = [], snaps = [];
      const baseSeed = (Math.random() * 4294967296) >>> 0;
      const set = Object.assign({}, settings, { seed: baseSeed });
      E2.beginPrime(set); H2.calculate();
      if (E2.fatal) return { ok: true, skipped: E2.fatal };
      E2.iterations = N; E2.runs = 1; E2.beginRun(1);
      for (let i = 1; i <= iterations; i++) {
        E2.beginIter(i);
        H2.calculate();
        const d = new Map(E2.current);
        for (const m of E2.masters.values()) if (m.map) d.set(m.addr + '|' + m.fnName, m.map.slice());
        draws.push(d);
        snaps.push(model.checks.map((c) => H2.valueAt(c.addr)));
      }
      E.beginPrime(set);
      await this.real.calculate();
      E.iterations = N; E.runs = 1; E.beginRun(1);
      let compared = 0;
      const mismatches = [];
      try {
        for (let i = 1; i <= iterations; i++) {
          E.replay = draws[i - 1];
          E.beginIter(i);
          await this.real.calculate();
          const vals = await this.real.readCells(model.checks.map((c) => c.addr));
          vals.forEach((v, k) => {
            const a = snaps[i - 1][k];
            compared++;
            if (!sameValue(a, v) && mismatches.length < 5) mismatches.push({ addr: model.checks[k].addr, formula: model.checks[k].f, compiled: a, excel: v, iteration: i });
          });
          if (mismatches.length) break;
        }
      } finally { E.replay = null; E.phase = 'idle'; }
      return { ok: !mismatches.length, compared, cells: model.checks.length, iterations, mismatches };
    }

    parallelPlan(model, N, R, settings, optim) {
      if (!Sg.makeWorker || !model || this.opts.threads === 1) return null;
      const threads = this.opts.threads || Math.min(16, Math.max(1, ((globalThis.navigator && navigator.hardwareConcurrency) || 2) - 1) || 1);
      if (threads < 2 && !this.opts.forceWorkers) return null;
      if (N * R < 2000 && !this.opts.forceWorkers) return null;
      if (optim && optim.on === 'run') return null;
      if (optim && optim.firstIterationOnly) return null;
      if (settings.conditionalOn && Object.values(Object.assign({ __default: settings.conditional.__default }, settings.conditional)).includes('once') && R === 1) return null;
      const used = model.usedEr;
      if (R > 1) {
        if (used.some((f) => TIES_RUNS.has(f))) return null;
        return { mode: 'runs', threads };
      }
      if (used.some((f) => TIES_ITERATIONS.has(f))) return null;
      return { mode: 'iterations', threads };
    }

    // ---- One iteration, used by every path ---------------------------------------------------
    // With optimisation per iteration, this is the Ersatz "Iteration" option: draw, hold the draws, fit, then record.
    async iterate(i, ctx) {
      const E = this.E;
      E.beginIter(i);
      const p = this.host.calculate();
      if (p) await p;
      if (E.fatal) this.fail(E.fatal);
      if (ctx.iterOptim) await this.optimiseWithin(i, ctx);
      if (!this.allReported(ctx.outAddrs)) await this.collect(ctx.outAddrs, `on iteration ${i} of run ${E.run}`);
      E.endIter();
    }
    async optimiseWithin(i, ctx) {
      const E = this.E, o = ctx.iterOptim, gen = E.gen;
      if (o.firstOnly && ctx.firstDone) { /* keep the fitted values for this and later iterations */ }
      else {
        const opt = new Sg.Optimizer(o.method, o.start, Object.assign({}, o.options, { u: E.u('optimizer') }));
        ctx.evals = ctx.evals || 0;
        while (!opt.done) {
          E.minX.set(o.name, opt.cur);
          E.beginFrozenEval();
          await this.calc();
          await this.collect([o.lossAddr], `while optimising on iteration ${i}`);
          opt.tell(E.reports.get(o.lossAddr).value);
          ctx.evals++;
          if (this.cancelled) break;
        }
        E.minX.set(o.name, opt.best.x);
        ctx.firstDone = true;
        ctx.lastLoss = opt.best.f; ctx.lastX = opt.best.x; ctx.trace = opt.trace;
      }
      E.beginFinalEval(gen);
      await this.calc();
    }

    // opts: iterations, runs, settings, optim {name, method, on, options, restarts, firstIterationOnly}, speed, check, onProgress
    async simulate(opts) {
      if (this.active) this.fail('A simulation is already running.');
      this.active = true; this.cancelled = false; this.host = this.real;
      const E = this.E, real = this.real, t0 = Date.now();
      let manualSet = false, lastPaint = 0, info = { path: 'excel' };
      const paint = async (run, iter, N, R) => {
        const now = Date.now();
        if (now - lastPaint < 120) return;
        lastPaint = now;
        if (opts.onProgress) opts.onProgress({ run, iter, N, R, elapsed: now - t0, path: info.path });
        await sleep(0);
      };
      try {
        const scan = await this.scan();
        if (!scan.cells.length) this.fail(scan.legacy.length ? `This workbook has ${scan.legacy.length} old Ersatz formulas. Convert them under Tools first.` : 'No ER. functions found. Add at least one random function and one ER.EROUTPUT, or insert the example model from Tools.');
        await real.setManual(true); manualSet = true;
        // Prime on the real workbook first: this finds bad parameters and duplicate names with their usual messages.
        E.beginPrime(opts.settings);
        await this.calc();
        E.finishPrime();
        const useOptim = !!(opts.optim && opts.optim.name);
        await this.checkReporters(scan.cells);
        if (!E.outputsReg.size && !E.runOutputsReg.size && !useOptim) this.fail('No outputs to record. Wrap a result in ER.EROUTPUT("name", value).');
        let N = opts.iterations;
        const R0 = opts.runs || 1;
        if (E.setItno && E.settings.useSetItno) N = E.setItno;
        if (!(N >= 1) || !(R0 >= 1)) this.fail('Iterations and runs must be at least 1.');
        const seedUsed = E.masterSeed;

        let model = null;
        if (opts.speed !== 'excel') {
          const c = await this.tryCompile(opts.settings);
          if (c.model) {
            info = { path: 'compiled', stat: c.model.stat };
            try {
              if (opts.check !== false) {
                const chk = await this.matchCheck(c.model, E.settings, N, Math.min(N, opts.checkIterations || 5));
                info.check = chk;
                if (chk.ok) model = c.model;
                else info = { path: 'excel', why: `The compiled model gave a different answer from Excel in ${chk.mismatches[0].addr}, so this run used Excel recalculation.`, check: chk, cell: chk.mismatches[0].addr };
              } else model = c.model;
            } catch (e) {
              if (e.simFailure) throw e;
              info = { path: 'excel', why: 'Compiled models are blocked here: ' + e.message };
            }
          } else info = { path: 'excel', why: c.why, cell: c.cell, fn: c.fn };
          // The check used its own seed, so restore the run's own.
          E.replay = null;
          E.beginPrime(Object.assign({}, opts.settings, { seed: seedUsed }));
          await real.calculate();
          E.finishPrime();
        }
        if (model) {
          this.host = new Sg.CompiledHost(model, E);
          E.beginPrime(Object.assign({}, opts.settings, { seed: seedUsed }));
          await this.calc();
          E.finishPrime();
        }
        E.iterations = N;
        E.keepAll = opts.keepAll !== undefined ? opts.keepAll : N * R0 <= 2000000;
        const iterOptimMode = useOptim && opts.optim.on !== 'run';
        const runOptimMode = useOptim && opts.optim.on === 'run';
        let optStart = null, lossAddr = null;
        if (useOptim) {
          optStart = E.minStart.get(opts.optim.name);
          lossAddr = E.minLossAddr.get(opts.optim.name);
          if (!optStart) this.fail(`No ER.ERMINIMIZE function is named "${opts.optim.name}".`);
          if (!lossAddr) this.fail(`No ER.ERMINIMIZERESULT function is named "${opts.optim.name}".`);
        }
        const ctx = {
          outAddrs: [...E.outputsReg.keys()],
          runAddrs: [...E.runOutputsReg.keys()],
          iterOptim: iterOptimMode ? { name: opts.optim.name, method: opts.optim.method, start: optStart.flat, lossAddr, options: Object.assign({}, opts.optim.options, { restarts: opts.optim.restarts }), firstOnly: !!opts.optim.firstIterationOnly } : null,
        };
        let completed = 0, optim = null;
        const R = R0;
        E.runs = R;

        const plan = model && !runOptimMode ? this.parallelPlan(model, N, R, E.settings, useOptim ? opts.optim : null) : null;
        let ran = false;
        if (plan) {
          try {
            const out = await new Sg.WorkerPool(this, plan, model, ctx, { N, R, seed: seedUsed, settings: E.settings, keepAll: E.keepAll }).run((done, total) => {
              if (opts.onProgress) opts.onProgress({ run: 1, iter: done, N: total, R: 1, elapsed: Date.now() - t0, path: 'compiled', threads: plan.threads });
            });
            completed = out.completed;
            info.mode = plan.mode; info.threads = plan.threads;
            if (ctx.iterOptim) optim = { name: opts.optim.name, evals: out.evals, perIteration: true, method: opts.optim.method };
            ran = true;
          } catch (e) {
            info.threadNote = 'Worker threads were not available, so this ran on one thread: ' + e.message;
          } finally { this.pool = null; }
        }
        if (ran) {
          // Results were merged by the pool.
        } else if (runOptimMode) {
          // The Ersatz "Run" option: the optimiser decides how many runs happen, each one a loss evaluation.
          const opt = new Sg.Optimizer(opts.optim.method, optStart.flat, Object.assign({}, opts.optim.options, { restarts: opts.optim.restarts, u: E.u('optimizer') }));
          let run = 0;
          const oneRun = async () => {
            run++;
            E.beginRun(run);
            for (let i = 1; i <= N; i++) { if (this.cancelled) return; await this.iterate(i, ctx); completed++; await paint(run, i, N, Math.max(run, 1)); }
            E.beginRunEnd();
            await this.calc();
            await this.collect(ctx.runAddrs.concat([lossAddr]), `at the end of run ${run}`);
            E.endRun();
          };
          while (!opt.done && !this.cancelled) {
            E.minX.set(opts.optim.name, opt.cur);
            await oneRun();
            if (this.cancelled) break;
            opt.tell(E.reports.get(lossAddr).value);
          }
          // One last run at the best values, so what's reported belongs to them.
          E.minX.set(opts.optim.name, opt.best.x);
          if (!this.cancelled) { E.keepAll = false; await oneRun(); }
          E.runs = run;
          optim = { x: opt.best.x, loss: opt.best.f, evals: opt.trace.length, trace: opt.trace, converged: opt.done, name: opts.optim.name, method: opts.optim.method };
        } else {
          outer: for (let run = 1; run <= R; run++) {
            E.beginRun(run);
            for (let i = 1; i <= N; i++) {
              if (this.cancelled) break outer;
              await this.iterate(i, ctx);
              completed++;
              if ((i & 255) === 0 || i === N || !this.host.sync) await paint(run, i, N, R);
            }
            E.beginRunEnd();
            await this.calc();
            await this.collect(ctx.runAddrs, `at the end of run ${run}`);
            E.endRun();
          }
          if (ctx.iterOptim) optim = { name: opts.optim.name, evals: ctx.evals || 0, perIteration: true, method: opts.optim.method, x: ctx.lastX, loss: ctx.lastLoss, trace: ctx.trace };
        }
        E.finish();
        this.host = real;
        await real.calculate();
        return this.results({ completed, N, R: E.runs, elapsed: Date.now() - t0, cancelled: this.cancelled, optim, info });
      } catch (e) {
        E.phase = 'idle'; E.replay = null;
        this.host = real;
        try { await real.calculate(); } catch (_) { /* keep the original error */ }
        throw e;
      } finally {
        if (manualSet) await real.setManual(false);
        this.active = false;
      }
    }

    results(meta) {
      const E = this.E;
      return Object.assign(meta, {
        ci: E.settings.ci, rng: E.settings.rng, seed: E.masterSeed, runIndex: E.runIndex, keepAll: E.keepAll,
        outputs: [...E.outputs.values()].map((o) => ({ name: o.name, addr: o.addr, values: o.values })).sort(byAddr((x) => x.addr)),
        runOutputs: [...E.runOutputs.values()].map((o) => ({ name: o.name, addr: o.addr, values: o.values })).sort(byAddr((x) => x.addr)),
        inputs: [...E.inputs.values()].map((i) => ({ key: i.key, label: i.addr, addr: i.addr, fn: i.fn, values: i.values, args: i.args })).sort(byAddr((x) => x.addr)),
        sensInputs: [...E.sensVals].map(([name, values]) => ({ name, values })),
        runSensInputs: [...E.runSensVals].map(([name, values]) => ({ name, values })),
        errors: [...E.errors.values()],
      });
    }

    // ---- Deterministic sensitivity ----------------------------------------------------------
    // Every pass holds all inputs at their means except those named in its Map, then recalculates the workbook in Excel.
    // These need few recalculations, so they don't need the compiled path.
    async deterministic(opts, work) {
      if (this.active) this.fail('A simulation is already running.');
      this.active = true; this.cancelled = false; this.host = this.real;
      const E = this.E, real = this.real, saved = E.saveResultState();
      await real.setManual(true);
      try {
        E.beginPrime(opts.settings);
        await this.calc();
        E.finishPrime();
        const outputs = [...E.outputsReg.entries()].map(([addr, r]) => ({ addr, name: r.name })).sort(byAddr((x) => x.addr));
        if (!outputs.length) this.fail('No outputs to record. Wrap a result in ER.EROUTPUT("name", value).');
        const addrs = outputs.map((o) => o.addr);
        const pass = async (overrides) => {
          E.beginFixed(overrides);
          await this.calc();
          await this.collect(addrs, 'during sensitivity analysis');
          return addrs.map((a) => E.reports.get(a).value);
        };
        const inputs = [...E.inputs.values()].filter((i) => Sg.DISTS[i.fn] && !Sg.DISTS[i.fn].deterministicGivenArgs).sort(byAddr((x) => x.addr));
        const rangeOf = (inp) => {
          const c = opts.custom && opts.custom[inp.key];
          const auto = Sg.inputRange(inp.fn, inp.args, opts.mode === 'custom' ? 'interval' : opts.mode, opts.ci);
          if (opts.mode === 'custom' && c) return [Number.isFinite(c[0]) ? c[0] : auto[0], Number.isFinite(c[1]) ? c[1] : auto[1]];
          return auto;
        };
        return await work({ pass, inputs, outputs, rangeOf, base: await pass(null) });
      } finally {
        E.phase = 'idle'; E.override = null;
        this.host = real;
        E.errors = new Map();
        E.restoreResultState(saved);
        try { await real.calculate(); } catch (_) { /* keep any original error */ }
        await real.setManual(false);
        this.active = false;
      }
    }
    // One-way tornado. Inputs sharing a group name move together, all to their low values and then all to their highs.
    async univariate(opts) {
      return this.deterministic(opts, async ({ pass, inputs, outputs, rangeOf, base }) => {
        const groups = new Map(), rows = [], plan = [];
        for (const inp of inputs) {
          const g = opts.groups && opts.groups[inp.key] ? String(opts.groups[inp.key]).trim() : '';
          if (g) { if (!groups.has(g)) { groups.set(g, []); plan.push({ group: g, members: groups.get(g) }); } groups.get(g).push(inp); }
          else plan.push({ members: [inp] });
        }
        let done = 0;
        for (const p of plan) {
          if (this.cancelled) break;
          const lo = new Map(), hi = new Map(), ranges = [];
          for (const inp of p.members) { const r = rangeOf(inp); lo.set(inp.key, r[0]); hi.set(inp.key, r[1]); ranges.push({ key: inp.key, addr: inp.addr, fn: inp.fn, low: r[0], high: r[1] }); }
          const low = await pass(lo), high = await pass(hi);
          rows.push({ group: p.group || null, key: p.members[0].key, label: p.members[0].addr, fn: p.members[0].fn, ranges, low, high });
          done++;
          if (opts.onProgress) { opts.onProgress({ done, total: plan.length }); await sleep(0); }
        }
        return { outputs, base, rows, mode: opts.mode, ci: opts.ci };
      });
    }
    // Two-way table: every combination of two inputs across their ranges.
    async twoWay(opts) {
      return this.deterministic(opts, async ({ pass, inputs, outputs, rangeOf, base }) => {
        const A = inputs.find((i) => i.key === opts.a), B = inputs.find((i) => i.key === opts.b);
        if (!A || !B || A === B) this.fail('Choose two different inputs.');
        const steps = Math.max(2, Math.min(21, Math.floor(opts.steps) || 5));
        const line = (r) => Array.from({ length: steps }, (_, i) => r[0] + (r[1] - r[0]) * i / (steps - 1));
        const xs = line(rangeOf(A)), ys = line(rangeOf(B)), grid = [];
        let done = 0;
        for (const y of ys) {
          const row = [];
          for (const x of xs) {
            if (this.cancelled) this.fail('Stopped.');
            row.push(await pass(new Map([[A.key, x], [B.key, y]])));
            done++;
            if (opts.onProgress && done % 5 === 0) { opts.onProgress({ done, total: steps * steps }); await sleep(0); }
          }
          grid.push(row);
        }
        return { outputs, base, a: { key: A.key, addr: A.addr, fn: A.fn }, b: { key: B.key, addr: B.addr, fn: B.fn }, xs, ys, grid };
      });
    }
    // Named scenarios. Each sets chosen inputs to their low or high value, or to a number.
    async scenarios(opts) {
      return this.deterministic(opts, async ({ pass, inputs, outputs, rangeOf, base }) => {
        const rows = [];
        for (const sc of opts.list) {
          const m = new Map();
          for (const inp of inputs) {
            const c = sc.set && sc.set[inp.key];
            if (c === undefined || c === 'mean') continue;
            if (typeof c === 'number') { m.set(inp.key, c); continue; }
            const r = rangeOf(inp);
            m.set(inp.key, c === 'low' ? r[0] : r[1]);
          }
          rows.push({ name: sc.name, changed: m.size, values: await pass(m) });
        }
        return { outputs, base, rows };
      });
    }
  }
  const sameValue = (a, b) => {
    if (typeof a === 'number' && a !== a) return typeof b === 'string' && b[0] === '#';
    if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)) + 1e-11;
    if (a === '' && b === 0) return true;
    return a === b;
  };
  Sg.sameValue = sameValue;
  Sg.Runner = Runner;
})(globalThis.Sg = globalThis.Sg || {});
