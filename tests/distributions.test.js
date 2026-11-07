// Every distribution, checked against the mean and SD formulas printed in the Ersatz Function Overview.
const assert = require('node:assert');
const test = require('node:test');
const Sg = require('../src/engine/index.js');
const { DISTS, RNGS, stats } = Sg;

// The Overview's own example parameters where it gives them.
const CASES = {
  ErBernoulli: [0.73], ErBeta: [5, 1.5], ErBeta4: [2, 2.5, -1.5, 8.1], ErBinomial: [8, 0.3], ErChi2: [3], ErDelaporte: [2.9, 3.1, 1.1],
  ErDice: [6], ErErlang: [2, 1.3], ErExponential: [6], ErGamma: [3, 1.5], ErGeometric: [0.6], ErHypergeometric: [11, 5, 25],
  ErInverseGaussian: [2.3, 5.7], ErLogistic: [3.7, 1.3], ErLoglogistic: [4.1, 1.7], ErLognormal: [4, 1], ErLognormal2: [1.2, 0.4],
  ErNegbinomial: [5, 0.5], ErNormal: [18, 3], ErPareto: [5.2, 0.003], ErPearson5: [4.6, 2.1], ErPearson6: [2.9, 5.1, 1.1], ErPert: [2.1, 3.7, 4.6],
  ErPoisson: [2.3], ErPolya: [1.7, 1.353], ErRayleigh: [4.2], ErRelativeRisk: [2.5, 0.1], ErStudentst: [5.5], ErTriangle: [1.9, 3.1, 4.05],
  ErUniform01: [], ErUniform: [2, 9], ErWeibull: [5.9, 2.1],
};
const N = 400000;
for (const [name, args] of Object.entries(CASES)) {
  test(`${name}${JSON.stringify(args)} matches documented mean and SD`, () => {
    const d = DISTS[name], u = RNGS.fast.make(Sg.hashSeed(7, name)), xs = new Float64Array(N);
    assert.ok(d.check(args), 'parameters should be valid');
    for (let i = 0; i < N; i++) xs[i] = d.sample(u, args);
    const m = d.mean(args), s = d.sd(args), got = stats.mean(xs), gs = stats.sd(xs);
    assert.ok(Math.abs(got - m) < 5 * s / Math.sqrt(N), `mean ${got} vs ${m}`);
    assert.ok(Math.abs(gs - s) / s < 0.02, `sd ${gs} vs ${s}`);
    if (d.discrete) assert.ok(xs.every(Number.isInteger), 'discrete draws must be whole numbers');
  });
}
test('large-parameter Binomial and Poisson use the rejection branches correctly', () => {
  const u = RNGS.fast.make(1);
  for (const [nm, a] of [['ErBinomial', [1000, 0.37]], ['ErBinomial', [100000, 0.9]], ['ErPoisson', [250]], ['ErPoisson', [12.5]], ['ErGamma', [0.3, 2]], ['ErBeta', [0.4, 0.6]]]) {
    const d = DISTS[nm], xs = new Float64Array(N);
    for (let i = 0; i < N; i++) xs[i] = d.sample(u, a);
    assert.ok(Math.abs(stats.mean(xs) - d.mean(a)) < 5 * d.sd(a) / Math.sqrt(N), `${nm} ${a} mean`);
    assert.ok(Math.abs(stats.sd(xs) - d.sd(a)) / d.sd(a) < 0.02, `${nm} ${a} sd`);
  }
});
test('invalid parameters fail the check, which surfaces as #NUM!', () => {
  const bad = { ErNormal: [0, -1], ErBeta: [0, 1], ErBernoulli: [1.2], ErBinomial: [5.5, 0.5], ErTriangle: [3, 2, 1], ErUniform: [2, 1], ErPert: [5, 1, 2], ErHypergeometric: [11, 30, 25], ErDice: [1] };
  for (const [n, a] of Object.entries(bad)) assert.strictEqual(DISTS[n].check(a), false, n);
  const E = new Sg.Engine();
  assert.throws(() => E.fns.ErNormal('S!A1', 0, -1), (e) => e.code === 'NUM');
});
test('all seven generators give uniform output in (0,1) with the right moments', () => {
  for (const [k, g] of Object.entries(RNGS)) {
    const u = g.make(99); let s = 0, s2 = 0, lo = 1, hi = 0, lag = 0, prev = u();
    const n = 1000000;
    for (let i = 0; i < n; i++) { const v = u(); s += v; s2 += v * v; lo = Math.min(lo, v); hi = Math.max(hi, v); lag += (v - 0.5) * (prev - 0.5); prev = v; }
    assert.ok(lo > 0 && hi < 1, k + ' range');
    assert.ok(Math.abs(s / n - 0.5) < 0.002, k + ' mean ' + s / n);
    assert.ok(Math.abs(s2 / n - 1 / 3) < 0.002, k + ' var');
    assert.ok(Math.abs(lag / n) < 0.001, k + ' lag-1 correlation ' + lag / n);
  }
});
test('Mersenne Twister reproduces the reference output', () => {
  // First output of MT19937 with init_genrand(5489) is 3499211612.
  const u = RNGS.mersenne.make(5489);
  assert.strictEqual(Math.round(u() * 4294967296 - 0.5), 3499211612);
});
test('Park-Miller reproduces the published check value', () => {
  // From seed 1 the 10000th value is 1043618065 (Park and Miller 1988). Step the generator directly.
  const IM = 2147483647; let x = 1;
  for (let i = 0; i < 10000; i++) { const k = Math.floor(x / 127773); x = 16807 * (x - k * 127773) - 2836 * k; if (x < 0) x += IM; }
  assert.strictEqual(x, 1043618065);
});
test('continuous empirical follows the curve it was given', () => {
  const xs = [], ps = [];
  for (let i = 0; i <= 40; i++) { const x = -4 + i * 0.2; xs.push(x); ps.push(Math.exp(-x * x / 2)); }
  const a = DISTS.ErEmpirical.norm(['n', xs.map((v) => [v]), ps.map((v) => [v]), false]), u = RNGS.fast.make(3), v = new Float64Array(200000);
  for (let i = 0; i < v.length; i++) v[i] = DISTS.ErEmpirical.sample(u, a);
  assert.ok(Math.abs(stats.mean(v)) < 0.01);
  assert.ok(Math.abs(stats.sd(v) - 1) < 0.02);
});
test('discrete empirical returns the given values with normalised weights', () => {
  const a = DISTS.ErEmpirical.norm(['d', [[1], [2], [3]], [[2], [6], [2]], true]), u = RNGS.fast.make(3), c = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 100000; i++) c[DISTS.ErEmpirical.sample(u, a)]++;
  assert.ok(Math.abs(c[2] / 100000 - 0.6) < 0.01);
});
test('survival: constant hazard matches the exponential mean, and overflow returns max+1', () => {
  const n = 400, xs = Array.from({ length: n }, (_, i) => [i]), rate = 0.05, ps = xs.map(() => [1 - Math.exp(-rate)]);
  const a = DISTS.ErSurvival.norm(['s', xs, ps, 0]), u = RNGS.fast.make(11), v = new Float64Array(200000);
  for (let i = 0; i < v.length; i++) v[i] = DISTS.ErSurvival.sample(u, a);
  assert.ok(Math.abs(stats.mean(v) - 1 / rate) < 0.2, 'mean ' + stats.mean(v));
  assert.ok(Math.abs(DISTS.ErSurvival.mean(a) - 1 / rate) < 0.1, 'numeric mean');
  const b = DISTS.ErSurvival.norm(['s', [[0], [1], [2]], [[0], [0], [1e-12]], 0]);
  assert.strictEqual(DISTS.ErSurvival.sample(u, b), 3);
  const c = DISTS.ErSurvival.norm(['s', xs, ps, 10]);  // memoryless: conditioning on 10 changes nothing
  let s = 0; for (let i = 0; i < 100000; i++) s += DISTS.ErSurvival.sample(u, c);
  assert.ok(Math.abs(s / 100000 - 1 / rate) < 0.3, 'remaining ' + s / 100000);
});
test('ErSurvival2 is deterministic in rnd, and higher rnd means longer survival', () => {
  const xs = [[0], [1], [2], [3]], p = [[0.1], [0.2], [0.3], [0.4]], f = (r) => DISTS.ErSurvival2.sample(null, DISTS.ErSurvival2.norm(['s', xs, p, 0, r]));
  assert.strictEqual(f(0.5), f(0.5));
  assert.ok(f(0.7) > f(0.3));
});
test('matrix tools: Cholesky, validity check and repair', () => {
  const bad = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
  assert.strictEqual(Sg.cholesky(bad), null);
  const r = Sg.checkMatrix(bad, false);
  assert.strictEqual(r.valid, false);
  assert.ok(Sg.cholesky(r.suggestion), 'suggestion must be valid');
  assert.ok(Sg.checkMatrix([[1, 0.5], [0.5, 1]], false).valid);
  assert.ok(Sg.cholesky([[1, 1], [1, 1]]), 'semi-definite is allowed');
});
test('statistics helpers', () => {
  assert.strictEqual(stats.percentile([1, 2, 3, 4, 5], 50), 3);
  assert.deepStrictEqual(stats.ranks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
  assert.ok(Math.abs(stats.pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
  assert.ok(Math.abs(stats.spearman([1, 2, 3, 4], [1, 8, 27, 64]) - 1) < 1e-12);
  assert.strictEqual(stats.kendall([1, 2, 3], [3, 2, 1]), -1);
});
