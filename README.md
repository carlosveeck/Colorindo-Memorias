# 🖍️ Colorindo Memórias — v0

Uma pessoa idosa conta uma lembrança por conversa (por texto nesta v0) e recebe um
livrinho em PDF: **uma página com desenho para colorir** + **uma página com a história**.

## Como rodar (localhost)

Precisa apenas do **Node.js 18 ou mais novo** (`node --version`). Não há pacotes para instalar.

```bash
cd colorindo-memorias
# 1. Abra o arquivo .env e cole sua chave em OPENAI_API_KEY=
# 2. Inicie:
npm start
# 3. Abra no navegador: http://localhost:3000
```

> **Sem chave?** O app roda em **modo demonstração**: perguntas prontas e um desenho
> de exemplo. Bom para testar as telas e o PDF sem gastar créditos.

## Estrutura

```
colorindo-memorias/
├── .env              ← sua chave e configurações (NÃO subir no Git)
├── .env.example      ← modelo do .env
├── server.js         ← servidor local + rotas da API
├── src/
│   ├── ai.js         ← TODA a integração com a OpenAI (isolada)
│   ├── prompts.js    ← textos/personalidade da IA e estilo do desenho
│   ├── mock.js       ← respostas do modo demonstração
│   └── env.js        ← leitor do .env
└── public/
    ├── index.html    ← as 3 telas
    ├── styles.css    ← visual acessível (fontes grandes, alto contraste)
    └── app.js        ← fluxo das telas + geração do PDF
```

## Rotas

| Rota | O que faz |
|---|---|
| `GET /api/config` | Saudação inicial e se está em modo demo |
| `POST /api/conversa` | Próxima pergunta da IA + `pronto` (conversa já cobriu todas as etapas) |
| `POST /api/roteiro` | Ficha da história: título, tamanho (1–3 páginas), personagens, cenários e texto de cada página |
| `POST /api/ilustracao` | Desenha UMA página. Recebe a imagem anterior como referência visual |

## Como as páginas ficam coerentes

1. **Conversa por etapas** (`SISTEMA_CONVERSA`): contexto → acontecimento → personagens → cenário/sentimentos → fechamento.
   Quando termina, a IA envia a marca `<<PRONTO>>` e o botão "Criar meu livro" aparece.
2. **Roteiro** (`SISTEMA_ROTEIRO`): a IA cria uma descrição visual fixa de cada personagem (como era *na época*)
   e de cada cenário. Grupos ("meus 2 filhos") viram personagens separados.
3. **Ilustração** (`promptIlustracao`): cada página puxa a ficha dos personagens e do cenário que aparecem nela.
   Da página 2 em diante, a imagem anterior é enviada como referência (`/images/edits`).
   Se isso falhar, a página é gerada do zero, então o livro nunca trava.

## Ajustes rápidos

- **Personalidade da conversa / estilo do desenho:** `src/prompts.js`
- **Quando aparece o botão "Criar meu livro":** `RESPOSTAS_PARA_LIBERAR_LIVRO` em `public/app.js`
- **Erro ao gerar imagem com `gpt-image-1`** (ex.: "organization must be verified"):
  troque `OPENAI_IMAGE_MODEL=dall-e-3` no `.env`.
- **Imagem lenta?** Use `OPENAI_IMAGE_QUALITY=low` no `.env`.

## Conversa por voz (GPT-Live) — v1

```
Navegador ──(oferta WebRTC)──▶ /api/voz/sessao ──(chave)──▶ POST /v1/live/sessions
Navegador ◀═══ áudio + eventos (canal "oai-events") ═══▶ OpenAI GPT-Live
```

- O `gpt-live-1` (`OPENAI_REALTIME_MODEL`) conduz a conversa falada com as instruções de `SISTEMA_VOZ`.
- Trabalho "delegado" vai para o modelo de texto (`OPENAI_CHAT_MODEL`).
- As transcrições (`session.input_transcript.delta` / `session.output_transcript.delta`) viram falas
  em `estado.mensagens`, o mesmo histórico do modo texto. Roteiro, ilustrações e PDF não mudam.
- O botão "Criar meu livro" aparece quando a IA fala a frase "Criar meu livro" (ou após 10 respostas).
- Se o microfone for negado ou a ligação falhar, a tela volta sozinha para o modo texto.
- Voz opcional: `OPENAI_LIVE_VOICE=marin` no `.env` (vazio = voz padrão).
- Microfone só funciona em `http://localhost` ou HTTPS.
- Custo aproximado da camada de voz: US$ 0,05 por minuto (mais o modelo de texto, quando delegado).
