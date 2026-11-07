for (const f of ['rng', 'dists', 'stats', 'optimize', 'spec', 'migrate', 'formula', 'xlruntime', 'compiler', 'engine', 'runner', 'pool', 'example']) require(`./${f}.js`);
require('../../tools/fake-excel.js');
module.exports = globalThis.Sg;
