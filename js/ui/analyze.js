import { h, ic } from './dom.js';
import { drawPose } from './player.js';

const STAGES = [
  ['open', 'Apro il video'],
  ['model', 'Carico il modello di postura'],
  ['scan', 'Cerco i salti'],
  ['dense', 'Tracciamento ad alta precisione'],
  ['analyze', 'Calcolo stacchi e atterraggi'],
];

export const analyze = {
  render(root, app) {
    root.className = '';
    const run = app.run;
    if (!run) { app.go('#/'); return; }
    const cv = h('canvas', { width: 320, height: 180 });
    const stages = STAGES.map(([k, label]) => h('div', { class: 'stage', 'data-k': k }, h('span', { class: 'dot' }), label));
    const fill = h('i');
    const label = h('div', { class: 'muted small', style: { marginTop: '8px', minHeight: '18px' } });
    const err = h('div', { class: 'card hide', style: { borderColor: '#5b2a2f' } });
    const logBox = h('pre', { class: 'small faint', style: { whiteSpace: 'pre-wrap', margin: 0 } });
    const cancel = h('button', { class: 'btn block', onclick: () => { run.ctrl.abort(); app.go('#/'); } }, 'Annulla');

    const upd = () => {
      const order = STAGES.map((s) => s[0]);
      const cur = order.indexOf(run.stage);
      stages.forEach((el, i) => { el.className = 'stage' + (i < cur || run.stage === 'done' ? ' done' : i === cur ? ' active' : ''); });
      fill.style.width = Math.round(run.progress * 100) + '%';
      label.textContent = run.label || '';
      logBox.textContent = run.log.slice(-8).join('\n');
      if (run.preview) {
        const { canvas, kp } = run.preview;
        if (cv.width !== canvas.width || cv.height !== canvas.height) { cv.width = canvas.width; cv.height = canvas.height; }
        const c = cv.getContext('2d');
        c.drawImage(canvas, 0, 0);
        drawPose(c, kp, cv.width, cv.height);
      }
      if (run.error) {
        err.classList.remove('hide'); cancel.classList.add('hide');
        err.replaceChildren(
          h('b', { style: { color: '#ff9b9b' } }, 'Analisi non riuscita'),
          h('p', { class: 'muted', style: { margin: '8px 0 12px' } }, run.error),
          h('div', { class: 'grid2' },
            h('button', { class: 'btn', onclick: () => app.go('#/') }, 'Indietro'),
            h('button', { class: 'btn primary', onclick: () => app.startAnalysis(run.file, run.extra) }, 'Riprova')));
      }
    };
    run.listener = upd;
    root.append(
      h('div', { class: 'top' }, h('div', { class: 'brand' }, 'Analisi in corso'), h('span', { class: 'chip ghost' }, run.file.name.slice(0, 22))),
      h('div', { class: 'stagebox', style: { minHeight: '200px' } }, cv),
      h('div', { class: 'bar', style: { marginTop: '14px' } }, fill), label,
      h('div', { class: 'card', style: { marginTop: '14px' } }, ...stages),
      err,
      h('details', { class: 'acc' }, h('summary', {}, 'Dettagli tecnici'), logBox),
      h('div', { style: { marginTop: '12px' } }, cancel),
    );
    upd();
  },
  dispose(app) { if (app.run) app.run.listener = null; },
};
