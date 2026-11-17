// Compiles a workbook to JavaScript. Three things make this fast, and each one also limits what gets compiled:
//  1. Formulas that don't depend on anything random keep the value Excel already calculated. They are never
//     recompiled, so unusual functions in the fixed part of a model cause no problem.
//  2. Formulas that nothing recorded depends on are skipped entirely.
//  3. What remains runs as plain JavaScript in dependency order, without crossing into Excel.
// Anything the compiler isn't sure about raises Unsupported, and the run falls back to Excel recalculation.
(function (Sg) {
  class Unsupported extends Error { constructor(msg, cell, fn) { super(Sg.publicText(msg)); this.cell = cell; this.fn = Sg.publicText(fn); this.unsupported = true; } }
  Sg.Unsupported = Unsupported;

  // Worksheet functions whose result doesn't depend on simulation state. The rest of the PSA. set is live.
  const ER_PURE = new Set(['ErOneOffCostDisc', 'ErAnnualCostDisc', 'ErLYDisc', 'ErHALYDisc', 'ErVersion', 'ErSortedArray']);
  const VOLATILE_DYNAMIC = new Set(['OFFSET', 'INDIRECT', 'CELL', 'INFO']);
  const STOCHASTIC_XL = new Set(['RAND', 'RANDBETWEEN', 'RANDARRAY']);
  const NS = Sg.NAMESPACE + '.';
  const ER_BY_UPPER = () => Sg.SPEC_BY_EXCEL;
  const erSpec = (fn) => (fn.startsWith(NS) ? ER_BY_UPPER().get(fn.slice(NS.length)) : null);

  const keyOf = (s, r, c) => s * 17179869184 + r * 16384 + c;
  const LOOKUP_FNS = new Set(['MATCH', 'VLOOKUP', 'HLOOKUP', 'LOOKUP', 'XLOOKUP', 'NA']);

  Sg.compileWorkbook = function (wb) {
    const sheetIdx = new Map(wb.sheets.map((s, i) => [s.name, i]));
    const sheets = wb.sheets, cells = new Map(), bounds = sheets.map(() => ({ r: 0, c: 0 }));
    const addrOf = (s, r, c) => `${sheets[s].name}!${Sg.colName(c)}${r + 1}`;
    sheets.forEach((sh, s) => {
      const { formulas, values, rowIndex: r0, columnIndex: c0 } = sh;
      for (let i = 0; i < formulas.length; i++) for (let j = 0; j < formulas[i].length; j++) {
        const f = formulas[i][j], v = values ? values[i][j] : f;
        if (f === '' && (v === '' || v === undefined || v === null)) continue;
        const isF = typeof f === 'string' && f[0] === '=';
        const r = r0 + i, c = c0 + j;
        cells.set(keyOf(s, r, c), { s, r, c, f: isF ? f : null, v: isF ? v : (values ? v : f), live: false, need: false, slot: -1, ty: null });
        if (r > bounds[s].r) bounds[s].r = r;
        if (c > bounds[s].c) bounds[s].c = c;
      }
    });
    const names = new Map();
    for (const n of wb.names || []) {
      try { names.set(n.name.toUpperCase(), Sg.parseFormula(String(n.formula))); } catch (e) { names.set(n.name.toUpperCase(), { t: 'opaque' }); }
    }

    // ---- Parse, find dependencies -------------------------------------------------------------
    const clip = (node, s) => ({ r2: Math.min(node.r2, bounds[s].r), c2: Math.min(node.c2, bounds[s].c) });
    const sheetOf = (node, cur) => {
      if (node.sheet === null || node.sheet === undefined) return cur;
      const k = sheetIdx.get(node.sheet);
      if (k === undefined) throw new Error('Unknown sheet ' + node.sheet);
      return k;
    };
    const formulaCells = [];
    for (const cell of cells.values()) {
      if (cell.f === null) continue;
      formulaCells.push(cell);
      try { cell.ast = Sg.parseFormula(cell.f); } catch (e) { cell.opaque = e.message; cell.ast = null; }
    }
    // Multi-cell legacy array formulas repeat the same text in each cell. The top-left cell becomes the anchor.
    const ARRAY_FN = new Set(['ErMinimize', 'ErRetrieveArray', 'ErCondRetrieveArray', 'ErDirichletCorrOut', 'ErMultinomialCorrOut', 'ErSortedArray', 'ErDataArray', 'ErRunDataArray']);
    const topErArray = (cell) => { if (!cell.ast || cell.ast.t !== 'call') return null; const s = erSpec(cell.ast.fn); return s && ARRAY_FN.has(s.name) ? s : null; };
    const spillChild = new Map();
    const dimsOf = (node, curSheet) => {
      if (!node) return null;
      if (node.t === 'ref') { const s = sheetOf(node, curSheet), k = clip(node, s); return { rows: k.r2 - node.r1 + 1, cols: k.c2 - node.c1 + 1 }; }
      if (node.t === 'name') { const a = names.get(node.v.toUpperCase()); return a && a.t === 'ref' ? dimsOf(a, curSheet) : null; }
      return null;
    };
    const refCell = (node, s0) => (node && node.t === 'ref' && node.r1 === node.r2 && node.c1 === node.c2 ? cells.get(keyOf(sheetOf(node, s0), node.r1, node.c1)) : null);
    // A retrieve gets its shape from its matching store, found by link or by a name typed as text.
    const storeShape = (nameArg, cell, argIdx) => {
      const direct = refCell(nameArg, cell.s);
      if (direct && direct.ast && direct.ast.t === 'call') return dimsOf(direct.ast.args[argIdx], direct.s);
      if (nameArg.t !== 'str') return null;
      const wanted = argIdx === 1 ? 'ErStoreArray' : 'ErCondStoreArray';
      for (const c of formulaCells) {
        if (!c.ast || c.ast.t !== 'call') continue;
        const sp = erSpec(c.ast.fn);
        if (sp && sp.name === wanted && c.ast.args[0] && c.ast.args[0].t === 'str' && c.ast.args[0].v === nameArg.v) return dimsOf(c.ast.args[argIdx], c.s);
      }
      return null;
    };
    const staticShape = (cell) => {
      const spec = topErArray(cell), a = cell.ast.args;
      switch (spec.name) {
        case 'ErMinimize': return dimsOf(a[1], cell.s);
        case 'ErSortedArray': return dimsOf(a[0], cell.s);
        case 'ErDirichletCorrOut': case 'ErMultinomialCorrOut': { const inC = refCell(a[0], cell.s); return inC && inC.ast && inC.ast.t === 'call' ? dimsOf(inC.ast.args[1], inC.s) : null; }
        case 'ErRetrieveArray': return storeShape(a[0], cell, 1);
        case 'ErCondRetrieveArray': return storeShape(a[0], cell, 2);
        default: return { rows: 1, cols: 1 };
      }
    };
    for (const cell of formulaCells) {
      if (!topErArray(cell) || spillChild.has(keyOf(cell.s, cell.r, cell.c))) continue;
      const shape = staticShape(cell);
      if (!shape) continue;
      cell.spill = shape;
      for (let i = 0; i < shape.rows; i++) for (let j = 0; j < shape.cols; j++) {
        if (i || j) spillChild.set(keyOf(cell.s, cell.r + i, cell.c + j), { anchor: cell, i, j });
      }
    }
    for (const [k] of spillChild) { const ch = cells.get(k); if (ch) cells.delete(k); }

    const liveRoots = [];
    const addDep = (deps, s, r, c) => {
      const k = keyOf(s, r, c), ch = spillChild.get(k);
      if (ch) { deps.add(ch.anchor); return; }
      const d = cells.get(k);
      if (d && d.f !== null) deps.add(d);
    };
    const walk = (node, cell, deps) => {
      if (!node) return;
      switch (node.t) {
        case 'ref': {
          const s = sheetOf(node, cell.s), k = clip(node, s);
          for (let r = node.r1; r <= k.r2; r++) for (let c = node.c1; c <= k.c2; c++) addDep(deps, s, r, c);
          break;
        }
        case 'name': {
          const a = names.get(node.v.toUpperCase());
          if (!a || a.t === 'opaque') { cell.opaque = cell.opaque || `name ${node.v}`; break; }
          walk(a, cell, deps);
          break;
        }
        case 'bin': walk(node.l, cell, deps); walk(node.r, cell, deps); break;
        case 'neg': walk(node.e, cell, deps); break;
        case 'call':
          if (VOLATILE_DYNAMIC.has(node.fn)) { cell.dynamic = node.fn; }
          if (STOCHASTIC_XL.has(node.fn)) { cell.seed = true; cell.usesRand = true; }
          if (node.fn.startsWith(NS)) {
            const sp = erSpec(node.fn);
            if (sp && !ER_PURE.has(sp.name)) cell.seed = true;
            if (sp && !ER_PURE.has(sp.name)) cell.erRoot = true;
          }
          node.args.forEach((a) => walk(a, cell, deps));
          break;
        default:
      }
    };
    for (const cell of formulaCells) {
      if (!cells.has(keyOf(cell.s, cell.r, cell.c))) continue;
      cell.deps = new Set();
      try { walk(cell.ast, cell, cell.deps); } catch (e) { cell.opaque = e.message; }
      if (cell.seed) liveRoots.push(cell);
    }
    const allF = formulaCells.filter((c) => cells.has(keyOf(c.s, c.r, c.c)));
    const rdeps = new Map();
    for (const c of allF) for (const d of c.deps) { if (!rdeps.has(d)) rdeps.set(d, []); rdeps.get(d).push(c); }

    // A formula we can't read, or one with references only known at run time, could depend on anything.
    const unknown = allF.filter((c) => c.opaque || c.dynamic);
    const queue = liveRoots.concat(unknown);
    for (const c of queue) c.live = true;
    for (let i = 0; i < queue.length; i++) for (const d of rdeps.get(queue[i]) || []) if (!d.live) { d.live = true; queue.push(d); }

    // Keep only what the PSA. functions need.
    const needed = [];
    for (const c of allF) if (c.erRoot || c.opaque || c.dynamic) { c.need = true; needed.push(c); }
    if (!needed.length) throw new Unsupported('No PSA. functions found in this workbook.');
    for (let i = 0; i < needed.length; i++) for (const d of needed[i].deps) if (d.live && !d.need) { d.need = true; needed.push(d); }
    const usesRand = needed.some((c) => c.usesRand);

    // ---- Calculation order --------------------------------------------------------------------
    const pending = new Map();
    const dependants = new Map();
    for (const c of needed) {
      let n = 0;
      for (const d of c.deps) if (d.need && d !== c) { n++; if (!dependants.has(d)) dependants.set(d, []); dependants.get(d).push(c); }
      if (c.deps.has(c)) throw new Unsupported(`Cell ${addrOf(c.s, c.r, c.c)} refers to itself.`, addrOf(c.s, c.r, c.c));
      pending.set(c, n);
    }
    const order = [];
    const ready = needed.filter((c) => pending.get(c) === 0);
    for (let i = 0; i < ready.length; i++) {
      const c = ready[i];
      order.push(c);
      for (const d of dependants.get(c) || []) { const n = pending.get(d) - 1; pending.set(d, n); if (n === 0) ready.push(d); }
    }
    if (order.length !== needed.length) {
      const stuck = needed.find((c) => pending.get(c) > 0);
      throw new Unsupported(`Formulas around ${addrOf(stuck.s, stuck.r, stuck.c)} form a circular reference.`, addrOf(stuck.s, stuck.r, stuck.c));
    }

    // ---- Storage ------------------------------------------------------------------------------
    let nSlots = 1; // slot 0 is the shared blank cell
    const slotCells = new Map();
    const slotOf = (s, r, c) => {
      const k = keyOf(s, r, c), ch = spillChild.get(k);
      if (ch) {
        const a = ch.anchor;
        if (!a.need) { const ov = spillValue(s, r, c); let st = slotCells.get(k); if (st === undefined) { st = nSlots++; slotCells.set(k, st); fixedInit.set(st, ov); } return st; }
        let st = slotCells.get(k);
        if (st === undefined) { st = nSlots++; slotCells.set(k, st); }
        return st;
      }
      const cell = cells.get(k);
      if (!cell) return 0;
      if (cell.slot < 0) { cell.slot = nSlots++; if (!cell.need) fixedInit.set(cell.slot, cell.v); }
      return cell.slot;
    };
    const fixedInit = new Map();
    // Values Excel computed for spilled cells of an anchor that didn't need compiling.
    const spillRaw = new Map();
    sheets.forEach((sh, s) => {
      const { formulas, values, rowIndex: r0, columnIndex: c0 } = sh;
      if (!values) return;
      for (let i = 0; i < values.length; i++) for (let j = 0; j < values[i].length; j++) {
        const k = keyOf(s, r0 + i, c0 + j);
        if (spillChild.has(k)) spillRaw.set(k, values[i][j]);
      }
      void formulas;
    });
    const spillValue = (s, r, c) => { const v = spillRaw.get(keyOf(s, r, c)); return v === undefined ? '' : v; };

    const rangeTable = [];
    const rangeMemo = new Map();
    const rangeOf = (node, cellSheet) => {
      const s = sheetOf(node, cellSheet), k = clip(node, s), rows = k.r2 - node.r1 + 1, cols = k.c2 - node.c1 + 1;
      if (rows < 1 || cols < 1) return { rows: 0, cols: 0, code: null };
      const memoK = `${s}:${node.r1}:${node.c1}:${k.r2}:${k.c2}`;
      let id = rangeMemo.get(memoK);
      if (id === undefined) {
        const idx = new Int32Array(rows * cols), blank = new Uint8Array(rows * cols);
        let fixed = true, p = 0;
        for (let r = node.r1; r <= k.r2; r++) for (let c = node.c1; c <= k.c2; c++, p++) {
          const kk = keyOf(s, r, c), ch = spillChild.get(kk), cell = cells.get(kk);
          if (ch) { idx[p] = slotOf(s, r, c); if (ch.anchor.need) fixed = false; continue; }
          if (!cell) { idx[p] = 0; blank[p] = 1; continue; }
          idx[p] = slotOf(s, r, c);
          if (cell.need) fixed = false;
        }
        id = rangeTable.length;
        rangeTable.push({ idx, blank, rows, cols, fixed });
        rangeMemo.set(memoK, id);
      }
      return { rows, cols, code: `R[${id}]`, id };
    };

    // Static type of each cell: n number, b boolean (0/1 in N), s text, v could be any of them.
    const valType = (v) => (typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : typeof v === 'string' ? (/^#(N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/.test(v) ? 'e' : v === '' ? 'blank' : 's') : 'blank');
    const addrs = []; const addrIdx = new Map();
    const A = (a) => { let k = addrIdx.get(a); if (k === undefined) { k = addrs.length; addrs.push(a); addrIdx.set(a, k); } return `A[${k}]`; };
    const fnList = []; const fnIdx = new Map();
    const FN = (name) => { let k = fnIdx.get(name); if (k === undefined) { k = fnList.length; fnList.push(name); fnIdx.set(name, k); } return `F[${k}]`; };
    const lit = (x) => (x !== x ? 'NaN' : JSON.stringify(x));

    let tDepth = 0, maxT = 0, curCell = null;
    const newT = () => { const t = `t${tDepth++}`; if (tDepth > maxT) maxT = tDepth; return t; };
    const relT = () => { tDepth--; };
    const bad = (msg, fn) => { throw new Unsupported(msg, curCell ? addrOf(curCell.s, curCell.r, curCell.c) : undefined, fn); };

    const cellRead = (s, r, c) => {
      const k = keyOf(s, r, c), ch = spillChild.get(k);
      if (ch) { const sl = slotOf(s, r, c); return { c: `$.val(${sl})`, ty: 'v' }; }
      const cell = cells.get(k);
      if (!cell) return { c: '0', ty: 'n', blank: true };
      if (!cell.need) {
        const t = valType(cell.v);
        if (t === 'n') return { c: Number.isFinite(cell.v) ? String(cell.v) : 'NaN', ty: 'n' };
        if (t === 'b') return { c: cell.v ? '1' : '0', ty: 'b' };
        if (t === 'e') return { c: 'NaN', ty: 'n' };
        if (t === 's') return { c: JSON.stringify(cell.v), ty: 's' };
        return { c: cell.f ? '""' : '0', ty: cell.f ? 's' : 'n', blank: !cell.f };
      }
      const sl = slotOf(s, r, c);
      if (cell.ty === 'n') return { c: `N[${sl}]`, ty: 'n' };
      if (cell.ty === 'b') return { c: `N[${sl}]`, ty: 'b' };
      return { c: `$.val(${sl})`, ty: 'v' };
    };
    const num = (e) => { if (e.ty === 'n' || e.ty === 'b') return e.c; if (e.ty === 'r' || e.ty === 'a') bad('A range is used where a single value is needed.'); return `$.num(${e.c})`; };
    const toV = (e) => { if (e.ty === 'b') return `$.b2v(${e.c})`; if (e.ty === 'r' || e.ty === 'a') bad('A range is used where a single value is needed.'); return e.c; };
    const boolish = (e) => { if (e.ty === 'b') return e.c; if (e.ty === 'n') return `$.bool(${e.c})`; if (e.ty === 'r' || e.ty === 'a') bad('A range is used where a single value is needed.'); return `$.bool(${e.c})`; };
    const strOf = (e) => { if (e.ty === 's') return e.c; return `$.str(${toV(e)})`; };

    const scalar = (e) => { if (e.ty === 'r' || e.ty === 'a') bad('A range is used where a single value is needed.'); return e; };
    const isRange = (e) => e.ty === 'r';
    const asArr = (e) => { if (e.ty === 'a') return e.c; if (e.ty === 'r') return `$.arr(${e.c})`; bad('Expected a range.'); return null; };
    const listArg = (e) => { if (e.ty === 'r' || e.ty === 'a') return e.c; return num(e); };

    function gen(node, s) {
      switch (node.t) {
        case 'num': return { c: Number.isFinite(node.v) ? String(node.v) : 'NaN', ty: 'n', k: node.v };
        case 'str': return { c: JSON.stringify(node.v), ty: 's', k: node.v };
        case 'bool': return { c: node.v ? '1' : '0', ty: 'b' };
        case 'err': return { c: 'NaN', ty: 'n' };
        case 'omit': return { c: '0', ty: 'n', omit: true };
        case 'opaque': bad('A defined name could not be read.'); break;
        case 'array': return { c: `$.lit(${JSON.stringify(node.rows)})`, ty: 'a' };
        case 'name': {
          const a = names.get(node.v.toUpperCase());
          if (!a) bad(`Unknown name ${node.v}.`);
          return gen(a, s);
        }
        case 'ref': {
          const sh = sheetOf(node, s);
          if (node.r1 === node.r2 && node.c1 === node.c2) return cellRead(sh, node.r1, node.c1);
          const r = rangeOf(node, s);
          if (!r.code) bad('A reference points to an empty area.');
          return { c: r.code, ty: 'r', rows: r.rows, cols: r.cols, id: r.id };
        }
        case 'neg': {
          const e = gen(node.e, s);
          if (e.ty === 'r' || e.ty === 'a') return { c: `$.aneg(${asArr(e)})`, ty: 'a' };
          return { c: `(-${num(e)})`, ty: 'n' };
        }
        case 'bin': return genBin(node, s);
        case 'call': return genCall(node, s);
        default: bad('Unknown expression.');
      }
      return null;
    }
    function genBin(node, s) {
      const l = gen(node.l, s), r = gen(node.r, s), op = node.op;
      if (l.ty === 'r' || l.ty === 'a' || r.ty === 'r' || r.ty === 'a') {
        if (op === '&') bad('Joining text across a range is not compiled.');
        const X = l.ty === 'r' || l.ty === 'a' ? asArr(l) : num(l), Y = r.ty === 'r' || r.ty === 'a' ? asArr(r) : num(r);
        return { c: `$.aop(${JSON.stringify(op)},${X},${Y})`, ty: 'a' };
      }
      switch (op) {
        case '+': return { c: `(${num(l)}+${num(r)})`, ty: 'n' };
        case '-': return { c: `(${num(l)}-${num(r)})`, ty: 'n' };
        case '*': return { c: `(${num(l)}*${num(r)})`, ty: 'n' };
        case '/': return { c: `$.div(${num(l)},${num(r)})`, ty: 'n' };
        case '^': return { c: `$.pow(${num(l)},${num(r)})`, ty: 'n' };
        case '&': return { c: `$.cat(${toV(l)},${toV(r)})`, ty: 'v' };
        default: {
          const names2 = { '=': 'eq', '<>': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' };
          if (l.ty === 'n' && r.ty === 'n' && !l.blank && !r.blank) return { c: `$.${names2[op]}(${l.c},${r.c})`, ty: 'b' };
          const a = l.blank ? 'null' : toV(l), b = r.blank ? 'null' : toV(r);
          return { c: `$.cmp(${JSON.stringify(op)},${a},${b})`, ty: 'b' };
        }
      }
    }
    const unify = (es) => {
      const tys = new Set(es.map((e) => e.ty));
      if (tys.size === 1) { const t = [...tys][0]; return t === 's' ? 'v' : t; }
      return 'v';
    };
    const conv = (e, ty) => (ty === 'n' || ty === 'b' ? e.c : toV(e));

    const simple = (f, nArgs) => (args, s) => {
      if (args.length < nArgs[0] || args.length > nArgs[1]) bad(`Wrong number of arguments for ${f}.`, f);
      return { c: `$.${f}(${args.map((a) => num(scalar(gen(a, s)))).join(',')})`, ty: 'n' };
    };
    const mathCall = (f) => (args, s) => {
      if (args.length !== 1) bad(`Wrong number of arguments for ${f}.`, f);
      return { c: `Math.${f}(${num(scalar(gen(args[0], s)))})`, ty: 'n' };
    };
    const aggregate = (f) => (args, s) => {
      const es = args.map((a) => gen(a, s));
      return { c: `$.${f}([${es.map(listArg).join(',')}])`, ty: 'n' };
    };
    const rangeOnly = (e, f) => { if (e.ty !== 'r') bad(`${f} needs a range here.`, f); return e.c; };
    const rangeOrCell = (node, s, f) => {
      if (node.t === 'name') { const a = names.get(node.v.toUpperCase()); if (a) return rangeOrCell(a, s, f); }
      if (node.t !== 'ref') bad(`${f} needs a range here.`, f);
      const r = rangeOf(node, s);
      if (!r.code) bad(`${f} refers to an empty area.`, f);
      return r.code;
    };
    const stat1 = (f) => (args, s) => { if (args.length !== 2) bad(`Wrong number of arguments for ${f}.`, f); return { c: `$.${f}(${rangeOrCell(args[0], s, f)},${num(scalar(gen(args[1], s)))})`, ty: 'n' }; };
    const twoRange = (f) => (args, s) => { if (args.length !== 2) bad(`Wrong number of arguments for ${f}.`, f); return { c: `$.${f}(${rangeOrCell(args[0], s, f)},${rangeOrCell(args[1], s, f)})`, ty: 'n' }; };

    // Excel functions the compiler handles. Everything else falls back to Excel.
    const XL = {
      ABS: mathCall('abs'), SIN: mathCall('sin'), COS: mathCall('cos'), TAN: mathCall('tan'), ATAN: mathCall('atan'),
      SQRT: simple('SQRT', [1, 1]), EXP: simple('EXP', [1, 1]), LN: simple('LN', [1, 1]), LOG10: simple('LOG10', [1, 1]), LOG: simple('LOG', [1, 2]),
      INT: simple('INT', [1, 1]), TRUNC: simple('TRUNC', [1, 2]), ROUND: simple('ROUND', [2, 2]), ROUNDUP: simple('ROUNDUP', [2, 2]), ROUNDDOWN: simple('ROUNDDOWN', [2, 2]),
      MOD: simple('MOD', [2, 2]), SIGN: simple('SIGN', [1, 1]), CEILING: simple('CEILING', [2, 2]), FLOOR: simple('FLOOR', [2, 2]), MROUND: simple('MROUND', [2, 2]),
      'CEILING.MATH': null, 'FLOOR.MATH': null,
      POWER: (a, s) => { if (a.length !== 2) bad('Wrong number of arguments for POWER.', 'POWER'); return { c: `$.pow(${num(scalar(gen(a[0], s)))},${num(scalar(gen(a[1], s)))})`, ty: 'n' }; },
      PI: () => ({ c: String(Math.PI), ty: 'n' }),
      FACT: simple('FACT', [1, 1]), COMBIN: simple('COMBIN', [2, 2]), GAMMALN: simple('GAMMALN', [1, 1]), 'GAMMALN.PRECISE': simple('GAMMALN', [1, 1]), GAMMA: simple('GAMMA', [1, 1]),
      ATAN2: simple('ATAN2', [2, 2]), ASIN: simple('ASIN', [1, 1]), ACOS: simple('ACOS', [1, 1]),
      SUM: (args, s) => {
        const es = args.map((a) => gen(a, s));
        return { c: '(' + es.map((e) => (e.ty === 'r' ? `$.sumR(${e.c})` : e.ty === 'a' ? `$.SUM([${e.c}])` : num(e))).join('+') + ')', ty: 'n' };
      },
      AVERAGE: aggregate('AVERAGE'), MEDIAN: aggregate('MEDIAN'), PRODUCT: aggregate('PRODUCT'),
      STDEV: aggregate('STDEV'), 'STDEV.S': aggregate('STDEV'), STDEVP: aggregate('STDEVP'), 'STDEV.P': aggregate('STDEVP'),
      VAR: aggregate('VAR'), 'VAR.S': aggregate('VAR'), VARP: aggregate('VARP'), 'VAR.P': aggregate('VARP'),
      SUMSQ: aggregate('SUMSQ'), GEOMEAN: aggregate('GEOMEAN'), HARMEAN: aggregate('HARMEAN'),
      MIN: (args, s) => { const es = args.map((a) => gen(a, s)); if (es.length === 1 && es[0].ty === 'r') return { c: `$.minR(${es[0].c})`, ty: 'n' }; return { c: `$.MIN([${es.map(listArg).join(',')}])`, ty: 'n' }; },
      MAX: (args, s) => { const es = args.map((a) => gen(a, s)); if (es.length === 1 && es[0].ty === 'r') return { c: `$.maxR(${es[0].c})`, ty: 'n' }; return { c: `$.MAX([${es.map(listArg).join(',')}])`, ty: 'n' }; },
      COUNT: (args, s) => { const es = args.map((a) => gen(a, s)); if (es.length === 1 && es[0].ty === 'r') return { c: `$.countR(${es[0].c})`, ty: 'n' }; if (es.some((e) => e.ty !== 'r' && e.ty !== 'n')) bad('COUNT with direct text or logical arguments is not compiled.', 'COUNT'); return { c: `$.COUNT([${es.map(listArg).join(',')}])`, ty: 'n' }; },
      COUNTA: (args, s) => { const es = args.map((a) => gen(a, s)); if (es.some((e) => e.ty === 'a')) bad('COUNTA over an array expression is not compiled.', 'COUNTA'); return { c: `$.COUNTA([${es.map((e) => (e.ty === 'r' ? e.c : e.blank ? 'undefined' : '1')).join(',')}])`, ty: 'n' }; },
      COUNTBLANK: (args, s) => ({ c: `$.COUNTBLANK(${rangeOrCell(args[0], s, 'COUNTBLANK')})`, ty: 'n' }),
      LARGE: stat1('LARGE'), SMALL: stat1('SMALL'),
      PERCENTILE: (a, s) => ({ c: `$.PCTINC(${rangeOrCell(a[0], s, 'PERCENTILE')},${num(scalar(gen(a[1], s)))})`, ty: 'n' }),
      'PERCENTILE.INC': (a, s) => ({ c: `$.PCTINC(${rangeOrCell(a[0], s, 'PERCENTILE')},${num(scalar(gen(a[1], s)))})`, ty: 'n' }),
      'PERCENTILE.EXC': (a, s) => ({ c: `$.PCTEXC(${rangeOrCell(a[0], s, 'PERCENTILE')},${num(scalar(gen(a[1], s)))})`, ty: 'n' }),
      QUARTILE: (a, s) => ({ c: `$.QUARTINC(${rangeOrCell(a[0], s, 'QUARTILE')},${num(scalar(gen(a[1], s)))})`, ty: 'n' }),
      'QUARTILE.INC': (a, s) => ({ c: `$.QUARTINC(${rangeOrCell(a[0], s, 'QUARTILE')},${num(scalar(gen(a[1], s)))})`, ty: 'n' }),
      RANK: (a, s) => ({ c: `$.RANK(${num(scalar(gen(a[0], s)))},${rangeOrCell(a[1], s, 'RANK')},${a[2] ? num(scalar(gen(a[2], s))) : 0})`, ty: 'n' }),
      'RANK.EQ': (a, s) => ({ c: `$.RANK(${num(scalar(gen(a[0], s)))},${rangeOrCell(a[1], s, 'RANK')},${a[2] ? num(scalar(gen(a[2], s))) : 0})`, ty: 'n' }),
      CORREL: twoRange('CORREL'), PEARSON: twoRange('CORREL'), SLOPE: twoRange('SLOPE'), INTERCEPT: twoRange('INTERCEPT'), SUMXMY2: twoRange('SUMXMY2'),
      COVAR: twoRange('COVARP'), 'COVARIANCE.P': twoRange('COVARP'), 'COVARIANCE.S': twoRange('COVARS'),
      FORECAST: (a, s) => ({ c: `$.FORECAST(${num(scalar(gen(a[0], s)))},${rangeOrCell(a[1], s, 'FORECAST')},${rangeOrCell(a[2], s, 'FORECAST')})`, ty: 'n' }),
      NPV: (a, s) => ({ c: `$.NPV(${num(scalar(gen(a[0], s)))},[${a.slice(1).map((x) => listArg(gen(x, s))).join(',')}])`, ty: 'n' }),
      SUMPRODUCT: (args, s) => ({ c: `$.SUMPRODUCT([${args.map((a) => { const e = gen(a, s); if (e.ty === 'r' || e.ty === 'a') return asArr(e); bad('SUMPRODUCT with a single value is not compiled.', 'SUMPRODUCT'); return null; }).join(',')}])`, ty: 'n' }),
      SUMIF: (a, s) => {
        const r = rangeOrCell(a[0], s, 'SUMIF'), c = toV(scalar(gen(a[1], s))), t = a[2] ? rangeOrCell(a[2], s, 'SUMIF') : r;
        return { c: `$.SUMIFS(${t},[${r},${c}])`, ty: 'n' };
      },
      AVERAGEIF: (a, s) => {
        const r = rangeOrCell(a[0], s, 'AVERAGEIF'), c = toV(scalar(gen(a[1], s))), t = a[2] ? rangeOrCell(a[2], s, 'AVERAGEIF') : r;
        return { c: `$.AVERAGEIFS(${t},[${r},${c}])`, ty: 'n' };
      },
      COUNTIF: (a, s) => ({ c: `$.COUNTIFS([${rangeOrCell(a[0], s, 'COUNTIF')},${toV(scalar(gen(a[1], s)))}])`, ty: 'n' }),
      COUNTIFS: (a, s) => ({ c: `$.COUNTIFS([${critPairs(a, s, 'COUNTIFS')}])`, ty: 'n' }),
      SUMIFS: (a, s) => ({ c: `$.SUMIFS(${rangeOrCell(a[0], s, 'SUMIFS')},[${critPairs(a.slice(1), s, 'SUMIFS')}])`, ty: 'n' }),
      AVERAGEIFS: (a, s) => ({ c: `$.AVERAGEIFS(${rangeOrCell(a[0], s, 'AVERAGEIFS')},[${critPairs(a.slice(1), s, 'AVERAGEIFS')}])`, ty: 'n' }),
      MAXIFS: (a, s) => ({ c: `$.MAXIFS(${rangeOrCell(a[0], s, 'MAXIFS')},[${critPairs(a.slice(1), s, 'MAXIFS')}])`, ty: 'n' }),
      MINIFS: (a, s) => ({ c: `$.MINIFS(${rangeOrCell(a[0], s, 'MINIFS')},[${critPairs(a.slice(1), s, 'MINIFS')}])`, ty: 'n' }),

      IF: (args, s) => {
        if (args.length < 2 || args.length > 3) bad('Wrong number of arguments for IF.', 'IF');
        const cond = boolish(scalar(gen(args[0], s))), t = newT();
        const a = scalar(gen(args[1], s)), b = args[2] ? scalar(gen(args[2], s)) : { c: '0', ty: 'b' };
        const ty = unify([a, b]);
        const out = { c: `((${t}=${cond})!==${t}?NaN:${t}?${conv(a, ty)}:${conv(b, ty)})`, ty };
        relT();
        return out;
      },
      IFS: (args, s) => {
        if (args.length < 2 || args.length % 2) bad('Wrong number of arguments for IFS.', 'IFS');
        const parts = [];
        for (let i = 0; i < args.length; i += 2) parts.push([boolish(scalar(gen(args[i], s))), scalar(gen(args[i + 1], s))]);
        const ty = unify(parts.map((p) => p[1]));
        let code = 'NaN';
        for (let i = parts.length - 1; i >= 0; i--) { const t = newT(); code = `((${t}=${parts[i][0]})!==${t}?NaN:${t}?${conv(parts[i][1], ty)}:${code})`; relT(); }
        return { c: code, ty };
      },
      SWITCH: (args, s) => {
        if (args.length < 3) bad('Wrong number of arguments for SWITCH.', 'SWITCH');
        const x = toV(scalar(gen(args[0], s))), rest = args.slice(1), hasDef = rest.length % 2 === 1, vals = [], tests = [];
        const t = newT();
        for (let i = 0; i + 1 < rest.length; i += 2) { tests.push(toV(scalar(gen(rest[i], s)))); vals.push(scalar(gen(rest[i + 1], s))); }
        const def = hasDef ? scalar(gen(rest[rest.length - 1], s)) : { c: 'NaN', ty: 'n' }, ty = unify(vals.concat([def]));
        let code = conv(def, ty);
        for (let i = vals.length - 1; i >= 0; i--) code = `($.cmp("=",${t},${tests[i]})===1?${conv(vals[i], ty)}:${code})`;
        const out = { c: `((${t}=${x})!==${t}?NaN:${code})`, ty };
        relT();
        return out;
      },
      CHOOSE: (args, s) => {
        if (args.length < 2) bad('Wrong number of arguments for CHOOSE.', 'CHOOSE');
        const i = num(scalar(gen(args[0], s))), vals = args.slice(1).map((a) => scalar(gen(a, s))), ty = unify(vals), t = newT();
        let code = 'NaN';
        for (let k = vals.length - 1; k >= 0; k--) code = `(${t}===${k + 1}?${conv(vals[k], ty)}:${code})`;
        const out = { c: `((${t}=Math.trunc(${i})),${code})`, ty };
        relT();
        return out;
      },
      IFERROR: (args, s) => {
        if (args.length !== 2) bad('Wrong number of arguments for IFERROR.', 'IFERROR');
        const a = scalar(gen(args[0], s)), b = scalar(gen(args[1], s)), ty = unify([a, b]), t = newT();
        const av = ty === 'n' || ty === 'b' ? `$.fin(${a.c})` : conv(a, ty);
        const out = { c: `((${t}=${av})!==${t}?${conv(b, ty)}:${t})`, ty };
        relT();
        return out;
      },
      // An error is NaN here with no code attached, so these only compile where the error can only be #N/A.
      IFNA: (args, s) => {
        if (!(args[0].t === 'call' && LOOKUP_FNS.has(args[0].fn))) bad('IFNA around anything but a lookup is not compiled.', 'IFNA');
        return XL.IFERROR(args, s);
      },
      ISNA: (args, s) => {
        if (!(args[0].t === 'call' && LOOKUP_FNS.has(args[0].fn))) bad('ISNA around anything but a lookup is not compiled.', 'ISNA');
        return XL.ISERROR(args, s);
      },
      ISERROR: (args, s) => { const e = scalar(gen(args[0], s)); return { c: `$.iserr(${e.ty === 'n' ? `$.fin(${e.c})` : conv(e, 'v')})`, ty: 'b' }; },
      ISNUMBER: (args, s) => { const e = scalar(gen(args[0], s)); if (e.blank) return { c: '0', ty: 'b' }; return { c: `$.isnum(${e.ty === 'b' ? 'true' : conv(e, 'v')})`, ty: 'b' }; },
      ISTEXT: (args, s) => { const e = scalar(gen(args[0], s)); return { c: `$.istext(${e.ty === 's' || e.ty === 'v' ? e.c : '0'})`, ty: 'b' }; },
      ISLOGICAL: (args, s) => { const e = scalar(gen(args[0], s)); if (e.ty === 'b') return { c: '1', ty: 'b' }; return { c: `$.islog(${e.ty === 'v' ? e.c : '0'})`, ty: 'b' }; },
      ISBLANK: (args) => {
        const a = args[0];
        if (a.t !== 'ref') return { c: '0', ty: 'b' };
        const sh = sheetOf(a, curCell.s), c = cells.get(keyOf(sh, a.r1, a.c1));
        return { c: !c && !spillChild.has(keyOf(sh, a.r1, a.c1)) ? '1' : '0', ty: 'b' };
      },
      AND: (args, s) => ({ c: `$.AND([${args.map((a) => { const e = gen(a, s); if (e.ty === 'a') bad('AND over an array expression is not compiled.', 'AND'); return e.ty === 'r' ? e.c : boolish(e); }).join(',')}])`, ty: 'b' }),
      OR: (args, s) => ({ c: `$.OR([${args.map((a) => { const e = gen(a, s); if (e.ty === 'a') bad('OR over an array expression is not compiled.', 'OR'); return e.ty === 'r' ? e.c : boolish(e); }).join(',')}])`, ty: 'b' }),
      XOR: (args, s) => ({ c: `$.XOR([${args.map((a) => boolish(scalar(gen(a, s)))).join(',')}])`, ty: 'b' }),
      NOT: (args, s) => { const b = boolish(scalar(gen(args[0], s))), t = newT(); const out = { c: `((${t}=${b})!==${t}?NaN:${t}?0:1)`, ty: 'b' }; relT(); return out; },
      TRUE: () => ({ c: '1', ty: 'b' }), FALSE: () => ({ c: '0', ty: 'b' }), NA: () => ({ c: 'NaN', ty: 'n' }),

      INDEX: (args, s) => {
        if (args.length < 2 || args.length > 3) bad('Wrong number of arguments for INDEX.', 'INDEX');
        const a0 = args[0].t === 'name' ? names.get(args[0].v.toUpperCase()) : args[0];
        if (!a0 || a0.t !== 'ref') bad('INDEX over anything but a range is not compiled.', 'INDEX');
        const sh = sheetOf(a0, s), cl = clip(a0, sh), R = rangeOrCell(a0, s, 'INDEX');
        const id = +/\d+/.exec(R)[0], info = rangeTable[id];
        const nums2 = args.slice(1).map((a) => {
          if (a.t === 'omit') return null;
          if (a.t === 'num' && a.v === 0) bad('INDEX with row or column 0 returns a whole line and is not compiled.', 'INDEX');
          return num(scalar(gen(a, s)));
        });
        void cl;
        if (nums2[0] === null) { if (info.rows !== 1) bad('INDEX with an omitted row is not compiled.', 'INDEX'); nums2[0] = '1'; }
        if (nums2.length === 2 && nums2[1] === null) { if (info.cols !== 1) bad('INDEX with an omitted column is not compiled.', 'INDEX'); nums2[1] = '1'; }
        const allN = allNumeric(info);
        const call = `(${R},${nums2.join(',')})`;
        return allN ? { c: `$.INDEXN${call}`, ty: 'n' } : { c: `$.INDEXV${call}`, ty: 'v' };
      },
      MATCH: (args, s) => {
        if (args.length < 2) bad('Wrong number of arguments for MATCH.', 'MATCH');
        const x = toV(scalar(gen(args[0], s))), r = rangeOrCell(args[1], s, 'MATCH');
        if (args[0].t === 'str' && /[*?~]/.test(args[0].v)) bad('MATCH with wildcards is not compiled.', 'MATCH');
        const ty = args[2] && args[2].t !== 'omit' ? num(scalar(gen(args[2], s))) : '1';
        return { c: `$.MATCH(${x},${r},${ty})`, ty: 'n' };
      },
      VLOOKUP: (args, s) => lookupFn('VLOOKUP', args, s),
      HLOOKUP: (args, s) => lookupFn('HLOOKUP', args, s),
      LOOKUP: (args, s) => {
        const x = toV(scalar(gen(args[0], s))), r = rangeOrCell(args[1], s, 'LOOKUP'), r2 = args[2] ? rangeOrCell(args[2], s, 'LOOKUP') : null;
        return { c: `$.LOOKUP(${x},${r}${r2 ? ',' + r2 : ''})`, ty: 'v' };
      },
      ROW: (args, s) => {
        if (!args.length) return { c: String(curCell.r + 1), ty: 'n' };
        if (args[0].t !== 'ref' || args[0].r1 !== args[0].r2) bad('ROW over a range is not compiled.', 'ROW');
        void s;
        return { c: String(args[0].r1 + 1), ty: 'n' };
      },
      COLUMN: (args) => {
        if (!args.length) return { c: String(curCell.c + 1), ty: 'n' };
        if (args[0].t !== 'ref' || args[0].c1 !== args[0].c2) bad('COLUMN over a range is not compiled.', 'COLUMN');
        return { c: String(args[0].c1 + 1), ty: 'n' };
      },
      ROWS: (args, s) => { const n = args[0].t === 'name' ? names.get(args[0].v.toUpperCase()) : args[0]; if (!n || n.t !== 'ref') bad('ROWS over anything but a range is not compiled.', 'ROWS'); return { c: String(dimsOf(n, s).rows), ty: 'n' }; },
      COLUMNS: (args, s) => { const n = args[0].t === 'name' ? names.get(args[0].v.toUpperCase()) : args[0]; if (!n || n.t !== 'ref') bad('COLUMNS over anything but a range is not compiled.', 'COLUMNS'); return { c: String(dimsOf(n, s).cols), ty: 'n' }; },
      NORMSDIST: simple('NORMSDIST', [1, 1]), NORMSINV: simple('NORMSINV', [1, 1]), 'NORM.S.INV': simple('NORMSINV', [1, 1]),
      'NORM.S.DIST': (a, s) => { if (a.length !== 2 || a[1].t !== 'bool' || !a[1].v) bad('NORM.S.DIST is only compiled with TRUE as its second argument.', 'NORM.S.DIST'); return { c: `$.NORMSDIST(${num(scalar(gen(a[0], s)))})`, ty: 'n' }; },
      NORMDIST: simple('NORMDIST', [4, 4]), 'NORM.DIST': simple('NORMDIST', [4, 4]), NORMINV: simple('NORMINV', [3, 3]), 'NORM.INV': simple('NORMINV', [3, 3]),
      'LOGNORM.DIST': simple('LOGNORMDIST', [4, 4]), 'LOGNORM.INV': simple('LOGNORMINV', [3, 3]), LOGINV: simple('LOGNORMINV', [3, 3]),
      EXPONDIST: simple('EXPONDIST', [3, 3]), 'EXPON.DIST': simple('EXPONDIST', [3, 3]),
      BINOMDIST: simple('BINOMDIST', [4, 4]), 'BINOM.DIST': simple('BINOMDIST', [4, 4]), POISSON: simple('POISSONDIST', [3, 3]), 'POISSON.DIST': simple('POISSONDIST', [3, 3]),
      LEN: (a, s) => ({ c: `$.LEN(${toV(scalar(gen(a[0], s)))})`, ty: 'n' }),
      LEFT: (a, s) => ({ c: `$.LEFT(${toV(scalar(gen(a[0], s)))},${a[1] ? num(scalar(gen(a[1], s))) : 1})`, ty: 'v' }),
      RIGHT: (a, s) => ({ c: `$.RIGHT(${toV(scalar(gen(a[0], s)))},${a[1] ? num(scalar(gen(a[1], s))) : 1})`, ty: 'v' }),
      MID: (a, s) => ({ c: `$.MID(${toV(scalar(gen(a[0], s)))},${num(scalar(gen(a[1], s)))},${num(scalar(gen(a[2], s)))})`, ty: 'v' }),
      UPPER: (a, s) => ({ c: `$.UPPER(${toV(scalar(gen(a[0], s)))})`, ty: 'v' }),
      LOWER: (a, s) => ({ c: `$.LOWER(${toV(scalar(gen(a[0], s)))})`, ty: 'v' }),
      TRIM: (a, s) => ({ c: `$.TRIM(${toV(scalar(gen(a[0], s)))})`, ty: 'v' }),
      VALUE: (a, s) => ({ c: `$.VALUE(${toV(scalar(gen(a[0], s)))})`, ty: 'n' }),
      EXACT: (a, s) => ({ c: `$.EXACT(${toV(scalar(gen(a[0], s)))},${toV(scalar(gen(a[1], s)))})`, ty: 'b' }),
      CONCATENATE: (a, s) => ({ c: a.map((x) => toV(scalar(gen(x, s)))).reduce((p, q) => `$.cat(${p},${q})`, '""'), ty: 'v' }),
      CONCAT: (a, s) => ({ c: a.map((x) => { const e = gen(x, s); if (e.ty === 'r' || e.ty === 'a') bad('CONCAT over a range is not compiled.', 'CONCAT'); return toV(e); }).reduce((p, q) => `$.cat(${p},${q})`, '""'), ty: 'v' }),
      RAND: () => { const a = A(addrOf(curCell.s, curCell.r, curCell.c)); return { c: `$.rand(${a})`, ty: 'n' }; },
      RANDBETWEEN: (args, s) => { const a = A(addrOf(curCell.s, curCell.r, curCell.c)); return { c: `$.randbetween(${a},${num(scalar(gen(args[0], s)))},${num(scalar(gen(args[1], s)))})`, ty: 'n' }; },
    };
    const allNumeric = (info) => {
      for (let i = 0; i < info.idx.length; i++) {
        const k = info.idx[i];
        if (k === 0) continue;
        if (!slotType.has(k) && !fixedInit.has(k)) return false;
        if (fixedInit.has(k)) { const t = valType(fixedInit.get(k)); if (t !== 'n' && t !== 'blank' && t !== 'e') return false; } else if (slotType.get(k) !== 'n') return false;
      }
      return true;
    };
    const slotType = new Map();
    const critPairs = (a, s, f) => {
      if (a.length % 2 || !a.length) bad(`Wrong number of arguments for ${f}.`, f);
      const parts = [];
      for (let i = 0; i < a.length; i += 2) parts.push(rangeOrCell(a[i], s, f), toV(scalar(gen(a[i + 1], s))));
      return parts.join(',');
    };
    const lookupFn = (f, args, s) => {
      if (args.length < 3) bad(`Wrong number of arguments for ${f}.`, f);
      const x = toV(scalar(gen(args[0], s))), r = rangeOrCell(args[1], s, f), c = num(scalar(gen(args[2], s)));
      const a = args[3] && args[3].t !== 'omit' ? boolish(scalar(gen(args[3], s))) : args[3] ? '0' : '1';
      if (args[0].t === 'str' && /[*?~]/.test(args[0].v)) bad(`${f} with wildcards is not compiled.`, f);
      return { c: `$.${f}(${x},${r},${c},${a})`, ty: 'v' };
    };

    function genCall(node, s) {
      if (node.fn.startsWith(NS)) return genEr(node, s, false);
      const f = XL[node.fn];
      if (!f) bad(`${node.fn} is not compiled yet.`, node.fn);
      return f(node.args, s);
    }
    function genEr(node, s, top) {
      const spec = erSpec(node.fn);
      if (!spec) bad(`Unknown function ${node.fn}.`, node.fn);
      if (node.args.length !== spec.params.length) bad(`${spec.name} expects ${spec.params.length} arguments.`, spec.name);
      if (spec.result === 'm' && !top) bad(`${spec.name} inside another formula is not compiled.`, spec.name);
      const parts = node.args.map((a, i) => {
        const code = spec.params[i].split(':')[1];
        if (code === 'm') {
          const n = a.t === 'name' ? names.get(a.v.toUpperCase()) : a;
          if (n && n.t === 'ref') { const r = rangeOf(n, s); if (!r.code) bad(`${spec.name} refers to an empty area.`, spec.name); return `$.mat(${r.code})`; }
          if (n && n.t === 'array') return `(${JSON.stringify(n.rows)})`;
          const e = gen(a, s);
          if (e.ty === 'a' || e.ty === 'r') bad(`${spec.name} over an array expression is not compiled.`, spec.name);
          return `[[${toV(e)}]]`;
        }
        const e = scalar(gen(a, s));
        if (code === 'n') return num(e);
        if (code === 's') return e.ty === 's' ? e.c : `$.str(${toV(e)})`;
        return boolishPass(e);
      });
      const addr = A(addrOf(curCell.s, curCell.r, curCell.c));
      const call = `$.er${parts.length}(${FN(spec.name)},${JSON.stringify(spec.name)},${addr}${parts.length ? ',' + parts.join(',') : ''})`;
      const ty = spec.result === 'n' ? 'n' : spec.result === 'm' ? 'm' : 'v';
      return { c: call, ty };
    }
    const boolishPass = (e) => { const b = boolish(e); return `$.tobool(${b})`; };

    // ---- Generate -----------------------------------------------------------------------------
    const stmts = [];
    const reason = (msg, cell, fn) => { throw new Unsupported(msg, cell, fn); };
    for (const cell of order) {
      curCell = cell;
      const a = addrOf(cell.s, cell.r, cell.c);
      if (cell.opaque && cell.ast === null) reason(`Cell ${a} could not be read (${cell.opaque}).`, a);
      if (cell.opaque) reason(`Cell ${a} refers to a defined name that can't be resolved.`, a);
      if (cell.dynamic) reason(`Cell ${a} uses ${cell.dynamic}, whose references are only known at run time.`, a, cell.dynamic);
      tDepth = 0; maxT = 0;
      const sl = slotOf(cell.s, cell.r, cell.c);
      let code;
      if (cell.spill) {
        const e = genEr(cell.ast, cell.s, true);
        const idx = new Int32Array(cell.spill.rows * cell.spill.cols);
        let p = 0;
        for (let i = 0; i < cell.spill.rows; i++) for (let j = 0; j < cell.spill.cols; j++, p++) idx[p] = i === 0 && j === 0 ? sl : slotOf(cell.s, cell.r + i, cell.c + j);
        const id = rangeTable.length;
        rangeTable.push({ idx, blank: new Uint8Array(idx.length), rows: cell.spill.rows, cols: cell.spill.cols, fixed: false });
        code = `$.spill(R[${id}],${e.c});`;
        cell.ty = 'v';
      } else {
        const e = cell.ast.t === 'call' && erSpec(cell.ast.fn) ? genEr(cell.ast, cell.s, true) : gen(cell.ast, cell.s);
        if (e.ty === 'r' || e.ty === 'a' || e.ty === 'm') {
          const fnm = cell.ast.t === 'call' ? cell.ast.fn : undefined;
          reason(`Cell ${a} returns several values, and only PSA. functions may spill in compiled models.`, a, fnm);
        }
        if (e.blank) { cell.ty = 'n'; code = `N[${sl}]=0;M[${sl}]=1;`; slotType.set(sl, 'n'); }
        else if (e.ty === 'n') { cell.ty = 'n'; slotType.set(sl, 'n'); code = `x=${e.c};N[${sl}]=x-x===0?x:NaN;`; }
        else if (e.ty === 'b') { cell.ty = 'b'; slotType.set(sl, 'b'); code = `$.setB(${sl},${e.c});`; }
        else { cell.ty = 'v'; code = `$.setV(${sl},${e.c});`; }
      }
      const ts = []; for (let i = 0; i < maxT; i++) ts.push('t' + i);
      stmts.push({ code, ts, addr: a, slot: sl, f: cell.f });
    }
    curCell = null;

    // V8 stops optimising very large functions, so split the model into chunks.
    const CHUNK = 250, chunks = [];
    for (let i = 0; i < stmts.length; i += CHUNK) chunks.push(stmts.slice(i, i + CHUNK));
    const src = chunks.map((ch, i) => {
      const ts = new Set(); ch.forEach((st) => st.ts.forEach((t) => ts.add(t)));
      return `function c${i}(){let x${[...ts].map((t) => ',' + t).join('')};\n${ch.map((st) => st.code).join('\n')}\n}`;
    }).join('\n') + `\nreturn [${chunks.map((_, i) => 'c' + i).join(',')}];`;

    // Fixed slots for cells read through ranges and $.val.
    const N0 = new Float64Array(nSlots), M0 = new Uint8Array(nSlots), Vinit = [];
    for (const [sl, v] of fixedInit) {
      const t = valType(v);
      if (t === 'n') { N0[sl] = v; M0[sl] = 1; }
      else if (t === 'e') { N0[sl] = NaN; M0[sl] = 1; }
      else if (t === 'b') { N0[sl] = v ? 1 : 0; Vinit.push([sl, v]); }
      else if (t === 's' || (t === 'blank' && v === '')) { N0[sl] = t === 's' ? NaN : 0; if (t === 's') Vinit.push([sl, v]); }
    }
    for (const c of order) if (c.ty === 'n') M0[c.slot] = 1;

    const stat = {
      totalFormulas: allF.length, liveFormulas: order.length, cells: cells.size, slots: nSlots,
      fixedFormulas: allF.length - allF.filter((c) => c.live).length,
      skippedFormulas: allF.filter((c) => c.live && !c.need).length,
      usesRand,
    };
    const used = new Set();
    for (const c of order) {
      const visit = (n) => { if (!n) return; if (n.t === 'call') { const sp = erSpec(n.fn); if (sp) used.add(sp.name); n.args.forEach(visit); } if (n.t === 'bin') { visit(n.l); visit(n.r); } if (n.t === 'neg') visit(n.e); };
      visit(c.ast);
    }
    return {
      src, nSlots, N0, M0, Vinit, ranges: rangeTable, addrs, fnList, stat, usedEr: [...used],
      checks: stmts.map((st) => ({ addr: st.addr, slot: st.slot, f: st.f })),
    };
  };

  // Stands in for Excel while a compiled model runs: same three calls the runner makes of any host.
  class CompiledHost {
    constructor(model, E) {
      this.model = model; this.E = E; this.sync = true;
      this.N = model.N0.slice(); this.M = model.M0.slice(); this.V = new Array(model.nSlots);
      for (const [s, v] of model.Vinit) this.V[s] = v;
      const ranges = model.ranges.map((r) => ({ idx: r.idx, blank: r.blank, rows: r.rows, cols: r.cols, fixed: r.fixed }));
      const $ = Sg.makeRuntime(this.N, this.M, this.V, ranges, E);
      $.tobool = (x) => (x !== x ? NaN : x !== 0);
      const F = model.fnList.map((n) => E.fns[n]);
      // eslint-disable-next-line no-new-func
      this.chunks = new Function('N', 'M', 'V', '$', 'R', 'A', 'F', model.src)(this.N, this.M, this.V, $, ranges, model.addrs, F);
      this.$ = $;
      this.slots = new Map(model.checks.map((c) => [c.addr, c.slot]));
    }
    calculate() { const c = this.chunks; for (let i = 0; i < c.length; i++) c[i](); }
    valueAt(addr) {
      const s = this.slots.get(addr);
      if (s === undefined) return undefined;
      const v = this.$.val(s);
      return v === undefined || v === null ? '' : v;
    }
    async readCells(addrs) {
      return addrs.map((a) => {
        const v = this.valueAt(a);
        if (v === undefined) return '';
        return typeof v === 'number' && v !== v ? '#NUM!' : v;
      });
    }
    async setManual() {}
  }
  Sg.CompiledHost = CompiledHost;
})(globalThis.Sg = globalThis.Sg || {});
