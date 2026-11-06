// ============================================================
//  Colorindo Memórias — lógica do navegador
//  Fluxo linear: Início ➔ Conversa ➔ Livro (PDF)
// ============================================================

// Rede de segurança: se a IA nunca sinalizar que terminou,
// o botão "Criar meu livro" aparece mesmo assim depois de N respostas.
const RESPOSTAS_MAXIMAS_SEM_SINAL = 10;

const estado = {
  mensagens: [],   // { role: 'user' | 'assistant', content: string }
  saudacao: 'Olá! Qual lembrança você gostaria de contar?',
  conversaPronta: false,
  roteiro: null,   // { titulo, tamanho, personagens, cenarios, paginas }
  paginas: [],     // [{ texto, imagem (PNG dataURL) | null }]
  ocupado: false,
};

const $ = (id) => document.getElementById(id);

// ---------- Navegação ----------
function irPara(idTela) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.remove('ativa'));
  $(idTela).classList.add('ativa');
  window.scrollTo(0, 0);
}

// ---------- Comunicação com o servidor ----------
async function api(rota, corpo) {
  const resp = await fetch(rota, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.detalhe || dados.erro || 'Falha de comunicação');
  return dados;
}

// ---------- TELA 1 ----------
async function iniciar() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    estado.saudacao = cfg.saudacao || estado.saudacao;
    $('aviso-demo').hidden = !cfg.modoDemo;
  } catch {
    /* sem problema: usa a saudação padrão */
  }

  $('btn-comecar').addEventListener('click', comecarConversa);
  $('form-mensagem').addEventListener('submit', enviarMensagem);
  $('campo-texto').addEventListener('keydown', (e) => {
    // Enter envia; Shift+Enter quebra linha
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('form-mensagem').requestSubmit();
    }
  });
  $('btn-criar').addEventListener('click', criarLivro);
  $('btn-tentar').addEventListener('click', criarLivro);
  $('btn-baixar').addEventListener('click', baixarPDF);
  $('btn-recomecar').addEventListener('click', recomecar);
}

// ---------- TELA 2 ----------
function comecarConversa() {
  estado.mensagens = [{ role: 'assistant', content: estado.saudacao }];
  estado.conversaPronta = false;
  $('mensagens').innerHTML = '';
  mostrarBalao('assistant', estado.saudacao);
  $('area-criar').hidden = true;
  irPara('tela-conversa');
  $('campo-texto').focus();
}

