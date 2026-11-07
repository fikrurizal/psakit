// A small stand-in for a workbook, used by the tests and the browser demo. It evaluates a useful subset of
// Excel formulas with Excel's relevant behaviours: inner calls before outer ones, ranges as 2-D arrays,
// error arguments short-circuiting custom functions, dynamic array spills, and shuffled calculation order.
(function (Sg) {
  class XlError { constructor(c) { this.code = c; } }
  const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const colName = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

  function tokenize(src) {
    const t = [], re = /\s*(?:("(?:[^"]|"")*")|((?:'[^']+'|[A-Za-z_][A-Za-z0-9_ ]*)!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![A-Za-z0-9_.(])|([A-Za-z_][A-Za-z0-9_.]*)|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|(<=|>=|<>|[-+*/^(),=<>&%]))/y;
    let i = 0, m;
    while (i < src.length) {
      re.lastIndex = i; m = re.exec(src);
      if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw new Error('Bad formula: ' + src); }
      i = re.lastIndex;
      if (m[1] !== undefined) t.push({ k: 's', v: m[1].slice(1, -1).replace(/""/g, '"') });
      else if (m[2] !== undefined || m[3] !== undefined) t.push({ k: 'r', v: m[2] || m[3] });
      else if (m[4] !== undefined) t.push({ k: 'n', v: m[4] });
      else if (m[5] !== undefined) t.push({ k: 'd', v: parseFloat(m[5]) });
      else t.push({ k: 'o', v: m[6] });
    }
    return t;
  }
  function parse(src) {
    const t = tokenize(src); let p = 0;
    const peek = () => t[p], isOp = (v) => t[p] && t[p].k === 'o' && t[p].v === v;
    const bin = (next, ops) => () => { let l = next(); while (t[p] && t[p].k === 'o' && ops.includes(t[p].v)) { const o = t[p++].v; l = { op: o, l, r: next() }; } return l; };
    function prim() {
      const k = t[p++];
      if (!k) throw new Error('Unexpected end: ' + src);
      if (k.k === 'd') return { num: k.v };
      if (k.k === 's') return { str: k.v };
      if (k.k === 'r') return { ref: k.v };
      if (k.k === 'n') {
        if (isOp('(')) {
          p++; const args = [];
          if (!isOp(')')) { do { args.push(cmp()); } while (isOp(',') && ++p); }
          if (!isOp(')')) throw new Error('Expected ): ' + src);
          p++;
          return { fn: k.v.toUpperCase(), args };
        }
        if (/^true$/i.test(k.v)) return { bool: true };
        if (/^false$/i.test(k.v)) return { bool: false };
        throw new Error('Unknown name ' + k.v);
      }
      if (k.v === '(') { const e = cmp(); p++; return e; }
      if (k.v === '-') return { neg: pow() };
      if (k.v === '+') return pow();
      throw new Error('Unexpected ' + k.v + ' in ' + src);
    }
    function pow() { let l = prim(); while (isOp('^')) { p++; l = { op: '^', l, r: prim() }; } while (isOp('%')) { p++; l = { op: '/', l, r: { num: 100 } }; } return l; }
    const mul = bin(pow, ['*', '/']), addE = bin(mul, ['+', '-']), cat = bin(addE, ['&']), cmp = bin(cat, ['=', '<', '>', '<=', '>=', '<>']);
    const e = cmp();
    if (p < t.length) throw new Error('Trailing tokens: ' + src);
    return e;
  }

  const BUILTIN = {
    SUMXMY2: ([x, y]) => { const a = flat([x]), b = flat([y]); return a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0); },
    COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
    SUMPRODUCT: (a) => { const f = a.map((m) => flat([m])); return f[0].reduce((s, _, i) => s + f.reduce((p, x) => p * (typeof x[i] === 'number' ? x[i] : 0), 1), 0); },
    MATCH: ([x, m, t]) => {
      const f = flat([m]);
      if (t === 0) { const i = f.findIndex((v) => v === x); if (i < 0) throw new XlError('#N/A'); return i + 1; }
      let b = -1; for (let i = 0; i < f.length; i++) if (typeof f[i] === 'number' && f[i] <= x) b = i;
      if (b < 0) throw new XlError('#N/A'); return b + 1;
    },
    SUM: (a) => flat(a).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0),
    AVERAGE: (a) => { const n = flat(a).filter((v) => typeof v === 'number'); return n.reduce((s, v) => s + v, 0) / n.length; },
    MIN: (a) => Math.min(...flat(a).filter((v) => typeof v === 'number')),
    MAX: (a) => Math.max(...flat(a).filter((v) => typeof v === 'number')),
    ABS: ([x]) => Math.abs(x), SQRT: ([x]) => Math.sqrt(x), EXP: ([x]) => Math.exp(x), LN: ([x]) => Math.log(x),
    ROUND: ([x, d]) => Math.round(x * 10 ** d) / 10 ** d,
    AND: (a) => flat(a).every(Boolean), OR: (a) => flat(a).some(Boolean), NOT: ([x]) => !x,
    INDEX: ([m, r, c]) => { if (!Array.isArray(m)) return m; return m.length === 1 && c === undefined ? m[0][r - 1] : m[r - 1][(c || 1) - 1]; },
    ROW: () => 1,
  };
  const flat = (a) => a.flatMap((x) => (Array.isArray(x) ? x.flat() : [x]));

  class FakeExcel {
    constructor(engine, opts) {
      this.E = engine; this.sheets = new Map(); this.parsed = new Map(); this.values = new Map(); this.spillFrom = new Map();
      this.opts = Object.assign({ shuffle: true, late: 0 }, opts);
      this.label = 'the simulated workbook'; this.calcs = 0; this.manual = false; this.byUpper = new Map(Sg.SPEC.map((s) => [s.name.toUpperCase(), s.name]));
    }
    sheet(name) { if (!this.sheets.has(name)) this.sheets.set(name, new Map()); return this.sheets.get(name); }
    set(addr, v) { const [s, c] = addr.split('!'); this.sheet(s).set(c, v); this.parsed.delete(addr); }
    setCells(sheet, obj) { for (const [c, v] of Object.entries(obj)) this.set(sheet + '!' + c, v); }

    evalCell(addr) {
      if (this.values.has(addr)) return this.values.get(addr);
      const [s, c] = addr.split('!'), raw = this.sheet(s).get(c);
      if (raw === undefined) {
        const a = this.spillFrom.get(addr);
        if (a && !this.visiting.has(a)) { this.evalCell(a); if (this.values.has(addr)) return this.values.get(addr); }
        return '';
      }
      if (typeof raw !== 'string' || raw[0] !== '=') { this.values.set(addr, raw); return raw; }
      if (this.visiting.has(addr)) return new XlError('#REF!');
      this.visiting.add(addr);
      let v;
      try {
        let tree = this.parsed.get(addr);
        if (!tree) { tree = parse(raw.slice(1)); this.parsed.set(addr, tree); }
        v = this.ev(tree, s, addr);
      } catch (e) {
        if (e instanceof XlError) v = e; else if (e.code) v = new XlError(String(e.code)[0] === '#' ? e.code : e.code === 'NUM' ? '#NUM!' : '#VALUE!'); else throw e;
      }
      this.visiting.delete(addr);
      if (Array.isArray(v)) {
        const [, col, rowS] = /^([A-Z]+)(\d+)$/.exec(c), c0 = colNum(col), r0 = +rowS;
        v.forEach((row, i) => row.forEach((x, j) => {
          const ad = `${s}!${colName(c0 + j)}${r0 + i}`;
          if (i || j) { this.values.set(ad, x); this.spillFrom.set(ad, addr); }
        }));
        v = v[0][0];
      }
      this.values.set(addr, v);
      return v;
    }
    range(ref, sheet) {
      let s = sheet, r = ref;
      if (ref.includes('!')) { const i = ref.lastIndexOf('!'); s = ref.slice(0, i).replace(/'/g, ''); r = ref.slice(i + 1); }
      r = r.replace(/\$/g, '').toUpperCase();
      if (!r.includes(':')) return this.evalCell(`${s}!${r}`);
      const [a, b] = r.split(':'), [, c1, r1] = /^([A-Z]+)(\d+)$/.exec(a), [, c2, r2] = /^([A-Z]+)(\d+)$/.exec(b), out = [];
      for (let i = +r1; i <= +r2; i++) { const row = []; for (let j = colNum(c1); j <= colNum(c2); j++) row.push(this.evalCell(`${s}!${colName(j)}${i}`)); out.push(row); }
      return out;
    }
    ev(n, sheet, addr) {
      if ('num' in n) return n.num;
      if ('str' in n) return n.str;
      if ('bool' in n) return n.bool;
      if ('neg' in n) { const v = this.ev(n.neg, sheet, addr); if (v instanceof XlError) throw v; return -v; }
      if ('ref' in n) return this.range(n.ref, sheet);
      if ('op' in n) {
        const l = this.ev(n.l, sheet, addr), r = this.ev(n.r, sheet, addr);
        if (l instanceof XlError) throw l;
        if (r instanceof XlError) throw r;
        const a = l === '' ? 0 : l, b = r === '' ? 0 : r;
        switch (n.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': if (b === 0) throw new XlError('#DIV/0!'); return a / b;
          case '^': return Math.pow(a, b); case '&': return String(l) + String(r);
          case '=': return a === b; case '<>': return a !== b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        }
      }
      if ('fn' in n) {
        if (n.fn === 'IF') {
          const c = this.ev(n.args[0], sheet, addr);
          if (c instanceof XlError) throw c;
          return c ? this.ev(n.args[1], sheet, addr) : n.args[2] ? this.ev(n.args[2], sheet, addr) : false;
        }
        const args = n.args.map((a) => this.ev(a, sheet, addr));
        for (const a of args) { if (a instanceof XlError) throw a; if (Array.isArray(a)) for (const row of a) for (const v of row) if (v instanceof XlError && n.fn.startsWith('ER.')) throw v; }
        if (n.fn.startsWith(Sg.NAMESPACE + '.')) {
          const name = this.byUpper.get(n.fn.slice(Sg.NAMESPACE.length + 1));
          if (!name) throw new XlError('#NAME?');
          const spec = Sg.SPEC_BY_NAME[name];
          // Excel passes matrix parameters as 2-D arrays even for one cell.
          spec.params.forEach((p, i) => { if (p.endsWith(':m') && !Array.isArray(args[i])) args[i] = [[args[i]]]; });
          return this.callCustom ? this.callCustom(name, addr, args) : this.E.fns[name](addr, ...args);
        }
        if (!BUILTIN[n.fn]) throw new XlError('#NAME?');
        return BUILTIN[n.fn](args);
      }
      throw new Error('Bad node');
    }
    cellKeys() {
      const keys = [];
      for (const [s, cells] of this.sheets) for (const [c, v] of cells) if (typeof v === 'string' && v[0] === '=') keys.push(`${s}!${c}`);
      return keys;
    }
    // ---- Host interface -----------------------------------------------------------------------
    async calculate() {
      this.calcs++;
      this.values = new Map(); this.visiting = new Set();
      const keys = this.cellKeys();
      if (this.opts.shuffle) for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
      // Spilling formulas first, so cells that read spilled values see them on the first pass too.
      const arr = /ERDATAARRAY|ERRUNDATAARRAY|CORROUT|ERMINIMIZE\(|RETRIEVEARRAY|SORTEDARRAY/i;
      keys.sort((a, b) => (arr.test(this.rawOf(b)) ? 1 : 0) - (arr.test(this.rawOf(a)) ? 1 : 0));
      for (const k of keys) this.evalCell(k);
    }
    rawOf(k) { const [s, c] = k.split('!'); return this.sheet(s).get(c); }
    async readCells(addrs) { return addrs.map((a) => { let v = this.values.get(a); if (v === undefined) v = this.rawOf(a); return v instanceof XlError ? v.code : v === undefined ? '' : v; }); }
    async scanFormulas() { return this.cellKeys().map((address) => ({ address, formula: this.rawOf(address) })); }
    // Same shape as ExcelHost.readWorkbook: formulas and calculated values for each sheet's used area.
    async readWorkbook() {
      const sheets = [];
      const parse = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { r: +m[2] - 1, c: colNum(m[1]) - 1 }; };
      for (const [name, cells] of this.sheets) {
        let maxR = 0, maxC = 0;
        const extra = [...this.spillFrom.keys()].filter((k) => k.startsWith(name + '!')).map((k) => k.slice(name.length + 1));
        for (const a of [...cells.keys(), ...extra]) { const p = parse(a); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); }
        const formulas = [], values = [];
        for (let r = 0; r <= maxR; r++) { formulas.push(new Array(maxC + 1).fill('')); values.push(new Array(maxC + 1).fill('')); }
        for (const [a, v] of cells) { const p = parse(a); formulas[p.r][p.c] = v; }
        for (const a of [...cells.keys(), ...extra]) {
          const p = parse(a), v = this.values.get(name + '!' + a);
          const raw = cells.get(a);
          values[p.r][p.c] = v instanceof XlError ? v.code : v === undefined ? (raw === undefined || (typeof raw === 'string' && raw[0] === '=') ? '' : raw) : v;
        }
        sheets.push({ name, rowIndex: 0, columnIndex: 0, formulas, values });
      }
      return { sheets, names: [] };
    }
    async setManual(m) { this.manual = m; }
    async saveSettings() {}
    async loadSettings() { return null; }
    display(addr) { const v = this.values.get(addr); return v instanceof XlError ? v.code : v; }
  }
  Sg.FakeExcel = FakeExcel;
  Sg.XlError = XlError;
})(globalThis.Sg = globalThis.Sg || {});
// Extra host methods the task pane uses, so the demo can run the full interface.
(function (Sg) {
  Object.assign(Sg.FakeExcel.prototype, {
    async writeSheet(name, rows) {
      const sh = this.sheet(name); sh.clear();
      const col = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
      rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') this.set(`${name}!${col(c)}${r + 1}`, v); }));
      if (this.onChange) this.onChange(name);
    },
    async convertLegacy() {
      let changed = 0;
      for (const [, cells] of this.sheets) for (const [c, v] of cells) { const n = Sg.convertFormula(v); if (n !== v) { cells.set(c, n); changed++; } }
      this.parsed.clear();
      return { changed, cleared: 0 };
    },
  });
})(globalThis.Sg);
