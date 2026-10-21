// Bot de WhatsApp do DAES rodando localmente com whatsapp-web.js.
// Fluxo: lê o QR code no terminal -> escuta mensagens -> responde com IA -> pausa quando a equipe assume.
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
import { createStore } from './store.js';
import { createBot } from './bot.js';
import { generateReply } from './llm.js';
import { startPanel } from './panel.js';

const { Client, LocalAuth } = pkg;

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const digitsList = (v) => (v || '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);

const IGNORE = digitsList(process.env.IGNORE_NUMBERS);
const ONLY = digitsList(process.env.ONLY_NUMBERS);

const cfg = {
  humanPauseMs: num(process.env.HUMAN_PAUSE_MINUTES, 5) * 60e3,
  handoffPauseMs: num(process.env.HANDOFF_PAUSE_MINUTES, 30) * 60e3,
  maxRepliesPerHour: num(process.env.MAX_REPLIES_PER_HOUR, 20),
  maxAgeSec: 10 * 60,
  minDelayMs: num(process.env.MIN_DELAY_SECONDS, 2) * 1000,
  maxDelayMs: num(process.env.MAX_DELAY_SECONDS, 6) * 1000,
};

const store = createStore({
  maxHistory: num(process.env.HISTORY_MAX, 12),
  ttlMs: num(process.env.HISTORY_TTL_HOURS, 24) * 3600e3,
});
setInterval(() => store.cleanup(), 3600e3).unref();

let ready = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: false,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

const bot = createBot({
  store,
  generateReply,
  cfg,
  send: async (chatId, text) => {
    const msg = await client.sendMessage(chatId, text, { sendSeen: false });
    return msg?.id?._serialized;
  },
  typing: async (chatId) => {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
  },
});

// Só atendemos conversas individuais; ignoramos grupos, status, canais e transmissões.
const isPrivateChat = (id) => /@(c\.us|lid)$/.test(id || '');

// Confere as listas de números permitidos/ignorados (usa o número real do contato).
async function allowed(msg) {
  if (!IGNORE.length && !ONLY.length) return true;
  let number = String(msg.from || msg.to).replace(/\D/g, '');
  try {
    const c = await msg.getContact();
    if (c?.number) number = c.number.replace(/\D/g, '');
  } catch {
    /* usa o id mesmo */
  }
  if (IGNORE.includes(number)) return false;
  if (ONLY.length && !ONLY.includes(number)) return false;
  return true;
}

const MEDIA_TYPES = new Set(['ptt', 'audio', 'image', 'video', 'document']);

client.on('qr', (qr) => {
  console.log('\nEscaneie o QR code abaixo no WhatsApp Business do celular:');
  console.log('Configurações > Dispositivos conectados > Conectar dispositivo\n');
  qrcode.generate(qr, { small: true });
});
client.on('authenticated', () => console.log('[whatsapp] autenticado'));
client.on('auth_failure', (m) => console.error('[whatsapp] falha de autenticação:', m));
client.on('ready', () => {
  ready = true;
  console.log('[whatsapp] pronto! O bot está atendendo.');
});
client.on('disconnected', (reason) => {
  ready = false;
  console.error('[whatsapp] desconectado:', reason, '— encerrando para o gerenciador (pm2) reiniciar');
  store.flush();
  process.exit(1);
});

// Mensagens recebidas de cidadãos
client.on('message', async (msg) => {
  try {
    if (msg.fromMe || msg.isStatus || !isPrivateChat(msg.from)) return;
    const isText = msg.type === 'chat';
    if (!isText && !MEDIA_TYPES.has(msg.type)) return; // figurinhas, reações, avisos do sistema...
    if (!(await allowed(msg))) return;
    bot.onIncoming({
      id: msg.id?._serialized,
      chatId: msg.from,
      text: isText ? msg.body : null,
      kind: isText ? 'text' : 'media',
      ts: msg.timestamp,
    });
  } catch (e) {
    console.error('[message]', e.message);
  }
});

// Mensagens enviadas por NÓS (celular da equipe ou o próprio bot)
client.on('message_create', async (msg) => {
  try {
    if (!msg.fromMe || msg.isStatus || !isPrivateChat(msg.to)) return;
    if (!(await allowed(msg))) return;
    const paused = bot.onHumanMessage({
      id: msg.id?._serialized,
      chatId: msg.to,
      text: msg.type === 'chat' ? msg.body : null,
    });
    if (paused) console.log('[bot] equipe assumiu uma conversa: pausado por', cfg.humanPauseMs / 60e3, 'min');
  } catch (e) {
    console.error('[message_create]', e.message);
  }
});

startPanel({ store, getStatus: () => ({ ready }), port: num(process.env.PANEL_PORT, 3030) });

const shutdown = async () => {
  store.flush();
  try {
    await client.destroy();
  } catch {
    /* ignora */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[whatsapp] iniciando (na primeira vez pode demorar um pouco)...');
client.initialize();
