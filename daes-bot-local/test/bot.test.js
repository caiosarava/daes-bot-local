// Teste da lógica (sem WhatsApp real): pausa de 5 min, transferência, duplicados, limites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../src/store.js';
import { createBot } from '../src/bot.js';

let t = 1_700_000_000_000;
const now = () => t;
const file = '/tmp/daes-test-state.json';
fs.rmSync(file, { force: true });

const store = createStore({ file, now });
const sent = [];
let llm = 0;
const bot = createBot({
  store,
  now,
  cfg: { humanPauseMs: 5 * 60e3, handoffPauseMs: 30 * 60e3, maxRepliesPerHour: 3, maxAgeSec: 600, minDelayMs: 0, maxDelayMs: 0 },
  generateReply: async (h) => {
    llm++;
    return h.at(-1).content.includes('atendente') ? 'Vou chamar a equipe. [[TRANSFERIR]]' : 'Resposta da IA';
  },
  send: async (chat, text) => {
    sent.push(text);
    return 'BOT' + sent.length;
  },
  typing: async () => {},
  log: { error: () => {} },
});

const A = '5516999999999@c.us';
let n = 0;
const inc = (text, chat = A, extra = {}) => bot.onIncoming({ id: 'i' + ++n, chatId: chat, text, ts: now() / 1000, ...extra });
const pass = (m) => console.log('PASS -', m);

await inc('Oi, como me cadastro na feira?');
assert.deepEqual(sent, ['Resposta da IA']); pass('bot responde');

await bot.onIncoming({ id: 'i1', chatId: A, text: 'repetida', ts: now() / 1000 });
assert.equal(sent.length, 1); pass('mensagem duplicada ignorada');

// o eco da mensagem do próprio bot não conta como humano
assert.equal(bot.onHumanMessage({ id: 'BOT1', chatId: A, text: 'Resposta da IA' }), false);
assert.equal(store.isPaused(A), false); pass('eco do bot não pausa');

// humano assume
t += 20e3;
assert.equal(bot.onHumanMessage({ id: 'h1', chatId: A, text: 'Olá, aqui é a Maria do DAES' }), true);
await inc('Preciso do endereço');
assert.equal(sent.length, 1); assert.equal(llm, 1); pass('bot quieto durante a pausa');

t += 4 * 60e3;
bot.onHumanMessage({ id: 'h2', chatId: A, text: 'Já te passo' });
t += 4 * 60e3;
await inc('ok?');
assert.equal(sent.length, 1); pass('nova mensagem humana renova a pausa (8 min após a primeira)');

t += 61e3;
await inc('Voltei');
assert.equal(sent.length, 2); pass('bot volta 5 min após a última mensagem humana');
assert.ok(store.getHistory(A).some((m) => m.content.startsWith('[Atendente humano] Olá'))); pass('fala humana fica no histórico');

// transferência
await inc('quero falar com um atendente');
assert.equal(sent.at(-1), 'Vou chamar a equipe.'); pass('transferência avisa e remove o marcador');
const c = sent.length;
await inc('alguém aí?');
assert.equal(sent.length, c); pass('bot pausa depois da transferência');

// mídia
const B = '5516888888888@c.us';
await inc(null, B, { kind: 'media' });
assert.ok(sent.at(-1).startsWith('Recebi seu arquivo')); pass('áudio/imagem recebe aviso de só texto');

// limite por hora (3)
const C = '5516777777777@c.us';
for (let i = 0; i < 5; i++) await inc('oi ' + i, C);
const toC = sent.slice(c + 1).length;
assert.ok(sent.some((m) => m.startsWith('Recebemos muitas mensagens'))); pass('limite por hora avisa uma vez e silencia');

// desligado
store.setEnabled(false);
const d = sent.length;
await inc('oi', '5516666666666@c.us');
assert.equal(sent.length, d); pass('bot desligado não responde');

// persistência
store.flush();
const store2 = createStore({ file, now });
assert.ok(store2.getHistory(A).length > 0 && store2.enabled === false); pass('estado é salvo e recarregado do arquivo');
