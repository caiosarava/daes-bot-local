import assert from 'node:assert/strict';
process.env.NVIDIA_API_KEY = 'k';
process.env.NVIDIA_MODELS = 'modelo/velho,modelo/instavel,modelo/bom';
const calls = [];
globalThis.fetch = async (url, opt) => {
  const m = JSON.parse(opt.body).model;
  calls.push(m);
  if (m === 'modelo/velho') return new Response('gone', { status: 410 });
  if (m === 'modelo/instavel') return new Response('busy', { status: 503 });
  return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think> Olá!' } }] }), { status: 200 });
};
console.error = () => {};
const { generateReply } = await import('../src/llm.js');
const out = await generateReply([{ role: 'user', content: 'oi' }]);
assert.equal(out, 'Olá!');
assert.deepEqual(calls, ['modelo/velho', 'modelo/instavel', 'modelo/instavel', 'modelo/bom']);
console.log('PASS - 410 pula direto; 503 tenta 2x; depois usa o próximo modelo; <think> removido');
