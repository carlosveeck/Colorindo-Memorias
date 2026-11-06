// ============================================================
//  Colorindo Memórias — servidor local
//  Sem dependências externas: basta Node 18+ e "npm start".
//  A chave da OpenAI fica SOMENTE aqui no servidor, nunca no navegador.
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/env.js';
import { responderConversa, criarRoteiro, criarIlustracao, normalizarRoteiro, modoDemo } from './src/ai.js';
import { SAUDACAO } from './src/prompts.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(RAIZ, '.env'));

const PASTA_PUBLICA = path.join(RAIZ, 'public');
const PORTA = Number(process.env.PORT) || 3000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function responderJSON(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados));
}

// Limite maior porque a ilustração anterior viaja junto (imagem em base64)
async function lerCorpo(req, limite = 20_000_000) {
  let corpo = '';
  for await (const pedaco of req) {
    corpo += pedaco;
    if (corpo.length > limite) throw new Error('Corpo muito grande');
  }
  return corpo ? JSON.parse(corpo) : {};
}

async function servirArquivo(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const relativo = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
  const caminho = path.normalize(path.join(PASTA_PUBLICA, relativo));

  // Bloqueia tentativas de sair da pasta pública (../)
  if (!caminho.startsWith(PASTA_PUBLICA)) return responderJSON(res, 403, { erro: 'Proibido' });

  try {
    const conteudo = await readFile(caminho);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(caminho)] || 'application/octet-stream' });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

const servidor = http.createServer(async (req, res) => {
  try {
    // Saudação inicial e se está em modo demo
    if (req.method === 'GET' && req.url === '/api/config') {
      return responderJSON(res, 200, { saudacao: SAUDACAO, modoDemo: modoDemo() });
    }

    // Tela 2: próxima fala da IA → { resposta, pronto }
    if (req.method === 'POST' && req.url === '/api/conversa') {
      const { mensagens } = await lerCorpo(req);
      return responderJSON(res, 200, await responderConversa(mensagens));
    }

    // Tela 3, passo 1: roteiro completo (título, personagens, cenários, páginas)
    if (req.method === 'POST' && req.url === '/api/roteiro') {
      const { mensagens } = await lerCorpo(req);
      const roteiro = await criarRoteiro(mensagens);
      console.log(`[roteiro] "${roteiro.titulo}" — ${roteiro.tamanho}, ${roteiro.paginas.length} página(s), ${roteiro.personagens.length} personagem(ns)`);
      return responderJSON(res, 200, roteiro);
    }

    // Tela 3, passo 2: ilustração de UMA página (chamado uma vez por página)
    if (req.method === 'POST' && req.url === '/api/ilustracao') {
      const { roteiro, indice, imagemAnterior } = await lerCorpo(req);
      const r = normalizarRoteiro(roteiro);
      const i = Number(indice);
      if (!Number.isInteger(i) || i < 0 || i >= r.paginas.length) {
        return responderJSON(res, 400, { erro: 'Página inválida' });
      }
      const imagem = await criarIlustracao(r, i, imagemAnterior || null);
      console.log(`[ilustração] página ${i + 1} pronta${imagemAnterior ? ' (com referência)' : ''}`);
      return responderJSON(res, 200, { imagem });
    }

    if (req.method === 'GET') return servirArquivo(req, res);
    responderJSON(res, 404, { erro: 'Rota não encontrada' });
  } catch (erro) {
    console.error('[erro]', erro.message);
    responderJSON(res, 500, { erro: 'Algo deu errado. Tente novamente.', detalhe: erro.message });
  }
});

// Ilustrações podem demorar; damos folga ao tempo limite das requisições.
servidor.requestTimeout = 10 * 60 * 1000;

servidor.listen(PORTA, () => {
  console.log('\n  🎨 Colorindo Memórias rodando em: http://localhost:' + PORTA);
  console.log(
    modoDemo()
      ? '  ⚠️  MODO DEMONSTRAÇÃO (sem chave). Coloque OPENAI_API_KEY no arquivo .env para usar a IA.\n'
      : '  ✅ Chave da OpenAI carregada.\n'
  );
});
