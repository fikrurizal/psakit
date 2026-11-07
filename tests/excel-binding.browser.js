// Loads the real taskpane.html in Chromium with a stand-in for office.js, so functions.js, excel-host.js and
// taskpane.js run exactly as shipped, calling worksheet functions through CustomFunctions.associate and
// the workbook through an Excel.run-shaped API. Run with: node tests/excel-binding.browser.js
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.join(__dirname, '..');
const stub = `
window.__assoc = {};
window.CustomFunctions = {
  ErrorCode: { invalidValue: '#VALUE!', invalidNumber: '#NUM!' },
  Error: class { constructor(code, msg) { this.code = code; this.message = msg; } },
  associate(id, fn) { if (window.__assoc[id]) throw new Error('duplicate ' + id); window.__assoc[id] = fn; },
};
window.__settings = {};
window.__hostileModel = () => {
  const bad = '</script><img src=x onerror=alert(1)><script>alert(2)</script>';
  const s = { n: 100, failed: 0, se: 0.1, mean: 1, sd: 1, median: 1, lo: 0, hi: 2, min: -1, max: 3 };
  const out = { name: bad, s, bins: [[0, 1, 50], [1, 2, 50]], conv: [1, 1, 1], convN: 100, sens: { rows: [{ label: bad, value: 0.5 }], more: 2 } };
  return { title: bad, decimals: null, generated: new Date().toISOString(), version: '0', ci: 95, note: bad, completed: 100, N: 100, R: 2, cancelled: true, seed: bad, rng: bad, showingRun: 2,
    outputs: [out, { name: 'Failed', s: { n: 100, failed: 3, mean: null }, bins: [], conv: [], convN: 0 }], runOutputs: [out],
    errors: [{ fn: bad, addr: bad, count: 3, iteration: 2, run: 1 }],
    optim: { name: bad, method: bad, evals: 9, converged: true, loss: 1, x: [1, 2], trace: [3, 2, 1] },
    ce: { cost: bad, effect: bad, wtp: 1, top: 2, mc: 1, me: 1, icer: 1, mean: 0, p: 0.5, evpi: 0.1, curve: [0, 0.5, 1], dc: [1, 2], de: [1, 2] },
    uni: { words: ['low', 'high'], outputs: [bad], base: [1], rows: [{ label: bad, lo: 0, hi: 1, low: [0], high: [2] }, { label: 'Fails', lo: 0, hi: 1, low: [null], high: [2] }] },
    two: { a: bad, b: bad, outputs: [bad], base: [1], xs: [0, 1], ys: [0, 1], grid: [[[0], [1]], [[1], [null]]] },
    scen: { outputs: [bad], base: [1], rows: [{ name: bad, values: [null] }] } };
};
window.__isDialog = window.name === 'surrogate-dialog';
window.Office = {
  StartupBehavior: { load: 'load' }, addin: { setStartupBehavior() { window.__startup = true; } },
  EventType: { DialogMessageReceived: 'msg', DialogEventReceived: 'evt', DialogParentMessageReceived: 'parent' },
  AsyncResultStatus: { Succeeded: 'succeeded' },
  context: { requirements: { isSetSupported: () => true }, ui: {
    // A stand-in for Excel's dialog: a real page in an iframe, joined to the pane only by text messages.
    displayDialogAsync(url, opts, cb) {
      const f = document.createElement('iframe'); f.name = 'surrogate-dialog'; f.id = 'dlg'; f.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:800px;background:white;z-index:50'; f.src = url;
      document.body.appendChild(f);
      const dialog = { handlers: {}, addEventHandler(t, h) { this.handlers[t] = h; }, messageChild(m) { window.__dialogBytes = Math.max(window.__dialogBytes || 0, m.length); f.contentWindow.__parentHandler({ message: m }); }, close() { f.remove(); } };
      window.__dialog = dialog;
      cb({ status: 'succeeded', value: dialog });
    },
    messageParent(m) { window.parent.__dialog.handlers.msg({ message: m }); },
    addHandlerAsync(t, h, cb) { window.__parentHandler = h; cb && cb({ status: 'succeeded' }); },
  }, document: { settings: { get: (k) => window.__settings[k], set: (k, v) => { window.__settings[k] = v; }, saveAsync: (cb) => cb() } } },
  onReady(cb) { window.addEventListener('load', () => cb({ host: 'Excel' })); },
};
window.__calcs = 0; window.__modeLog = [];
function backing() {
  if (window.__X) return window.__X;
  const X = new Sg.FakeExcel(Sg.engine);
  X.callCustom = (name, addr, args) => {
    const r = window.__assoc[name.toUpperCase()](...args, { address: addr.includes(' ') ? "'" + addr.replace('!', "'!") : addr });
    return r;
  };
  window.__X = X;
  return X;
}
class Range {
  constructor(sheet, ref) { this.sheet = sheet; this.ref = ref; this.format = { font: {}, autofitColumns() {} }; }
  load() {}
  get values() { const v = backing().values.get(this.sheet + '!' + this.ref); const raw = v === undefined ? backing().sheet(this.sheet).get(this.ref) : v; return [[raw && raw.code ? raw.code : raw === undefined ? '' : raw]]; }
  set formulas(m) {
    const X = backing(), col = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
    m.forEach((row, r) => row.forEach((v, c) => { const a = this.sheet + '!' + col((this.c0 || 0) + c) + ((this.r0 || 0) + r + 1); if (v === '') X.sheet(this.sheet).delete(a.split('!')[1]); else X.set(a, v); }));
    X.parsed.clear();
  }
  clear() { if (this.isCell) { const X = backing(), col = String.fromCharCode(65 + this.c0); X.sheet(this.sheet).delete(col + (this.r0 + 1)); } else backing().sheet(this.sheet).clear(); }
}
class Sheet {
  constructor(name) { this.name = name; this.isNullObject = !backing().sheets.has(name); }
  getRange(ref) { return new Range(this.name, ref); }
  getCell(r, c) { const g = new Range(this.name, ''); g.r0 = r; g.c0 = c; g.isCell = true; return g; }
  getRangeByIndexes(r, c) { const g = new Range(this.name, ''); g.r0 = r; g.c0 = c; return g; }
  activate() {}
  getUsedRangeOrNullObject() {
    const X = backing(), cells = [...X.sheet(this.name).entries()];
    let maxR = 0, maxC = 0, map = {};
    const num = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
    for (const [a, v] of cells) { const m = /^([A-Z]+)(\\d+)$/.exec(a), R = +m[2] - 1, C = num(m[1]) - 1; maxR = Math.max(maxR, R); maxC = Math.max(maxC, C); map[R + ',' + C] = v; }
    const formulas = []; for (let r = 0; r <= maxR; r++) { formulas.push([]); for (let c = 0; c <= maxC; c++) formulas[r].push(map[r + ',' + c] === undefined ? '' : map[r + ',' + c]); }
    const rows = formulas.map((row, r) => row.map((f, c) => { const a = this.name + '!' + Sg.colName(c) + (r + 1), v = X.values.get(a); return v === undefined ? (typeof f === 'string' && f[0] === '=' ? '' : f) : v && v.code ? v.code : v; }));
    return { formulas, values: rows, rowIndex: 0, columnIndex: 0, isNullObject: !cells.length, load() {} };
  }
}
window.Excel = {
  CalculationType: { full: 'Full' }, CalculationMode: { manual: 'Manual' }, ClearApplyTo: { contents: 'Contents' },
  async run(a, b) {
    const fn = b || a;
    let calcQueued = false;
    const app = { calculationMode: window.__mode || 'Automatic', load() {}, calculate() { calcQueued = true; }, suspendScreenUpdatingUntilNextSync() { window.__suspended = true; } };
    Object.defineProperty(app, 'calculationMode', { get: () => window.__mode || 'Automatic', set: (v) => { window.__mode = v; window.__modeLog.push(v); } });
    const worksheets = {
      load() {}, get items() { return [...backing().sheets.keys()].map((n) => new Sheet(n)); },
      getItem: (n) => new Sheet(n), getItemOrNullObject: (n) => new Sheet(n), add: (n) => { backing().sheet(n); return new Sheet(n); },
    };
    worksheets.onChanged = { add(h) { window.__changeHandler = h; return { context: {}, remove() { window.__changeHandler = null; } }; } };
    const ctx = { workbook: { application: app, worksheets, names: { load() {}, items: [] } }, sync: async () => { if (calcQueued) { calcQueued = false; window.__calcs++; await backing().calculate(); } } };
    const r = await fn(ctx);
    await ctx.sync();
    return r;
  },
};
`;
(async () => {
  const fake = fs.readFileSync(path.join(root, 'tools/fake-excel.js'), 'utf8');
  const server = http.createServer((req, res) => {
    const f = path.join(root, req.url.split('?')[0]);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(f)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(f));
  }).listen(0);
  const port = server.address().port, b = await chromium.launch(), p = await b.newPage({ viewport: { width: 360, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
  await p.addInitScript('');
  await p.route('**/src/taskpane/taskpane.js', async (r) => r.fulfill({ contentType: 'text/javascript', body: fake + '\n' + fs.readFileSync(path.join(root, 'src/taskpane/taskpane.js'), 'utf8') }));
  await p.goto(`http://localhost:${port}/src/taskpane/taskpane.html`);
  await p.waitForFunction(() => window.Sg && Sg.pane);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'src/functions/functions.json'), 'utf8')).functions;
  const ids = await p.evaluate(() => Object.keys(window.__assoc));
  assert.deepStrictEqual(ids.slice().sort(), meta.map((f) => f.id).sort(), 'metadata and associated functions must match');
  assert.ok(meta.every((f) => /^[A-Z0-9]+$/.test(f.id) && f.options.requiresAddress), 'ids and options');
  // Parameter counts in metadata equal the engine's expected arity
  assert.ok(await p.evaluate(() => window.__startup), 'startup behaviour set');

  // Insert the example through the real button, in a sheet whose name has a space.
  await p.click('[data-tab=tools]'); await p.click('#ex');
  await p.waitForFunction(() => /Added the sheet/.test(document.getElementById('exMsg').textContent));
  await p.fill('#iterations', '500'); await p.dispatchEvent('#iterations', 'change');
  await p.click('#run');
  await p.waitForFunction(() => /^(Finished|Run failed)/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  const st = await p.textContent('#status');
  assert.match(st, /^Finished 500/, st + ' / ' + await p.textContent('#alert'));
  const info = await p.evaluate(() => ({ calcs: window.__calcs, modes: window.__modeLog, mode: window.__mode, outs: Sg.pane.ui.res.outputs.map((o) => [o.addr, o.values.length]), inputs: Sg.pane.ui.res.inputs.map((i) => i.addr), susp: window.__suspended, labels: [...Sg.pane.ui.labels.values()] }));
  assert.deepStrictEqual(info.modes, ['Manual', 'Automatic'], 'calc mode saved and restored');
  assert.strictEqual(info.mode, 'Automatic');
  const pinfo = await p.evaluate(() => Sg.pane.ui.res.info);
  assert.strictEqual(pinfo.path, 'compiled', 'readWorkbook feeds the compiler: ' + JSON.stringify(pinfo));
  assert.ok(pinfo.check.ok && pinfo.check.compared > 50, 'matched real recalculation through the Office.js layer');
  assert.ok(info.calcs < 30, 'Excel recalculates a handful of times, not once per iteration: ' + info.calcs);
  assert.ok(info.outs.length === 3 && info.outs.every(([a, n]) => a.startsWith('Example model!') && n === 500), JSON.stringify(info.outs));
  assert.ok(info.labels.includes('Relative risk with screening'), 'labels from neighbouring cells');
  assert.ok(info.susp, 'screen updating paused');

  // Real worker threads: a large run through the shipped worker.js, split across threads.
  await p.evaluate(() => { Sg.pane.runnerOpts && Sg.pane.runnerOpts({ threads: 2, forceWorkers: true }); });
  await p.fill('#iterations', '20000'); await p.dispatchEvent('#iterations', 'change');
  await p.click('#run');
  await p.waitForFunction(() => /^(Finished 20,000|Run failed)/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  const threaded = await p.evaluate(() => { const r = Sg.pane.ui.res; return { info: r.info, n: r.outputs[0].values.length, mean: Sg.stats.mean(r.outputs[0].values), uniq: new Set(r.outputs[0].values).size }; });
  assert.strictEqual(threaded.info.threads, 2, 'ran on worker threads: ' + JSON.stringify(threaded.info));
  assert.strictEqual(threaded.info.mode, 'iterations');
  assert.strictEqual(threaded.n, 20000);
  assert.strictEqual(threaded.uniq, 20000, 'no repeated draws between blocks');
  console.log('threads ok', await p.textContent('#status'));

  // Write results
  await p.click('#toSheet');
  await p.waitForFunction(() => /Wrote results/.test((document.getElementById('saved') || {}).textContent || ''));
  const head = await p.evaluate(() => [window.__X.sheet('Surrogate results').get('A1'), window.__X.sheet('Surrogate results').get('B1')]);
  assert.deepStrictEqual(head, ['Output', 'Mean']);

  // ---- Saved report: the real file, opened on its own with no connection to anything else.
  await p.fill('#iterations', '500'); await p.dispatchEvent('#iterations', 'change');
  await p.click('#run');
  await p.waitForFunction(() => /^Finished 500/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  await p.fill('#rpTitle', 'Test <report>'); await p.dispatchEvent('#rpTitle', 'change');
  const reportHtml = await p.evaluate(() => Sg.pane.reportText());
  const rp = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const rpErrs = []; rp.on('pageerror', (e) => rpErrs.push(e.message)); rp.on('requestfailed', (q) => rpErrs.push('request ' + q.url())); rp.on('request', (q) => { if (!q.url().startsWith('data:') && !q.url().startsWith('about:')) rpErrs.push('external request ' + q.url()); });
  await rp.setContent(reportHtml, { waitUntil: 'load' });
  assert.strictEqual(await rp.title(), 'Test <report>', 'title is escaped safely');
  assert.strictEqual(await rp.locator('h1').textContent(), 'Test <report>');
  assert.ok((await rp.locator('.rp-chart svg').count()) >= 9, 'charts drawn in the saved file');
  assert.match(await rp.locator('.rp-sum').first().textContent(), /QALYs gained/);
  assert.deepStrictEqual(rpErrs, [], 'the report loads nothing from elsewhere');
  await rp.close();

  // ---- Live window: the real dashboard.html, fed through text messages only.
  await p.click('#dashOpen');
  const dlg = p.frameLocator('#dlg');
  await dlg.locator('.rp-sum').first().waitFor({ timeout: 15000 });
  assert.match(await dlg.locator('.rp-sum').first().textContent(), /QALYs gained/, 'results reached the window');
  assert.ok(await dlg.locator('.rp-chart svg').count() >= 9, 'charts drawn in the window');
  assert.ok((await p.evaluate(() => window.__dialogBytes)) <= 20100, 'messages stay within the piece size');
  const seedBefore = await p.evaluate(() => Sg.pane.ui.res.seed);
  // Run again from the window.
  await dlg.locator('#lvRun').click();
  await p.waitForFunction((s) => Sg.pane.ui.res.seed !== s && !document.querySelector('#run').classList.contains('stop'), seedBefore, { timeout: 30000 });
  await dlg.locator('#lvStatus', { hasText: 'Finished' }).waitFor({ timeout: 10000 });
  // A sensitivity analysis run in the panel appears in the window.
  await p.evaluate(() => Sg.pane.selectTab('sens'));
  await p.locator('#uRun').evaluate((e) => e.click());
  await dlg.locator('h2', { hasText: 'One-way sensitivity' }).first().waitFor({ timeout: 20000 });
  // Rerun when the workbook changes, waiting for a pause, and ignoring changes straight after a run.
  await dlg.locator('#lvAuto').check();
  await p.waitForFunction(() => !!window.__changeHandler);
  await new Promise((r) => setTimeout(r, 1700));
  const seed2 = await p.evaluate(() => Sg.pane.ui.res.seed);
  await p.evaluate(() => { window.__changeHandler(); window.__changeHandler(); });
  await p.waitForFunction((s) => Sg.pane.ui.res.seed !== s, seed2, { timeout: 30000 });
  await dlg.locator('#lvAuto').uncheck();
  await p.waitForFunction(() => !window.__changeHandler);
  // Stopping from the window ends the run early.
  await p.fill('#iterations', '2000000'); await p.dispatchEvent('#iterations', 'change');
  await dlg.locator('#lvRun').click();
  await dlg.locator('#lvRun', { hasText: 'Stop' }).waitFor({ timeout: 10000 });
  await dlg.locator('#lvRun').click();
  await dlg.locator('#lvRun', { hasText: 'Run again' }).waitFor({ timeout: 30000 });
  await dlg.locator('.rp-warn', { hasText: 'stopped' }).waitFor({ timeout: 10000 });
  await p.fill('#iterations', '500'); await p.dispatchEvent('#iterations', 'change');
  await dlg.locator('#lvRun').click();
  await dlg.locator('#lvStatus', { hasText: 'Finished 500' }).waitFor({ timeout: 30000 });
  // A second click while the window is open only refreshes it, and a window that fails to load says so.
  await p.evaluate(() => Sg.pane.selectTab('results'));
  await p.locator('#dashOpen').evaluate((e) => e.click());
  assert.strictEqual(await p.locator('iframe#dlg').count(), 1, 'only one window');
  // Closing the window leaves the panel working, and it can open again.
  await p.evaluate(() => { const d = window.__dialog; d.close(); d.handlers.evt({ error: 12006 }); });
  assert.strictEqual(await p.locator('#alert').isVisible(), false, 'closing is not an error');
  await p.click('#dashOpen');
  await dlg.locator('.rp-sum').first().waitFor({ timeout: 15000 });
  await p.evaluate(() => { const d = window.__dialog; d.close(); d.handlers.evt({ error: 12002 }); });
  await p.locator('#alert', { hasText: '12002' }).waitFor({ timeout: 5000 });
  await p.evaluate(() => { document.getElementById('alert').hidden = true; });
  // A hostile output name can't run in a saved report, and every section draws.
  const hostile = await p.evaluate(async () => Sg.reportHtml(window.__hostileModel(), await Sg.getReportAssets()));
  const hp = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const hErrs = []; hp.on('pageerror', (e) => hErrs.push(e.message)); hp.on('dialog', (d) => { hErrs.push('script ran'); d.dismiss(); });
  await hp.setContent(hostile, { waitUntil: 'load' });
  assert.deepStrictEqual(hErrs, [], 'nothing ran');
  assert.strictEqual(await hp.locator('main img, main script').count(), 0, 'markup in names stays text');
  for (const t of ['Optimisation', 'Scenarios', 'Two-way', 'One-way', 'Cost-effectiveness', 'Across runs']) assert.ok(await hp.getByText(t).count(), `${t} drawn`);
  assert.ok(await hp.locator('.rp-warn', { hasText: 'failed' }).count(), 'failures reported');
  await hp.close();
  console.log('report and live window ok');

  // Error path: a #NUM! on one cell aborts through the real wrapper and reports the cell
  await p.evaluate(() => { window.__X.set('Example model!B4', '=ER.ERBETA(-1,880)'); window.__X.parsed.clear(); });
  await p.click('#run');
  await p.waitForFunction(() => /^Run failed/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  assert.match(await p.textContent('#alert'), /#(NUM|VALUE)!/);
  assert.strictEqual(await p.evaluate(() => window.__mode), 'Automatic', 'calc mode restored after failure');

  // Legacy conversion through the host, then a run
  await p.evaluate(() => { const X = window.__X; X.sheets.clear(); X.set('Old!A1', '=ErNormal(10,1)'); X.set('Old!B1', '=ErOutput("o",A1)'); X.set('Old!D1', '=ErDataArray("d",A1)'); X.set('Old!D2', '=ErDataArray("d",A1)'); X.parsed.clear(); });
  await p.click('[data-tab=tools]'); await p.click('#conv');
  await p.waitForFunction(() => /Converted/.test(document.getElementById('convMsg').textContent));
  const conv = await p.evaluate(() => [...window.__X.sheet('Old').entries()]);
  assert.deepStrictEqual(Object.fromEntries(conv), { A1: '=ER.ERNORMAL(10,1)', B1: '=ER.EROUTPUT("o",A1)', D1: '=ER.ERDATAARRAY("d",A1)' });
  await p.click('#run');
  await p.waitForFunction(() => /^Finished/.test(document.getElementById('status').textContent), null, { timeout: 30000 });

  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log(`ok: ${ids.length} functions registered; example ran ${info.calcs} calculates; results, failure path and conversion all work through the Office.js layer.`);
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
