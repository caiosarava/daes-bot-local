// Diagnóstico da IA: rode com `npm run check-ia`.
// 1) confere a chave e lista se os modelos do .env existem na sua conta;
// 2) faz uma pergunta de teste a cada modelo e mostra o tempo de resposta.
import { nvidiaConfig } from '../src/llm.js';

const cfg = nvidiaConfig();
if (!cfg.key) {
  console.error('Faltou NVIDIA_API_KEY no .env');
  process.exit(1);
}
console.log('Endereço:', cfg.baseUrl);
console.log('Modelos configurados:', cfg.models.join(', '), '\n');

let available = null;
try {
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) {
    console.error(`✗ A chave foi recusada (HTTP ${res.status}). Gere outra em build.nvidia.com/settings/api-keys`);
    process.exit(1);
  }
  if (res.ok) available = new Set((await res.json()).data.map((m) => m.id));
  else console.warn(`Não consegui listar os modelos (HTTP ${res.status}); seguindo para o teste direto.`);
} catch (e) {
  console.warn('Não consegui listar os modelos:', e.message);
}

for (const model of cfg.models) {
  if (available && !available.has(model)) {
    console.log(`✗ ${model}: NÃO existe no catálogo (troque no .env). Parecidos:`);
    const base = model.split('/').pop().split('-')[0];
    [...available].filter((id) => id.includes(base)).slice(0, 8).forEach((id) => console.log('    ', id));
    continue;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Responda em uma frase: o que é economia solidária?' }],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    const text = JSON.parse(body).choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    console.log(`✓ ${model} (${((Date.now() - t0) / 1000).toFixed(1)} s): ${text || '(resposta vazia)'}`);
  } catch (e) {
    console.log(`✗ ${model}: ${e.message}`);
  }
}

if (available) {
  console.log('\nOutros modelos de chat disponíveis (amostra):');
  [...available]
    .filter((id) => /llama|nemotron|mistral|qwen|gemma|kimi|glm|gpt-oss|deepseek/i.test(id) && !/embed|rerank|vision|vl|guard|safety/i.test(id))
    .slice(0, 25)
    .forEach((id) => console.log('  ', id));
}
