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

function providers() {
  const list = [];
  if (process.env.GROQ_API_KEY) {
    list.push({
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    });
  }
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_MODEL) {
    list.push({
      name: 'nvidia',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      key: process.env.NVIDIA_API_KEY,
      model: process.env.NVIDIA_MODEL,
    });
  }
  return list;
}

// history: [{ role: 'user' | 'assistant', content: '...' }]
export async function generateReply(history) {
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const system = `${SYSTEM_PROMPT}\n${REGRAS_TECNICAS}\nData e hora atuais (São Carlos/SP): ${agora}.`;
  const messages = [{ role: 'system', content: system }, ...history];

  let lastError;
  for (const p of providers()) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, messages, temperature: 0.3, max_tokens: 600 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content
        ?.replace(/<think>[\s\S]*?<\/think>/g, '') // alguns modelos (ex.: Qwen) devolvem o raciocínio
        .trim();
      if (text) return text;
      throw new Error(`${p.name}: resposta vazia`);
    } catch (e) {
      lastError = e;
      console.error('[ia]', e.message);
    }
  }
  throw lastError || new Error('Nenhum provedor de IA configurado');
}
