// Lógica do atendimento, independente da biblioteca de WhatsApp (por isso é fácil de testar).
//
// Pausa quando um humano assume:
//  - Se alguém da equipe escreve pelo celular, o evento chega em onHumanMessage().
//  - O bot fica quieto por humanPauseMs (5 min) e cada nova mensagem humana renova o prazo.

const MSG_FALLBACK =
  'Desculpe, estou com uma instabilidade no momento. 😕 Nossa equipe vai responder assim que possível.';
const MSG_NAO_TEXTO =
  'Recebi seu arquivo, mas por enquanto só consigo ler mensagens de texto. 😊 Pode escrever sua dúvida? Se preferir, nossa equipe responde assim que possível.';
const MSG_LIMITE =
  'Recebemos muitas mensagens suas em pouco tempo. Nossa equipe vai continuar o atendimento assim que possível. 🙏';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBot({ store, generateReply, send, typing, cfg, log = console, now = () => Date.now() }) {
  const queues = new Map(); // fila por contato: uma mensagem por vez
  const seen = new Map(); // ids já processados
  const botIds = new Map(); // ids de mensagens enviadas pelo bot (para não confundir com humano)
  const sending = new Map(); // contato -> até quando eventos "fromMe" são considerados do bot
  const rate = new Map(); // contato -> { count, resetAt }

  function enqueue(chatId, fn) {
    const prev = queues.get(chatId) || Promise.resolve();
    const next = prev.then(fn).catch((e) => log.error('[erro]', e.message));
    queues.set(chatId, next);
    next.finally(() => {
      if (queues.get(chatId) === next) queues.delete(chatId);
    });
    return next;
  }

  function remember(map, key, ttlMs) {
    map.set(key, now() + ttlMs);
    if (map.size > 2000) for (const [k, exp] of map) if (exp < now()) map.delete(k);
  }

  function isBotEcho(id, chatId) {
    if (id && (botIds.get(id) || 0) > now()) return true;
    return (sending.get(chatId) || 0) > now();
  }

  function overLimit(chatId) {
    const t = now();
    let r = rate.get(chatId);
    if (!r || r.resetAt <= t) r = { count: 0, resetAt: t + 3600e3 };
    r.count++;
    rate.set(chatId, r);
    return r.count;
  }

  async function sendBot(chatId, text) {
    const delay = Math.min(cfg.maxDelayMs, Math.max(cfg.minDelayMs, text.length * 25));
    if (delay > 0) {
      await typing(chatId).catch(() => {});
      await sleep(delay);
    }
    sending.set(chatId, now() + 60e3); // durante o envio, ecos "fromMe" são do bot
    try {
      const id = await send(chatId, text);
      if (id) remember(botIds, id, 10 * 60e3);
    } finally {
      sending.set(chatId, now() + 3000); // pequena folga para o evento chegar
    }
  }

  // ---- Equipe respondeu pelo celular ----
  function onHumanMessage({ id, chatId, text }) {
    if (isBotEcho(id, chatId)) return false;
    store.setPause(chatId, cfg.humanPauseMs);
    store.pushHistory(chatId, { role: 'assistant', content: `[Atendente humano] ${(text || '[mídia]').slice(0, 1000)}` });
    return true;
  }

  // ---- Cidadão enviou mensagem ----
  // kind: 'text' | 'media'
  function onIncoming({ id, chatId, text, kind = 'text', ts }) {
    if (!store.enabled) return Promise.resolve();
    if (id) {
      if ((seen.get(id) || 0) > now()) return Promise.resolve();
      remember(seen, id, 24 * 3600e3);
    }
    if (ts && now() / 1000 - ts > cfg.maxAgeSec) return Promise.resolve();

    const clean = text?.trim().slice(0, 1000) || null;

    return enqueue(chatId, async () => {
      const paused = store.isPaused(chatId);
      if (clean) store.pushHistory(chatId, { role: 'user', content: clean });
      if (paused) return; // humano atendendo: o bot fica quieto

      if (kind === 'media' || !clean) {
        await sendBot(chatId, MSG_NAO_TEXTO);
        return;
      }

      const n = overLimit(chatId);
      if (n > cfg.maxRepliesPerHour) {
        if (n === cfg.maxRepliesPerHour + 1) await sendBot(chatId, MSG_LIMITE);
        return;
      }

      let reply;
      try {
        reply = await generateReply(store.getHistory(chatId));
      } catch (e) {
        log.error('[ia]', e.message);
        await sendBot(chatId, MSG_FALLBACK);
        return;
      }

      // A equipe pode ter começado a escrever enquanto a IA pensava: confere de novo.
      if (store.isPaused(chatId)) return;

      const transferir = reply.includes('[[TRANSFERIR]]');
      const limpo = reply.replace(/\[\[TRANSFERIR\]\]/g, '').trim();
      if (limpo) {
        await sendBot(chatId, limpo);
        store.pushHistory(chatId, { role: 'assistant', content: limpo });
      }
      if (transferir) store.setPause(chatId, cfg.handoffPauseMs);
    });
  }

  return { onIncoming, onHumanMessage };
}
