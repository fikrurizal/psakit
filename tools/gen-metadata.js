// Generates src/functions/functions.json from the catalogue. Run by "npm run build".
const fs = require('fs'), path = require('path');
const Sg = require('../src/engine/index.js');
const TYPE = { n: 'number', s: 'string', b: 'boolean', m: 'any' };
const functions = Sg.SPEC.map((f) => {
  const options = { requiresAddress: true };
  if (f.random || f.volatile) options.volatile = true;
  const result = f.result === 'm' ? { type: 'any', dimensionality: 'matrix' } : { type: f.result === 'n' ? 'number' : f.result === 's' ? 'string' : 'boolean', dimensionality: 'scalar' };
  return {
    id: Sg.excelName(f.name), name: Sg.excelName(f.name), description: f.desc,
    parameters: f.params.map((p) => {
      const [name, code] = p.split(':');
      return { name, description: name, type: TYPE[code], dimensionality: code === 'm' ? 'matrix' : 'scalar' };
    }),
    result, options,
  };
});
const out = path.join(__dirname, '..', 'src', 'functions', 'functions.json');
fs.writeFileSync(out, JSON.stringify({ functions }, null, 2) + '\n');
console.log(`Wrote ${functions.length} functions to ${path.relative(process.cwd(), out)}`);
