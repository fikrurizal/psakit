// End-to-end runs through the runner against the simulated workbook, which calculates cells in random order.
const assert = require('node:assert');
const test = require('node:test');
const Sg = require('../src/engine/index.js');
const { stats } = Sg;
function setup(cells, opts) {
  const E = new Sg.Engine(), X = new Sg.FakeExcel(E, opts), R = new Sg.Runner(E, X);
  X.setCells('S', cells);
  // The whole suite runs twice, once through Excel-style recalculation and once through the compiled path.
  const sim = R.simulate.bind(R), speed = process.env.SG_SPEED || 'compiled';
  R.simulate = (o) => sim(Object.assign({ speed }, o)).then((res) => {
    if (speed === 'compiled' && res.info.path !== 'compiled') globalThis.__fellBack = (globalThis.__fellBack || []).concat([res.info.why]);
    return res;
  });
  return { E, X, R };
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const out = (res, name) => res.outputs.find((o) => o.name === name).values;

test('basic model: outputs recorded, summary right, sheet returns to means afterwards', async () => {
  const { X, R } = setup({ A1: '=ER.ERNORMAL(10,2)', A2: '=ER.ERGAMMA(3,1.5)', B1: '=ER.EROUTPUT("sum",A1+A2)' });
  const res = await R.simulate({ iterations: 5000 });
  const s = stats.summary(out(res, 'sum'), 95);
  near(s.mean, 14.5, 0.15); near(s.sd, Math.sqrt(4 + 6.75), 0.2);
  assert.strictEqual(res.completed, 5000);
  assert.strictEqual(res.inputs.length, 2);
  assert.strictEqual(X.manual, false, 'calc mode restored');
  await X.calculate();
  assert.strictEqual(X.display('S!A1'), 10, 'shows the mean when idle');
});
test('same seed gives identical results whatever order Excel calculates in', async () => {
  const cells = { A1: '=ER.ERNORMAL(0,1)', A2: '=ER.ERPOISSON(30)', A3: '=ER.ERBETA(2,3)', B1: '=ER.EROUTPUT("o",A1*A2+A3)' };
  const a = setup(cells), b = setup(cells);
  const ra = await a.R.simulate({ iterations: 200, settings: { seed: 42 } }), rb = await b.R.simulate({ iterations: 200, settings: { seed: 42 } });
  assert.deepStrictEqual(out(ra, 'o'), out(rb, 'o'));
  const c = setup(cells), rc = await c.R.simulate({ iterations: 200, settings: { seed: 43 } });
  assert.notDeepStrictEqual(out(ra, 'o'), out(rc, 'o'));
});
test('every generator runs a model end to end', async () => {
  for (const rng of Object.keys(Sg.RNGS)) {
    const { R } = setup({ A1: '=ER.ERNORMAL(5,1)', B1: '=ER.EROUTPUT("o",A1)' });
    const res = await R.simulate({ iterations: 2000, settings: { rng } });
    near(stats.mean(out(res, 'o')), 5, 0.12, rng);
  }
});
test('a bad parameter on one iteration is logged, the run continues, and that output gets no statistics', async () => {
  const { R, X } = setup({ A1: '=ER.ERITERATION()', A2: '=ER.ERNORMAL(0,IF(A1=50,-1,1))', B1: '=ER.EROUTPUT("o",A2)', A3: '=ER.ERNORMAL(5,1)', B2: '=ER.EROUTPUT("ok",A3)' });
  const res = await R.simulate({ iterations: 100 });
  assert.strictEqual(res.completed, 100);
  assert.ok(Number.isNaN(out(res, 'o')[49]));
  const s = stats.summary(out(res, 'o'), 95);
  assert.strictEqual(s.failed, 1);
  assert.ok(Number.isNaN(s.mean), 'no statistics for the affected output');
  assert.ok(Number.isFinite(stats.summary(out(res, 'ok'), 95).mean), 'other outputs are unaffected');
  const e = res.errors.find((x) => x.addr === 'S!B1' || x.addr === 'S!A2');
  assert.ok(e && e.count >= 1, 'the failure is reported');
  assert.strictEqual(X.manual, false, 'calc mode restored');
});
test('an output downstream of a bad parameter gets a message naming the cell, not "no outputs"', async () => {
  await assert.rejects(setup({ A1: '=ER.ERBETA(-1,3)', B1: '=ER.EROUTPUT("o",A1)' }).R.simulate({ iterations: 5 }), /S!B1 shows #NUM! before the run/);
});
test('late or missing reports are recovered by reading the cell', async () => {
  const { E, X, R } = setup({ A1: '=ER.ERNORMAL(5,1)', B1: '=ER.EROUTPUT("o",A1)' });
  const real = E.report.bind(E);
  let n = 0;
  E.report = (a, v) => { if (E.phase === 'iter' && ++n % 3 === 0) return; real(a, v); };
  const res = await R.simulate({ iterations: 30, speed: 'excel' });
  assert.ok(out(res, 'o').every(Number.isFinite));
  assert.ok(X.calcs > 30);
});
test('duplicate output names are a fatal error', async () => {
  const { R } = setup({ A1: '=ER.ERNORMAL(0,1)', B1: '=ER.EROUTPUT("o",A1)', B2: '=ER.EROUTPUT("o",A1)' });
  await assert.rejects(R.simulate({ iterations: 5 }), /Names must be unique/);
});
test('no formulas and no outputs give direct instructions', async () => {
  await assert.rejects(setup({ A1: 1 }).R.simulate({ iterations: 5 }), /No ER\. functions/);
  await assert.rejects(setup({ A1: '=ER.ERNORMAL(0,1)' }).R.simulate({ iterations: 5 }), /No outputs/);
});
test('ER.ERSETITNO overrides the iteration count', async () => {
  const { R } = setup({ A1: '=ER.ERSETITNO(37)', A2: '=ER.ERNORMAL(0,1)', B1: '=ER.EROUTPUT("o",A2)' });
  assert.strictEqual((await R.simulate({ iterations: 500 })).completed, 37);
});
test('multinomial draws sum to N in any calc order, with binomial margins', async () => {
  const { R } = setup({ M1: '=ER.ERMULTINOMIAL("m",3,100)', A1: '=ER.ERMULTINOMIALCOM(M1,1,20)', A2: '=ER.ERMULTINOMIALCOM(M1,2,30)', A3: '=ER.ERMULTINOMIALCOM(M1,3,50)', B1: '=ER.EROUTPUT("sum",SUM(A1:A3))', B2: '=ER.EROUTPUT("a",A1)' });
  const res = await R.simulate({ iterations: 8000 });
  assert.ok(out(res, 'sum').every((v) => v === 100));
  near(stats.mean(out(res, 'a')), 20, 0.2); near(stats.sd(out(res, 'a')), 4, 0.15);
});
test('multinomial cases that do not sum to N are refused before the run', async () => {
  const { R } = setup({ M1: '=ER.ERMULTINOMIAL("m",2,100)', A1: '=ER.ERMULTINOMIALCOM(M1,1,20)', A2: '=ER.ERMULTINOMIALCOM(M1,2,30)', B1: '=ER.EROUTPUT("o",A1+A2)' });
  await assert.rejects(R.simulate({ iterations: 5 }), /sum to 50, but N is 100/);
});
test('Dirichlet draws sum to 1 with the right marginal Beta in any calc order', async () => {
  const { R } = setup({ M1: '=ER.ERDIRICHLET("d",3,100)', A1: '=ER.ERDIRICHLETCOM(M1,1,20)', A2: '=ER.ERDIRICHLETCOM(M1,2,30)', A3: '=ER.ERDIRICHLETCOM(M1,3,50)', B1: '=ER.EROUTPUT("sum",SUM(A1:A3))', B2: '=ER.EROUTPUT("c",A3)' });
  const res = await R.simulate({ iterations: 8000 });
  assert.ok(out(res, 'sum').every((v) => Math.abs(v - 1) < 1e-9));
  near(stats.mean(out(res, 'c')), 0.5, 0.004); near(stats.sd(out(res, 'c')), Sg.DISTS.ErBeta.sd([50, 50]), 0.003);
});
test('non-parametric bootstrap resamples whole records with replacement', async () => {
  const data = [1, 2, 3, 4, 5, 6], cells = { M1: '=ER.ERNONPARAM("b",6,2)' };
  data.forEach((v, i) => { cells['A' + (i + 1)] = v; cells['B' + (i + 1)] = v * 10; cells['C' + (i + 1)] = `=ER.ERNONPARAMCOM(M1,${i + 1},1,A${i + 1})`; cells['D' + (i + 1)] = `=ER.ERNONPARAMCOM(M1,${i + 1},2,B${i + 1})`; });
  cells.E1 = '=ER.EROUTPUT("mean",AVERAGE(C1:C6))'; cells.E2 = '=ER.EROUTPUT("ratio",SUM(D1:D6)/SUM(C1:C6))';
  const res = await setup(cells).R.simulate({ iterations: 5000 });
  near(stats.mean(out(res, 'mean')), 3.5, 0.03);
  near(stats.sd(out(res, 'mean')), Math.sqrt(35 / 12 / 6), 0.03);
  assert.ok(out(res, 'ratio').every((v) => Math.abs(v - 10) < 1e-9), 'fields of a record stay together');
});
test('randomisation permutes without replacement', async () => {
  const cells = { M1: '=ER.ERRANDOMISE("r",5,1)' };
  [1, 2, 3, 4, 5].forEach((v, i) => { cells['A' + (i + 1)] = v; cells['C' + (i + 1)] = `=ER.ERRANDOMISECOM(M1,${i + 1},1,A${i + 1})`; });
  cells.E1 = '=ER.EROUTPUT("sum",SUM(C1:C5))'; cells.E2 = '=ER.EROUTPUT("first",C1)';
  const res = await setup(cells).R.simulate({ iterations: 3000 });
  assert.ok(out(res, 'sum').every((v) => v === 15));
  near(stats.mean(out(res, 'first')), 3, 0.08);
});
const corr3 = { H1: 1, H2: 0.7, I2: 1, H3: -0.4, I3: 0.1, J3: 1 };
test('correlated normals reach the requested correlation', async () => {
  const res = await setup(Object.assign({}, corr3, { M1: '=ER.ERCORRNORMAL("c",H1:J3,3,TRUE)', A1: '=ER.ERCORRNORMALCOM(M1,1,10,2)', A2: '=ER.ERCORRNORMALCOM(M1,2,0,1)', A3: '=ER.ERCORRNORMALCOM(M1,3,5,3)', B1: '=ER.EROUTPUT("a",A1)', B2: '=ER.EROUTPUT("b",A2)', B3: '=ER.EROUTPUT("c",A3)' })).R.simulate({ iterations: 10000 });
  near(stats.pearson(out(res, 'a'), out(res, 'b')), 0.7, 0.02);
  near(stats.pearson(out(res, 'a'), out(res, 'c')), -0.4, 0.03);
  near(stats.mean(out(res, 'a')), 10, 0.08); near(stats.sd(out(res, 'c')), 3, 0.08);
});
test('correlated normals accept a covariance matrix', async () => {
  const res = await setup({ H1: 4, H2: 1.2, I2: 1, M1: '=ER.ERCORRNORMAL("c",H1:I2,2,FALSE)', A1: '=ER.ERCORRNORMALCOM(M1,1,0,2)', A2: '=ER.ERCORRNORMALCOM(M1,2,0,1)', B1: '=ER.EROUTPUT("a",A1)', B2: '=ER.EROUTPUT("b",A2)' }).R.simulate({ iterations: 8000 });
  near(stats.pearson(out(res, 'a'), out(res, 'b')), 0.6, 0.03);
});
test('an invalid correlation matrix is a fatal error that points to Tools', async () => {
  const bad = { H1: 1, H2: 0.9, I2: 1, H3: -0.9, I3: 0.9, J3: 1, M1: '=ER.ERCORRNORMAL("c",H1:J3,3,TRUE)', A1: '=ER.ERCORRNORMALCOM(M1,1,0,1)', B1: '=ER.EROUTPUT("a",A1)' };
  await assert.rejects(setup(bad).R.simulate({ iterations: 5 }), /not valid.*Tools/s);
});
test('rank correlation keeps each marginal and imposes the correlation', async () => {
  const res = await setup({ H1: 1, H2: 0.8, I2: 1, M1: '=ER.ERRANKCORR("r",H1:I2,2)', A1: '=ER.ERRANKCORRCOM(M1,1,ER.ERGAMMA(3,2))', A2: '=ER.ERRANKCORRCOM(M1,2,ER.ERWEIBULL(5,2.1))', B1: '=ER.EROUTPUT("g",A1)', B2: '=ER.EROUTPUT("w",A2)' }).R.simulate({ iterations: 8000 });
  near(stats.spearman(out(res, 'g'), out(res, 'w')), (6 / Math.PI) * Math.asin(0.8 / 2), 0.03, 'Spearman of normals correlated at 0.8');
  near(stats.mean(out(res, 'g')), 6, 0.2); near(stats.sd(out(res, 'g')), 2 * Math.sqrt(3), 0.2);
  near(stats.mean(out(res, 'w')), Sg.DISTS.ErWeibull.mean([5, 2.1]), 0.15);
});
test('rank correlation without an embedded function is fatal', async () => {
  await assert.rejects(setup({ H1: 1, H2: 0.8, I2: 1, X1: '=ER.ERGAMMA(3,2)', M1: '=ER.ERRANKCORR("r",H1:I2,2)', A1: '=ER.ERRANKCORRCOM(M1,1,X1)', B1: '=ER.EROUTPUT("g",A1)' }).R.simulate({ iterations: 5 }), /embedded/);
});
test('correlated Dirichlets sum to 1 and correlate across distributions', async () => {
  const res = await setup({ H1: 1, H2: 0.8, I2: 1, P1: 20, P2: 30, P3: 50, Q1: 40, Q2: 40, Q3: 20, M1: '=ER.ERDIRICHLETCORR("d",H1:I2,2)', N1: '=ER.ERDIRICHLETCORRIN(M1,P1:P3,1)', N2: '=ER.ERDIRICHLETCORRIN(M1,Q1:Q3,2)', A1: '=ER.ERDIRICHLETCORROUT(N1,1)', C1: '=ER.ERDIRICHLETCORROUT(N2,2)', B1: '=ER.EROUTPUT("s",SUM(A1:A3))', B2: '=ER.EROUTPUT("x",A1)', B3: '=ER.EROUTPUT("y",C1)' }).R.simulate({ iterations: 6000 });
  assert.ok(out(res, 's').every((v) => Math.abs(v - 1) < 1e-9));
  near(stats.mean(out(res, 'x')), 0.2, 0.004);
  const r = stats.pearson(out(res, 'x'), out(res, 'y'));
  assert.ok(r > 0.6 && r < 0.85, 'guide says achieved correlation sits a bit closer to zero: ' + r);
});
test('correlated multinomials sum to their total', async () => {
  const res = await setup({ H1: 1, H2: 0.8, I2: 1, P1: 20, P2: 30, P3: 50, Q1: 40, Q2: 40, Q3: 20, M1: '=ER.ERMULTINOMIALCORR("d",H1:I2,2)', N1: '=ER.ERMULTINOMIALCORRIN(M1,P1:P3,1)', N2: '=ER.ERMULTINOMIALCORRIN(M1,Q1:Q3,2)', A1: '=ER.ERMULTINOMIALCORROUT(N1,1)', C1: '=ER.ERMULTINOMIALCORROUT(N2,2)', B1: '=ER.EROUTPUT("s",SUM(A1:A3))', B2: '=ER.EROUTPUT("x",A1)', B3: '=ER.EROUTPUT("y",C1)' }).R.simulate({ iterations: 3000 });
  assert.ok(out(res, 's').every((v) => v === 100));
  assert.ok(stats.pearson(out(res, 'x'), out(res, 'y')) > 0.5);
});
test('truncation stays in bounds, and a hopeless range returns #NUM!', async () => {
  const res = await setup({ A1: '=ER.ERTRUNCATE(0,25,ER.ERNORMAL(15,5))', B1: '=ER.EROUTPUT("o",A1)' }).R.simulate({ iterations: 3000, settings: { maxTruncate: 100 } });
  assert.ok(out(res, 'o').every((v) => v >= 0 && v <= 25));
  const hopeless = await setup({ A1: '=ER.ERTRUNCATE(100,101,ER.ERNORMAL(0,1))', B1: '=ER.EROUTPUT("o",A1)' }).R.simulate({ iterations: 5 });
  assert.strictEqual(stats.summary(hopeless.outputs[0].values, 95).failed, 5);
  await assert.rejects(setup({ A1: '=ER.ERTRUNCATE(0,1,ER.ERDICE(6))', B1: '=ER.EROUTPUT("o",A1)' }).R.simulate({ iterations: 5 }), /cannot be embedded/);
});
test('ErConditional holds a draw until its condition is true again', async () => {
  const res = await setup({ I1: '=ER.ERITERATION()', A1: '=ER.ERCONDITIONAL(I1=1,ER.ERNORMAL(0,1))', A2: '=ER.ERCONDITIONAL(I1>3,I1)', B1: '=ER.EROUTPUT("o",A1)', B2: '=ER.EROUTPUT("p",A2)' }).R.simulate({ iterations: 6 });
  assert.strictEqual(new Set(out(res, 'o')).size, 1);
  assert.deepStrictEqual(out(res, 'p'), [0, 0, 0, 4, 5, 6]);
});
test('conditional firing: once per run, and none returns the mean', async () => {
  const cells = { A1: '=ER.ERNORMAL(7,1)', A2: '=ER.ERNORMAL(0,1)', A3: '=ER.ERNORMAL(3,9)', B1: '=ER.EROUTPUT("a",A1)', B2: '=ER.EROUTPUT("b",A2)', B3: '=ER.EROUTPUT("c",A3)' };
  const res = await setup(cells).R.simulate({ iterations: 50, runs: 3, settings: { conditionalOn: true, conditional: { 'S!A1|ErNormal': 'once', 'S!A3|ErNormal': 'none' } } });
  const a = out(res, 'a');
  for (const k of [0, 50, 100]) assert.strictEqual(new Set(a.slice(k, k + 50)).size, 1, 'one value per run');
  assert.strictEqual(new Set(a).size, 3, 'a new value each run');
  assert.ok(new Set(out(res, 'b')).size > 100);
  assert.ok(out(res, 'c').every((v) => v === 3));
});
test('store and retrieve see the previous iteration; first iteration is 0', async () => {
  const res = await setup({ I1: '=ER.ERITERATION()', A1: '=ER.ERSTORE("k",I1*10)', A2: '=ER.ERRETRIEVE("k")', B1: '=ER.EROUTPUT("o",A2)', A3: '=ER.ERSTOREARRAY("v",D1:D2)', D1: '=I1', D2: '=I1*2', E1: '=ER.ERRETRIEVEARRAY("v")', B2: '=ER.EROUTPUT("x",E2)' }).R.simulate({ iterations: 4 });
  assert.deepStrictEqual(out(res, 'o'), [0, 10, 20, 30]);
  assert.deepStrictEqual(out(res, 'x'), [0, 2, 4, 6]);
});
test('statistics become final at run end and feed ErRunOutput across runs', async () => {
  const { X, R } = setup({ A1: '=ER.ERNORMAL(10,1)', B1: '=ER.ERMEAN(A1)', B2: '=ER.ERSTDEV(A1)', B3: '=ER.ERMIN(A1)', B4: '=ER.ERMAX(A1)', B5: '=ER.ERTOTAL(A1)', B6: '=ER.ERPERCENTILE(A1,50)', B7: '=ER.ERCORRELATION(A1,A1)', C1: '=ER.ERRUNOUTPUT("runmean",B1)', C2: '=ER.EROUTPUT("o",A1)', C3: '=ER.ERRUNDATAARRAY("arr",B1)', D1: '=ER.ERDATA(A1,3)', E1: '=ER.ERDATAARRAY("all",A1)' });
  const res = await R.simulate({ iterations: 400, runs: 5, settings: { seed: 9 } });
  const rm = res.runOutputs.find((o) => o.name === 'runmean').values;
  assert.strictEqual(rm.length, 5);
  assert.strictEqual(new Set(rm).size, 5);
  const last = out(res, 'o').slice(-400);
  near(rm[4], stats.mean(last), 1e-9, 'last run mean');
  await X.calculate();
  near(X.display('S!B1'), stats.mean(last), 1e-9);
  near(X.display('S!B2'), stats.sd(last), 1e-9);
  near(X.display('S!B3'), Math.min(...last), 1e-9);
  near(X.display('S!B7'), 1, 1e-9);
  near(X.display('S!D1'), last[2], 1e-12, 'ErData');
  near(X.display('S!E1'), last[0], 1e-12, 'ErDataArray top');
  near(X.display('S!E400'), last[399], 1e-12, 'ErDataArray bottom');
  near(X.display('S!C7'), rm[4], 1e-12, 'ErRunDataArray bottom');
});
test('ErDataArray shows #NUM! before a run', async () => {
  const { X } = setup({ A1: '=ER.ERNORMAL(0,1)', E1: '=ER.ERDATAARRAY("all",A1)' });
  await X.calculate();
  assert.strictEqual(X.display('S!E1'), '#NUM!');
});
test('microsimulation pattern: effect drawn once per run, individuals every iteration', async () => {
  const res = await setup({ I1: '=ER.ERITERATION()', A1: '=ER.ERCONDITIONAL(I1=1,ER.ERRELATIVERISK(2,0.1))', A2: '=ER.EREXPONENTIAL(10)', A3: '=A2/A1', T1: '=ER.ERMEAN(A3)', C1: '=ER.ERRUNOUTPUT("pop",T1)' }).R.simulate({ iterations: 1000, runs: 40 });
  const v = res.runOutputs[0].values;
  near(stats.mean(v), 5.05, 0.15);
  assert.ok(stats.sd(v) > 0.3 && stats.sd(v) < 0.8);
});
// The guide's OptimizationIt example: draw data each iteration, hold it, fit a line, record the fit.
const fitCells = () => ({
  X1: 0, X2: 1, X3: 2,
  Y1: '=ER.ERBETA(300,700)', Y2: '=ER.ERBETA(270,730)', Y3: '=ER.ERBETA(240,760)',
  H1: 0.3, H2: -0.02,
  A1: '=ER.ERMINIMIZE("fit1",H1:H2)',
  Z1: '=A1+A2*X1', Z2: '=A1+A2*X2', Z3: '=A1+A2*X3',
  L1: '=ER.ERMINIMIZERESULT("fit1",SUMXMY2(Y1:Y3,Z1:Z3)*1000)',
  O1: '=ER.EROUTPUT("trend",A2)', O2: '=ER.EROUTPUT("sse",L1)', O3: '=ER.EROUTPUT("true trend",(Y3-Y1)/2)',
});
for (const [method, iters, opts] of [['quasiNewton', 40, { tolerance: 1e-6 }], ['downhill', 40, { tolerance: 1e-6 }], ['crossEntropy', 3, {}], ['annealing', 2, { maxTries: 60, startTemperature: 1 }]]) {
  test(`${method}: Iteration option fits within every iteration, and the fit matches the exact answer`, async () => {
    const { X, R } = setup(fitCells());
    const res = await R.simulate({ iterations: iters, optim: { name: 'fit1', method, on: 'iteration', options: opts } });
    assert.strictEqual(res.completed, iters);
    assert.ok(res.optim.evals > iters * 5, `optimiser ran inside each iteration (${res.optim.evals})`);
    const got = out(res, 'trend'), want = out(res, 'true trend');
    const tol = method === 'annealing' || method === 'crossEntropy' ? 0.01 : 0.001;
    got.forEach((v, i) => near(v, want[i], tol, `iteration ${i + 1}`));
    assert.ok(new Set(got).size === iters, 'each iteration has its own draws');
    await X.calculate();
  }, { timeout: 120000 });
}
test('Iteration option can fit on the first iteration only', async () => {
  const { R } = setup(fitCells());
  const res = await R.simulate({ iterations: 10, optim: { name: 'fit1', method: 'downhill', on: 'iteration', firstIterationOnly: true, options: { tolerance: 1e-6 } } });
  const t = out(res, 'trend');
  assert.strictEqual(new Set(t).size, 1, 'the first fit applies to all iterations');
  assert.ok(new Set(out(res, 'true trend')).size === 10, 'draws still change');
});
test('down-hill simplex default start follows the guide, and restarts run again from the best point', async () => {
  const opt = new Sg.Optimizer('downhill', [2, 4], { restarts: 0 });
  const seen = [opt.cur.slice()];
  opt.tell(1); seen.push(opt.cur.slice()); opt.tell(2); seen.push(opt.cur.slice());
  assert.deepStrictEqual(seen, [[2, 4], [2.2, 4], [2, 4.4]]);
  const f = (x) => (x[0] - 1) ** 2 + (x[1] + 3) ** 2;
  const run = (restarts) => { const o = new Sg.Optimizer('downhill', [2, 4], { restarts, tolerance: 1e-3 }); while (!o.done) o.tell(f(o.cur)); return o; };
  assert.ok(run(2).trace.length > run(0).trace.length);
  assert.ok(run(2).best.f <= run(0).best.f);
});
test('all four methods minimise a smooth function outside Excel', () => {
  const f = (x) => (x[0] - 3) ** 2 + 2 * (x[1] + 2) ** 2 + (x[0] - 3) * (x[1] + 2);
  for (const m of Object.keys(Sg.OPTIMIZERS)) {
    const o = new Sg.Optimizer(m, [1, 1], { u: Sg.RNGS.fast.make(11), tolerance: 1e-8, maxTries: m === 'annealing' ? 200 : m === 'crossEntropy' ? 100 : 5000 });
    while (!o.done) o.tell(f(o.cur));
    assert.ok(o.best.f < 0.02, `${m} best ${o.best.f} after ${o.trace.length}`);
  }
});
test('quasi-Newton fails on noise and down-hill simplex with the noisy rule stops by itself, as the guide warns', () => {
  const u = Sg.RNGS.fast.make(5), noisy = (x) => (x[0] - 3) ** 2 + (x[1] + 2) ** 2 + 0.3 * Sg.rNormal(u);
  const dn = new Sg.Optimizer('downhill', [1, 1], { noisy: true, noiseTolerance: 0.02, maxTries: 100000 });
  while (!dn.done) dn.tell(noisy(dn.cur));
  assert.ok(dn.trace.length < 100000, 'stopped by the noisy rule');
  near(dn.best.x[0], 3, 1.5); near(dn.best.x[1], -2, 1.5);
});
test('Run option: each loss evaluation is a whole run, with the run count set by the optimiser', async () => {
  // The guide's OptimizationRun example, with log-transformed Beta parameters to keep them positive.
  const { R } = setup({ C1: 3, C2: 3, B1: '=ER.ERMINIMIZE("fit2",C1:C2)', D1: '=EXP(B1)', D2: '=EXP(B2)', E1: '=ER.ERBETA(D1,D2)', F1: '=ER.ERMEAN(E1)', G1: 0.77, G2: 123, H1: '=(F1-G1)^2*2*G2+((D1+D2)-G2)^2/G2', L1: '=ER.ERMINIMIZERESULT("fit2",H1)', O1: '=ER.EROUTPUT("mean",F1)', P1: '=ER.ERRUNOUTPUT("sum",D1+D2)' });
  const res = await R.simulate({ iterations: 300, optim: { name: 'fit2', method: 'downhill', on: 'run', options: { noisy: true, noiseTolerance: 0.003, tolerance: 1e-5, maxTries: 400 } }, settings: { seed: 12 } });
  assert.ok(res.R > 5, 'runs set by the optimiser: ' + res.R);
  near(Math.exp(res.optim.x[0]) / (Math.exp(res.optim.x[0]) + Math.exp(res.optim.x[1])), 0.77, 0.03);
  near(Math.exp(res.optim.x[0]) + Math.exp(res.optim.x[1]), 123, 25);
}, { timeout: 120000 });
test('one-way tornado: documented ranges move one input at a time from the mean', async () => {
  const { R } = setup({ A1: '=ER.ERNORMAL(10,2)', A2: '=ER.ERNORMAL(5,1)', B1: '=ER.EROUTPUT("o",A1*2+A2)' });
  const sd = await R.univariate({ mode: 'sd' });
  assert.deepStrictEqual(sd.base, [25]);
  const r = sd.rows.find((x) => x.label === 'S!A1');
  assert.deepStrictEqual([r.low[0], r.high[0]], [21, 29]);
  const pct = await R.univariate({ mode: 'pct' });
  const q = pct.rows.find((x) => x.label === 'S!A2');
  assert.deepStrictEqual([q.low[0], q.high[0]], [24.5, 25.5]);
});
const sensModel = { A1: '=ER.ERNORMAL(10,2)', A2: '=ER.ERNORMAL(5,1)', A3: '=ER.ERGAMMA(4,1)', B1: '=ER.EROUTPUT("o",A1*A2+A3)' };
const K1 = 'S!A1|ErNormal', K2 = 'S!A2|ErNormal', K3 = 'S!A3|ErGamma';
test('one-way tornado: your own ranges, with empty fields using the interval', async () => {
  const { R } = setup(sensModel);
  const u = await R.univariate({ mode: 'custom', custom: { [K1]: [6, 20], [K2]: [NaN, 8] }, ci: 95 });
  const a = u.rows.find((x) => x.key === K1), b = u.rows.find((x) => x.key === K2);
  assert.deepStrictEqual([a.low[0], a.high[0]], [6 * 5 + 4, 20 * 5 + 4]);
  assert.ok(Math.abs(b.ranges[0].low - (5 - 1.96)) < 0.05, 'empty low uses the 2.5th percentile: ' + b.ranges[0].low);
  assert.strictEqual(b.ranges[0].high, 8);
});
test('one-way tornado: the interval option uses each distribution\'s own percentiles', async () => {
  const { R } = setup(sensModel);
  const u = await R.univariate({ mode: 'interval', ci: 95 });
  const g = u.rows.find((x) => x.key === K3).ranges[0];
  assert.ok(Math.abs(g.low - 1.09) < 0.05 && Math.abs(g.high - 8.77) < 0.1, `Gamma(4,1) interval ${g.low} to ${g.high}`);
});
test('grouped inputs move together as one tornado bar', async () => {
  const { R } = setup(sensModel);
  const u = await R.univariate({ mode: 'custom', custom: { [K1]: [8, 12], [K2]: [4, 6] }, groups: { [K1]: 'Effect', [K2]: 'Effect' } });
  assert.strictEqual(u.rows.length, 2, 'one group and one single input');
  const g = u.rows.find((x) => x.group === 'Effect');
  assert.deepStrictEqual([g.low[0], g.high[0]], [8 * 4 + 4, 12 * 6 + 4]);
  assert.strictEqual(g.ranges.length, 2);
});
test('two-way table: every combination, and the middle equals the base case', async () => {
  const { R } = setup(sensModel);
  const t = await R.twoWay({ mode: 'sd', a: K1, b: K2, steps: 3 });
  assert.deepStrictEqual(t.xs, [8, 10, 12]);
  assert.deepStrictEqual(t.ys, [4, 5, 6]);
  assert.strictEqual(t.grid[0][0][0], 8 * 4 + 4);
  assert.strictEqual(t.grid[2][0][0], 8 * 6 + 4, 'rows follow the input going up');
  assert.strictEqual(t.grid[1][2][0], 12 * 5 + 4);
  assert.strictEqual(t.grid[1][1][0], t.base[0]);
  await assert.rejects(R.twoWay({ mode: 'sd', a: K1, b: K1, steps: 3 }), /two different/);
});
test('scenarios set chosen inputs low, high or to a number, and the rest stay at their means', async () => {
  const { R } = setup(sensModel);
  const s = await R.scenarios({ mode: 'sd', list: [{ name: 'Best', set: { [K1]: 'high', [K2]: 'high' } }, { name: 'Worst', set: { [K1]: 'low', [K3]: 2 } }, { name: 'Same', set: {} }] });
  assert.strictEqual(s.rows[0].values[0], 12 * 6 + 4);
  assert.strictEqual(s.rows[1].values[0], 8 * 5 + 2);
  assert.strictEqual(s.rows[2].values[0], s.base[0]);
});
test('sensitivity analysis and scanning leave the last run\'s results in the sheet', async () => {
  const { R, X } = setup({ A1: '=ER.ERNORMAL(10,1)', B1: '=ER.ERMEAN(A1)', E1: '=ER.ERDATAARRAY("all",A1)', C1: '=ER.EROUTPUT("o",A1)' });
  const res = await R.simulate({ iterations: 50 });
  const mean = stats.mean(out(res, 'o'));
  await R.univariate({ mode: 'sd' });
  await R.inspect({});
  await X.calculate();
  near(X.display('S!B1'), mean, 1e-9, 'ErMean still shows the run');
  assert.ok(Number.isFinite(X.display('S!E50')), 'ErDataArray still shows the run');
});
// ---- Behaviour stated in the Ersatz Function Overview ----
test('Overview: conditional array store restarts at iteration 1 of each run, then adds (BreastCaMarkovMC pattern)', async () => {
  const { R } = setup({ I1: '=ER.ERITERATION()', D1: '=I1*10', S1: '=ER.ERCONDSTOREARRAY("sum",TRUE,D1:D1,2)', G1: '=ER.ERCONDRETRIEVEARRAY(S1,TRUE)', O1: '=ER.ERRUNOUTPUT("total",G1)' });
  const res = await R.simulate({ iterations: 4, runs: 3 });
  assert.deepStrictEqual(res.runOutputs[0].values, [100, 100, 100], 'each run sums its own iterations');
});
test('Overview: a store firing only at the end of a run carries across runs (ConditionalStore pattern)', async () => {
  const { R } = setup({ I1: '=ER.ERITERATION()', R1: '=ER.ERRUNNO()', D1: '=R1+1', S1: '=ER.ERCONDSTOREARRAY("pif",I1=2,D1:D1,1)', G1: '=ER.ERCONDRETRIEVEARRAY(S1,I1=2)', O1: '=ER.ERRUNOUTPUT("product",G1)' });
  const res = await R.simulate({ iterations: 2, runs: 3 });
  assert.deepStrictEqual(res.runOutputs[0].values, [2, 6, 24]);
});
test('Overview: a stored number is retrieved at the next iteration or run, and is 0 only on the very first', async () => {
  const { R } = setup({ I1: '=ER.ERITERATION()', U1: '=ER.ERRUNNO()', A1: '=ER.ERSTORE("k",U1*100+I1)', A2: '=ER.ERRETRIEVE("k")', B1: '=ER.ERRUNOUTPUT("last",A2)', B2: '=ER.EROUTPUT("o",A2)' });
  const res = await R.simulate({ iterations: 2, runs: 2, keepAll: true });
  assert.deepStrictEqual(Array.from(out(res, 'o')), [0, 101, 102, 201]);
});
test('Overview: parameter rules return #NUM! where documented', () => {
  const E = new Sg.Engine(), F = E.fns, num = (f) => assert.throws(f, (e) => e.code === 'NUM');
  const x = [[0], [1]], p = [[0], [0]], name26 = 'n'.repeat(26);
  num(() => F.ErSurvival('a', 'n', x, p, 0)); // sum of p must be above 0
  num(() => F.ErSurvival('a', '', x, [[0.1], [0.2]], 0));
  num(() => F.ErSurvival('a', name26, x, [[0.1], [0.2]], 0));
  num(() => F.ErSurvival('a', 'n', [[0], [1], [2]], [[0.1], [0.2]], 0));
  num(() => F.ErSurvival2('a', 'n', x, [[0.1], [0.2]], 0, 1));
  num(() => F.ErEmpirical('a', 'n', [[1], [2]], [[1]], true));
  assert.throws(() => F.ErEmpirical('a', 'n', [['x'], [2]], [[1], [2]], true), (e) => e.code === 'VALUE');
  E.phase = 'prime';
  E.names = new Map();
  F.ErMultinomial('m', 'mn', 2, 10);
  num(() => F.ErMultinomialCom('c', 'mn', 1, 0));
  num(() => F.ErMultinomialCom('c', 'mn', 1, 2.5));
  num(() => F.ErOneOffCostDisc('a', 5, 4, 1, 0.1));
  num(() => F.ErOneOffCostDisc('a', 1, 2, 1, -0.1));
  num(() => F.ErAnnualCostDisc('a', 5, 4, 8, 1, 0.1));
  num(() => F.ErHALYDisc('a', 0, 0, 1, 0, [[0], [1]], [[0.5]]));
  num(() => F.ErPercentile('a', 1, 101));
  assert.strictEqual(F.ErLYDisc('a', 0, 5, 2, 0.03), 0);
  assert.strictEqual(F.ErAnnualCostDisc('a', 0, 5, 2, 10, 0.03), 0);
  assert.strictEqual(Sg.DISTS.ErHypergeometric.check([0, 0, 0]), true, 'M may be 0');
});
test('Overview: survival longer than the table returns the highest x plus 1, whatever ct is', () => {
  const F = new Sg.Engine().fns, d = Sg.DISTS.ErSurvival2, x = [[0], [1], [2]], p = [[0.1], [0.1], [0.1]];
  const at = (ct, r) => d.sample(null, d.norm(['s', x, p, ct, r]));
  assert.strictEqual(at(0, 0.99), 3);
  assert.strictEqual(at(1.5, 0.99), 3);
  assert.strictEqual(at(5, 0.5), 3, 'beyond the table');
  assert.ok(at(1, 0.05) < 1, 'otherwise the remaining time is returned');
  void F;
});
test('multivariate measures rank the dominant input first', async () => {
  const { R } = setup({ A1: '=ER.ERNORMAL(0,5)', A2: '=ER.ERNORMAL(0,1)', A3: '=ER.ERUNIFORM(0,1)', B1: '=ER.EROUTPUT("o",EXP(A1/5)+A2*0.2)' });
  const res = await R.simulate({ iterations: 3000 });
  const y = out(res, 'o'), xs = res.inputs, get = (a) => xs.find((i) => i.addr === a).values;
  for (const f of [stats.pearson, stats.spearman, stats.kendall]) assert.ok(Math.abs(f(get('S!A1'), y)) > 0.5 && Math.abs(f(get('S!A3'), y)) < 0.1, f.name);
  const p = stats.prcc(xs.map((i) => i.values), y);
  assert.ok(Math.abs(p[xs.findIndex((i) => i.addr === 'S!A1')]) > 0.8);
  assert.ok(Math.abs(p[xs.findIndex((i) => i.addr === 'S!A3')]) < 0.1);
});
test('cancel stops cleanly and keeps partial results', async () => {
  const { R, X } = setup({ A1: '=ER.ERNORMAL(0,1)', B1: '=ER.EROUTPUT("o",A1)' });
  const res = await R.simulate({ iterations: 100000, onProgress: () => R.cancel() });
  assert.ok(res.cancelled && res.completed < 100000);
  assert.strictEqual(X.manual, false);
}, { timeout: 20000 });
test('discounting matches hand calculations', () => {
  const F = new Sg.Engine().fns;
  near(F.ErOneOffCostDisc('a', 2020, 2025, 1000, 0.03), 1000 / 1.03 ** 5, 1e-9);
  near(F.ErAnnualCostDisc('a', 0, 0, 10, 100, 0), 1000, 1e-9);
  near(F.ErLYDisc('a', 0, 0, 10, 0.03), (1 - 1.03 ** -10) / Math.log(1.03), 1e-9);
  assert.strictEqual(F.ErLYDisc('a', 0, 5, 2, 0.03), 0);
  assert.throws(() => F.ErLYDisc('a', 6, 5, 8, 0.03), (e) => e.code === 'NUM');
  near(F.ErHALYDisc('a', 0, 0, 2, 0, [[0], [1]], [[0.5], [0.8]]), 1.3, 1e-9);
  near(F.ErHALYDisc('a', 0, 0.5, 1.5, 0, [[0], [1]], [[0.5], [0.8]]), 0.65, 1e-9);
});
test('ErFixed wraps, ErSortedArray sorts column-wise, ErVersion answers', () => {
  const E = new Sg.Engine(), F = E.fns;
  assert.strictEqual(F.ErFixed('a', [[1], [2], [3]], 2), 1, 'first element when not running');
  E.phase = 'iter';
  assert.strictEqual(F.ErFixed('a', [[1], [2], [3]], 5), 2);
  assert.strictEqual(F.ErFixed('a', [[1, 3], [2, 4]], 3), 3, 'column-wise');
  assert.deepStrictEqual(F.ErSortedArray('a', [[3], [1], [2]], 1), [[1], [2], [3]]);
  assert.deepStrictEqual(F.ErSortedArray('a', [[3], [1], [2]], 0), [[3], [2], [1]]);
  assert.match(F.ErVersion(), /^Surrogate/);
});
test('conditional array store modes', async () => {
  const { X, R } = setup({ I1: '=ER.ERITERATION()', D1: '=I1', A1: '=ER.ERCONDSTOREARRAY("s",I1>1,D1:D1,2)', E1: '=ER.ERCONDRETRIEVEARRAY(A1,TRUE)', B1: '=ER.EROUTPUT("o",I1)' });
  await R.simulate({ iterations: 4 });
  await X.calculate();
  assert.strictEqual(X.display('S!E1'), 9, '2+3+4');
});
test('formula migration handles case, paths, strings and array formulas', () => {
  const c = Sg.convertFormula;
  assert.strictEqual(c('=ErNormal(0,1)'), '=ER.ERNORMAL(0,1)');
  assert.strictEqual(c('=ERNORMAL(0,1)+ergamma(1,2)'), '=ER.ERNORMAL(0,1)+ER.ERGAMMA(1,2)');
  assert.strictEqual(c("='C:\\Program Files\\Ersatz\\ersatzdll.xll'!ErBeta(1,2)"), '=ER.ERBETA(1,2)');
  assert.strictEqual(c('=ErOutput("ErNormal(x)",A1)'), '=ER.EROUTPUT("ErNormal(x)",A1)');
  assert.strictEqual(c('=ErRankCorrCom(A3,1,ErWeibull(5,2.1))'), '=ER.ERRANKCORRCOM(A3,1,ER.ERWEIBULL(5,2.1))');
  assert.strictEqual(c('=ER.ERNORMAL(0,1)'), '=ER.ERNORMAL(0,1)', 'already converted');
  assert.strictEqual(c('=ERROR.TYPE(A1)+Err(1)'), '=ERROR.TYPE(A1)+Err(1)', 'other functions untouched');
  assert.strictEqual(c('plain text ErNormal(1)'), 'plain text ErNormal(1)');
  const m = Sg.convertMatrix([['=ErDataArray("a",B1)', 5], ['=ErDataArray("a",B1)', '=ErNormal(0,1)'], ['=ErDataArray("a",B1)', '=ErNormal(0,1)']]);
  assert.deepStrictEqual(m.formulas, [['=ER.ERDATAARRAY("a",B1)', 5], ['', '=ER.ERNORMAL(0,1)'], ['', '=ER.ERNORMAL(0,1)']]);
  assert.strictEqual(m.cleared, 2);
});
test('the compiled path was used wherever it should be', () => {
  // Only the formulas chosen to be impossible to compile may fall back.
  const bad = (globalThis.__fellBack || []).filter(Boolean);
  assert.deepStrictEqual([...new Set(bad)], []);
});
test('catalogue: every documented function is implemented with a matching parameter count', () => {
  const E = new Sg.Engine();
  assert.strictEqual(Sg.SPEC.length, 88);
  for (const s of Sg.SPEC) assert.strictEqual(typeof E.fns[s.name], 'function', s.name);
  for (const n of Object.keys(E.fns)) assert.ok(Sg.SPEC_BY_NAME[n], 'not in catalogue: ' + n);
});
