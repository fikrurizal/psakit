// Registers every worksheet function with Excel. Loaded in the shared runtime alongside the task pane,
// so both see the same engine instance.
(function (Sg) {
  const engine = (Sg.engine = Sg.engine || new Sg.Engine());
  function toExcelError(e) {
    const CE = globalThis.CustomFunctions;
    const code = e && e.code === 'VALUE' ? CE.ErrorCode.invalidValue : CE.ErrorCode.invalidNumber;
    return new CE.Error(code, e && e.message && e.message[0] !== '#' ? e.message : undefined);
  }
  Sg.registerFunctions = function () {
    for (const spec of Sg.SPEC) {
      globalThis.CustomFunctions.associate(spec.name.toUpperCase(), function () {
        Sg.cfCalls = (Sg.cfCalls || 0) + 1; // lets the host tell when Excel has stopped calling functions
        const args = Array.prototype.slice.call(arguments), invocation = args.pop();
        const addr = Sg.normAddr(invocation && invocation.address);
        try {
          return engine.fns[spec.name](addr, ...args);
        } catch (e) {
          if (e && (e.code === 'NUM' || e.code === 'VALUE')) { if (engine.running) engine.noteError(addr, spec.name); throw toExcelError(e); }
          engine.fatal = engine.fatal || `Unexpected error in ${spec.name} at ${addr}: ${e && e.message}`;
          throw toExcelError(e);
        }
      });
    }
  };
  if (globalThis.CustomFunctions) Sg.registerFunctions();
})(globalThis.Sg = globalThis.Sg || {});
