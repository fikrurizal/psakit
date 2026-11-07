// Single-thread timings. Usage: node benchmarks/run-node.js
const Sg = require('../src/engine/index.js');
const M = require('./models.js');
(async () => {
  const run = async (label, cells, opts) => {
    const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X, { threads: 1 });
    X.setCells('S', cells);
    const t = Date.now();
    const res = await R.simulate(Object.assign({ settings: { seed: 3 } }, opts));
    const s = (Date.now() - t) / 1000;
    const st = res.info.stat || {};
    console.log(`${label.padEnd(34)} ${res.info.path.padEnd(9)} ${String(res.completed).padStart(9)} iter ${s.toFixed(2).padStart(8)} s ${Math.round(res.completed / s).toLocaleString().padStart(10)} iter/s  live ${st.liveFormulas ?? '-'} of ${st.totalFormulas ?? '-'}${res.info.why ? ' ' + res.info.why : ''}`);
    if (res.errors.length) console.log('  errors', res.errors.slice(0, 3));
    return res;
  };
  const r1 = await run('Markov, 14 x 2000 runs', M.markov(), { iterations: 14, runs: 2000 });
  console.log('   ', r1.runOutputs.map((o) => `${o.name}=${Sg.stats.mean(o.values).toFixed(3)}`).join(' '), 'failed', r1.runOutputs.map((o) => Sg.stats.summary(o.values, 95).failed).join());
  const r2 = await run('Micro, 2448 x 200 runs', M.micro(), { iterations: 2448, runs: 200 });
  console.log('   ', r2.runOutputs.map((o) => `${o.name}=${Sg.stats.mean(o.values).toFixed(3)}`).join(' '));
  await run('PSA, 600 live cells', M.psa(), { iterations: 100000 });
  await run('Excel-style path, Markov x 100 runs', M.markov(), { iterations: 14, runs: 100, speed: 'excel' });
  await run('Excel-style path, Micro x 2 runs', M.micro(), { iterations: 2448, runs: 2, speed: 'excel' });
})();
