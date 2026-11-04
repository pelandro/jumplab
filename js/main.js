import { h, icon, toast } from './ui/dom.js';
import { store } from './store.js';
import { runAnalysis } from './engine/pipeline.js';
import { home } from './ui/home.js';
import { analyze } from './ui/analyze.js';
import { review } from './ui/review.js';
import { history } from './ui/history.js';
import { profile } from './ui/profile.js';

const root = document.getElementById('app');
const views = { '': home, history, profile, analyze, result: review };
const TABS = [['', 'Test', 'jump'], ['history', 'Storico', 'history'], ['profile', 'Profilo', 'user']];
let current = null;

const app = {
  session: null,
  run: null,
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  route,

  async startAnalysis(file, extra = {}) {
    app.run?.ctrl.abort();
    const S = store.s, ath = store.athlete();
    const ctrl = new AbortController();
    const run = { file, ctrl, extra, stage: 'open', progress: 0, label: '', log: [], preview: null, error: null, listener: null };
    app.run = run;
    const notify = () => run.listener?.();
    const opts = {
      model: S.settings.model, delegate: S.settings.delegate, testType: S.testType, heightCm: ath.heightCm, massKg: ath.massKg,
      boxCm: S.boxCm || undefined, signal: ctrl.signal, ...extra,
    };
    app.go('#/analyze');
    try {
      const session = await runAnalysis(file, opts, {
        onStage: (s, p, l) => { run.stage = s; run.progress = p; run.label = l; notify(); },
        onPreview: (canvas, kp) => { run.preview = { canvas, kp }; notify(); },
        onLog: (s) => { run.log.push(s); notify(); },
      });
      if (ctrl.signal.aborted) return;
      session.file = file;
      app.session = session;
      app.run = null;
      app.go('#/result');
    } catch (e) {
      if (e.name === 'AbortError' || ctrl.signal.aborted) return;
      console.error(e);
      run.error = String(e.message || e);
      run.log.push('ERRORE: ' + run.error);
      notify();
    }
  },
};

function tabbar(active) {
  return h('div', { class: 'tabbar' }, h('div', { class: 'in' }, ...TABS.map(([k, label, ic]) =>
    h('button', { class: active === k ? 'on' : '', onclick: () => app.go('#/' + k) }, h('span', { html: icon(ic) }), label))));
}

function route() {
  const [, name = '', param] = (location.hash || '#/').match(/^#\/?([^/]*)\/?(.*)$/) || [];
  const view = views[name] || home;
  current?.dispose?.(app);
  document.querySelector('.tabbar')?.remove();
  root.replaceChildren();
  root.className = '';
  window.scrollTo(0, 0);
  current = view;
  view.render(root, app, param || undefined);
  if (['', 'history', 'profile'].includes(name) && !(name === 'history' && param)) document.body.append(tabbar(name));
}

addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
window.__app = app;
