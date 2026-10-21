// Memória local em arquivo JSON (data/state.json): histórico das conversas, pausas e liga/desliga.
// Sem banco de dados e sem dependências. Grava com atraso (debounce) e de forma atômica.
import fs from 'node:fs';
import path from 'node:path';

export function createStore({ file = 'data/state.json', maxHistory = 12, ttlMs = 24 * 3600e3, now = () => Date.now() } = {}) {
  let state = { enabled: true, history: {}, pauses: {} };
  let dirty = false;
  let timer = null;

  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    /* primeira execução */
  }

  function save() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(flush, 1500);
    timer.unref?.();
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  }

  // Remove históricos antigos (LGPD: não guardamos conversas além do prazo) e pausas vencidas.
  function cleanup() {
    const t = now();
    for (const [chat, h] of Object.entries(state.history)) {
      if (!h.items?.length || t - h.last > ttlMs) delete state.history[chat];
    }
    for (const [chat, until] of Object.entries(state.pauses)) {
      if (until <= t) delete state.pauses[chat];
    }
    save();
  }

  return {
    get enabled() {
      return state.enabled;
    },
    setEnabled(v) {
      state.enabled = !!v;
      save();
    },
    getHistory(chat) {
      const h = state.history[chat];
      if (!h || now() - h.last > ttlMs) return [];
      return h.items.map((i) => ({ role: i.role, content: i.content }));
    },
    pushHistory(chat, item) {
      const h = state.history[chat] || { items: [], last: 0 };
      h.items.push(item);
      h.items = h.items.slice(-maxHistory);
      h.last = now();
      state.history[chat] = h;
      save();
    },
    setPause(chat, ms) {
      state.pauses[chat] = now() + ms; // regravar = renovar o prazo
      save();
    },
    clearPause(chat) {
      delete state.pauses[chat];
      save();
    },
    isPaused(chat) {
      const until = state.pauses[chat];
      if (!until) return false;
      if (until <= now()) {
        delete state.pauses[chat];
        save();
        return false;
      }
      return true;
    },
    pauses() {
      const t = now();
      return Object.entries(state.pauses)
        .filter(([, until]) => until > t)
        .map(([chat, until]) => ({ chat, secondsLeft: Math.round((until - t) / 1000) }));
    },
    chatCount: () => Object.keys(state.history).length,
    cleanup,
    flush,
  };
}
