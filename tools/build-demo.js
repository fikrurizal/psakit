// Builds dist/demo.html: the real task pane running against a simulated workbook, as one self-contained file.
const fs = require('fs'), path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const core = ['src/engine/rng.js', 'src/engine/dists.js', 'src/engine/stats.js', 'src/engine/optimize.js', 'src/engine/spec.js', 'src/engine/migrate.js', 'src/engine/formula.js', 'src/engine/xlruntime.js', 'src/engine/compiler.js', 'src/engine/engine.js', 'src/engine/runner.js', 'src/engine/pool.js'].map(r).join('\n;\n');
const workerSrc = core + `\n;{const state={};self.onmessage=(ev)=>{globalThis.Sg.workerHandle(state,ev.data,(m,t)=>self.postMessage(m,t));};}`;
const js = core + '\n;\n' + ['src/engine/example.js', 'tools/fake-excel.js', 'src/taskpane/charts.js', 'src/taskpane/report.js', 'src/taskpane/taskpane.js'].map(r).join('\n;\n') + `\n;globalThis.Sg.WORKER_SRC=${JSON.stringify(workerSrc)};globalThis.Sg.REPORT_ASSETS=${JSON.stringify({ css: r('src/taskpane/taskpane.css'), js: ['src/engine/stats.js', 'src/taskpane/charts.js', 'src/taskpane/report.js'].map(r).join('\n;\n') }).replace(/<\//g, '<\\/')};`;
const boot = `
(function () {
  const E = Sg.engine = new Sg.Engine(), X = new Sg.FakeExcel(E);
  try {
    const url = URL.createObjectURL(new Blob([Sg.WORKER_SRC], { type: 'text/javascript' }));
    Sg.makeWorker = () => new Worker(url);
  } catch (e) { /* the demo still runs on one thread */ }
  const paint = () => {
    const rows = Sg.EXAMPLE_ROWS;
    document.getElementById('sheet').innerHTML = rows.map((row, i) => {
      const n = i + 1;
      return '<tr><td class="f">' + n + '</td><td>' + (row[0] || '') + '</td><td class="f">' + String(row[1] === undefined ? '' : row[1]).replace(/</g, '&lt;') + '</td><td class="f">' + (row[3] || '') + '</td></tr>';
    }).join('');
  };
  X.writeSheet(Sg.EXAMPLE_NAME, Sg.EXAMPLE_ROWS);
  X.onChange = () => {};
  // The demo's live window covers the page, because a browser demo has no Excel dialog to open.
  X.openDashboard = (handlers) => {
    const o = document.createElement('div');
    o.className = 'live-overlay';
    document.body.appendChild(o);
    const close = () => { o.remove(); handlers.onClosed(); };
    const view = Sg.mountLive(o, { run: () => handlers.onMessage({ type: 'run' }), stop: () => handlers.onMessage({ type: 'stop' }), auto: () => {}, save: () => {} }, { onClose: close });
    return Promise.resolve({ immediate: true, close, send: (m) => { if (m.type === 'model') view.update(m.model); if (m.type === 'status') view.status(m); } });
  };
  paint();
  Sg.startPane(X).then(() => document.getElementById('run').click());
})();`;
const demoCss = `
.demo-pane .runbar { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); top: env(safe-area-inset-top, 0px); }
.demo-pane .progress { margin-left: -16px; margin-right: -16px; }
.demo-pane main { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.demo-pane .tabs { padding-left: 12px; padding-right: 12px; }
.demo-pane .alert { margin-left: 16px; margin-right: 16px; }
.demo-sheet { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
#toCsv, #rpSave, #rpCopy { display: none; }
`;
const inner = `<title>Surrogate Demo</title><meta name="claude:viewport-fit-sides" content="cover"><style>${r('src/taskpane/taskpane.css')}${demoCss}</style>
<div class="demo-shell"><div class="demo-pane">
${r('tools/pane-body.html')}
</div><section class="demo-sheet">
<h1>Simulated workbook</h1>
<p class="small muted">This is a browser demo of the task pane. A small stand-in plays the part of Excel and recalculates the model below on each iteration. The numbers in the model are invented.</p>
<div class="scrollx"><table><tbody id="sheet"></tbody></table></div>
</section></div>
<script>${js.replace(/<\/script/g, '<\\/script')}${boot}</script>`;
const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${inner}</body></html>`;
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'demo.html'), html);
if (process.argv[2]) fs.writeFileSync(process.argv[2], inner);
console.log('Wrote dist/demo.html', Math.round(html.length / 1024) + ' KB');
