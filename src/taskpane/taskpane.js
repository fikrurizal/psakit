// Task pane interface. Works against any host that implements the runner's interface.
(function (Sg) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeText = (v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v); // keep names from running as formulas
  const csvCell = (v) => { const s = String(safeText(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const ui = { sensView: 'tornado', tab: 'results', res: null, detail: null, view: 'hist', scanned: null, labels: new Map(), uni: null };
  const D = { iterations: 2000, runs: 1, multi: false, ci: 95, rng: 'fast', seed: '', showMeans: true, hideScreen: true, decimals: 'auto', maxTruncate: 10, useSetItno: true, conditionalOn: false, conditional: {}, condDefault: 'every', speed: 'fast', check: true, reportTitle: 'Simulation report', sensMode: 'sd', sensCustom: {}, sensGroups: {}, scenarios: [], optimOn: false, optimName: '', optimMethod: 'downhill', optimEach: 'iteration', optimFirst: false, optimRestarts: 0, optimOptions: {} };
  let S = Object.assign({}, D, { conditional: {} });
  let engine, host, runner;

  const fmt = (v) => Sg.fmt(v, S.decimals);
  const engineSettings = () => ({ rng: S.rng, seed: S.seed === '' ? null : S.seed, showMeans: S.showMeans, ci: S.ci, maxTruncate: S.maxTruncate, useSetItno: S.useSetItno, conditionalOn: S.conditionalOn, conditional: Object.assign({ __default: S.condDefault }, S.conditional) });
  const persist = () => { try { host.saveSettings(S); } catch (e) { /* settings are a convenience */ } };

  function setAlert(msg) { $('alert').textContent = msg || ''; $('alert').hidden = !msg; }
  function log(msg) { const a = $('log'); if (!a) return; const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`; a.prepend(d); }

  // ---- Run bar ------------------------------------------------------------------------------
  function syncRunBar() {
    $('runsField').hidden = !S.multi;
    $('iterations').value = S.iterations; $('runs').value = S.runs;
    $('run').textContent = S.optimOn ? 'Run optimisation' : 'Run simulation';
  }
  function busy(on, stopLabel) {
    const b = $('run');
    b.className = on ? 'btn stop' : 'btn primary';
    b.textContent = on ? (stopLabel || 'Stop') : (S.optimOn ? 'Run optimisation' : 'Run simulation');
    $('iterations').disabled = on; $('runs').disabled = on;
  }
  function progress(p) {
    const tot = p.N * p.R, done = (p.run - 1) * p.N + p.iter;
    $('bar').style.width = (100 * done / tot) + '%';
    const speed = done / (p.elapsed / 1000);
    const left = speed > 0 ? Math.round((tot - done) / speed) : 0;
    $('status').textContent = (p.R > 1 ? `Run ${p.run} of ${p.R}, iteration ${p.iter.toLocaleString()} of ${p.N.toLocaleString()}` : `Iteration ${p.iter.toLocaleString()} of ${p.N.toLocaleString()}`) + `. About ${left < 90 ? left + ' s' : Math.round(left / 60) + ' min'} left.`;
    if (Date.now() - (ui.lastDashStatus || 0) > 400) { ui.lastDashStatus = Date.now(); dashStatus({ running: true, text: $('status').textContent, pct: 100 * done / tot }); }
  }
  async function onRun() {
    if (runner.active) { runner.cancel(); $('run').textContent = 'Stopping'; return; }
    setAlert(''); ui.detail = null; ui.uni = null; ui.two = null; ui.scen = null; busy(true);
    dashStatus({ running: true, text: 'Reading the workbook.', pct: 0 });
    $('status').textContent = 'Reading the workbook.'; $('bar').style.width = '0';
    host.hideScreen = S.hideScreen;
    try {
      const opts = { iterations: S.iterations, runs: S.multi ? S.runs : 1, settings: engineSettings(), onProgress: progress, speed: S.speed === 'excel' ? 'excel' : 'compiled', check: S.check };
      if (S.optimOn) {
        if (!S.optimName) throw new Error('Choose which optimiser to run on the Optimise tab. Scan the workbook there if the list is empty.');
        opts.optim = { name: S.optimName, method: S.optimMethod, on: S.optimEach, options: S.optimOptions[S.optimMethod] || {}, restarts: S.optimRestarts, firstIterationOnly: S.optimFirst };
      }
      const res = await runner.simulate(opts);
      ui.res = res;
      await resolveLabels(res.inputs);
      const secs = res.elapsed / 1000, rate = res.completed / Math.max(secs, 0.001);
      $('status').textContent = `${res.cancelled ? 'Stopped after' : 'Finished'} ${res.completed.toLocaleString()} iterations in ${secs < 90 ? secs.toFixed(1) + ' s' : (secs / 60).toFixed(1) + ' min'} (${Math.round(rate).toLocaleString()} per second).`;
      $('bar').style.width = '100%';
      log(`${res.outputs.length} outputs, ${res.inputs.length} inputs, ${res.completed} iterations, ${secs.toFixed(1)} s, generator ${Sg.RNGS[res.rng].label}, seed ${res.seed}.`);
      log(pathNote(res));
      res.errors.slice(0, 50).forEach((e) => log(`${e.fn} in ${e.addr} failed on ${e.count} iteration${e.count > 1 ? 's' : ''}, first on iteration ${e.iteration} of run ${e.run}.`));
      selectTab(res.optim ? 'optim' : 'results');
      pushDash();
      dashStatus({ running: false, text: $('status').textContent, pct: 100 });
    } catch (e) {
      $('status').textContent = 'Run failed.'; $('bar').style.width = '0';
      setAlert(e.message || String(e));
      log('Run failed: ' + (e.message || e));
      dashStatus({ running: false, text: 'Run failed: ' + (e.message || e) });
    } finally { busy(false); ui.ignoreChangesUntil = Date.now() + 1500; }
  }

  // ---- Report and live window -----------------------------------------------------------------------
  const reportModel = () => Sg.buildReportModel({
    res: ui.res, title: S.reportTitle, decimals: S.decimals, note: ui.res ? pathNote(ui.res) : '', labelOf, detLabel,
    uni: ui.uni, two: ui.two, scen: ui.scen, ce: ui.ceUsed ? ui.ce : null,
  });
  const reportText = async () => Sg.reportHtml(reportModel(), await Sg.getReportAssets());
  async function saveReport() {
    try {
      Sg.saveTextFile(Sg.reportFileName(S.reportTitle), await reportText());
      $('rpMsg').textContent = `Saved ${Sg.reportFileName(S.reportTitle)} to your downloads. If nothing appeared, this version of Excel blocks downloads, so use Copy report HTML and paste it into a text file ending in .html.`;
    } catch (e) { setAlert('Could not save the report: ' + (e.message || e)); }
  }
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(await reportText());
      $('rpMsg').textContent = 'Copied the report. Paste it into a text file and save that with a name ending in .html.';
    } catch (e) { setAlert('Could not copy the report: ' + (e.message || e)); }
  }
  // Sends results to the live window, if it's open.
  function pushDash() {
    if (!ui.dash) return;
    try { ui.dash.send({ type: 'model', model: reportModel() }); } catch (e) { log('Could not update the live window: ' + (e.message || e)); }
  }
  function dashStatus(s) { if (ui.dash) { try { ui.dash.send(Object.assign({ type: 'status' }, s)); } catch (e) { /* it will catch up */ } } }
  async function setAuto(on) {
    ui.autoOn = on;
    if (on && !ui.unwatch && host.watchChanges) {
      try { ui.unwatch = await host.watchChanges(onWorkbookChanged); }
      catch (e) { ui.autoOn = false; dashStatus({ text: 'This version of Excel can\'t report changes, so use Run again.' }); }
    } else if (!on && ui.unwatch) { try { await ui.unwatch(); } catch (e) { /* already gone */ } ui.unwatch = null; }
    clearTimeout(ui.autoTimer);
  }
  // A rerun waits for a pause in editing. Changes made during a run, or by the run finishing, are ignored.
  function onWorkbookChanged() {
    if (!ui.autoOn || runner.active || Date.now() < (ui.ignoreChangesUntil || 0)) return;
    clearTimeout(ui.autoTimer);
    ui.autoTimer = setTimeout(() => { if (ui.autoOn && !runner.active) { dashStatus({ running: true, text: 'The workbook changed. Running again.', pct: 0 }); onRun(); } }, 1200);
  }
  async function openDash() {
    if (ui.dash) { pushDash(); return; }
    if (!host.openDashboard) { setAlert('A separate window is not available here. Save an HTML report instead.'); return; }
    setAlert('');
    // The window asks for results once its page has loaded, because anything sent sooner would be lost.
    let channel = null, ready = false;
    const connect = () => {
      ui.dash = channel;
      pushDash();
      dashStatus({ running: runner.active, text: $('status').textContent });
      channel.send({ type: 'auto', on: !!ui.autoOn });
    };
    try {
      channel = await host.openDashboard({
        onMessage: (m) => {
          if (m.type === 'ready') { ready = true; if (channel) connect(); }
          if (m.type === 'run' && !runner.active) onRun();
          if (m.type === 'stop' && runner.active) runner.cancel();
          if (m.type === 'auto') setAuto(m.on);
        },
        onClosed: (code) => {
          ui.dash = null; setAuto(false);
          if (code && code !== 12006) setAlert(`The live window could not stay open (Excel error ${code}). Save an HTML report instead.`);
        },
      });
      if (ready || channel.immediate) connect();
    } catch (e) { setAlert(e.message || String(e)); }
  }

  // Says plainly how the run was calculated, and what limited it.
  function pathNote(res) {
    const i = res.info;
    const hostName = host.label || 'Excel';
    if (i.path !== 'compiled') return `Calculated by ${hostName} on every iteration. ${i.why || 'You chose this under Model.'}`;
    const st = i.stat, why = st.liveFormulas < st.totalFormulas ? ", because the rest don't change between iterations or feed no output," : '';
    let t = `Compiled ${st.liveFormulas.toLocaleString()} of ${st.totalFormulas.toLocaleString()} formulas${why} and ran on ${i.threads ? i.threads + ' threads' : 'one thread'}.`;
    if (i.check && i.check.compared) t += ` Matched ${hostName} on ${i.check.compared.toLocaleString()} cell values across ${i.check.iterations} sets of draws.`;
    else if (i.check && i.check.skipped) t += ` Not checked against ${hostName} because ${i.check.skipped}.`;
    if (i.threadNote) t += ' ' + i.threadNote;
    return t;
  }

  // Input labels: the text just left of the cell, when there is any, otherwise the address.
  async function resolveLabels(inputs) {
    const need = [], left = [];
    for (const i of inputs) {
      if (ui.labels.has(i.addr) || i.addr.includes('#')) continue;
      const m = /^(.*)!([A-Z]+)(\d+)$/.exec(i.addr);
      if (!m || m[2] === 'A') continue;
      let n = 0; for (const ch of m[2]) n = n * 26 + ch.charCodeAt(0) - 64;
      n -= 1; let col = ''; while (n > 0) { const r = (n - 1) % 26; col = String.fromCharCode(65 + r) + col; n = (n - r - 1) / 26; }
      need.push(i.addr); left.push(`${m[1]}!${col}${m[3]}`);
    }
    if (!need.length) return;
    try {
      const vals = await host.readCells(left);
      vals.forEach((v, k) => { if (typeof v === 'string' && v.trim() && v[0] !== '#') ui.labels.set(need[k], v.trim()); });
    } catch (e) { /* addresses still work */ }
  }
  const short = (addr) => addr.replace(/^.*!/, '');
  const labelOf = (i) => { const l = ui.labels.get(i.addr); return l ? l : `${short(i.addr)} ${i.fn.replace(/^Er/, '')}`; };

  // ---- Tabs ----------------------------------------------------------------------------------
  const TABS = { results: renderResults, sens: renderSens, model: renderModel, optim: renderOptim, tools: renderTools };
  function selectTab(t) {
    ui.tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    TABS[t]();
  }
  const main = () => $('main');

  // ---- Results -------------------------------------------------------------------------------
  const lastRun = (res, values) => {
    if (!res.runIndex.length) return values;
    const R = res.runIndex[res.runIndex.length - 1];
    let first = res.runIndex.indexOf(R);
    return values.slice(first);
  };
  function renderResults() {
    const res = ui.res;
    if (!res) {
      main().innerHTML = `<div class="empty"><strong>No results yet</strong>Set the number of iterations above and run the simulation. Each output in the workbook will appear here with its distribution. If the workbook has no model, insert the example from the Tools tab.</div><div class="actions"><button class="btn" id="dashOpen">Open live window</button></div>`;
      $('dashOpen').addEventListener('click', openDash);
      return;
    }
    if (ui.detail) return renderDetail();
    const R = res.runIndex.length ? res.runIndex[res.runIndex.length - 1] : 1;
    let h = '';
    h += `<p class="small muted" style="margin-bottom:6px">${esc(pathNote(res))}</p>`;
    if (res.info.path !== 'compiled' && res.info.cell) h += `<p class="small" style="margin-bottom:6px">To speed this model up, change ${esc(res.info.cell)}${res.info.fn ? ', which uses ' + esc(res.info.fn) : ''}, or ask for that function to be added.</p>`;
    if (res.errors.length) h += `<div class="alert" style="margin:0 0 8px"><strong>${res.errors.length === 1 ? 'A cell' : res.errors.length + ' cells'} failed during this run.</strong> Outputs that depend on them have no statistics. First: ${esc(res.errors[0].fn)} in ${esc(res.errors[0].addr)}, on iteration ${res.errors[0].iteration}. See Messages under Tools.</div>`;
    if (res.R > 1 && res.outputs.length) h += `<p class="muted small">Showing run ${R} of ${res.R}. ${res.keepAll ? 'Writing results to a sheet includes every run.' : 'Only this run\'s iterations were kept, to save memory.'}</p>`;
    h += res.outputs.length ? '<div id="outs"></div>' : '';
    if (res.runOutputs.length) h += `<h2>Across runs</h2><div id="runouts"></div>`;
    if (!res.outputs.length && !res.runOutputs.length) h += `<div class="empty"><strong>No outputs were recorded</strong>This run had no PSA.OUTPUT cells.</div>`;
    if (res.outputs.length >= 2) h += `<div class="actions"><button class="btn" id="ceOpen">Cost-effectiveness analysis</button></div>`;
    h += `<h2>Save results</h2>
      <div class="stack small">
        <label class="check"><input type="checkbox" id="wOut" checked><span>Every output value, by iteration</span></label>
        <label class="check"><input type="checkbox" id="wSorted"><span>Sorted output values</span></label>
        <label class="check"><input type="checkbox" id="wIn"><span>Every input value, by iteration</span></label>
      </div>
      <div class="actions"><button class="btn" id="toSheet">Write to a new sheet</button><button class="btn" id="toCsv">Download CSV</button></div>
      <div class="notice" id="saved" role="status"></div>
      <h2>Report</h2>
      <label class="field"><span>Report title</span><input type="text" id="rpTitle" value="${esc(S.reportTitle)}"></label>
      <p class="small muted" style="margin:6px 0 0">Includes these results, and any cost-effectiveness and sensitivity analyses you've run since this simulation.</p>
      <div class="actions"><button class="btn" id="rpSave">Save HTML report</button><button class="btn" id="rpCopy">Copy report HTML</button><button class="btn" id="dashOpen">Open live window</button></div>
      <div class="notice" id="rpMsg" role="status"></div>`;
    main().innerHTML = h;
    const row = (o, parent, kind) => {
      const vals = kind === 'run' ? o.values : lastRun(res, o.values), s = Sg.stats.summary(vals, res.ci);
      const b = document.createElement('button');
      b.className = 'out';
      b.innerHTML = `<div class="out-head"><span class="out-name">${esc(o.name)}</span><span class="out-mean">${s.failed ? 'n/a' : esc(fmt(s.mean))}</span></div><div class="out-ci">${s.failed ? `No statistics: ${s.failed.toLocaleString()} of ${s.n.toLocaleString()} iterations failed` : `${res.ci}% interval ${esc(fmt(s.lo))} to ${esc(fmt(s.hi))}`}</div><div class="mini"></div>`;
      b.addEventListener('click', () => { ui.detail = { o, kind }; ui.view = 'hist'; renderResults(); });
      parent.appendChild(b);
      if (!s.failed) Sg.histogram(b.querySelector('.mini'), vals, { height: 56, axis: false, tooltip: false, lo: s.lo, hi: s.hi, mean: s.mean });
    };
    if (res.outputs.length) res.outputs.forEach((o) => row(o, $('outs'), 'iter'));
    if (res.runOutputs.length) res.runOutputs.forEach((o) => row(o, $('runouts'), 'run'));
    if ($('ceOpen')) $('ceOpen').addEventListener('click', () => { ui.detail = { ce: true }; renderResults(); });
    $('toSheet').addEventListener('click', writeResults);
    $('toCsv').addEventListener('click', downloadCsv);
    $('rpTitle').addEventListener('change', (e) => { S.reportTitle = e.target.value.trim() || 'Simulation report'; e.target.value = S.reportTitle; persist(); pushDash(); });
    $('rpSave').addEventListener('click', saveReport);
    $('rpCopy').addEventListener('click', copyReport);
    $('dashOpen').addEventListener('click', openDash);
  }
  function renderDetail() {
    if (ui.detail.ce) return renderCE();
    const res = ui.res, { o, kind } = ui.detail, vals = kind === 'run' ? o.values : lastRun(res, o.values), s = Sg.stats.summary(vals, res.ci);
    const views = [['hist', 'Histogram'], ['conv', 'Running mean'], ['scat', 'Scatter']];
    const hasInputs = kind !== 'run' && res.inputs.length;
    main().innerHTML = `<button class="back" id="back">Back to all outputs</button>
      <h2>${esc(o.name)}</h2>
      <div class="seg" role="group" aria-label="Chart type">${views.filter((v) => v[0] !== 'scat' || hasInputs).map((v) => `<button data-v="${v[0]}" aria-pressed="${ui.view === v[0]}">${v[1]}</button>`).join('')}</div>
      <div id="viewOpts"></div><div id="big"></div>
      <p class="small muted" id="caption" style="margin-top:6px"></p>
      <div class="scrollx"><table><tbody>
        ${[['Mean', s.mean], ['Standard error of the mean', s.se], ['Standard deviation', s.sd], ['Median', s.median], [`${res.ci}% interval, lower`, s.lo], [`${res.ci}% interval, upper`, s.hi], ['Minimum', s.min], ['Maximum', s.max]].map(([k, v]) => `<tr><td>${k}</td><td>${esc(fmt(v))}</td></tr>`).join('')}
        <tr><td>Values</td><td>${s.n.toLocaleString()}</td></tr>
      </tbody></table></div>`;
    $('back').addEventListener('click', () => { ui.detail = null; renderResults(); });
    document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { ui.view = b.dataset.v; renderDetail(); }));
    const big = $('big'), cap = $('caption');
    if (ui.view === 'hist') {
      Sg.histogram(big, vals, { height: 190, lo: s.lo, hi: s.hi, mean: s.mean });
      cap.textContent = `Dark bars fall inside the ${res.ci}% interval. Pale bars are the tails.`;
    } else if (ui.view === 'conv') {
      const run = []; let m = 0, k = 0;
      for (const v of vals) { if (Number.isFinite(v)) { k++; m += (v - m) / k; } run.push(m); }
      Sg.lineChart(big, run, { xLabel: kind === 'run' ? 'runs' : 'iterations' });
      cap.textContent = 'The mean has settled once the right of this line runs flat. If it is still moving, use more iterations.';
    } else {
      const inputs = res.inputs;
      if (!ui.scatKey || !inputs.some((i) => i.key === ui.scatKey)) ui.scatKey = inputs[0].key;
      $('viewOpts').innerHTML = `<label class="field"><span>Input on the horizontal axis</span><select id="scatIn">${inputs.map((i) => `<option value="${esc(i.key)}" ${i.key === ui.scatKey ? 'selected' : ''}>${esc(labelOf(i))}</option>`).join('')}</select></label>`;
      $('scatIn').addEventListener('change', (e) => { ui.scatKey = e.target.value; renderDetail(); });
      const inp = inputs.find((i) => i.key === ui.scatKey);
      Sg.scatter(big, inp.values, o.values, { height: 210 });
      big.style.marginTop = '8px';
      const pr = pairs(inp.values, o.values), r = Sg.stats.pearson(pr[0], pr[1]);
      cap.textContent = `${labelOf(inp)} across, ${o.name} up. Correlation ${Number.isFinite(r) ? r.toFixed(3) : 'not available'}. Shows at most 1,500 points.`;
    }
  }
  // Cost-effectiveness plane, acceptability curve and value of information. These go beyond Ersatz, which left them to
  // the modeller, and are the usual reporting for the health economic models it was built for.
  function renderCE() {
    const res = ui.res, outs = res.outputs;
    const c = ui.ce || (ui.ce = { cost: 0, effect: Math.min(1, outs.length - 1), wtp: 50000 });
    main().innerHTML = `<button class="back" id="back">Back to all outputs</button><h2>Cost-effectiveness analysis</h2>
      <p class="small muted">Use outputs that are already differences between the two arms.</p>
      <div class="grid2">
        <label class="field"><span>Incremental cost</span><select id="ceC">${outs.map((o, i) => `<option value="${i}" ${i === c.cost ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Incremental effect</span><select id="ceE">${outs.map((o, i) => `<option value="${i}" ${i === c.effect ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field" style="margin-top:8px"><span>Willingness to pay per unit of effect</span><input type="number" id="ceW" min="0" value="${c.wtp}"></label>
      <div id="ceOut" style="margin-top:10px"></div>`;
    $('back').addEventListener('click', () => { ui.detail = null; renderResults(); });
    const draw = () => {
      c.cost = +$('ceC').value; c.effect = +$('ceE').value; c.wtp = Math.max(0, +$('ceW').value || 0);
      ui.ceUsed = true;
      const [dc, de] = pairs(lastRun(res, outs[c.cost].values), lastRun(res, outs[c.effect].values)), n = dc.length;
      if (!n) { $('ceOut').innerHTML = '<p class="muted small">These outputs have no usable values.</p>'; return; }
      const mc = Sg.stats.mean(dc), me = Sg.stats.mean(de);
      const nbAt = (w) => { let ce = 0, s = 0, m = 0; for (let i = 0; i < n; i++) { const b = w * de[i] - dc[i]; s += b; if (b > 0) { ce++; m += b; } } return { p: ce / n, mean: s / n, evpi: m / n - Math.max(s / n, 0) }; };
      const at = nbAt(c.wtp), top = Math.max(c.wtp * 2, 1), curve = [];
      for (let k = 0; k <= 100; k++) curve.push(nbAt(top * k / 100).p);
      $('ceOut').innerHTML = `<div class="scrollx"><table><tbody>
        <tr><td>Mean incremental cost</td><td>${esc(fmt(mc))}</td></tr>
        <tr><td>Mean incremental effect</td><td>${esc(fmt(me))}</td></tr>
        <tr><td>Ratio of means (ICER)</td><td>${me !== 0 ? esc(fmt(mc / me)) : 'n/a'}</td></tr>
        <tr><td>Mean net benefit at this willingness to pay</td><td>${esc(fmt(at.mean))}</td></tr>
        <tr><td>Probability cost-effective</td><td>${(at.p * 100).toFixed(1)}%</td></tr>
        <tr><td>Expected value of perfect information, per unit modelled</td><td>${esc(fmt(at.evpi))}</td></tr>
      </tbody></table></div><h2>Cost-effectiveness plane</h2><div id="cePlane"></div><p class="small muted" style="margin-top:4px">Effect across, cost up.</p><h2>Acceptability curve</h2><div id="ceCurve"></div><p class="small muted" style="margin-top:4px">Probability cost-effective as willingness to pay rises from 0 to ${esc(fmt(top))}.</p>`;
      Sg.scatter($('cePlane'), de, dc, { height: 200 });
      pushDash();
      Sg.lineChart($('ceCurve'), curve, { height: 140, yMin: 0, yMax: 1, xLeft: '0', xRight: Sg.fmt(top), tip: (i) => `${Sg.fmt(top * i / 100)}: ${(curve[i] * 100).toFixed(1)}%` });
    };
    ['ceC', 'ceE', 'ceW'].forEach((id) => $(id).addEventListener('change', draw));
    draw();
  }
  function resultRows() {
    const r = ui.res, rows = [], bold = [];
    const add = (a) => rows.push(a);
    const header = (a) => { bold.push([rows.length, a.length]); add(a); };
    const sumHead = ['Output', 'Mean', 'SD', 'Median', `${r.ci}% lower`, `${r.ci}% upper`, 'Minimum', 'Maximum', 'Values'];
    const cell = (v) => (Number.isFinite(v) ? v : 'n/a');
    const line = (o, vals) => { const s = Sg.stats.summary(vals, r.ci); add([safeText(o.name), s.mean, s.sd, s.median, s.lo, s.hi, s.min, s.max, s.n].map((v, k) => (k ? cell(v) : v))); };
    header(sumHead);
    r.outputs.forEach((o) => line(o, lastRun(r, o.values)));
    if (r.runOutputs.length) { add([]); header(['Across runs'].concat(sumHead.slice(1))); r.runOutputs.forEach((o) => line(o, o.values)); }
    add([]);
    add(['Iterations completed', r.completed]);
    add(['Random generator', Sg.RNGS[r.rng].label]);
    add(['Seed', r.seed]);
    add(['Calculated by', pathNote(r)]);
    r.errors.forEach((e) => add(['Failed', `${e.fn} in ${e.addr}: ${e.count} iterations, first on iteration ${e.iteration} of run ${e.run}`]));
    const wOut = $('wOut') && $('wOut').checked, wIn = $('wIn') && $('wIn').checked, wSorted = $('wSorted') && $('wSorted').checked;
    if (wOut || wIn) {
      add([]);
      const cols = [].concat(wOut ? r.outputs.map((o) => ({ h: o.name, v: o.values })) : [], wIn ? r.inputs.map((i) => ({ h: labelOf(i), v: i.values })) : []);
      header(['Run', 'Iteration'].concat(cols.map((c) => safeText(c.h))));
      const counts = new Map();
      r.runIndex.forEach((run, k) => {
        const it = (counts.get(run) || 0) + 1; counts.set(run, it);
        add([run, it].concat(cols.map((c) => (Number.isFinite(c.v[k]) ? c.v[k] : ''))));
      });
    }
    if (wSorted && r.outputs.length) {
      add([]);
      header(r.outputs.map((o) => 'Sorted: ' + safeText(o.name)));
      const sorted = r.outputs.map((o) => Sg.stats.clean(lastRun(r, o.values)).sort((a, b) => a - b));
      const n = Math.max(...sorted.map((a) => a.length));
      for (let i = 0; i < n; i++) add(sorted.map((a) => (i < a.length ? a[i] : '')));
    }
    return { rows, bold };
  }
  async function writeResults() {
    const { rows, bold } = resultRows();
    try {
      await host.writeSheet('PSAkit results', rows, { boldRows: bold });
      $('saved').textContent = 'Wrote results to the sheet "PSAkit results".';
    } catch (e) { setAlert('Could not write the results sheet: ' + (e.message || e)); }
  }
  function downloadCsv() {
    const { rows } = resultRows();
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'psakit-results.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('saved').textContent = 'Downloaded psakit-results.csv. If nothing appeared, your version of Excel blocks downloads here, so use Write to a new sheet.';
  }

  // ---- Sensitivity -----------------------------------------------------------------------------
  const detInputs = () => (ui.scanned ? ui.scanned.inputs.filter((i) => Sg.DISTS[i.fn] && !Sg.DISTS[i.fn].deterministicGivenArgs) : []);
  const detOpts = (extra) => Object.assign({ mode: S.sensMode, ci: S.ci, custom: S.sensCustom, groups: S.sensGroups, settings: engineSettings() }, extra);
  const rangeText = (i) => { try { const r = Sg.inputRange(i.fn, i.args, S.sensMode === 'custom' ? 'interval' : S.sensMode, S.ci); return r; } catch (e) { return [NaN, NaN]; } };
  const MEASURES = { spearman: "Spearman rank", pearson: 'Pearson product moment', kendall: "Kendall's tau", prcc: 'Partial rank', inputs: 'Spearman, input against input' };
  function renderSens() {
    const r = ui.res, oSel = ui.sensOut || 0;
    const allOuts = r ? r.outputs.map((o, i) => ({ id: 'i' + i, name: o.name, o, kind: 'iter' })).concat(r.runOutputs.map((o, i) => ({ id: 'r' + i, name: o.name + ' (across runs)', o, kind: 'run' }))) : [];
    main().innerHTML = `
      <h2>How much each input drives an output</h2>
      ${!r ? '<p class="muted">Correlations come from a finished run. Run a simulation first.</p>' : allOuts.length ? `
      <div class="grid2">
        <label class="field"><span>Output</span><select id="sOut">${allOuts.map((o) => `<option value="${o.id}" ${o.id === ui.sensId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Measure</span><select id="sM">${Object.entries(MEASURES).map(([k, v]) => `<option value="${k}" ${k === (ui.measure || 'spearman') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div>
      <label class="check small" style="margin-top:8px"><input type="checkbox" id="sNamed" ${ui.namedOnly ? 'checked' : ''}><span>Only inputs named with PSA.SENSINPUT</span></label>
      <div id="sChart" style="margin-top:10px"></div>` : '<p class="muted">The last run recorded no outputs.</p>'}
      <h2>Moving inputs by set amounts</h2>
      <p class="small muted">These hold every other input at its mean and recalculate. They don't use the last run.</p>
      <label class="field"><span>How far to move each input</span><select id="sensMode">
        <option value="sd" ${S.sensMode === 'sd' ? 'selected' : ''}>Plus and minus 1 SD</option>
        <option value="pct" ${S.sensMode === 'pct' ? 'selected' : ''}>Plus and minus 10% of the mean</option>
        <option value="interval" ${S.sensMode === 'interval' ? 'selected' : ''}>${S.ci}% interval of its distribution</option>
        <option value="custom" ${S.sensMode === 'custom' ? 'selected' : ''}>Low and high values I enter</option>
      </select></label>
      <div class="seg" role="group" aria-label="Analysis">${[['tornado', 'One-way tornado'], ['two', 'Two-way table'], ['scen', 'Scenarios']].map(([k, l]) => `<button data-sv="${k}" aria-pressed="${ui.sensView === k}">${l}</button>`).join('')}</div>
      <div id="detBox"></div>
      <div class="notice" id="sensSaved" role="status"></div>`;
    $('sensMode').addEventListener('change', (e) => { S.sensMode = e.target.value; persist(); ui.uni = null; ui.two = null; ui.scen = null; drawDet(); });
    document.querySelectorAll('[data-sv]').forEach((b) => b.addEventListener('click', () => { ui.sensView = b.dataset.sv; document.querySelectorAll('[data-sv]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawDet(); }));
    drawDet();
    if (!ui.scanned && !ui.scanTried && !runner.active) { ui.scanTried = true; scanModel(); }
    if (!r || !allOuts.length) return;
    const draw = () => {
      const pick = allOuts.find((o) => o.id === $('sOut').value) || allOuts[0];
      ui.sensId = pick.id; ui.measure = $('sM').value; ui.namedOnly = $('sNamed').checked;
      let inputs;
      if (pick.kind === 'run') inputs = r.runSensInputs.map((s) => ({ label: s.name, values: s.values }));
      else {
        const named = r.sensInputs.map((s) => ({ label: s.name, values: s.values }));
        inputs = ui.namedOnly ? named : r.inputs.map((i) => ({ label: labelOf(i), values: i.values })).concat(named);
      }
      const box = $('sChart');
      if (!inputs.length) { box.innerHTML = `<p class="muted small">${pick.kind === 'run' ? 'Across-run sensitivity needs inputs named with PSA.RUNSENSINPUT.' : 'No named inputs. Wrap inputs in PSA.SENSINPUT, or untick the box.'}</p>`; return; }
      const y = pick.o.values;
      const usable = inputs.filter((i) => Sg.stats.sd(Sg.stats.clean(i.values)) > 0);
      if (ui.measure === 'inputs') {
        const cols = usable.slice(0, 12);
        box.innerHTML = `<div class="scrollx"><table><thead><tr><th></th>${cols.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody>${cols.map((a, i) => `<tr><td>${i + 1}. ${esc(a.label)}</td>${cols.map((b) => `<td>${Sg.stats.spearman(pairs(a.values, b.values)[0], pairs(a.values, b.values)[1]).toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted" style="margin-top:6px">If any pair sits far from 0, use Partial rank.${usable.length > 12 ? ' Showing the first 12 inputs.' : ''}</p>`;
        return;
      }
      let vals;
      if (ui.measure === 'prcc') {
        const idx = []; for (let k = 0; k < y.length; k++) if (Number.isFinite(y[k]) && usable.every((i) => Number.isFinite(i.values[k]))) idx.push(k);
        vals = Sg.stats.prcc(usable.map((i) => idx.map((k) => i.values[k])), idx.map((k) => y[k]));
      } else {
        const f = Sg.stats[ui.measure];
        vals = usable.map((i) => { const [a, b] = pairs(i.values, y); return f(a, b); });
      }
      const rows = usable.map((i, k) => ({ label: i.label, value: vals[k] })).sort((p, q) => Math.abs(q.value || 0) - Math.abs(p.value || 0));
      const dropped = inputs.length - usable.length;
      box.innerHTML = '<div id="sBars"></div>' + `<p class="small muted" style="margin-top:6px">Teal bars push the output up as the input rises; rust bars push it down. ${dropped ? `${dropped} input${dropped > 1 ? 's' : ''} did not vary and ${dropped > 1 ? 'are' : 'is'} left out.` : ''}</p>`;
      Sg.signedBars($('sBars'), rows, { max: 1 });
    };
    ['sOut', 'sM', 'sNamed'].forEach((id) => $(id).addEventListener('change', draw));
    draw();
  }
  function pairs(x, y) {
    const a = [], b = [], n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { a.push(x[i]); b.push(y[i]); }
    return [a, b];
  }
  function drawDet() {
    const box = $('detBox');
    if (!box) return;
    const inputs = detInputs();
    if (!inputs.length) { box.innerHTML = `<p class="small muted">${ui.scanned ? 'This workbook has no distribution inputs to move.' : 'Reading the inputs in this workbook.'}</p><div class="actions"><button class="btn" id="detScan">Scan workbook</button></div>`; $('detScan').addEventListener('click', scanModel); return; }
    if (ui.sensView === 'two') return drawTwo(box, inputs);
    if (ui.sensView === 'scen') return drawScen(box, inputs);
    return drawTornado(box, inputs);
  }
  // Rows for entering each input's own low and high, and for grouping inputs that should move together.
  function inputTable(inputs) {
    const custom = S.sensMode === 'custom';
    return `<details class="inputs" ${custom ? 'open' : ''}><summary>Input ranges${custom ? '' : ' and groups'}</summary><div class="sensgrid"><span>Input</span><span>Low</span><span>High</span><span>Group</span>${inputs.map((i) => {
      const r = rangeText(i), c = S.sensCustom[i.key] || [], lab = esc(labelOf(i));
      const val = (k) => (custom && Number.isFinite(c[k]) ? c[k] : '');
      const ph = (k) => (Number.isFinite(r[k]) ? +r[k].toPrecision(4) : '');
      return `<span class="lab small">${lab}</span><input type="number" step="any" aria-label="Low value for ${lab}" data-lo="${esc(i.key)}" value="${val(0)}" placeholder="${ph(0)}" ${custom ? '' : 'disabled'}><input type="number" step="any" aria-label="High value for ${lab}" data-hi="${esc(i.key)}" value="${val(1)}" placeholder="${ph(1)}" ${custom ? '' : 'disabled'}><input type="text" aria-label="Group for ${lab}" data-gr="${esc(i.key)}" value="${esc(S.sensGroups[i.key] || '')}">`;
    }).join('')}</div>${custom ? '<p class="small muted" style="margin:6px 0 0">Empty fields use the input\'s interval, shown in grey.</p>' : ''}<p class="small muted" style="margin:6px 0 0">Inputs with the same group name move together as one bar in the tornado.</p></details>`;
  }
  function bindInputTable() {
    const setC = (key, k, v) => { const c = S.sensCustom[key] || (S.sensCustom[key] = [NaN, NaN]); c[k] = v === '' ? NaN : parseFloat(v); ui.uni = null; ui.two = null; ui.scen = null; persist(); };
    document.querySelectorAll('[data-lo]').forEach((f) => f.addEventListener('change', (e) => setC(e.target.dataset.lo, 0, e.target.value)));
    document.querySelectorAll('[data-hi]').forEach((f) => f.addEventListener('change', (e) => setC(e.target.dataset.hi, 1, e.target.value)));
    document.querySelectorAll('[data-gr]').forEach((f) => f.addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) S.sensGroups[e.target.dataset.gr] = v; else delete S.sensGroups[e.target.dataset.gr]; ui.uni = null; persist(); }));
  }
  const rangeWords = () => ({ sd: ['minus 1 SD', 'plus 1 SD'], pct: ['minus 10%', 'plus 10%'], interval: ['at its low value', 'at its high value'], custom: ['at its low value', 'at its high value'] }[S.sensMode]);
  const detLabel = (addr, fn) => ui.labels.get(addr) || `${short(addr)} ${fn.replace(/^Er/, '')}`;

  function drawTornado(box, inputs) {
    box.innerHTML = `${inputTable(inputs)}<div class="actions"><button class="btn" id="uRun">Run tornado</button></div><div id="uOut" style="margin-top:10px"></div>`;
    bindInputTable();
    $('uRun').addEventListener('click', async () => {
      if (runner.active) return;
      setAlert(''); $('uRun').disabled = true; $('uOut').innerHTML = '<p class="muted small" id="uProg">Starting.</p>';
      try {
        ui.uni = await runner.univariate(detOpts({ onProgress: (p) => { const e = $('uProg'); if (e) e.textContent = `Bar ${p.done} of ${p.total}.`; } }));
        ui.uni.words = rangeWords();
        drawUni();
        pushDash();
      } catch (e) { setAlert(e.message || String(e)); $('uOut').innerHTML = ''; }
      finally { if ($('uRun')) $('uRun').disabled = false; }
    });
    if (ui.uni) drawUni();
  }
  function drawUni() {
    const u = ui.uni, box = $('uOut');
    if (!u || !box) return;
    const k = ui.uniOut || 0, w = u.words;
    const rows = u.rows.map((r) => ({ label: r.group || detLabel(r.label, r.fn), low: r.low[k], high: r.high[k], r })).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
    box.innerHTML = `${u.outputs.length > 1 ? `<label class="field" style="margin-bottom:8px"><span>Output</span><select id="uSel">${u.outputs.map((o, i) => `<option value="${i}" ${i === k ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
      <div class="legend"><span><i style="background:var(--rust)"></i>Input ${w[0]}</span><span><i style="background:var(--mark)"></i>Input ${w[1]}</span></div>
      <div id="uBars"></div><p class="small muted" style="margin-top:6px">With every input at its mean, ${esc(u.outputs[k].name)} is ${esc(fmt(u.base[k]))}.</p>
      <div class="scrollx"><table><thead><tr><th>Input</th><th>Low</th><th>High</th><th>Output at low</th><th>Output at high</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.r.group ? 'group' : esc(Sg.fmt(x.r.ranges[0].low))}</td><td>${x.r.group ? 'group' : esc(Sg.fmt(x.r.ranges[0].high))}</td><td>${esc(fmt(x.low))}</td><td>${esc(fmt(x.high))}</td></tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="btn" id="uSheet">Write to a new sheet</button></div>`;
    if ($('uSel')) $('uSel').addEventListener('change', (e) => { ui.uniOut = +e.target.value; drawUni(); });
    Sg.tornado($('uBars'), rows, u.base[k]);
    $('uSheet').addEventListener('click', () => writeSens(() => {
      const out = [['One-way sensitivity', ''], ['Output', 'With all inputs at their means']];
      u.outputs.forEach((o, i) => out.push([safeText(o.name), u.base[i]]));
      out.push([], ['Input', 'Group', 'Low value', 'High value'].concat(u.outputs.flatMap((o) => [`${safeText(o.name)} at low`, `${safeText(o.name)} at high`])));
      u.rows.forEach((r) => r.ranges.forEach((g, gi) => out.push([safeText(detLabel(g.addr, g.fn)), safeText(r.group || ''), g.low, g.high].concat(gi === 0 ? u.outputs.flatMap((_, i) => [r.low[i], r.high[i]]) : []))));
      return out;
    }));
  }
  function drawTwo(box, inputs) {
    if (!inputs.some((i) => i.key === ui.twoA)) ui.twoA = inputs[0].key;
    if (!inputs.some((i) => i.key === ui.twoB) || ui.twoB === ui.twoA) ui.twoB = (inputs.find((i) => i.key !== ui.twoA) || inputs[0]).key;
    if (inputs.length < 2) { box.innerHTML = '<p class="small muted">A two-way table needs at least two inputs.</p>'; return; }
    const opt = (sel) => inputs.map((i) => `<option value="${esc(i.key)}" ${i.key === sel ? 'selected' : ''}>${esc(labelOf(i))}</option>`).join('');
    box.innerHTML = `${inputTable(inputs)}<div class="stack" style="margin-top:8px">
      <label class="field"><span>Input across</span><select id="tA">${opt(ui.twoA)}</select></label>
      <label class="field"><span>Input up</span><select id="tB">${opt(ui.twoB)}</select></label>
      <label class="field"><span>Values per input</span><select id="tS">${[3, 5, 7, 11, 21].map((n) => `<option ${n === (ui.twoSteps || 5) ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="actions"><button class="btn" id="tRun">Run two-way table</button></div><div id="tOut" style="margin-top:10px"></div>`;
    bindInputTable();
    $('tA').addEventListener('change', (e) => { ui.twoA = e.target.value; ui.two = null; drawDet(); });
    $('tB').addEventListener('change', (e) => { ui.twoB = e.target.value; ui.two = null; drawDet(); });
    $('tS').addEventListener('change', (e) => { ui.twoSteps = +e.target.value; ui.two = null; });
    $('tRun').addEventListener('click', async () => {
      if (runner.active) return;
      setAlert(''); $('tRun').disabled = true; $('tOut').innerHTML = '<p class="muted small" id="tProg">Starting.</p>';
      try {
        ui.two = await runner.twoWay(detOpts({ a: ui.twoA, b: ui.twoB, steps: ui.twoSteps || 5, onProgress: (p) => { const e = $('tProg'); if (e) e.textContent = `${p.done} of ${p.total} combinations.`; } }));
        drawTwoResult();
        pushDash();
      } catch (e) { setAlert(e.message || String(e)); $('tOut').innerHTML = ''; }
      finally { if ($('tRun')) $('tRun').disabled = false; }
    });
    if (ui.two) drawTwoResult();
  }
  function drawTwoResult() {
    const t = ui.two, box = $('tOut');
    if (!t || !box) return;
    const k = ui.twoOut || 0, vals = t.grid.map((row) => row.map((c) => c[k])), la = detLabel(t.a.addr, t.a.fn), lb = detLabel(t.b.addr, t.b.fn);
    box.innerHTML = `${t.outputs.length > 1 ? `<label class="field" style="margin-bottom:8px"><span>Output</span><select id="tSel">${t.outputs.map((o, i) => `<option value="${i}" ${i === k ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
      <div class="legend"><span><i style="background:var(--rust)"></i>Below the base case</span><span><i style="background:var(--mark)"></i>Above it</span></div>
      <div id="tMap"></div><p class="small muted" style="margin-top:4px">${esc(la)} across, ${esc(lb)} up. With every input at its mean, ${esc(t.outputs[k].name)} is ${esc(fmt(t.base[k]))}.</p>
      <div class="scrollx"><table><thead><tr><th></th>${t.xs.map((x) => `<th>${esc(Sg.fmt(x))}</th>`).join('')}</tr></thead><tbody>${t.ys.map((y, j) => `<tr><td>${esc(Sg.fmt(y))}</td>${vals[j].map((v) => `<td>${esc(fmt(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="btn" id="tSheet">Write to a new sheet</button></div>`;
    if ($('tSel')) $('tSel').addEventListener('change', (e) => { ui.twoOut = +e.target.value; drawTwoResult(); });
    Sg.heatmap($('tMap'), { xs: t.xs, ys: t.ys, values: vals, base: t.base[k] });
    $('tSheet').addEventListener('click', () => writeSens(() => {
      const out = [['Two-way sensitivity', ''], ['Across', safeText(la)], ['Up', safeText(lb)]];
      t.outputs.forEach((o, i) => { out.push([], [safeText(o.name), 'Base', t.base[i]], [''].concat(t.xs)); t.ys.forEach((y, j) => out.push([y].concat(t.grid[j].map((c) => c[i])))); });
      return out;
    }));
  }
  function drawScen(box, inputs) {
    const list = S.scenarios;
    box.innerHTML = `${inputTable(inputs)}<div class="actions"><button class="btn" id="scAdd">Add scenario</button><button class="btn" id="scLow">Add all low</button><button class="btn" id="scHigh">Add all high</button></div>
      <div id="scList" style="margin-top:8px">${list.map((sc, n) => `<details class="inputs" open><summary>${esc(sc.name) || 'Unnamed scenario'}</summary>
        <div class="actions" style="margin:6px 0"><label class="field" style="flex:1"><span>Name</span><input type="text" data-scname="${n}" value="${esc(sc.name)}"></label><button class="btn" data-scdel="${n}" style="align-self:flex-end">Remove</button></div>
        ${inputs.map((i) => `<div class="inputrow"><div class="lab small">${esc(labelOf(i))}</div><select data-sc="${n}" data-key="${esc(i.key)}" aria-label="${esc(labelOf(i))} in ${esc(sc.name)}">${[['mean', 'Mean'], ['low', 'Low'], ['high', 'High']].map(([k, l]) => `<option value="${k}" ${(sc.set[i.key] || 'mean') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')}</details>`).join('')}</div>
      ${list.length ? '<div class="actions"><button class="btn primary" id="scRun" style="flex:none">Run scenarios</button></div>' : '<p class="small muted">Add a scenario to set chosen inputs to their low or high values, leaving the rest at their means.</p>'}
      <div id="scOut" style="margin-top:10px"></div>`;
    bindInputTable();
    const add = (name, how) => { const set = {}; if (how) inputs.forEach((i) => { set[i.key] = how; }); list.push({ name, set }); ui.scen = null; persist(); drawDet(); };
    $('scAdd').addEventListener('click', () => add(`Scenario ${list.length + 1}`));
    $('scLow').addEventListener('click', () => add('All inputs low', 'low'));
    $('scHigh').addEventListener('click', () => add('All inputs high', 'high'));
    document.querySelectorAll('[data-scname]').forEach((f) => f.addEventListener('change', (e) => { list[+e.target.dataset.scname].name = e.target.value.trim() || 'Scenario'; ui.scen = null; persist(); drawDet(); }));
    document.querySelectorAll('[data-scdel]').forEach((f) => f.addEventListener('click', (e) => { list.splice(+e.target.dataset.scdel, 1); ui.scen = null; persist(); drawDet(); }));
    document.querySelectorAll('[data-sc]').forEach((f) => f.addEventListener('change', (e) => { const s = list[+e.target.dataset.sc]; if (e.target.value === 'mean') delete s.set[e.target.dataset.key]; else s.set[e.target.dataset.key] = e.target.value; ui.scen = null; persist(); }));
    if ($('scRun')) $('scRun').addEventListener('click', async () => {
      if (runner.active) return;
      setAlert(''); $('scRun').disabled = true;
      try { ui.scen = await runner.scenarios(detOpts({ list })); drawScenResult(); pushDash(); }
      catch (e) { setAlert(e.message || String(e)); }
      finally { if ($('scRun')) $('scRun').disabled = false; }
    });
    if (ui.scen) drawScenResult();
  }
  function drawScenResult() {
    const r = ui.scen, box = $('scOut');
    if (!r || !box) return;
    box.innerHTML = `<div class="scrollx"><table><thead><tr><th>Scenario</th>${r.outputs.map((o) => `<th>${esc(o.name)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>All inputs at their means</td>${r.base.map((v) => `<td>${esc(fmt(v))}</td>`).join('')}</tr>
      ${r.rows.map((x) => `<tr><td>${esc(x.name)}</td>${x.values.map((v) => `<td>${esc(fmt(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="btn" id="scSheet">Write to a new sheet</button></div>`;
    $('scSheet').addEventListener('click', () => writeSens(() => [['Scenarios'], ['Scenario'].concat(r.outputs.map((o) => safeText(o.name))), ['All inputs at their means'].concat(r.base)].concat(r.rows.map((x) => [safeText(x.name)].concat(x.values)))));
  }
  async function writeSens(build) {
    try { await host.writeSheet('PSAkit sensitivity', build().map((row) => row.map((v) => (typeof v === 'number' && !Number.isFinite(v) ? 'n/a' : v))), {}); $('sensSaved').textContent = 'Wrote this analysis to the sheet "PSAkit sensitivity".'; }
    catch (e) { setAlert('Could not write the sheet: ' + (e.message || e)); }
  }

  // ---- Model and settings ------------------------------------------------------------------------
  function renderModel() {
    const sc = ui.scanned;
    main().innerHTML = `
      <div class="actions" style="margin-top:0"><button class="btn" id="scan">Scan workbook</button></div>
      <p class="small muted" id="scanInfo" style="margin-top:6px">${sc ? `${sc.inputs.length} random inputs, ${sc.outputs.length} outputs, ${sc.runOutputs.length} per-run outputs, ${sc.masters.length} master functions.${sc.setItno ? ` PSA.SETITNO sets ${sc.setItno} iterations.` : ''}` : 'Scan to list the inputs and outputs in this workbook.'}</p>
      <h2>Runs</h2>
      <label class="check"><input type="checkbox" id="multi" ${S.multi ? 'checked' : ''}><span>Multiple runs. Use this for microsimulation or age-group models. PSA.RUNOUTPUT collects one value per run.</span></label>
      <h2>Random numbers</h2>
      <div class="stack">
        <label class="field"><span>Generator</span><select id="rng">${Object.entries(Sg.RNGS).map(([k, v]) => `<option value="${k}" ${k === S.rng ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Seed (optional)</span><input type="text" inputmode="numeric" id="seed" value="${esc(S.seed)}" placeholder="New random seed each run"></label>
        <p class="small muted" style="margin:0">Each cell has its own random stream, so the same seed gives the same draws in every cell even if Excel changes its calculation order. Comparing two model versions on one seed uses common random numbers.</p>
      </div>
      <h2>Display</h2>
      <div class="stack">
        <label class="check"><input type="checkbox" id="showMeans" ${S.showMeans ? 'checked' : ''}><span>Show mean values while not running. Otherwise cells draw a new value on each recalculation.</span></label>
        <label class="check"><input type="checkbox" id="hideScreen" ${S.hideScreen ? 'checked' : ''}><span>Pause screen updates while running, which is faster</span></label>
        <div class="grid2">
          <label class="field"><span>Confidence interval (%)</span><input type="number" id="ci" min="50" max="99" value="${S.ci}"></label>
          <label class="field"><span>Decimals in results</span><select id="decimals"><option value="auto">Automatic</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => `<option value="${d}" ${String(S.decimals) === String(d) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        </div>
      </div>
      <h2>Calculation</h2>
      <div class="stack">
        <label class="field"><span>How to calculate each iteration</span><select id="speed"><option value="fast" ${S.speed !== 'excel' ? 'selected' : ''}>Compile the model (fastest)</option><option value="excel" ${S.speed === 'excel' ? 'selected' : ''}>Recalculate the workbook in Excel</option></select></label>
        <label class="check"><input type="checkbox" id="check" ${S.check ? 'checked' : ''}><span>Before each run, check compiled results against Excel on 5 sets of draws, and use Excel if they differ</span></label>
        <label class="field"><span>PSA.TRUNCATE tries before #NUM!</span><input type="number" id="maxTruncate" min="1" value="${S.maxTruncate}"></label>
        <label class="check"><input type="checkbox" id="useSetItno" ${S.useSetItno ? 'checked' : ''}><span>Let PSA.SETITNO set the number of iterations</span></label>
      </div>
      <h2>Conditional firing</h2>
      <label class="check"><input type="checkbox" id="condOn" ${S.conditionalOn ? 'checked' : ''}><span>Limit how often inputs draw a new value</span></label>
      <div id="condBox" ${S.conditionalOn ? '' : 'hidden'} style="margin-top:8px">
        <label class="field"><span>Default for all inputs</span><select id="condDefault">${condOpts(S.condDefault)}</select></label>
        <div id="condList" style="margin-top:8px"></div>
      </div>`;
    if ($('decimals').value !== String(S.decimals)) $('decimals').value = String(S.decimals);
    $('scan').addEventListener('click', scanModel);
    const bindCheck = (id, key, after) => $(id).addEventListener('change', (e) => { S[key] = e.target.checked; persist(); if (after) after(); });
    const bindVal = (id, key, cast) => $(id).addEventListener('change', (e) => { S[key] = cast ? cast(e.target.value) : e.target.value; persist(); });
    bindCheck('multi', 'multi', syncRunBar);
    bindCheck('showMeans', 'showMeans', async () => { engine.settings.showMeans = S.showMeans; if (!runner.active) { try { await host.calculate(); } catch (e) { /* ignore */ } } });
    bindCheck('hideScreen', 'hideScreen');
    bindCheck('useSetItno', 'useSetItno');
    bindCheck('check', 'check');
    $('speed').addEventListener('change', (e) => { S.speed = e.target.value; persist(); });
    bindCheck('condOn', 'conditionalOn', () => { $('condBox').hidden = !S.conditionalOn; drawCond(); });
    bindVal('rng', 'rng'); bindVal('seed', 'seed', (v) => v.trim());
    $('ci').addEventListener('change', (e) => { S.ci = Math.max(50, Math.min(99, +e.target.value || 95)); e.target.value = S.ci; if (ui.res) ui.res.ci = S.ci; persist(); });
    bindVal('decimals', 'decimals'); bindVal('maxTruncate', 'maxTruncate', (v) => Math.max(1, Math.floor(+v) || 10));
    bindVal('condDefault', 'condDefault');
    drawCond();
  }
  const condOpts = (sel) => [['every', 'Every iteration'], ['once', 'Once per run'], ['none', 'Never: use the mean']].map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  function drawCond() {
    const box = $('condList');
    if (!box || !S.conditionalOn) return;
    const sc = ui.scanned;
    if (!sc) { box.innerHTML = '<p class="small muted">Scan the workbook to set this for individual inputs.</p>'; return; }
    const rows = sc.inputs.concat(sc.masters.map((m) => ({ key: `${m.addr}|${m.fn}`, addr: m.addr, fn: m.fn })));
    box.innerHTML = rows.map((i, k) => `<div class="inputrow"><div class="lab small">${esc(labelOf(i))}</div><select data-k="${esc(i.key)}" aria-label="Firing for ${esc(labelOf(i))}">${condOpts(S.conditional[i.key] || S.condDefault)}</select></div>`).join('');
    box.querySelectorAll('select').forEach((s) => s.addEventListener('change', (e) => { S.conditional[e.target.dataset.k] = e.target.value; persist(); }));
  }
  async function scanModel() {
    setAlert('');
    if (runner.active) return;
    try {
      await host.setManual(true);
      ui.scanned = await runner.inspect(engineSettings());
      await resolveLabels(ui.scanned.inputs);
      await host.calculate();
      if (ui.scanned.minimizers.length && !ui.scanned.minimizers.includes(S.optimName)) S.optimName = ui.scanned.minimizers[0];
    } catch (e) { setAlert(e.message || String(e)); }
    finally { try { await host.setManual(false); } catch (e) { /* ignore */ } }
    TABS[ui.tab]();
  }

  // ---- Optimise ------------------------------------------------------------------------------
  const OPT_HELP = {
    quasiNewton: 'Fastest on smooth problems. Do not use it on a noisy loss, such as the Run option usually gives.',
    downhill: 'Slower than Quasi-Newton but more robust. Tick Noisy optimisation when the loss jumps around.',
    annealing: 'For a loss with several local minima. It uses a lot of evaluations, so try Cross-Entropy first.',
    crossEntropy: 'For a loss with local minima or noise. Follow it with Down-hill Simplex for more precision.',
  };
  function renderOptim() {
    const sc = ui.scanned, names = sc ? sc.minimizers : [], res = ui.res && ui.res.optim, method = S.optimMethod, def = Sg.OPTIMIZERS[method];
    const vals = Object.assign(Sg.optimizerDefaults(method), S.optimOptions[method] || {});
    const fields = def.options.map(([k, label, d]) => {
      if (typeof d === 'boolean') return `<label class="check" style="grid-column:1/-1"><input type="checkbox" data-opt="${k}" ${vals[k] ? 'checked' : ''}><span>${esc(label)}</span></label>`;
      const off = k === 'noiseTolerance' && !vals.noisy;
      return `<label class="field"><span>${esc(label)}</span><input type="number" step="any" data-opt="${k}" value="${vals[k]}" ${off ? 'disabled' : ''}></label>`;
    }).join('');
    main().innerHTML = `
      <h2>Fit parameters by minimising a loss</h2>
      <p class="small muted">Pair PSA.MINIMIZE, which holds the parameters, with PSA.MINIMIZERESULT, which holds the loss. Usually the loss is a sum of squared differences from your targets.</p>
      <label class="check"><input type="checkbox" id="oOn" ${S.optimOn ? 'checked' : ''}><span>Optimise on the next run</span></label>
      <div class="stack" style="margin-top:8px">
        <label class="field"><span>Optimiser name in the workbook</span>
          ${names.length ? `<select id="oName">${names.map((n) => `<option ${n === S.optimName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input type="text" id="oName" value="${esc(S.optimName)}" placeholder="Type it, or scan the workbook">`}
        </label>
        <div class="actions" style="margin-top:0"><button class="btn" id="oScan">Scan workbook</button></div>
        <fieldset class="plain"><legend class="small muted">Fit</legend>
          <label class="check"><input type="radio" name="oEach" value="iteration" ${S.optimEach === 'iteration' ? 'checked' : ''}><span>Each iteration: draw the inputs, hold them, fit, then record the outputs. This gives a distribution of fits.</span></label>
          <label class="check"><input type="radio" name="oEach" value="run" ${S.optimEach === 'run' ? 'checked' : ''}><span>Each run: every loss evaluation is a whole run. The optimiser decides how many runs happen, and usually the loss is noisy.</span></label>
        </fieldset>
        ${S.optimEach === 'iteration' ? `<label class="check"><input type="checkbox" id="oFirst" ${S.optimFirst ? 'checked' : ''}><span>Fit on the first iteration only, and use that result for the rest</span></label>` : ''}
        <label class="field"><span>Method</span><select id="oMethod">${Object.entries(Sg.OPTIMIZERS).map(([k, v]) => `<option value="${k}" ${k === method ? 'selected' : ''}>${esc(v.label)} (${v.kind})</option>`).join('')}</select></label>
        <p class="small muted" style="margin:0">${esc(OPT_HELP[method])}</p>
        <div class="grid2">${fields}<label class="field"><span>Restarts from the result</span><input type="number" id="oRestarts" min="0" max="10" value="${S.optimRestarts}"></label></div>
        <div class="actions" style="margin-top:0"><button class="btn" id="oReset">Reset to defaults</button></div>
      </div>
      ${res ? (res.perIteration && !res.x ? `<h2>Result: ${esc(res.name)}</h2><p class="small">Fitted ${ui.res.completed.toLocaleString()} iterations with ${res.evals.toLocaleString()} loss evaluations. The fits are in your outputs on the Results tab.</p>` : `<h2>Best result: ${esc(res.name)}</h2>
        <p class="small">${res.perIteration ? `Last iteration's fit, from ${res.evals.toLocaleString()} evaluations across the run.` : `${res.converged ? 'Stopped by its own criterion' : 'Stopped early'} after ${res.evals.toLocaleString()} evaluations. The best values are now in the PSA.MINIMIZE cells.`}</p>
        <div class="scrollx"><table><tbody><tr><td>Loss</td><td>${esc(fmt(res.loss))}</td></tr>${(res.x || []).map((v, i) => `<tr><td>Parameter ${i + 1}</td><td>${esc(Sg.fmt(v))}</td></tr>`).join('')}</tbody></table></div>
        <h2>Best loss so far</h2><div id="oTrace"></div>`) : ''}`;
    $('oOn').addEventListener('change', (e) => { S.optimOn = e.target.checked; persist(); syncRunBar(); });
    $('oName').addEventListener('change', (e) => { S.optimName = e.target.value; persist(); });
    if (names.length && !S.optimName) S.optimName = names[0];
    $('oScan').addEventListener('click', scanModel);
    $('oMethod').addEventListener('change', (e) => { S.optimMethod = e.target.value; persist(); renderOptim(); });
    document.querySelectorAll('input[name=oEach]').forEach((r) => r.addEventListener('change', (e) => { S.optimEach = e.target.value; persist(); renderOptim(); }));
    if ($('oFirst')) $('oFirst').addEventListener('change', (e) => { S.optimFirst = e.target.checked; persist(); });
    $('oRestarts').addEventListener('change', (e) => { S.optimRestarts = Math.max(0, Math.min(10, Math.floor(+e.target.value) || 0)); e.target.value = S.optimRestarts; persist(); });
    $('oReset').addEventListener('click', () => { delete S.optimOptions[method]; S.optimRestarts = 0; persist(); renderOptim(); });
    document.querySelectorAll('[data-opt]').forEach((f) => f.addEventListener('change', (e) => {
      const o = (S.optimOptions[method] = S.optimOptions[method] || {}), k = e.target.dataset.opt;
      if (e.target.type === 'checkbox') { o[k] = e.target.checked; persist(); renderOptim(); return; }
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v > 0) o[k] = v; else e.target.value = vals[k];
      persist();
    }));
    if (res && res.trace && $('oTrace')) Sg.lineChart($('oTrace'), res.trace.filter(Number.isFinite), { xLabel: 'evaluations', height: 140 });
  }

  // ---- Tools ---------------------------------------------------------------------------------
  function renderTools() {
    main().innerHTML = `
      <h2>Convert Ersatz workbooks</h2>
      <p class="small muted">Changes Ersatz formulas like =ErNormal(0,1), and formulas from the earlier prototype like =ER.ERNORMAL(0,1), to =PSA.NORMAL(0,1) throughout this workbook. Check them afterwards. Save an .xls file as .xlsx first, and keep a copy of the original.</p>
      <div class="actions" style="margin-top:0"><button class="btn" id="conv">Convert formulas</button></div>
      <div class="notice" id="convMsg" role="status"></div>
      <h2>Example model</h2>
      <p class="small muted">Adds a sheet with a small cost-effectiveness model, using invented numbers, that you can run straight away.</p>
      <div class="actions" style="margin-top:0"><button class="btn" id="ex">Insert example model</button></div>
      <div class="notice" id="exMsg" role="status"></div>
      <h2>Distribution viewer</h2>
      <label class="field"><span>Distribution</span><select id="dName">${Object.keys(Sg.DISTS).filter((n) => !Sg.DISTS[n].custom).map((n) => `<option value="${n}" ${n === (ui.dName || 'ErGamma') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="grid2" id="dParams" style="margin-top:8px"></div>
      <div id="dChart" style="margin-top:10px"></div><p class="small" id="dInfo" style="margin-top:4px"></p>
      <h2>Check a correlation matrix</h2>
      <p class="small muted">Paste the matrix from Excel. Only the lower triangle is used, as in the worksheet functions.</p>
      <textarea id="mx" rows="4" aria-label="Matrix" placeholder="1&#9;&#9;&#10;0.9&#9;1&#9;&#10;-0.9&#9;0.9&#9;1"></textarea>
      <div class="actions"><label class="check small" style="align-self:center"><input type="checkbox" id="mxCov"><span>This is a covariance matrix</span></label><button class="btn" id="mxGo">Check matrix</button></div>
      <div id="mxOut" class="small" style="margin-top:6px"></div>
      <h2>Messages</h2><div id="log" class="small muted"></div>`;
    $('log').innerHTML = ui.logHtml || '';
    new MutationObserver(() => { ui.logHtml = $('log') ? $('log').innerHTML : ui.logHtml; }).observe($('log'), { childList: true });
    $('conv').addEventListener('click', async () => {
      setAlert('');
      try {
        const r = await host.convertLegacy();
        $('convMsg').textContent = r.changed ? `Converted ${r.changed} formula${r.changed === 1 ? '' : 's'}${r.cleared ? `, and merged ${r.cleared} array cells into spilling formulas` : ''}. Check any #SPILL! cells, which need empty cells below them.` : 'Found no old Ersatz formulas in this workbook.';
      } catch (e) { setAlert('Could not convert formulas: ' + (e.message || e)); }
    });
    $('ex').addEventListener('click', async () => {
      setAlert('');
      try {
        await host.writeSheet(Sg.EXAMPLE_NAME, Sg.EXAMPLE_ROWS, { boldRows: [[0, 1], [2, 4], [15, 2], [21, 2]] });
        $('exMsg').textContent = `Added the sheet "${Sg.EXAMPLE_NAME}". Press Run simulation.`;
      } catch (e) { setAlert('Could not add the example: ' + (e.message || e)); }
    });
    $('dName').addEventListener('change', (e) => { ui.dName = e.target.value; ui.dArgs = null; drawDist(); });
    drawDist();
    $('mxGo').addEventListener('click', checkMatrix);
  }
  const VIEW_DEFAULTS = { ErBernoulli: [0.73], ErBeta: [5, 1.5], ErBeta4: [2, 2.5, -1.5, 8.1], ErBinomial: [8, 0.3], ErChi2: [3], ErDelaporte: [2.9, 3.1, 1.1], ErDice: [6], ErErlang: [2, 1.3], ErExponential: [6], ErGamma: [3, 1.5], ErGeometric: [0.6], ErHypergeometric: [11, 5, 25], ErInverseGaussian: [2.3, 5.7], ErLogistic: [3.7, 1.3], ErLoglogistic: [2.1, 1.7], ErLognormal: [4, 1], ErLognormal2: [1.2, 0.4], ErNegbinomial: [5, 0.5], ErNormal: [18, 3], ErPareto: [3, 2], ErPearson5: [3.6, 2.1], ErPearson6: [2.9, 3.1, 1.1], ErPert: [2.1, 3.7, 4.6], ErPoisson: [2.3], ErPolya: [1.7, 1.353], ErRayleigh: [4.2], ErRelativeRisk: [2.5, 0.1], ErStudentst: [2.5], ErTriangle: [1.9, 3.1, 4.05], ErUniform01: [], ErUniform: [2, 9], ErWeibull: [5.9, 2.1] };
  function drawDist() {
    const name = ui.dName || 'ErGamma', d = Sg.DISTS[name];
    if (!ui.dArgs) ui.dArgs = VIEW_DEFAULTS[name].slice();
    $('dParams').innerHTML = d.params.map((p, i) => `<label class="field"><span>${esc(p)}</span><input type="number" step="any" data-i="${i}" value="${ui.dArgs[i]}"></label>`).join('');
    $('dParams').querySelectorAll('input').forEach((inp) => inp.addEventListener('change', (e) => { ui.dArgs[+e.target.dataset.i] = parseFloat(e.target.value); plotDist(); }));
    plotDist();
  }
  function plotDist() {
    const name = ui.dName || 'ErGamma', d = Sg.DISTS[name], a = ui.dArgs;
    if (a.some((v) => !Number.isFinite(v)) || !d.check(a)) {
      $('dChart').innerHTML = ''; $('dInfo').textContent = 'These parameters are out of range, so this function would return #NUM!.'; return;
    }
    const u = Sg.RNGS.fast.make(2024), v = new Float64Array(20000);
    for (let i = 0; i < v.length; i++) v[i] = d.sample(u, a);
    const sorted = Float64Array.from(v).sort(), clipHi = Sg.stats.percentile(sorted, 99.5), clipLo = Sg.stats.percentile(sorted, 0.5);
    const shown = Array.from(v).filter((x) => x >= clipLo && x <= clipHi), m = d.mean(a), s = d.sd(a);
    Sg.histogram($('dChart'), shown, { height: 150, mean: Number.isFinite(m) ? m : undefined, bins: d.discrete && clipHi - clipLo <= 40 ? Math.max(1, clipHi - clipLo + 1) : undefined });
    $('dInfo').textContent = `Mean ${Number.isFinite(m) ? Sg.fmt(m) : 'undefined'}, SD ${Number.isFinite(s) ? Sg.fmt(s) : 'undefined'}. From 20,000 draws, showing the central 99%.`;
  }
  function checkMatrix() {
    const box = $('mxOut'), lines = $('mx').value.trim().split(/\r?\n/).map((l) => l.split(/[\t,; ]+/).filter((x) => x !== '').map(Number));
    const n = lines.length;
    if (!n || lines.some((l) => l.some(Number.isNaN))) { box.textContent = 'Could not read that as numbers. Paste a square or lower-triangular block of cells.'; return; }
    const A = []; 
    for (let i = 0; i < n; i++) { A.push(new Array(n)); for (let j = 0; j < n; j++) { const v = i >= j ? lines[i][j] : lines[j][i]; if (v === undefined) { box.textContent = `Row ${Math.max(i, j) + 1} is too short for a ${n} by ${n} matrix.`; return; } A[i][j] = v; } }
    const r = Sg.checkMatrix(A, $('mxCov').checked);
    if (r.valid) { box.textContent = 'This matrix is valid.'; return; }
    const text = r.suggestion.map((row) => row.map((v) => +v.toFixed(4)).join('\t')).join('\n');
    box.innerHTML = `<p>This matrix is not valid: its lowest eigenvalue is ${r.minEigen.toFixed(4)}. The closest valid matrix found by shifting that eigenvalue is below. Copy it into your sheet.</p><textarea rows="${n + 1}" readonly aria-label="Suggested matrix">${esc(text)}</textarea>`;
  }

  // ---- Start up ------------------------------------------------------------------------------
  Sg.startPane = async function (hostImpl) {
    host = hostImpl;
    engine = Sg.engine = Sg.engine || new Sg.Engine();
    runner = new Sg.Runner(engine, host);
    Sg.pane = { selectTab, ui, get S() { return S; }, reportText, reportModel, runnerOpts: (o) => Object.assign(runner.opts, o) };
    try { const saved = await host.loadSettings(); if (saved) S = Object.assign({}, D, saved, { conditional: saved.conditional || {}, optimOptions: saved.optimOptions || {}, sensCustom: saved.sensCustom || {}, sensGroups: saved.sensGroups || {}, scenarios: saved.scenarios || [] }); } catch (e) { /* defaults are fine */ }
    if (!Sg.OPTIMIZERS[S.optimMethod]) S.optimMethod = 'downhill';
    engine.settings = Object.assign(engine.settings, engineSettings());
    host.hideScreen = S.hideScreen;
    syncRunBar();
    $('iterations').addEventListener('change', (e) => { S.iterations = Math.max(1, Math.floor(+e.target.value) || 1000); e.target.value = S.iterations; persist(); });
    $('runs').addEventListener('change', (e) => { S.runs = Math.max(1, Math.floor(+e.target.value) || 1); e.target.value = S.runs; persist(); });
    $('run').addEventListener('click', onRun);
    const tabs = [...document.querySelectorAll('.tabs button')];
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => selectTab(b.dataset.tab));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); selectTab(n.dataset.tab); }
      });
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!runner.active) TABS[ui.tab](); }, 150); });
    selectTab('results');
    try {
      const sc = await runner.scan();
      if (sc.legacy.length) setAlert(`This workbook has ${sc.legacy.length} Ersatz or prototype formulas. Convert them on the Tools tab before running.`);
    } catch (e) { /* workbook not ready yet; a run will report any problem */ }
  };
  if (globalThis.Office && Office.onReady) {
    Office.onReady((info) => {
      if (!info || !info.host) { $('status').textContent = 'Open this page from inside Excel, using the PSAkit button on the Data tab.'; return; }
      try { Office.addin.setStartupBehavior(Office.StartupBehavior.load); } catch (e) { /* older hosts */ }
      if (typeof Worker !== 'undefined') Sg.makeWorker = () => new Worker('../engine/worker.js');
      Sg.startPane(new Sg.ExcelHost());
    });
  }
})(globalThis.Sg = globalThis.Sg || {});
