import { SYSTEM_PROMPT } from './prompt.js';

if (SYSTEM_PROMPT.includes('[[COLE AQUI O SEU PROMPT]]')) {
  console.warn('[prompt] ATENÇÃO: o prompt do atendente ainda não foi colado em src/prompt.js');
}

// Regras técnicas que o código exige, independentemente do seu prompt.
const REGRAS_TECNICAS = `
REGRAS TÉCNICAS DO CANAL (WhatsApp):
- Responda sempre em português do Brasil, com mensagens curtas e claras.
- Use apenas formatação do WhatsApp: *negrito* com asteriscos simples e listas com hífen. Não use markdown (#, **, tabelas, links em formato [texto](url)).
- Não invente informações que não estejam nas suas instruções. Se não souber, diga que vai encaminhar para a equipe.
- Se o cidadão pedir para falar com uma pessoa/atendente, se você não souber responder com segurança, ou se o assunto for reclamação ou caso sensível: avise que a equipe dará continuidade e inclua exatamente o marcador [[TRANSFERIR]] no final da resposta.
- No histórico, mensagens que começam com [Atendente humano] foram escritas pela equipe. Nunca use esse prefixo nas suas respostas.
`;

const DEFAULT_MODELS = 'meta/llama-3.3-70b-instruct,nvidia/nemotron-3-super-120b-a12b';

export const nvidiaConfig = () => ({
  baseUrl: (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
  key: process.env.NVIDIA_API_KEY,
  // Lista de modelos em ordem de preferência: se o primeiro falhar, tenta o próximo.
  models: (process.env.NVIDIA_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean),
  timeoutMs: (Number(process.env.NVIDIA_TIMEOUT_SECONDS) || 30) * 1000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callModel({ baseUrl, key, timeoutMs }, model, messages) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content
    ?.replace(/<think>[\s\S]*?<\/think>/g, '') // alguns modelos devolvem o raciocínio no texto
    .trim();
  if (!text) throw new Error('resposta vazia');
  return text;
}

// history: [{ role: 'user' | 'assistant', content: '...' }]
export async function generateReply(history) {
  const cfg = nvidiaConfig();
  if (!cfg.key) throw new Error('NVIDIA_API_KEY não configurada no .env');

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const system = `${SYSTEM_PROMPT}\n${REGRAS_TECNICAS}\nData e hora atuais (São Carlos/SP): ${agora}.`;
  const messages = [{ role: 'system', content: system }, ...history];

  let lastError;
  for (const model of cfg.models) {
    // Até 2 tentativas por modelo; só repete em erro temporário (429, 5xx, timeout, rede).
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await callModel(cfg, model, messages);
      } catch (e) {
        lastError = e;
        console.error(`[ia] ${model} (tentativa ${attempt}): ${e.message}`);
        const temporario = !e.status || e.status === 429 || e.status >= 500;
        if (!temporario) break; // 401/403/404/410...: não adianta repetir, vai para o próximo modelo
        if (attempt === 1) await sleep(1500);
      }
    }
  }
  throw lastError || new Error('Nenhum modelo configurado');
}