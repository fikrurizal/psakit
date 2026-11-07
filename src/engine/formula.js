// Excel formula parser. Produces a small AST. Anything it can't parse throws, and the compiler then treats that
// cell as impossible to compile rather than guessing at its meaning.
(function (Sg) {
  const colNum = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; };
  const colName = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
  Sg.colNum = colNum; Sg.colName = colName;
  const MAXR = 1048575, MAXC = 16383;

  const TOK = new RegExp([
    '(?<ws>\\s+)',
    '(?<str>"(?:[^"]|"")*")',
    '(?<err>#(?:N/A|DIV/0!|VALUE!|REF!|NAME\\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA))',
    "(?<sheet>(?:'(?:[^']|'')+'|[A-Za-z_\\\\][A-Za-z0-9_.\\\\]*)!)",
    '(?<range>\\$?[A-Za-z]{1,3}\\$?[0-9]+:\\$?[A-Za-z]{1,3}\\$?[0-9]+(?![A-Za-z0-9_.(]))',
    '(?<colrange>\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}(?![A-Za-z0-9_.(!]))',
    '(?<rowrange>\\$?[0-9]+:\\$?[0-9]+(?![0-9.A-Za-z]))',
    '(?<cell>\\$?[A-Za-z]{1,3}\\$?[0-9]+(?![A-Za-z0-9_.(!]))',
    '(?<num>[0-9]+\\.?[0-9]*(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?)',
    '(?<name>[A-Za-z_\\\\][A-Za-z0-9_.\\\\]*)',
    '(?<op><=|>=|<>|[-+*/^(),=<>&%{};@])',
  ].join('|'), 'y');

  function tokenize(src) {
    const out = []; let i = 0;
    while (i < src.length) {
      TOK.lastIndex = i;
      const m = TOK.exec(src);
      if (!m) throw new Error('Cannot read formula at: ' + src.slice(i, i + 20));
      i = TOK.lastIndex;
      const g = m.groups;
      if (g.ws) continue;
      if (g.str !== undefined) out.push({ k: 'str', v: g.str.slice(1, -1).replace(/""/g, '"') });
      else if (g.err) out.push({ k: 'err', v: g.err });
      else if (g.sheet) out.push({ k: 'sheet', v: g.sheet.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") });
      else if (g.range) out.push({ k: 'range', v: g.range });
      else if (g.colrange) out.push({ k: 'colrange', v: g.colrange });
      else if (g.rowrange) out.push({ k: 'rowrange', v: g.rowrange });
      else if (g.cell) out.push({ k: 'cell', v: g.cell });
      else if (g.num) out.push({ k: 'num', v: parseFloat(g.num) });
      else if (g.name) out.push({ k: 'name', v: g.name });
      else out.push({ k: 'op', v: g.op });
    }
    return out;
  }
  const parseCell = (s) => { const m = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(s); return { c: colNum(m[1].toUpperCase()), r: +m[2] - 1 }; };

  Sg.parseFormula = function (text) {
    const src = text[0] === '=' ? text.slice(1) : text, t = tokenize(src);
    let p = 0;
    const isOp = (v) => p < t.length && t[p].k === 'op' && t[p].v === v;
    const fail = (why) => { throw new Error(`${why} in ${text}`); };
    const levels = [['=', '<', '>', '<=', '>=', '<>'], ['&'], ['+', '-'], ['*', '/'], ['^']];
    function binary(level) {
      if (level === levels.length) return unary();
      let l = binary(level + 1);
      while (p < t.length && t[p].k === 'op' && levels[level].includes(t[p].v)) { const op = t[p++].v; l = { t: 'bin', op, l, r: binary(level + 1) }; }
      return l;
    }
    // Excel binds unary minus tighter than ^, so -2^2 is 4.
    function unary() {
      if (isOp('-') || isOp('+')) { const op = t[p++].v, e = unary(); return op === '-' ? { t: 'neg', e } : e; }
      if (isOp('@')) { p++; return unary(); }
      let e = primary();
      while (isOp('%')) { p++; e = { t: 'bin', op: '/', l: e, r: { t: 'num', v: 100 } }; }
      return e;
    }
    function refNode(tok, sheet) {
      if (tok.k === 'cell') { const a = parseCell(tok.v); return { t: 'ref', sheet, r1: a.r, c1: a.c, r2: a.r, c2: a.c }; }
      if (tok.k === 'range') { const [x, y] = tok.v.split(':'), a = parseCell(x), b = parseCell(y); return { t: 'ref', sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }; }
      if (tok.k === 'colrange') { const [x, y] = tok.v.replace(/\$/g, '').toUpperCase().split(':'); return { t: 'ref', sheet, r1: 0, c1: colNum(x), r2: MAXR, c2: colNum(y), whole: true }; }
      if (tok.k === 'rowrange') { const [x, y] = tok.v.replace(/\$/g, '').split(':'); return { t: 'ref', sheet, r1: +x - 1, c1: 0, r2: +y - 1, c2: MAXC, whole: true }; }
      return fail('Bad reference');
    }
    function primary() {
      if (p >= t.length) fail('Unexpected end');
      const k = t[p++];
      switch (k.k) {
        case 'num': return { t: 'num', v: k.v };
        case 'str': return { t: 'str', v: k.v };
        case 'err': return { t: 'err', v: k.v };
        case 'cell': case 'range': case 'colrange': case 'rowrange': {
          if (isOp(':')) fail('Unsupported range operator');
          return refNode(k, null);
        }
        case 'sheet': {
          const n = t[p++];
          if (!n) fail('Unexpected end');
          if (n.k === 'name') return { t: 'name', v: n.v, sheet: k.v };
          return refNode(n, k.v);
        }
        case 'name': {
          if (isOp('(')) {
            p++;
            const args = [];
            if (isOp(')')) { p++; return { t: 'call', fn: cleanFn(k.v), args }; }
            for (;;) {
              if (isOp(',')) { args.push({ t: 'omit' }); p++; if (isOp(')')) { args.push({ t: 'omit' }); p++; break; } continue; }
              args.push(binary(0));
              if (isOp(',')) { p++; if (isOp(')')) { args.push({ t: 'omit' }); p++; break; } continue; }
              if (isOp(')')) { p++; break; }
              fail('Expected , or )');
            }
            return { t: 'call', fn: cleanFn(k.v), args };
          }
          if (/^true$/i.test(k.v)) return { t: 'bool', v: true };
          if (/^false$/i.test(k.v)) return { t: 'bool', v: false };
          return { t: 'name', v: k.v, sheet: null };
        }
        case 'op':
          if (k.v === '(') { const e = binary(0); if (!isOp(')')) fail('Expected )'); p++; return e; }
          if (k.v === '{') {
            const rows = [[]];
            for (;;) {
              let neg = false;
              if (isOp('-')) { neg = true; p++; }
              const c = t[p++];
              if (!c) fail('Unexpected end');
              if (c.k === 'num') rows[rows.length - 1].push(neg ? -c.v : c.v);
              else if (c.k === 'str') rows[rows.length - 1].push(c.v);
              else if (c.k === 'name' && /^(true|false)$/i.test(c.v)) rows[rows.length - 1].push(/^true$/i.test(c.v));
              else fail('Bad array constant');
              if (isOp(',')) { p++; continue; }
              if (isOp(';')) { p++; rows.push([]); continue; }
              if (isOp('}')) { p++; break; }
              fail('Bad array constant');
            }
            return { t: 'array', rows };
          }
          return fail(`Unexpected ${k.v}`);
        default: return fail('Unexpected token');
      }
    }
    const cleanFn = (s) => s.toUpperCase().replace(/^_XLFN\./, '').replace(/^_XLWS\./, '').replace(/^_XLDUDF\./, '');
    const e = binary(0);
    if (p < t.length) fail('Trailing text');
    return e;
  };
})(globalThis.Sg = globalThis.Sg || {});
