// The Office.js side of the runner's host interface.
(function (Sg) {
 
  const SHEET_RE = /'/g;
  const colName = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
  const SETTINGS_KEY = 'surrogateSettings';

  class ExcelHost {
    constructor() { this.hideScreen = true; this.savedMode = null; this.label = 'Excel'; }
    async calculate() {
      await Excel.run(async (ctx) => {
        if (this.hideScreen) ctx.workbook.application.suspendScreenUpdatingUntilNextSync();
        ctx.workbook.application.calculate(Excel.CalculationType.full);
        await ctx.sync();
      });
      await this.settle();
    }
    // In real Excel, calculate() returns before Excel has finished calling custom functions, so the engine would check
    // registrations (Dirichlet components, outputs) too early. Wait until Excel reports it is done and no function has
    // been called for a moment. Gives up after 30 seconds and lets the usual checks report what's missing.
    async settle() {
      const canAsk = typeof Office !== 'undefined' && Office.context && Office.context.requirements && Office.context.requirements.isSetSupported('ExcelApi', '1.9');
      const start = Date.now();
      let last = -1;
      for (;;) {
        let state;
        if (canAsk) {
          state = await Excel.run(async (ctx) => { const app = ctx.workbook.application; app.load('calculationState'); await ctx.sync(); return app.calculationState; });
        }
        const busy = state === 'Calculating' || state === 'Pending';
        const calls = Sg.cfCalls || 0;
        if (!busy && calls === last) return;
        if (Date.now() - start > 30000) return;
        last = calls;
        await new Promise((r) => setTimeout(r, busy ? 50 : 25));
      }
    }
    async setManual(manual) {
      await Excel.run(async (ctx) => {
        const app = ctx.workbook.application;
        if (manual) {
          app.load('calculationMode');
          await ctx.sync();
          this.savedMode = app.calculationMode;
          app.calculationMode = Excel.CalculationMode.manual;
        } else if (this.savedMode) {
          app.calculationMode = this.savedMode;
          this.savedMode = null;
        }
        await ctx.sync();
      });
    }
    async readCells(addrs) {
      return Excel.run(async (ctx) => {
        const rs = addrs.map((a) => {
          const i = a.lastIndexOf('!');
          const r = ctx.workbook.worksheets.getItem(a.slice(0, i).replace(SHEET_RE, '')).getRange(a.slice(i + 1));
          r.load('values');
          return r;
        });
        await ctx.sync();
        return rs.map((r) => r.values[0][0]);
      });
    }
    async _usedRanges(ctx) {
      const sheets = ctx.workbook.worksheets;
      sheets.load('items/name');
      await ctx.sync();
      const used = sheets.items.map((s) => {
        const u = s.getUsedRangeOrNullObject(false);
        u.load('formulas,rowIndex,columnIndex,isNullObject');
        return { name: s.name, sheet: s, u };
      });
      await ctx.sync();
      return used.filter((x) => !x.u.isNullObject);
    }
    async scanFormulas() {
      return Excel.run(async (ctx) => {
        const out = [];
        for (const { name, u } of await this._usedRanges(ctx)) {
          u.formulas.forEach((row, r) => row.forEach((f, c) => {
            if (typeof f === 'string' && f[0] === '=') out.push({ address: `${name}!${colName(u.columnIndex + c)}${u.rowIndex + r + 1}`, formula: f });
          }));
        }
        return out;
      });
    }
    // Everything the compiler needs: formulas and Excel's calculated values for each sheet, and defined names.
    async readWorkbook() {
      return Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load('items/name');
        const names = ctx.workbook.names;
        names.load('items/name,items/formula,items/type,items/visible');
        await ctx.sync();
        const used = sheets.items.map((sh) => {
          const u = sh.getUsedRangeOrNullObject(false);
          u.load('formulas,values,rowIndex,columnIndex,isNullObject');
          return { name: sh.name, u };
        });
        await ctx.sync();
        return {
          sheets: used.filter((x) => !x.u.isNullObject).map((x) => ({ name: x.name, rowIndex: x.u.rowIndex, columnIndex: x.u.columnIndex, formulas: x.u.formulas, values: x.u.values })),
          names: names.items.filter((n) => typeof n.formula === 'string').map((n) => ({ name: n.name, formula: n.formula })),
        };
      });
    }
    // Rewrites old Ersatz formulas one cell at a time, leaving every other cell and its formatting alone.
    async convertLegacy() {
      return Excel.run(async (ctx) => {
        let changed = 0, cleared = 0;
        for (const { sheet, u } of await this._usedRanges(ctx)) {
          const res = Sg.convertMatrix(u.formulas);
          res.formulas.forEach((row, r) => row.forEach((f, c) => {
            if (f === u.formulas[r][c]) return;
            const cell = sheet.getCell(u.rowIndex + r, u.columnIndex + c);
            if (f === '') cell.clear(Excel.ClearApplyTo.contents); else cell.formulas = [[f]];
          }));
          changed += res.changed; cleared += res.cleared;
          await ctx.sync();
        }
        return { changed, cleared };
      });
    }
    async writeSheet(name, rows, opts) {
      this.lastOwnWrite = Date.now(); // so writing results doesn't count as someone editing the model
      return Excel.run(async (ctx) => {
        let ws = ctx.workbook.worksheets.getItemOrNullObject(name);
        await ctx.sync();
        if (ws.isNullObject) ws = ctx.workbook.worksheets.add(name); else ws.getRange().clear();
        const width = Math.max(...rows.map((r) => r.length));
        const data = rows.map((r) => r.concat(new Array(width - r.length).fill('')));
        const rg = ws.getRangeByIndexes(0, 0, data.length, width);
        rg.formulas = data;
        if (opts && opts.boldHeader) ws.getRangeByIndexes(0, 0, 1, width).format.font.bold = true;
        for (const [row, n] of (opts && opts.boldRows) || []) ws.getRangeByIndexes(row, 0, 1, n).format.font.bold = true;
        rg.format.autofitColumns();
        ws.activate();
        await ctx.sync();
      });
    }
    // The live window: an Excel dialog that stays open beside the workbook. handlers: onMessage(obj), onClosed()
    openDashboard(handlers) {
      return new Promise((resolve, reject) => {
        if (!Office.context.requirements.isSetSupported('DialogApi', '1.2')) { reject(new Error('This version of Excel can\'t send updates to a separate window. Save an HTML report instead.')); return; }
        const url = new URL('dashboard.html', window.location.href).href;
        Office.context.ui.displayDialogAsync(url, { height: 85, width: 70, displayInIframe: false }, (r) => {
          if (r.status !== Office.AsyncResultStatus.Succeeded) { reject(new Error(r.error && r.error.code === 12007 ? 'A Surrogate window is already open.' : `Excel could not open the window: ${r.error && r.error.message}`)); return; }
          const dialog = r.value;
          dialog.addEventHandler(Office.EventType.DialogMessageReceived, (ev) => { try { handlers.onMessage(JSON.parse(ev.message)); } catch (e) { /* not ours */ } });
          dialog.addEventHandler(Office.EventType.DialogEventReceived, (ev) => handlers.onClosed(ev && ev.error));
          resolve({ send: (obj) => Sg.sendInPieces((text) => dialog.messageChild(text), obj), close: () => dialog.close() });
        });
      });
    }
    // Calls back when someone edits any sheet. Returns a function that stops watching.
    async watchChanges(callback) {
      return Excel.run(async (ctx) => {
        const reg = ctx.workbook.worksheets.onChanged.add(async () => { if (Date.now() - (this.lastOwnWrite || 0) > 2500) callback(); });
        await ctx.sync();
        return async () => { await Excel.run(reg.context, async (c) => { reg.remove(); await c.sync(); }); };
      });
    }
    async saveSettings(obj) {
      const s = Office.context.document.settings;
      s.set(SETTINGS_KEY, obj);
      await new Promise((resolve) => s.saveAsync(() => resolve()));
    }
    async loadSettings() {
      const v = Office.context.document.settings.get(SETTINGS_KEY);
      return v || null;
    }
  }
  Sg.ExcelHost = ExcelHost;
})(globalThis.Sg = globalThis.Sg || {});
