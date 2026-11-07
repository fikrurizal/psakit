// The report's numbers must be the run's numbers, and its file must be safe whatever the workbook's names contain.
const assert = require('node:assert');
const test = require('node:test');
const Sg = require('../src/engine/index.js');
require('../src/taskpane/charts.js');
require('../src/taskpane/report.js');
const { stats } = Sg;
async function run(cells, opts) {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X);
  X.setCells('S', cells);
  const res = await R.simulate(Object.assign({ iterations: 3000, seed: 7, ci: 95 }, opts));
  return { R, res };
}
const build = (res, more) => Sg.buildReportModel(Object.assign({ res, title: 'T', note: 'n', labelOf: (i) => i.fn + i.addr, detLabel: (a) => a }, more));
const CELLS = { A1: '=ER.ERNORMAL(10,2)', A2: '=ER.ERGAMMA(3,1.5)', B1: '=ER.EROUTPUT("sum",A1+A2)', B2: '=ER.EROUTPUT("gain",3*A1-A2)' };

test('summaries, histogram and running mean are those of the recorded values', async () => {
  const { res } = await run(CELLS);
  const m = build(res), o = m.outputs.find((x) => x.name === 'sum'), vals = res.outputs.find((x) => x.name === 'sum').values, s = stats.summary(vals, 95);
  for (const k of ['mean', 'sd', 'median', 'lo', 'hi', 'min', 'max', 'se']) assert.strictEqual(o.s[k], s[k], k);
  assert.strictEqual(o.bins.reduce((t, b) => t + b[2], 0), 3000, 'every value is in a bin');
  assert.ok(Math.abs(o.conv[o.conv.length - 1] - s.mean) < 0.05, 'running mean ends near the mean');
  assert.ok(o.conv.length <= 240, 'running mean thinned');
  assert.strictEqual(m.completed, 3000);
});

test('sensitivity bars match a direct Spearman, strongest first', async () => {
  const { res } = await run(CELLS);
  const o = build(res).outputs.find((x) => x.name === 'gain'), y = res.outputs.find((x) => x.name === 'gain').values;
  assert.strictEqual(o.sens.rows.length, 2);
  res.inputs.forEach((i) => {
    const row = o.sens.rows.find((r) => r.label === i.fn + i.addr);
    assert.ok(Math.abs(row.value - stats.spearman(Array.from(i.values), Array.from(y))) < 1e-3, i.addr);
  });
  assert.ok(Math.abs(o.sens.rows[0].value) >= Math.abs(o.sens.rows[1].value));
});

test('with several runs, iteration outputs show the last run, as the panel does', async () => {
  const { res } = await run(CELLS, { iterations: 500, runs: 3 });
  const m = build(res), vals = res.outputs.find((x) => x.name === 'sum').values;
  assert.strictEqual(m.showingRun, 3);
  assert.strictEqual(m.outputs.find((x) => x.name === 'sum').s.n, 500);
  assert.strictEqual(m.outputs.find((x) => x.name === 'sum').s.mean, stats.summary(vals.slice(-500), 95).mean);
});

test('cost-effectiveness figures match a hand calculation', async () => {
  const { res } = await run(CELLS);
  const m = build(res, { ce: { cost: 0, effect: 1, wtp: 2 } }), c = res.outputs[0].values, e = res.outputs[1].values;
  let ce = 0, nb = 0, mx = 0;
  for (let i = 0; i < c.length; i++) { const b = 2 * e[i] - c[i]; nb += b; if (b > 0) { ce++; mx += b; } }
  nb /= c.length;
  assert.ok(Math.abs(m.ce.p - ce / c.length) < 1e-12);
  assert.ok(Math.abs(m.ce.mean - nb) < 1e-9);
  assert.ok(Math.abs(m.ce.evpi - (mx / c.length - Math.max(nb, 0))) < 1e-9);
  assert.strictEqual(m.ce.curve.length, 101);
  assert.strictEqual(m.ce.curve[50].toFixed(4), (ce / c.length).toFixed(4), 'the curve passes through this willingness to pay');
});

test('a failed output carries no statistics and the failures are listed', async () => {
  const { res } = await run({ A1: '=ER.ERUNIFORM(-1,1)', B1: '=ER.EROUTPUT("root",SQRT(A1))', B2: '=ER.EROUTPUT("fine",A1)' }, { iterations: 200 });
  const m = build(res), r = m.outputs.find((x) => x.name === 'root');
  assert.ok(r.s.failed > 0); assert.strictEqual(r.s.mean, null);
  assert.ok(m.outputs.find((x) => x.name === 'fine').s.mean !== null);
  assert.doesNotThrow(() => JSON.stringify(m));
});

test('the model is plain JSON, and the file keeps names inert', async () => {
  const bad = '</script><img src=x onerror=alert(1)>';
  const { res } = await run({ A1: '=ER.ERNORMAL(10,2)', B1: `=ER.EROUTPUT("${bad}",A1)` }, { iterations: 100 });
  const m = build(res, { title: bad, decimals: 2 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), m);
  const html = Sg.reportHtml(m, { css: 'body{}', js: 'var x="</script>";' });
  assert.ok(!html.includes(bad), 'raw name absent');
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 2, 'only the file\'s own script tags close');
  assert.ok(html.includes('<title>&lt;/script&gt;'), 'title escaped');
});

test('long messages arrive whole, whatever the order', () => {
  const big = { type: 'model', text: 'é<'.repeat(60000) }, parts = [];
  Sg.sendInPieces((p) => parts.push(p), big);
  assert.ok(parts.length > 3); assert.ok(parts.every((p) => p.length < 21000));
  let got = null; const rx = Sg.pieceReceiver((m) => { got = m; });
  parts.reverse().forEach(rx);
  assert.deepStrictEqual(got, big);
});

test('a waiting model has no results and file names are safe', () => {
  assert.strictEqual(Sg.buildReportModel({ res: null, title: 'x' }).waiting, true);
  assert.strictEqual(Sg.reportFileName('Burden / 2026: draft'), 'burden-2026-draft.html');
  assert.strictEqual(Sg.reportFileName('???'), 'simulation-report.html');
});
