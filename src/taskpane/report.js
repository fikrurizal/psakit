// Results as a document: one plain data model, drawn the same way in a saved HTML report and in the live window.
(function (Sg) {
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  Sg.reportEsc = esc;

  // ---- Building the model. Only runs where the results are, so saved reports don't need the engine. ----------------
  const lastRunOf = (res, values) => {
    if (!res.runIndex.length) return values;
    return values.slice(res.runIndex.indexOf(res.runIndex[res.runIndex.length - 1]));
  };
  const pairsOf = (x, y) => {
    const a = [], b = [], n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { a.push(x[i]); b.push(y[i]); }
    return [a, b];
  };
  const thin = (a, cap) => { const st = Math.max(1, Math.ceil(a.length / cap)), o = []; for (let i = 0; i < a.length; i += st) o.push(a[i]); return o; };
  const round = (v) => (Number.isFinite(v) ? +v.toPrecision(10) : null);
  function outputModel(name, vals, ci) {
    const st = Sg.stats, s = st.summary(vals, ci), run = [];
    let m = 0, k = 0;
    for (const v of vals) { if (Number.isFinite(v)) { k++; m += (v - m) / k; } run.push(m); }
    const summary = {};
    for (const key of Object.keys(s)) summary[key] = typeof s[key] === 'number' ? (Number.isFinite(s[key]) ? s[key] : null) : s[key];
    return {
      name, s: summary,
      bins: st.histogram(vals).map((b) => [round(b.x0), round(b.x1), b.count]),
      conv: thin(run, 240).map(round), convN: run.length,
    };
  }
  function sensModel(y, inputs) {
    const st = Sg.stats, rows = [];
    for (const inp of inputs) {
      const p = pairsOf(thin(Array.from(inp.values), 20000), thin(Array.from(y), 20000));
      if (p[0].length < 3 || st.sd(p[0]) === 0 || st.sd(p[1]) === 0) continue;
      const r = st.spearman(p[0], p[1]);
      if (Number.isFinite(r)) rows.push({ label: inp.label, value: +r.toFixed(4) });
    }
    rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { rows: rows.slice(0, 15), more: Math.max(0, rows.length - 15) };
  }
  // opts: res, title, note, decimals, labelOf(input), detLabel(addr, fn), uni, two, scen, ce
  Sg.buildReportModel = function (o) {
    const res = o.res, model = {
      title: o.title || 'Simulation report', decimals: o.decimals, generated: new Date().toISOString(),
      version: Sg.VERSION, waiting: !res,
    };
    if (res) {
      if (!res._rp) {
        // Summaries and correlations are slow on big runs and don't change, so build them once per run.
        const inputs = res.inputs.map((i) => ({ label: o.labelOf(i), values: i.values })).concat(res.sensInputs.map((s) => ({ label: s.name, values: s.values })));
        res._rp = {
          outputs: res.outputs.map((x) => Object.assign(outputModel(x.name, lastRunOf(res, x.values), res.ci), { sens: sensModel(x.values, inputs) })),
          runOutputs: res.runOutputs.map((x) => Object.assign(outputModel(x.name, x.values, res.ci), { sens: sensModel(x.values, res.runSensInputs.map((s) => ({ label: s.name, values: s.values }))) })),
        };
      }
      Object.assign(model, res._rp, {
        ci: res.ci, note: o.note, completed: res.completed, N: res.N, R: res.R, cancelled: res.cancelled, seed: res.seed,
        rng: Sg.RNGS[res.rng] ? Sg.RNGS[res.rng].label : res.rng, elapsed: res.elapsed,
        errors: res.errors.slice(0, 50).map((e) => ({ fn: e.fn, addr: e.addr, count: e.count, iteration: e.iteration, run: e.run })),
        showingRun: res.R > 1 && res.outputs.length ? (res.runIndex.length ? res.runIndex[res.runIndex.length - 1] : res.R) : null,
      });
      if (res.optim) {
        const p = res.optim, m = Sg.OPTIMIZERS[p.method];
        model.optim = { name: p.name, method: m ? m.label : p.method, evals: p.evals, perIteration: !!p.perIteration, converged: !!p.converged, loss: Number.isFinite(p.loss) ? p.loss : null, x: p.x ? Array.from(p.x) : null, trace: p.trace ? thin(p.trace.filter(Number.isFinite), 240) : null };
      }
      if (o.ce && res.outputs.length >= 2 && res.outputs[o.ce.cost] && res.outputs[o.ce.effect]) {
        const [dc, de] = pairsOf(lastRunOf(res, res.outputs[o.ce.cost].values), lastRunOf(res, res.outputs[o.ce.effect].values)), n = dc.length;
        if (n) {
          const at = (w) => { let ce = 0, s = 0, m = 0; for (let i = 0; i < n; i++) { const b = w * de[i] - dc[i]; s += b; if (b > 0) { ce++; m += b; } } return { p: ce / n, mean: s / n, evpi: m / n - Math.max(s / n, 0) }; };
          const here = at(o.ce.wtp), top = Math.max(o.ce.wtp * 2, 1), curve = [], mc = Sg.stats.mean(dc), me = Sg.stats.mean(de);
          for (let k = 0; k <= 100; k++) curve.push(+at(top * k / 100).p.toFixed(4));
          model.ce = { cost: res.outputs[o.ce.cost].name, effect: res.outputs[o.ce.effect].name, wtp: o.ce.wtp, top, mc, me, icer: me !== 0 ? mc / me : null, mean: here.mean, p: here.p, evpi: here.evpi, curve, dc: thin(dc, 800).map(round), de: thin(de, 800).map(round) };
        }
      }
    }
    const fin = (a) => a.map((v) => (Number.isFinite(v) ? v : null));
    if (o.uni) {
      const u = o.uni;
      model.uni = { words: u.words, outputs: u.outputs.map((x) => x.name), base: fin(u.base), rows: u.rows.map((r) => ({ label: r.group || o.detLabel(r.label, r.fn), group: !!r.group, lo: r.group ? null : r.ranges[0].low, hi: r.group ? null : r.ranges[0].high, low: fin(r.low), high: fin(r.high) })) };
    }
    if (o.two) {
      const t = o.two;
      model.two = { a: o.detLabel(t.a.addr, t.a.fn), b: o.detLabel(t.b.addr, t.b.fn), outputs: t.outputs.map((x) => x.name), base: fin(t.base), xs: t.xs, ys: t.ys, grid: t.grid.map((row) => row.map(fin)) };
    }
    if (o.scen) model.scen = { outputs: o.scen.outputs.map((x) => x.name), base: fin(o.scen.base), rows: o.scen.rows.map((r) => ({ name: r.name, values: fin(r.values) })) };
    return model;
  };

  // ---- Drawing ------------------------------------------------------------------------------------------------------
  function statsTable(s, ci, f) {
    const rows = [['Mean', s.mean], ['Standard error of the mean', s.se], ['Standard deviation', s.sd], ['Median', s.median], [`${ci}% interval, lower`, s.lo], [`${ci}% interval, upper`, s.hi], ['Minimum', s.min], ['Maximum', s.max]];
    return `<table class="rp-stats"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(f(v))}</td></tr>`).join('')}<tr><td>Values</td><td>${Number(s.n).toLocaleString()}</td></tr></tbody></table>`;
  }
  Sg.renderReport = function (root, m) {
    const f = (v) => Sg.fmt(v, m.decimals);
    const draws = []; // charts need layout, so they're drawn after the markup is in place
    let id = 0;
    const box = (fn) => { const k = 'rp' + (++id); draws.push(() => fn(document.getElementById(k))); return `<div class="rp-chart" id="${k}"></div>`; };
    const dateText = m.generated ? new Date(m.generated).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : '';
    let h = `<header class="rp-head"><h1>${esc(m.title)}</h1><p class="rp-sub">${esc(dateText)}</p></header>`;
    if (m.waiting) { root.innerHTML = h + '<p class="rp-empty">No results yet. Run a simulation and they will appear here.</p>'; return; }

    const all = m.outputs.concat(m.runOutputs);
    if (m.cancelled) h += `<p class="rp-warn">${m.completed ? 'This run was stopped early, so these results come from fewer iterations than planned.' : 'This run was stopped before any iterations finished, so it has no results.'}</p>`;
    if (m.errors.length) h += `<div class="rp-warn"><strong>Some cells failed during this run.</strong> Outputs that depend on them have no statistics.<ul>${m.errors.map((e) => `<li>${esc(e.fn)} in ${esc(e.addr)}: ${Number(e.count).toLocaleString()} iteration${e.count > 1 ? 's' : ''}, first on iteration ${e.iteration} of run ${e.run}</li>`).join('')}</ul></div>`;

    // Summary first: the numbers most readers came for.
    if (all.length) {
      const line = (o) => `<tr><td>${esc(o.name)}</td><td>${esc(f(o.s.mean))}</td><td>${esc(f(o.s.lo))}</td><td>${esc(f(o.s.hi))}</td><td>${esc(f(o.s.sd))}</td></tr>`;
      const head = `<tr><th>Output</th><th>Mean</th><th>${m.ci}% lower</th><th>${m.ci}% upper</th><th>SD</th></tr>`;
      h += `<section><h2>Summary</h2>`;
      if (m.outputs.length) h += `<div class="scrollx"><table class="rp-sum"><thead>${head}</thead><tbody>${m.outputs.map(line).join('')}</tbody></table></div>`;
      if (m.runOutputs.length) h += `<h3>Across runs</h3><div class="scrollx"><table class="rp-sum"><thead>${head}</thead><tbody>${m.runOutputs.map(line).join('')}</tbody></table></div>`;
      if (m.showingRun) h += `<p class="rp-note">Iteration-level outputs show run ${m.showingRun} of ${m.R}.</p>`;
      h += '</section>';
    }
    if (m.ce) {
      const c = m.ce;
      h += `<section><h2>Cost-effectiveness</h2><p class="rp-note">${esc(c.cost)} against ${esc(c.effect)}, at a willingness to pay of ${esc(Sg.fmt(c.wtp))} per unit of effect.</p>
        <div class="rp-two"><div><table class="rp-stats"><tbody>
          <tr><td>Mean incremental cost</td><td>${esc(f(c.mc))}</td></tr><tr><td>Mean incremental effect</td><td>${esc(f(c.me))}</td></tr>
          <tr><td>Ratio of means (ICER)</td><td>${esc(f(c.icer))}</td></tr><tr><td>Mean net benefit</td><td>${esc(f(c.mean))}</td></tr>
          <tr><td>Probability cost-effective</td><td>${(c.p * 100).toFixed(1)}%</td></tr><tr><td>Expected value of perfect information, per unit modelled</td><td>${esc(f(c.evpi))}</td></tr>
        </tbody></table></div><div><h3>Cost-effectiveness plane</h3>${box((el) => Sg.scatter(el, c.de, c.dc, { height: 220 }))}<p class="rp-note">Effect across, cost up.</p></div></div>
        <h3>Acceptability curve</h3>${box((el) => Sg.lineChart(el, c.curve, { height: 170, yMin: 0, yMax: 1, xLeft: '0', xRight: Sg.fmt(c.top), tip: (i) => `${Sg.fmt(c.top * i / 100)}: ${(c.curve[i] * 100).toFixed(1)}%` }))}
        <p class="rp-note">Probability cost-effective as willingness to pay rises from 0 to ${esc(Sg.fmt(c.top))}.</p></section>`;
    }
    // One section per output, with its distribution, how it settled, and what drives it.
    const outSection = (o, unit) => {
      let x = `<section class="rp-out"><h2>${esc(o.name)}</h2>`;
      if (o.s.failed) return x + `<p class="rp-warn">No statistics: ${Number(o.s.failed).toLocaleString()} of ${Number(o.s.n).toLocaleString()} ${unit} failed.</p></section>`;
      x += `<div class="rp-two"><div><h3>Distribution</h3>${box((el) => Sg.histogram(el, [], { height: 200, binData: o.bins.map((b) => ({ x0: b[0], x1: b[1], count: b[2] })), lo: o.s.lo, hi: o.s.hi, mean: o.s.mean }))}<p class="rp-note">Dark bars fall inside the ${m.ci}% interval.</p></div><div>${statsTable(o.s, m.ci, f)}</div></div>`;
      x += `<div class="rp-two"><div><h3>Running mean</h3>${box((el) => Sg.lineChart(el, o.conv, { height: 170, xRight: `${Number(o.convN).toLocaleString()} ${unit}`, tip: (i) => Sg.fmt(o.conv[i]) }))}<p class="rp-note">The mean has settled once the right of this line runs flat.</p></div>`;
      if (o.sens && o.sens.rows.length) x += `<div><h3>What drives it</h3>${box((el) => Sg.signedBars(el, o.sens.rows, { max: 1 }))}<p class="rp-note">Spearman rank correlation of each input with this output.${o.sens.more ? ` Showing the top 15 of ${o.sens.rows.length + o.sens.more}.` : ''}</p></div>`;
      return x + '</div></section>';
    };
    m.outputs.forEach((o) => { h += outSection(o, 'iterations'); });
    m.runOutputs.forEach((o) => { h += outSection(o, 'runs'); });

    if (m.uni) {
      const u = m.uni;
      u.outputs.forEach((name, k) => {
        const rows = u.rows.filter((r) => Number.isFinite(r.low[k]) && Number.isFinite(r.high[k])).map((r) => ({ label: r.label, low: r.low[k], high: r.high[k] })).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
        const skipped = u.rows.length - rows.length;
        h += `<section><h2>One-way sensitivity: ${esc(name)}</h2>
          <div class="legend"><span><i style="background:var(--rust)"></i>Input ${esc(u.words[0])}</span><span><i style="background:var(--mark)"></i>Input ${esc(u.words[1])}</span></div>
          ${box((el) => (Number.isFinite(u.base[k]) && rows.length ? Sg.tornado(el, rows, u.base[k]) : null))}
          <p class="rp-note">With every input at its mean, ${esc(name)} is ${esc(f(u.base[k]))}.${skipped ? ` ${skipped} input${skipped > 1 ? 's' : ''} failed and ${skipped > 1 ? 'are' : 'is'} left out of the chart.` : ''}</p>
          <div class="scrollx"><table class="rp-sum"><thead><tr><th>Input</th><th>Low</th><th>High</th><th>Output at low</th><th>Output at high</th></tr></thead><tbody>${u.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.group ? 'group' : esc(Sg.fmt(r.lo))}</td><td>${r.group ? 'group' : esc(Sg.fmt(r.hi))}</td><td>${esc(f(r.low[k]))}</td><td>${esc(f(r.high[k]))}</td></tr>`).join('')}</tbody></table></div></section>`;
      });
    }
    if (m.two) {
      const t = m.two;
      t.outputs.forEach((name, k) => {
        const vals = t.grid.map((row) => row.map((c) => c[k]));
        h += `<section><h2>Two-way sensitivity: ${esc(name)}</h2>
          <div class="legend"><span><i style="background:var(--rust)"></i>Below the base case</span><span><i style="background:var(--mark)"></i>Above it</span></div>
          ${box((el) => Sg.heatmap(el, { xs: t.xs, ys: t.ys, values: vals, base: Number.isFinite(t.base[k]) ? t.base[k] : 0 }))}
          <p class="rp-note">${esc(t.a)} across, ${esc(t.b)} up. With every input at its mean, ${esc(name)} is ${esc(f(t.base[k]))}.</p></section>`;
      });
    }
    if (m.scen) {
      const r = m.scen;
      h += `<section><h2>Scenarios</h2><div class="scrollx"><table class="rp-sum"><thead><tr><th>Scenario</th>${r.outputs.map((o) => `<th>${esc(o)}</th>`).join('')}</tr></thead><tbody>
        <tr><td>All inputs at their means</td>${r.base.map((v) => `<td>${esc(f(v))}</td>`).join('')}</tr>
        ${r.rows.map((x) => `<tr><td>${esc(x.name)}</td>${x.values.map((v) => `<td>${esc(f(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    }
    if (m.optim) {
      const p = m.optim;
      h += `<section><h2>Optimisation: ${esc(p.name)}</h2><p class="rp-note">${esc(p.method)}, ${Number(p.evals).toLocaleString()} loss evaluations${p.perIteration ? ', fitted within each iteration' : p.converged ? ', stopped by its own criterion' : ', stopped early'}.</p>`;
      if (p.x) h += `<div class="rp-two"><div><table class="rp-stats"><tbody><tr><td>Loss</td><td>${esc(f(p.loss))}</td></tr>${p.x.map((v, i) => `<tr><td>Parameter ${i + 1}</td><td>${esc(Sg.fmt(v))}</td></tr>`).join('')}</tbody></table></div>${p.trace && p.trace.length ? `<div><h3>Best loss so far</h3>${box((el) => Sg.lineChart(el, p.trace, { height: 150, xRight: 'evaluations', tip: (i) => Sg.fmt(p.trace[i]) }))}</div>` : ''}</div>`;
      h += '</section>';
    }
    h += `<section class="rp-method"><h2>How this was calculated</h2><table class="rp-stats"><tbody>
      <tr><td>Iterations completed</td><td>${Number(m.completed).toLocaleString()}</td></tr>
      <tr><td>Iterations per run</td><td>${Number(m.N).toLocaleString()}</td></tr><tr><td>Runs</td><td>${Number(m.R).toLocaleString()}</td></tr>
      <tr><td>Random generator</td><td>${esc(m.rng)}</td></tr><tr><td>Seed</td><td>${esc(m.seed)}</td></tr></tbody></table>
      <p class="rp-note">${esc(m.note)}</p>
      <p class="rp-note">Calculated with Surrogate ${esc(m.version)}, an independent reimplementation of the Ersatz function set. It is not affiliated with or endorsed by EpiGear.</p></section>`;
    root.innerHTML = h;
    draws.forEach((d) => d());
  };
  // Redraws when the window changes width, since charts are drawn to fit.
  Sg.keepReportFitted = function (root, getModel) {
    let t, w = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === w || !root.isConnected) return;
      w = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(() => { const m = getModel(); if (m) Sg.renderReport(root, m); }, 150);
    });
  };

  // ---- Saved file ---------------------------------------------------------------------------------------------------
  Sg.getReportAssets = async function () {
    if (Sg.REPORT_ASSETS) return Sg.REPORT_ASSETS;
    const text = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`Could not read ${u}`); return r.text(); };
    const [css, stats, charts, report] = await Promise.all(['taskpane.css', '../engine/stats.js', 'charts.js', 'report.js'].map(text));
    Sg.REPORT_ASSETS = { css, js: [stats, charts, report].join('\n;\n') };
    return Sg.REPORT_ASSETS;
  };
  // One self-contained file: no connection to Excel, and nothing loaded from anywhere else.
  Sg.reportHtml = function (model, assets) {
    const safeJson = JSON.stringify(model).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
    const safeJs = assets.js.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title><style>${assets.css}</style></head>
<body class="rp-body"><main class="rp" id="report"></main>
<script>${safeJs}</script>
<script>(function(){var m=${safeJson};var r=document.getElementById('report');Sg.renderReport(r,m);Sg.keepReportFitted(r,function(){return m;});})();</script>
</body></html>`;
  };
  Sg.reportFileName = (title) => `${String(title || 'simulation-report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'simulation-report'}.html`;

  // ---- Live window --------------------------------------------------------------------------------------------------
  // Works in any window. The host decides how messages reach it. actions: run(), auto(on), save(model).
  Sg.mountLive = function (container, actions, opts) {
    opts = opts || {};
    container.innerHTML = `<div class="live-bar">
      <button class="btn primary" id="lvRun">Run again</button>
      ${opts.canAuto ? '<label class="check small"><input type="checkbox" id="lvAuto"><span>Rerun when the workbook changes</span></label>' : ''}
      <span class="live-status small" id="lvStatus" role="status"></span>
      ${opts.canSave ? '<button class="btn" id="lvSave">Save HTML report</button>' : ''}
      ${opts.onClose ? '<button class="btn" id="lvClose">Close</button>' : ''}
    </div><div class="live-progress" aria-hidden="true"><i id="lvBar"></i></div><main class="rp" id="lvRoot"></main>`;
    const q = (k) => container.querySelector('#' + k), root = q('lvRoot');
    let model = null, running = false;
    q('lvRun').addEventListener('click', () => { if (running) actions.stop(); else actions.run(); });
    if (q('lvAuto')) q('lvAuto').addEventListener('change', (e) => actions.auto(e.target.checked));
    if (q('lvSave')) q('lvSave').addEventListener('click', () => { if (model) actions.save(model); });
    if (q('lvClose')) q('lvClose').addEventListener('click', opts.onClose);
    Sg.keepReportFitted(root, () => model);
    return {
      update(m) {
        model = m;
        const y = window.scrollY;
        Sg.renderReport(root, m);
        window.scrollTo(0, y); // keep the reader's place when a new run arrives
      },
      status(s) {
        running = !!s.running;
        const b = q('lvRun');
        b.textContent = running ? 'Stop' : 'Run again';
        b.className = running ? 'btn stop' : 'btn primary';
        q('lvStatus').textContent = s.text || '';
        q('lvBar').style.width = s.pct === undefined ? '0' : `${s.pct}%`;
      },
      setAuto(on) { if (q('lvAuto')) q('lvAuto').checked = !!on; },
    };
  };
  // Long messages go in pieces, because Office dialogs limit message length.
  const PIECE = 20000;
  Sg.sendInPieces = function (post, obj) {
    const text = JSON.stringify(obj), id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), n = Math.max(1, Math.ceil(text.length / PIECE));
    for (let i = 0; i < n; i++) post(JSON.stringify({ id, i, n, d: text.slice(i * PIECE, (i + 1) * PIECE) }));
  };
  Sg.pieceReceiver = function (onMessage) {
    const open = new Map();
    return (raw) => {
      const p = JSON.parse(raw);
      let b = open.get(p.id);
      if (!b) { b = { parts: new Array(p.n), got: 0 }; open.set(p.id, b); }
      if (b.parts[p.i] === undefined) { b.parts[p.i] = p.d; b.got++; }
      if (b.got === p.n) { open.delete(p.id); onMessage(JSON.parse(b.parts.join(''))); }
    };
  };
  Sg.saveTextFile = function (name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' })), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})(globalThis.Sg = globalThis.Sg || {});