function mostrarBalao(role, texto) {
  const div = document.createElement('div');
  div.className = 'balao ' + (role === 'user' ? 'balao-pessoa' : 'balao-ia');
  div.textContent = texto; // textContent evita injeção de HTML
  $('mensagens').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function definirOcupado(ocupado) {
  estado.ocupado = ocupado;
  $('pensando').hidden = !ocupado;
  $('btn-enviar').disabled = ocupado;
  $('btn-criar').disabled = ocupado;
}

async function enviarMensagem(evento) {
  evento.preventDefault();
  const campo = $('campo-texto');
  const texto = campo.value.trim();
  if (!texto || estado.ocupado) return;

  campo.value = '';
  estado.mensagens.push({ role: 'user', content: texto });
  mostrarBalao('user', texto);
  definirOcupado(true);

  try {
    const { resposta, pronto } = await api('/api/conversa', { mensagens: estado.mensagens });
    estado.mensagens.push({ role: 'assistant', content: resposta });
    mostrarBalao('assistant', resposta);
    if (pronto) estado.conversaPronta = true;
  } catch (erro) {
    console.error(erro);
    mostrarBalao('assistant', 'Desculpe, não consegui ouvir direito. Pode escrever de novo?');
    // Remove a última fala para a pessoa poder reenviar sem duplicar
    estado.mensagens.pop();
    campo.value = texto;
  } finally {
    definirOcupado(false);
    atualizarBotaoCriar();
    campo.focus();
  }
}

// O botão aparece quando a IA diz que já tem a história completa
function atualizarBotaoCriar() {
  const respostas = estado.mensagens.filter((m) => m.role === 'user').length;
  const mostrar = estado.conversaPronta || respostas >= RESPOSTAS_MAXIMAS_SEM_SINAL;
  const estavaEscondido = $('area-criar').hidden;
  $('area-criar').hidden = !mostrar;
  if (mostrar && estavaEscondido) $('area-criar').scrollIntoView({ behavior: 'smooth' });
}

// ---------- TELA 3 ----------
function progresso(texto, fracao) {
  $('progresso-titulo').textContent = texto;
  const barra = $('barra');
  if (fracao === null) {
    barra.classList.add('indeterminada');
    barra.style.width = '';
  } else {
    barra.classList.remove('indeterminada');
    barra.style.width = `${Math.max(8, fracao * 100)}%`;
  }
}

async function criarLivro() {
  irPara('tela-livro');
  $('livro-carregando').hidden = false;
  $('livro-erro').hidden = true;
  $('livro-pronto').hidden = true;

  // Passo 1: roteiro (personagens, cenários e texto de cada página)
  progresso('Organizando sua história…', null);
  try {
    estado.roteiro = await api('/api/roteiro', { mensagens: estado.mensagens });
  } catch (erro) {
    console.error(erro);
    $('livro-carregando').hidden = true;
    $('livro-erro').hidden = false;
    return;
  }

  // Passo 2: uma ilustração por página, em sequência.
  // A imagem anterior vai junto para manter os personagens parecidos.
  const total = estado.roteiro.paginas.length;
  estado.paginas = [];
  let ultimaImagem = null;

  for (let i = 0; i < total; i++) {
    progresso(total > 1 ? `Desenhando a página ${i + 1} de ${total}…` : 'Desenhando sua memória…', i / total);
    let imagem = null;
    try {
      const resp = await api('/api/ilustracao', {
        roteiro: estado.roteiro,
        indice: i,
        imagemAnterior: ultimaImagem,
      });
      imagem = await paraPNG(resp.imagem);
      ultimaImagem = imagem;
    } catch (erro) {
      // Uma página sem desenho não impede o livro de ficar pronto
      console.error(`Página ${i + 1}:`, erro);
    }
    estado.paginas.push({ texto: estado.roteiro.paginas[i].texto, imagem });
  }

  progresso('Pronto!', 1);
  mostrarLivro();
}

function mostrarLivro() {
  $('livro-titulo').textContent = estado.roteiro.titulo;
  const container = $('livro-paginas');
  container.innerHTML = '';
  const total = estado.paginas.length;

  estado.paginas.forEach((pagina, i) => {
    const folha = document.createElement('section');
    folha.className = 'folha';

    if (total > 1) {
      const numero = document.createElement('p');
      numero.className = 'folha-numero';
      numero.textContent = `Página ${i + 1} de ${total}`;
      folha.appendChild(numero);
    }

    const grade = document.createElement('div');
    grade.className = 'paginas';

    const figura = document.createElement('figure');
    figura.className = 'pagina pagina-imagem';
    if (pagina.imagem) {
      const img = document.createElement('img');
      img.src = pagina.imagem;
      img.alt = `Desenho para colorir da página ${i + 1}`;
      figura.appendChild(img);
    } else {
      const aviso = document.createElement('figcaption');
      aviso.textContent = 'Não conseguimos desenhar esta página desta vez.';
      figura.appendChild(aviso);
    }

    const artigo = document.createElement('article');
    artigo.className = 'pagina pagina-texto';
    const p = document.createElement('p');
    p.textContent = pagina.texto;
    artigo.appendChild(p);

    grade.append(figura, artigo);
    folha.appendChild(grade);
    container.appendChild(folha);
  });

  $('livro-carregando').hidden = true;
  $('livro-pronto').hidden = false;
}

function paraPNG(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1024;
      canvas.height = img.naturalHeight || 1024;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = src;
  });
}

// ---------- PDF ----------
// As fontes padrão do PDF só aceitam caracteres "latinos" (acentos OK, emojis não).
function textoSeguroPDF(texto) {
  return String(texto)
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '');
}

// Para cada página da história: uma folha com o desenho + uma folha com o texto
function baixarPDF() {
  if (!window.jspdf) {
    alert('Não foi possível carregar o gerador de PDF. Verifique a internet e recarregue a página.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); // 210 x 297 mm
  const L = 210, A = 297, margem = 20;
  const titulo = textoSeguroPDF(estado.roteiro.titulo);
  const total = estado.paginas.length;

  estado.paginas.forEach((pagina, i) => {
    if (i > 0) pdf.addPage();
    const cabecalho = i === 0 ? titulo : `${titulo} (${i + 1}/${total})`;

    // Folha do desenho
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(i === 0 ? 24 : 18);
    pdf.text(cabecalho, L / 2, 30, { align: 'center' });
    if (pagina.imagem) {
      const lado = L - margem * 2; // 170 mm
      pdf.addImage(pagina.imagem, 'PNG', margem, 50, lado, lado);
    }
    rodape(pdf, L, A);

    // Folha do texto
    pdf.addPage();
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(16);
    const linhas = pdf.splitTextToSize(textoSeguroPDF(pagina.texto), L - margem * 2);
    let y = 40;
    for (const linha of linhas) {
      if (y > A - 30) { // texto longo: continua na folha seguinte
        rodape(pdf, L, A);
        pdf.addPage();
        y = 30;
      }
      pdf.text(linha, margem, y);
      y += 9;
    }
    rodape(pdf, L, A);
  });

  const nome = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'minha-memoria';
  pdf.save(`${nome}.pdf`);
}

function rodape(pdf, L, A) {
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(11);
  pdf.setTextColor(120);
  pdf.text('Colorindo Memórias', L / 2, A - 12, { align: 'center' });
  pdf.setTextColor(0);
}

function recomecar() {
  estado.mensagens = [];
  estado.roteiro = null;
  estado.paginas = [];
  estado.conversaPronta = false;
  irPara('tela-inicio');
}

iniciar();
