// Persistenza locale (localStorage) di impostazioni, atleti e sessioni salvate. Nessun video viene salvato.

const KEY = 'jumplab.v4';
// Da aggiornare ad ogni modifica del codice: serve a capire a colpo d'occhio se l'app è aggiornata.
export const VERSION = '4.7.0';
export const BUILD = '2026-11-04';

const DEFAULTS = () => ({
  settings: { units: 'cm', model: 'full', delegate: 'auto', skeleton: true, refine: true, headline: 'integrated' },
  athletes: [{ id: 'a1', name: 'Io', heightCm: 175, massKg: 0 }],
  currentAthlete: 'a1',
  testType: 'cmj',
  leg: 'both',
  sessions: [],
});

let state;
const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) return { ...DEFAULTS(), ...raw, settings: { ...DEFAULTS().settings, ...raw.settings } };
  } catch { /* storage non disponibile */ }
  return DEFAULTS();
}

export const store = {
  get s() { return (state ??= read()); },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { /* quota o modalità privata: i dati restano per la sessione */ }
    listeners.forEach((f) => f());
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  athlete() { const s = store.s; return s.athletes.find((a) => a.id === s.currentAthlete) || s.athletes[0]; },
  addSession(sess) { store.s.sessions.unshift(sess); store.s.sessions = store.s.sessions.slice(0, 300); store.save(); },
  removeSession(id) { store.s.sessions = store.s.sessions.filter((x) => x.id !== id); store.save(); },
  uid: () => Math.random().toString(36).slice(2, 10),
};
