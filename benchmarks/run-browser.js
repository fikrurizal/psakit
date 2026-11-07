// Timings with real worker threads, in Chromium. Usage: PLAYWRIGHT_PATH=... node benchmarks/run-browser.js [threads]
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'demo.html'));
  await p.waitForFunction(() => /^Finished/.test(document.getElementById('status').textContent));
  await p.addScriptTag({ content: 'var module={};\n' + fs.readFileSync(path.join(__dirname, 'models.js'), 'utf8') + ';window.M=module.exports;' });
  const threads = +process.argv[2] || 2;
  const run = (label, model, opts) => p.evaluate(async ({ label, model, opts, threads }) => {
    const E = new Sg.Engine(), X = new Sg.FakeExcel(E), R = new Sg.Runner(E, X, { threads, forceWorkers: threads > 1 });
    X.setCells('S', M[model]());
    const t = performance.now(), res = await R.simulate(Object.assign({ settings: { seed: 3 } }, opts)), s = (performance.now() - t) / 1000;
    return { label, path: res.info.path, mode: res.info.mode, threads: res.info.threads, note: res.info.threadNote, iter: res.completed, seconds: +s.toFixed(2), perSec: Math.round(res.completed / s), checked: res.info.check && res.info.check.compared, errors: res.errors.length, out: res.runOutputs.map((o) => `${o.name}=${Sg.stats.mean(o.values).toFixed(2)}`).join(' ') };
  }, { label, model, opts, threads });
  console.log(await run('Markov stand-in: 14 iterations x 2000 runs', 'markov', { iterations: 14, runs: 2000 }));
  console.log(await run('Micro stand-in: 2448 iterations x 2000 runs', 'micro', { iterations: 2448, runs: 2000 }));
  console.log(await run('PSA, 610 live cells: 200,000 iterations', 'psa', { iterations: 200000 }));
  await b.close();
})();
