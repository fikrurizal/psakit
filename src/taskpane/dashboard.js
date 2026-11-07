// The live window's own page. Excel opens it as a dialog, and the task pane sends it results.
(function (Sg) {
  /* global Office */
  Office.onReady(() => {
    const send = (m) => { try { Office.context.ui.messageParent(JSON.stringify(m)); } catch (e) { /* the pane has gone */ } };
    const saveIt = async (model) => {
      try { Sg.saveTextFile(Sg.reportFileName(model.title), Sg.reportHtml(model, await Sg.getReportAssets())); view.status({ text: 'Saved the report to your downloads. If nothing appeared, this version of Excel blocks downloads, so use Copy report HTML in the panel.' }); }
      catch (e) { view.status({ text: 'Could not save the report: ' + e.message }); }
    };
    const view = Sg.mountLive(document.getElementById('app'), { run: () => send({ type: 'run' }), stop: () => send({ type: 'stop' }), auto: (on) => send({ type: 'auto', on }), save: saveIt }, { canAuto: true, canSave: true });
    const receive = Sg.pieceReceiver((m) => {
      if (m.type === 'model') view.update(m.model);
      if (m.type === 'status') view.status(m);
      if (m.type === 'auto') view.setAuto(m.on);
    });
    Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, (ev) => receive(ev.message), () => send({ type: 'ready' }));
  });
})(globalThis.Sg);
