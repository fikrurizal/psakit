// The compiler, against LibreOffice as an independent spreadsheet engine, and against the run path it replaces.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('fs'), path = require('path');
const Sg = require('../src/engine/index.js');
const forms = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle/formulas.json')));
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle/expected.json')));
const layout = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle/layout.json')));

// Lays the reference data out as a workbook. With liveData on, numbers in S come through PSA.FIXED, so every formula
// depends on something live and has to be compiled, and ranges read from live slots rather than fixed values.
function build(liveData) {
  const grid = (cells) => {
    let mr = 0, mc = 0;
    const p = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { r: +m[2] - 1, c: Sg.colNum(m[1]) }; };
    for (const a of Object.keys(cells)) { const x = p(a); mr = Math.max(mr, x.r); mc = Math.max(mc, x.c); }
    const f = [], v = [];
    for (let r = 0; r <= mr; r++) { f.push(new Array(mc + 1).fill('')); v.push(new Array(mc + 1).fill('')); }
    for (const [a, val] of Object.entries(cells)) { const x = p(a); f[x.r][x.c] = val; v[x.r][x.c] = val; }
    return { f, v };
  };
  const S = {};
  for (const [a, val] of Object.entries(layout.S)) S[a] = liveData && typeof val === 'number' ? `=PSA.FIXED({${val}},1)` : val;
  S.Z1 = '=PSA.ITERATION()';
  const s = grid(S), o = grid(layout.Other);
  for (const [a, val] of Object.entries(layout.S)) { if (typeof val === 'number') { const m = /^([A-Z]+)(\d+)$/.exec(a); s.v[+m[2] - 1][Sg.colNum(m[1])] = val; } }
  const R = {};
  forms.forEach((f, i) => { R['A' + (i + 1)] = '=' + f.replace(/(?<![!A-Za-z$.:])([A-Z]{1,2}\d+(?::[A-Z]{1,2}\d+)?)(?![A-Za-z0-9(])/g, 'S!$1') + '+0*0'; });
  // A wrapper that keeps text and booleans intact while forcing the cell to be recorded.
  forms.forEach((f, i) => { R['A' + (i + 1)] = '=' + f.replace(/(?<![!A-Za-z$.:])([A-Z]{1,2}\d+(?::[A-Z]{1,2}\d+)?)(?![A-Za-z0-9(])/g, 'S!$1'); R['B' + (i + 1)] = `=PSA.SENSINPUT("c${i}",PSA.ITERATION()*0)+0*N0`; });
  const r = grid(R);
  return { wb: { sheets: [{ name: 'S', rowIndex: 0, columnIndex: 0, formulas: s.f, values: s.v }, { name: 'Other', rowIndex: 0, columnIndex: 0, formulas: o.f, values: o.v }, { name: 'R', rowIndex: 0, columnIndex: 0, formulas: r.f, values: r.v }], names: [{ name: 'rate', formula: '=Other!$A$1' }, { name: 'table', formula: '=S!$F$1:$F$5' }] } };
}
// Where LibreOffice and Excel differ, Excel's documented behaviour is what's implemented.
const KNOWN_DIFFERENCES = {
  'TRUE>A1': 'Excel orders number < text < TRUE/FALSE. LibreOffice treats TRUE as 1.',
  'COUNT(B1:B6)': 'Excel ignores TRUE in a range. LibreOffice counts it as a number.',
  'AVERAGE(B1:B6)': 'Excel ignores TRUE in a range. LibreOffice counts it as a number.',
  'G3&H1': 'Excel joins a boolean as the word TRUE. LibreOffice joins it as 1.',
  'POWER(0,0)': 'Excel returns #NUM!. LibreOffice returns 1.',
  'POWER(-8,1/3)': 'Excel returns #NUM!. LibreOffice returns -2.',
};
const same = (got, want) => {
  if (typeof want === 'string' && want[0] === '#') return typeof got === 'number' && Number.isNaN(got);
  if (typeof want === 'number' && typeof got === 'boolean') return (got ? 1 : 0) === want;
  if (typeof want === 'boolean' && typeof got === 'number') return (want ? 1 : 0) === got;
  if (typeof want === 'number' && typeof got === 'number') return Math.abs(got - want) <= 1e-8 * Math.max(1, Math.abs(want));
  return got === want;
};
// Compiles one formula at a time, so a single unsupported function can't hide the rest.
function evalOne(f, i, liveData) {
  const { wb } = build(liveData);
  const R = wb.sheets[2];
  for (let r = 0; r < R.formulas.length; r++) { if (r !== i) { R.formulas[r] = R.formulas[r].map(() => ''); R.values[r] = R.values[r].map(() => ''); } }
  // Depend on something live, and make the cell needed, by feeding PSA.SENSINPUT from it only when numeric-safe.
  // Wrapping each formula in an IF on the iteration number makes the cell live, so it's compiled however fixed its data is.
  { const g = R.formulas[i][0].slice(1); R.formulas[i][0] = `=IF(S!Z1>0,${g},${g})`; }
  R.formulas[i][1] = `=PSA.CONDITIONAL(FALSE,LEN(A${i + 1}&""))`;
  R.values[i][1] = 0;
  const model = Sg.compileWorkbook(wb);
  const E = new Sg.Engine(), H = new Sg.CompiledHost(model, E);
  E.beginPrime({ seed: 1 }); H.calculate();
  E.iterations = 3; E.beginRun(1); E.beginIter(1); H.calculate();
  return H.valueAt(`R!A${i + 1}`);
}
for (const live of [true, false]) {
  test(`every reference formula matches LibreOffice (${live ? 'live' : 'fixed'} data)`, () => {
    const failures = [], unsup = [];
    forms.forEach((f, i) => {
      if (KNOWN_DIFFERENCES[f]) return;
      try {
        const v = evalOne(f, i, live);
        if (!same(v, expected[f])) failures.push(`${f}: compiled ${v}, LibreOffice ${expected[f]}`);
      } catch (e) {
        if (e.unsupported) unsup.push(`${f}: ${e.message}`); else throw e;
      }
    });
    assert.deepStrictEqual(failures, []);
    if (live) assert.deepStrictEqual(unsup, []);
  });
}
test('formulas with nothing random in them keep Excel\'s value, even using functions the compiler does not know', async () => {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X);
  X.setCells('S', { C1: 7, A1: '=PSA.NORMAL(10,1)', B1: '=PSA.OUTPUT("o",A1+D1)', D1: '=C1*2', E1: '=A1*999' });
  const wb = (await (async () => { await X.calculate(); return X.readWorkbook(); })());
  wb.sheets[0].formulas[0][3] = '=SOMEUDF(C1)'; // D1
  wb.sheets[0].values[0][3] = 14;
  const m = Sg.compileWorkbook(wb);
  assert.strictEqual(m.stat.fixedFormulas, 1, 'D1 keeps the calculated value');
  assert.strictEqual(m.stat.skippedFormulas, 1, 'E1 feeds nothing recorded, so it is skipped');
  assert.strictEqual(m.stat.liveFormulas, 2);
  void R;
});
test('formulas that can\'t be compiled are refused with the reason, and the run falls back to Excel', async () => {
  for (const [f, fn] of [['SOMEUDF(A1)', 'SOMEUDF'], ['OFFSET(A1,1,0)', 'OFFSET'], ['INDIRECT("A1")', 'INDIRECT'], ['IFNA(A1/0,1)', 'IFNA']]) {
    const E = new Sg.Engine(), X = new Sg.FakeExcel(E);
    X.setCells('S', { A1: '=PSA.NORMAL(10,1)', B1: `=${f}`, C1: '=PSA.OUTPUT("o",B1)' });
    await X.calculate();
    const wb = await X.readWorkbook();
    wb.sheets[0].values[0][1] = 1;
    assert.throws(() => Sg.compileWorkbook(wb), (e) => e.unsupported && (e.fn === fn || e.message.includes(fn)), f);
  }
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X);
  X.setCells('S', { A1: '=PSA.NORMAL(10,1)', C1: '=SUM(A1,1)', B1: '=PSA.OUTPUT("o",C1)' });
  const real = X.readWorkbook.bind(X);
  X.readWorkbook = async () => { const w = await real(); w.sheets[0].formulas[0][2] = '=OFFSET(A1,0,0)+1'; return w; };
  const res = await R.simulate({ iterations: 20 });
  assert.strictEqual(res.info.path, 'excel');
  assert.match(res.info.why, /OFFSET/);
  assert.strictEqual(res.completed, 20);
});
test('circular references are refused', async () => {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E);
  X.setCells('S', { A1: '=PSA.NORMAL(10,1)' });
  await X.calculate();
  const wb = await X.readWorkbook();
  wb.sheets[0].formulas = [['=PSA.OUTPUT("o",B1)', '=A2+1'], ['=B1+PSA.NORMAL(0,1)', '']];
  wb.sheets[0].values = [[0, 0], [0, '']];
  wb.sheets[0].formulas[0][1] = '=A2+1';
  assert.throws(() => Sg.compileWorkbook(wb), (e) => e.unsupported && /circular/.test(e.message));
});
test('the match check catches a compiled model that disagrees with the workbook, and the run falls back', async () => {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X);
  X.setCells('S', { A1: '=PSA.NORMAL(10,1)', C1: '=A1*2', B1: '=PSA.OUTPUT("o",C1)' });
  // Simulates a compiler bug: the compiled workbook sees a different formula from the real one.
  const real = X.readWorkbook.bind(X);
  X.readWorkbook = async () => { const w = await real(); w.sheets[0].formulas[0][2] = '=A1*3'; return w; };
  const res = await R.simulate({ iterations: 30 });
  assert.strictEqual(res.info.path, 'excel', 'fell back');
  assert.match(res.info.why, /different answer/);
  assert.strictEqual(res.info.check.mismatches[0].addr, 'S!C1');
  assert.strictEqual(res.completed, 30);
});
test('the match check compares every compiled cell on replayed draws, including component functions', async () => {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X);
  const cells = { H1: 1, H2: 0.8, I2: 1, M1: '=PSA.DIRICHLET("d",3,100)', A1: '=PSA.DIRICHLETCOM(M1,1,20)', A2: '=PSA.DIRICHLETCOM(M1,2,30)', A3: '=PSA.DIRICHLETCOM(M1,3,50)', M2: '=PSA.MULTINOMIAL("m",2,10)', A4: '=PSA.MULTINOMIALCOM(M2,1,4)', A5: '=PSA.MULTINOMIALCOM(M2,2,6)', M3: '=PSA.CORRNORMAL("c",H1:I2,2,TRUE)', A6: '=PSA.CORRNORMALCOM(M3,1,0,1)', A7: '=PSA.CORRNORMALCOM(M3,2,0,1)', M4: '=PSA.RANKCORR("r",H1:I2,2)', A8: '=PSA.RANKCORRCOM(M4,1,PSA.GAMMA(3,2))', A9: '=PSA.RANKCORRCOM(M4,2,PSA.BETA(2,2))', M5: '=PSA.NONPARAM("b",3,1)', J1: 1, J2: 2, J3: 3, K1: '=PSA.NONPARAMCOM(M5,1,1,J1)', K2: '=PSA.NONPARAMCOM(M5,2,1,J2)', K3: '=PSA.NONPARAMCOM(M5,3,1,J3)', T1: '=PSA.TRUNCATE(0,5,PSA.NORMAL(2,2))', B1: '=PSA.OUTPUT("o",SUM(A1:A9)+SUM(K1:K3)+T1)' };
  X.setCells('S', cells);
  const res = await R.simulate({ iterations: 200 });
  assert.strictEqual(res.info.path, 'compiled');
  assert.ok(res.info.check.ok, JSON.stringify(res.info.check.mismatches));
  assert.ok(res.info.check.compared >= 5 * 15, 'cells compared: ' + res.info.check.compared);
});
test('splitting a run across workers gives the same results as any other number of workers', async () => {
  // In-process workers run the real worker protocol, in a shuffled order, without threads.
  const makeFake = () => {
    const state = {}; let self;
    self = {
      onmessage: null, terminate() {},
      postMessage(m) { setTimeout(() => Sg.workerHandle(state, m, (x) => { setTimeout(() => self.onmessage({ data: x }), Math.random() * 3); }), 0); },
    };
    return self;
  };
  const had = Sg.makeWorker;
  Sg.makeWorker = makeFake;
  try {
    const run = async (threads, cells, extra) => {
      const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X, { threads, forceWorkers: true });
      X.setCells('S', cells);
      return R.simulate(Object.assign({ settings: { seed: 77 } }, extra));
    };
    const plain = { A1: '=PSA.NORMAL(10,2)', A2: '=PSA.ITERATION()', D1: '=PSA.DIRICHLET("d",2,10)', D2: '=PSA.DIRICHLETCOM(D1,1,4)', D3: '=PSA.DIRICHLETCOM(D1,2,6)', B1: '=PSA.OUTPUT("o",A1*D2)', B2: '=PSA.OUTPUT("i",A2)' };
    const a = await run(2, plain, { iterations: 3000 }), b = await run(4, plain, { iterations: 3000 });
    assert.strictEqual(a.info.mode, 'iterations');
    assert.deepStrictEqual(Array.from(a.outputs[1].values), Array.from(b.outputs[1].values));
    assert.deepStrictEqual(Array.from(a.outputs[0].values), Array.from(b.outputs[0].values), 'same numbers on 2 and 4 threads');
    assert.deepStrictEqual(Array.from(a.outputs[0 + 1].values).slice(0, 3), [1, 2, 3], 'iterations in order');
    assert.ok(new Set(a.outputs[0].values).size === 3000, 'blocks do not repeat draws');
    assert.ok(Math.abs(Sg.stats.mean(a.outputs[0].values) - 4) < 0.1);
    assert.ok(a.inputs.length >= 2 && a.inputs[0].values.length === 3000);

    const micro = { I1: '=PSA.ITERATION()', A1: '=PSA.CONDITIONAL(I1=1,PSA.RELATIVERISK(2,0.1))', A2: '=PSA.EXPONENTIAL(10)', A3: '=A2/A1', T1: '=PSA.MEAN(A3)', C1: '=PSA.RUNOUTPUT("pop",T1)', C2: '=PSA.OUTPUT("ind",A3)', C3: '=PSA.RUNDATAARRAY("arr",T1)' };
    const p = await run(2, micro, { iterations: 500, runs: 12 }), q = await run(3, micro, { iterations: 500, runs: 12 });
    assert.strictEqual(p.info.mode, 'runs');
    assert.strictEqual(p.runOutputs[0].values.length, 12);
    assert.deepStrictEqual(p.runOutputs[0].values, q.runOutputs[0].values);
    assert.strictEqual(new Set(p.runOutputs[0].values).size, 12, 'each run has its own draws');
    const sd = Sg.stats.sd(p.runOutputs[0].values);
    assert.ok(sd > 0.3 && sd < 1.0, 'run-level effect carries through: ' + sd);

    const it = await run(2, { X1: 0, X2: 1, X3: 2, Y1: '=PSA.BETA(300,700)', Y2: '=PSA.BETA(270,730)', Y3: '=PSA.BETA(240,760)', H1: 0.3, H2: -0.02, A1: '=PSA.MINIMIZE("fit1",H1:H2)', Z1: '=A1+A2*X1', Z2: '=A1+A2*X2', Z3: '=A1+A2*X3', L1: '=PSA.MINIMIZERESULT("fit1",SUMXMY2(Y1:Y3,Z1:Z3)*1000)', O1: '=PSA.OUTPUT("trend",A2)', O3: '=PSA.OUTPUT("want",(Y3-Y1)/2)' }, { iterations: 2000, optim: { name: 'fit1', method: 'downhill', on: 'iteration', options: { tolerance: 1e-6 } } });
    assert.strictEqual(it.info.mode, 'iterations');
    it.outputs[0].values.forEach((v, i) => assert.ok(Math.abs(v - it.outputs[1].values[i]) < 0.001, 'fit ' + i));
    assert.ok(it.optim.evals > 2000 * 5);

    const tied = await run(2, { A1: '=PSA.NORMAL(0,1)', M1: '=PSA.MEAN(A1)', B1: '=PSA.OUTPUT("o",A1)' }, { iterations: 3000 });
    assert.strictEqual(tied.info.mode, undefined, 'statistics tie iterations together, so this stays on one thread');
    assert.strictEqual(tied.info.path, 'compiled');
  } finally { if (had) Sg.makeWorker = had; else delete Sg.makeWorker; }
}, { timeout: 180000 });
