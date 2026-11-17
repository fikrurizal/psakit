// Rewrites older formulas to PSAkit's names:
//   Ersatz:              =ErNormal(0,1), or with a path to ersatzdll.xll  ->  =PSA.NORMAL(0,1)
//   the prototype add-in: =ER.ERNORMAL(0,1)                                ->  =PSA.NORMAL(0,1)
// Text inside quotes is left alone, and so are names that aren't in the catalogue.
(function (Sg) {
  const LOWER = () => Sg._knownLower || (Sg._knownLower = new Map(Sg.SPEC.map((s) => [s.name.toLowerCase(), s.name])));
  const PROTOTYPE = /(?<![A-Za-z0-9_.])ER\.(ER[A-Za-z0-9]+)(\s*\()/gi;
  const ERSATZ = /(?:'[^']*\.xll'!|[A-Za-z0-9_.:\\\/\[\]-]*\.xll!)?(?<![A-Za-z0-9_.])(Er[A-Za-z0-9]+)(\s*\()/gi;
  const swap = (m, n, p) => { const name = LOWER().get(n.toLowerCase()); return name ? `${Sg.NAMESPACE}.${Sg.excelName(name)}${p}` : m; };
  Sg.convertFormula = function (f) {
    if (typeof f !== 'string' || f[0] !== '=') return f;
    return f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(PROTOTYPE, swap).replace(ERSATZ, swap))).join('');
  };
  // Multi-cell array formulas of array-returning functions become one spilling formula in the top-left cell.
  const ARRAY_FNS = ['ErMinimize', 'ErDataArray', 'ErRunDataArray', 'ErRetrieveArray', 'ErCondRetrieveArray', 'ErDirichletCorrOut', 'ErMultinomialCorrOut', 'ErSortedArray'];
  const ARR = () => Sg._arrRe || (Sg._arrRe = new RegExp(`${Sg.NAMESPACE}\\.(${ARRAY_FNS.map((n) => Sg.excelName(n)).join('|')})\\s*\\(`, 'i'));
  Sg.convertMatrix = function (formulas) {
    const out = formulas.map((r) => r.slice());
    let changed = 0, cleared = 0;
    for (let r = 0; r < out.length; r++) for (let c = 0; c < out[r].length; c++) {
      const orig = formulas[r][c], nf = Sg.convertFormula(orig);
      if (nf === orig) continue;
      if (ARR().test(nf) && ((r > 0 && formulas[r - 1][c] === orig) || (c > 0 && formulas[r][c - 1] === orig))) { out[r][c] = ''; cleared++; continue; }
      out[r][c] = nf; changed++;
    }
    return { formulas: out, changed, cleared };
  };
  Sg.hasLegacy = (f) => typeof f === 'string' && f[0] === '=' && Sg.convertFormula(f) !== f;
})(globalThis.Sg = globalThis.Sg || {});
