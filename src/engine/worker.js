// Worker thread entry point for the add-in. The browser demo builds an equivalent from inlined source.
/* global importScripts */
importScripts('rng.js', 'dists.js', 'stats.js', 'optimize.js', 'spec.js', 'migrate.js', 'formula.js', 'xlruntime.js', 'compiler.js', 'engine.js', 'runner.js', 'pool.js');
{
  const state = {};
  self.onmessage = (ev) => { globalThis.Sg.workerHandle(state, ev.data, (m, t) => self.postMessage(m, t)); };
}
