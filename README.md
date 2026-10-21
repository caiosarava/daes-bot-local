# Bot de WhatsApp do DAES, versão local (Node.js)

Atendimento automático com IA no WhatsApp Business usando **whatsapp-web.js**: o bot entra no
WhatsApp como um "dispositivo conectado" (igual ao WhatsApp Web), então usa o **mesmo número**
e a equipe continua respondendo pelo celular. Sem API da Meta, sem custo.

> **Aviso:** o whatsapp-web.js não é oficial e vai contra os termos do WhatsApp. Existe risco de
> o número ser bloqueado. Para reduzir: o bot só responde a quem escreveu primeiro, com atraso
> de "digitando...", limite de respostas por hora e ignorando grupos. Nunca use para envio em massa.

## Estrutura
- `src/index.js` – conexão com o WhatsApp (QR code) e ligação com o bot
- `src/bot.js` – regras do atendimento (pausa de 5 min, transferência, limites)
- `src/llm.js` – chamada à IA (Groq, com reserva opcional na NVIDIA)
- `src/prompt.js` – **cole aqui o prompt do atendente**
- `src/store.js` – memória local em `data/state.json` (histórico, pausas, liga/desliga)
- `src/panel.js` + `public/painel.html` – painel local em http://localhost:3030
- `test/bot.test.js` – teste da lógica (`npm test`)

## Como funciona
1. Chega mensagem de um cidadão → o bot guarda no histórico.
2. Se há pausa ativa para aquela conversa → fica quieto.
3. Senão → mostra "digitando...", chama a IA e responde.
4. Se a IA incluir `[[TRANSFERIR]]`, avisa o cidadão e pausa por `HANDOFF_PAUSE_MINUTES`.
5. Quando a equipe escreve pelo celular → pausa de `HUMAN_PAUSE_MINUTES` (5). Cada nova mensagem
   da equipe renova o prazo.

## Manutenção
- Sessão do WhatsApp fica em `.wwebjs_auth/` (não apague, senão precisa ler o QR de novo).
- O celular precisa abrir o WhatsApp Business ao menos a cada ~14 dias, ou o aparelho é desconectado.
- Modelo de IA descontinuado: troque `GROQ_MODEL` no `.env` (lista em console.groq.com/docs/models).
- Histórico expira em 24 h (`HISTORY_TTL_HOURS`). Oriente o prompt a não pedir CPF/documentos.
- Se o `whatsapp-web.js` parar de funcionar após uma atualização do WhatsApp: `npm update whatsapp-web.js`.
