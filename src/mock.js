// ============================================================
//  Modo demonstração: usado quando OPENAI_API_KEY está vazia.
//  Permite testar telas, etapas e PDF sem gastar créditos.
// ============================================================

// Uma pergunta por etapa da conversa guiada
const PERGUNTAS = [
  'Que lembrança bonita! Isso foi em que época da sua vida? Você lembra mais ou menos o ano?',  // contexto
  'Imagino! E o que aconteceu nesse dia? Pode me contar do começo.',                            // acontecimento
  'Que especial! E depois, o que aconteceu?',                                                   // acontecimento
  'Quem estava com você nesse momento?',                                                        // personagens
  'E como essas pessoas eram naquela época? E você, como era?',                                 // personagens
  'Como era o lugar? O que você via ao seu redor?',                                             // cenário
  'E o que você sentiu naquele momento?',                                                       // sentimentos
];
const FINAL =
  'Muito obrigada por dividir essa lembrança comigo! Sua história já está pronta para virar livro. ' +
  'Quando quiser, toque no botão "Criar meu livro".';

export async function mockResposta(historico) {
  await esperar(600);
  const n = historico.filter((m) => m.role === 'user').length;
  if (n > PERGUNTAS.length) return { resposta: FINAL, pronto: true };
  return { resposta: PERGUNTAS[n - 1] || PERGUNTAS[0], pronto: false };
}

export async function mockRoteiro(historico) {
  await esperar(1200);
  const falas = historico.filter((m) => m.role === 'user').map((m) => m.content.trim());
  const metade = Math.ceil(falas.length / 2);

  return {
    titulo: 'Minha Memória Especial',
    tamanho: 'media',
    personagens: [
      { id: 'p1', nome: 'Eu', descricao_visual: 'demo character' },
      { id: 'p2', nome: 'Minha família', descricao_visual: 'demo character' },
    ],
    cenarios: [{ id: 'c1', nome: 'Casa', descricao_visual: 'demo setting' }],
    paginas: [
      {
        texto: '(Página de demonstração 1)\n\n' + falas.slice(0, metade).join(' '),
        cena: 'demo', personagens: ['p1'], cenario: 'c1',
      },
      {
        texto: '(Página de demonstração 2)\n\n' + falas.slice(metade).join(' ') +
          '\n\nGuardo essa lembrança com muito carinho no coração.',
        cena: 'demo', personagens: ['p1', 'p2'], cenario: 'c1',
      },
    ],
  };
}

export async function mockIlustracao(indice) {
  await esperar(1500);
  const svg = DESENHOS[indice % DESENHOS.length];
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const abre = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#fff"/><g fill="none" stroke="#000" stroke-width="10" stroke-linejoin="round" stroke-linecap="round">';
const fecha = '</g></svg>';

// Desenhos simples em contorno para o modo demo
const DESENHOS = [
  // Casa, árvore e sol
  abre + `
  <circle cx="820" cy="200" r="90"/>
  <path d="M820 70v-40M820 370v-40M690 200h-40M990 200h-40"/>
  <path d="M60 820 Q300 740 520 800 T980 790"/>
  <rect x="200" y="520" width="340" height="280"/><path d="M170 530 L370 360 L570 530 Z"/>
  <rect x="320" y="640" width="90" height="160"/><rect x="230" y="580" width="70" height="70"/><rect x="440" y="580" width="70" height="70"/>
  <rect x="700" y="600" width="50" height="200"/><circle cx="725" cy="520" r="120"/>` + fecha,
  // Praia com barco e nuvens
  abre + `
  <path d="M100 250 q40 -60 100 -20 q50 -50 100 10 q40 40 -10 60 h-180 q-50 -10 -10 -50z"/>
  <path d="M60 600 Q200 560 340 600 T620 600 T900 600 T1000 600"/>
  <path d="M60 680 Q200 640 340 680 T620 680 T900 680"/>
  <path d="M520 520 h260 l-40 70 h-180 z"/><path d="M650 520 v-260 l110 230 z"/>
  <path d="M40 900 Q500 800 990 900"/><circle cx="200" cy="860" r="28"/><path d="M780 870 l30 -60 l30 60 z"/>` + fecha,
  // Mesa com bolo e balões
  abre + `
  <rect x="220" y="620" width="580" height="40"/><path d="M260 660 v200 M760 660 v200"/>
  <rect x="380" y="500" width="260" height="120"/><rect x="420" y="420" width="180" height="80"/>
  <path d="M470 420 v-50 M512 420 v-50 M554 420 v-50"/>
  <ellipse cx="180" cy="250" rx="70" ry="90"/><path d="M180 340 q-20 80 10 160"/>
  <ellipse cx="850" cy="230" rx="70" ry="90"/><path d="M850 320 q20 80 -10 160"/>` + fecha,
];
