// ============================================================
//  Integração com a OpenAI — isolada neste arquivo.
//  Quando trocar a conversa por texto pelo GPT Realtime (voz),
//  só responderConversa() muda; o roteiro e as ilustrações continuam iguais.
// ============================================================
import { SISTEMA_CONVERSA, SISTEMA_ROTEIRO, MARCA_PRONTO, promptIlustracao } from './prompts.js';
import { mockResposta, mockRoteiro, mockIlustracao } from './mock.js';

// Lê a configuração na hora do uso (garante que o .env já foi carregado).
function config() {
  return {
    key: (process.env.OPENAI_API_KEY || '').trim(),
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    imageQuality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
  };
}

export const modoDemo = () => !config().key;

// Chamada genérica à API. Aceita JSON (objeto) ou FormData (envio de imagem).
async function chamarOpenAI(rota, corpo, tempoLimiteMs) {
  const { key, baseUrl } = config();
  const ehFormulario = corpo instanceof FormData;

  const resp = await fetch(`${baseUrl}${rota}`, {
    method: 'POST',
    headers: ehFormulario
      ? { Authorization: `Bearer ${key}` } // o fetch monta o multipart sozinho
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: ehFormulario ? corpo : JSON.stringify(corpo),
    signal: AbortSignal.timeout(tempoLimiteMs),
  });

  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = dados?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`OpenAI (${rota}): ${msg}`);
  }
  return dados;
}

// Limpa o histórico vindo do navegador (nunca confiar no cliente).
function limparMensagens(mensagens) {
  if (!Array.isArray(mensagens)) return [];
  return mensagens
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-60)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));
}

// ============================================================
// 1) CONVERSA
// ============================================================
export async function responderConversa(mensagens) {
  const historico = limparMensagens(mensagens);
  if (modoDemo()) return mockResposta(historico);

  const dados = await chamarOpenAI(
    '/chat/completions',
    {
      model: config().chatModel,
      // Sem max_tokens/temperature: modelos novos rejeitam esses parâmetros.
      messages: [{ role: 'system', content: SISTEMA_CONVERSA }, ...historico],
    },
    45_000
  );

  const bruto = dados.choices?.[0]?.message?.content?.trim() || 'Desculpe, pode repetir, por favor?';
  // Detecta e remove a marca de "conversa completa"
  const pronto = bruto.includes(MARCA_PRONTO);
  const resposta = bruto.split(MARCA_PRONTO).join('').trim();
  return { resposta, pronto };
}

// ============================================================
// 2) ROTEIRO (título, tamanho, personagens, cenários, páginas)
// ============================================================
export async function criarRoteiro(mensagens) {
  const historico = limparMensagens(mensagens);
  if (modoDemo()) return mockRoteiro(historico);

  const transcricao = historico
    .map((m) => `${m.role === 'user' ? 'Pessoa' : 'Entrevistadora'}: ${m.content}`)
    .join('\n');

  const dados = await chamarOpenAI(
    '/chat/completions',
    {
      model: config().chatModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SISTEMA_ROTEIRO },
        { role: 'user', content: transcricao },
      ],
    },
    90_000
  );

  let bruto;
  try {
    bruto = JSON.parse(dados.choices[0].message.content);
  } catch {
    throw new Error('A IA não devolveu o roteiro no formato esperado.');
  }
  return normalizarRoteiro(bruto);
}

// Garante que o roteiro sempre tem a forma certa, mesmo se a IA errar algo.
// Também é usada para validar o roteiro que volta do navegador.
export function normalizarRoteiro(r) {
  const texto = (v, max) => String(v ?? '').trim().slice(0, max);

  const personagens = (Array.isArray(r?.personagens) ? r.personagens : [])
    .slice(0, 8)
    .map((p, i) => ({
      id: texto(p?.id, 20) || `p${i + 1}`,
      nome: texto(p?.nome, 60) || `Pessoa ${i + 1}`,
      descricao_visual: texto(p?.descricao_visual, 400),
    }));

  const cenarios = (Array.isArray(r?.cenarios) ? r.cenarios : [])
    .slice(0, 5)
    .map((c, i) => ({
      id: texto(c?.id, 20) || `c${i + 1}`,
      nome: texto(c?.nome, 60) || `Lugar ${i + 1}`,
      descricao_visual: texto(c?.descricao_visual, 400),
    }));

  const idsPersonagens = new Set(personagens.map((p) => p.id));
  const paginas = (Array.isArray(r?.paginas) ? r.paginas : [])
    .slice(0, 3) // nunca mais que 3 páginas
    .map((p) => ({
      texto: texto(p?.texto, 2000),
      cena: texto(p?.cena, 600) || 'a peaceful, happy scene',
      personagens: (Array.isArray(p?.personagens) ? p.personagens : [])
        .map(String)
        .filter((id) => idsPersonagens.has(id)),
      cenario: texto(p?.cenario, 20),
    }))
    .filter((p) => p.texto);

  if (!paginas.length) throw new Error('O roteiro veio sem páginas.');

  const tamanhos = { 1: 'pequena', 2: 'media', 3: 'grande' };
  return {
    titulo: texto(r?.titulo, 80) || 'Minha Memória',
    tamanho: tamanhos[paginas.length], // o tamanho segue o número real de páginas
    personagens,
    cenarios,
    paginas,
  };
}

// ============================================================
// 3) ILUSTRAÇÃO DE UMA PÁGINA
//    Página 1: gera do zero.
//    Páginas 2 e 3: usam a imagem anterior como referência (/images/edits).
//    Se a referência falhar, gera do zero — o livro nunca para por isso.
// ============================================================
export async function criarIlustracao(roteiro, indice, imagemAnterior) {
  if (modoDemo()) return mockIlustracao(indice);

  const { imageModel } = config();
  const aceitaReferencia = !imageModel.startsWith('dall-e');

  if (imagemAnterior && aceitaReferencia) {
    try {
      return await editarComReferencia(promptIlustracao(roteiro, indice, true), imagemAnterior);
    } catch (erro) {
      console.warn('[ilustração] Referência falhou, gerando do zero:', erro.message);
    }
  }
  return gerarDoZero(promptIlustracao(roteiro, indice, false));
}

async function gerarDoZero(prompt) {
  const { imageModel, imageQuality } = config();
  const corpo = { model: imageModel, prompt, n: 1, size: '1024x1024' };

  // Cada família de modelo aceita parâmetros um pouco diferentes.
  if (imageModel.startsWith('dall-e')) corpo.response_format = 'b64_json';
  else corpo.quality = imageQuality;

  const dados = await chamarOpenAI('/images/generations', corpo, 180_000);
  return extrairImagem(dados);
}

async function editarComReferencia(prompt, referenciaDataUrl) {
  const { imageModel, imageQuality } = config();
  const base64 = String(referenciaDataUrl).split(',')[1];
  if (!base64) throw new Error('Imagem de referência inválida');

  const form = new FormData();
  form.append('model', imageModel);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('quality', imageQuality);
  form.append('image', new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }), 'pagina-anterior.png');

  const dados = await chamarOpenAI('/images/edits', form, 180_000);
  return extrairImagem(dados);
}

async function extrairImagem(dados) {
  const item = dados.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;

  // Alguns modelos devolvem URL: baixamos aqui para o navegador não ter problema de CORS.
  if (item?.url) {
    const r = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
  throw new Error('Resposta de imagem vazia.');
}
