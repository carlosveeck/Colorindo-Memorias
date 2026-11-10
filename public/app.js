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
  vozDisponivel: false,
  frasePronto: 'criar meu livro',
  modo: 'texto',   // 'voz' | 'texto'
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
    estado.vozDisponivel = Boolean(cfg.vozDisponivel);
    estado.frasePronto = cfg.frasePronto || estado.frasePronto;
    $('aviso-demo').hidden = !cfg.modoDemo;
  } catch {
    /* sem problema: usa a saudação padrão */
  }

  $('btn-comecar').addEventListener('click', comecarConversa);
  $('btn-instrucoes').addEventListener('click', () => irPara('tela-instrucoes'));
  $('btn-comecar-instrucoes').addEventListener('click', comecarConversa);
  $('btn-voltar-instrucoes').addEventListener('click', () => irPara('tela-inicio'));
  $('form-mensagem').addEventListener('submit', enviarMensagem);
  $('campo-texto').addEventListener('keydown', (e) => {
    // Enter envia; Shift+Enter quebra linha
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('form-mensagem').requestSubmit();
    }
  });
  $('btn-criar').addEventListener('click', async () => {
    await encerrarVoz(); // fecha o microfone antes de gerar o livro
    criarLivro();
  });
  $('btn-tentar').addEventListener('click', criarLivro);
  $('btn-baixar').addEventListener('click', baixarPDF);
  $('btn-recomecar').addEventListener('click', recomecar);
}

// ---------- TELA 2 ----------
function comecarConversa() {
  estado.mensagens = [];
  estado.conversaPronta = false;
  $('mensagens').innerHTML = '';
  $('area-criar').hidden = true;
  irPara('tela-conversa');

  if (estado.vozDisponivel) iniciarVoz();
  else ativarModoTexto();
}

// Modo texto: usado no modo demo ou como plano B quando a voz falha
function ativarModoTexto(motivo) {
  estado.modo = 'texto';
  $('painel-voz').hidden = true;
  $('form-mensagem').hidden = false;
  if (motivo) mostrarBalao('assistant', motivo);
  if (!estado.mensagens.length) {
    estado.mensagens.push({ role: 'assistant', content: estado.saudacao });
    mostrarBalao('assistant', estado.saudacao);
  }
  $('campo-texto').focus();
}

function mostrarBalao(role, texto) {
  const div = document.createElement('div');
  div.className = 'balao ' + (role === 'user' ? 'balao-pessoa' : 'balao-ia');
  div.textContent = texto; // textContent evita injeção de HTML
  $('mensagens').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

// ============================================================
//  VOZ (GPT-Live via WebRTC)
//  Áudio vai e volta direto entre navegador e OpenAI.
//  As transcrições chegam em pedaços (deltas) e viram falas
//  no mesmo histórico usado pelo modo texto.
// ============================================================
const voz = {
  pc: null,          // RTCPeerConnection
  canal: null,       // data channel "oai-events"
  microfone: null,   // MediaStream
  audio: null,       // <audio> que toca a voz da IA
  falaAtual: null,   // { role, texto, balao } — fala sendo transcrita agora
  timerStatus: null,
  ativa: false,
  // Introdução: microfone bloqueado até a IA terminar a apresentação
  microfoneLiberado: false,
  introComecou: false,     // já ouvimos a IA falar?
  ultimoSomIA: 0,          // quando ouvimos a IA pela última vez (ms)
  contextoAudio: null,     // AudioContext para medir o volume da IA
  timerIntro: null,        // garantia: libera o microfone de qualquer jeito
  timerIntroTexto: null,   // plano B: libera pouco depois da última palavra da IA
  timerVolume: null,
};

// Ajustes da liberação do microfone
const SILENCIO_FIM_INTRO_MS = 1000;   // silêncio da IA que indica fim da apresentação
const LIMITE_INTRO_MS = 20_000;        // nunca deixa a pessoa presa mais que isso
const VOLUME_MINIMO = 0.02;            // abaixo disso consideramos silêncio

const STATUS_VOZ = {
  conectando: 'Conectando…',
  bloqueado: 'Escute a assistente… 🔇',
  ouvindo: 'Pode falar, estou ouvindo 😊',
  'pessoa-falando': 'Estou ouvindo você…',
  'ia-falando': 'Falando…',
  encerrado: 'Conversa encerrada',
};

function statusVoz(estadoVoz) {
  $('voz-circulo').className = `voz-circulo ${estadoVoz}`;
  $('voz-status').textContent = STATUS_VOZ[estadoVoz];
}

// Depois de um tempo sem novas transcrições, volta para "ouvindo"
function statusTemporario(estadoVoz) {
  statusVoz(estadoVoz);
  clearTimeout(voz.timerStatus);
  voz.timerStatus = setTimeout(() => {
    if (voz.ativa) statusVoz(voz.microfoneLiberado ? 'ouvindo' : 'bloqueado');
  }, 1500);
}

// ---------- Introdução com microfone bloqueado ----------
// Mede o volume da voz da IA. Quando ela fala e depois fica em silêncio
// por SILENCIO_FIM_INTRO_MS, a apresentação acabou: liberamos o microfone.
function monitorarFimDaIntro(streamIA) {
  try {
    voz.contextoAudio = new AudioContext();
    voz.contextoAudio.resume().catch(() => {});
    const fonte = voz.contextoAudio.createMediaStreamSource(streamIA);
    const analisador = voz.contextoAudio.createAnalyser();
    analisador.fftSize = 512;
    fonte.connect(analisador); // não conecta à saída: o <audio> já toca o som
    const amostras = new Float32Array(analisador.fftSize);

    voz.timerVolume = setInterval(() => {
      analisador.getFloatTimeDomainData(amostras);
      const volume = Math.sqrt(amostras.reduce((s, x) => s + x * x, 0) / amostras.length);
      const agora = Date.now();

      if (volume > VOLUME_MINIMO) {
        voz.introComecou = true;
        voz.ultimoSomIA = agora;
      } else if (voz.introComecou && agora - voz.ultimoSomIA > SILENCIO_FIM_INTRO_MS) {
        liberarMicrofone();
      }
    }, 100);
  } catch (erro) {
    // Sem medição de volume: usa as transcrições da IA como plano B (ver tratarEventoVoz)
    console.warn('Medição de volume indisponível:', erro);
  }
}

function liberarMicrofone() {
  if (voz.microfoneLiberado) return;
  voz.microfoneLiberado = true;
  clearInterval(voz.timerVolume);
  clearTimeout(voz.timerIntro);
  clearTimeout(voz.timerIntroTexto);
  voz.microfone?.getAudioTracks().forEach((t) => { t.enabled = true; });
  statusVoz('ouvindo');
  tocarPlim();
}

// Som curto e suave avisando que o microfone ligou
function tocarPlim() {
  try {
    const ctx = voz.contextoAudio || new AudioContext();
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    ganho.gain.setValueAtTime(0.0001, ctx.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(ganho).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch { /* som é só um extra */ }
}

async function iniciarVoz() {
  estado.modo = 'voz';
  $('form-mensagem').hidden = true;
  $('painel-voz').hidden = false;
  statusVoz('conectando');

  try {
    // 1. Microfone (com cancelamento de eco, para a IA não ouvir a si mesma)
    voz.microfone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // Começa BLOQUEADO: a IA só recebe silêncio até terminar a apresentação
    voz.microfone.getAudioTracks().forEach((t) => { t.enabled = false; });
    Object.assign(voz, { microfoneLiberado: false, introComecou: false, ultimoSomIA: 0 });
  } catch (erro) {
    console.error(erro);
    return ativarModoTexto(
      'Não consegui usar o microfone. Sem problema: você pode escrever sua história aqui embaixo.'
    );
  }

  try {
    // 2. Conexão WebRTC
    voz.pc = new RTCPeerConnection();
    voz.audio = new Audio();
    voz.audio.autoplay = true;
    voz.pc.ontrack = (e) => {
      voz.audio.srcObject = e.streams[0];
      monitorarFimDaIntro(e.streams[0]);
    };
    voz.microfone.getTracks().forEach((t) => voz.pc.addTrack(t, voz.microfone));

    // O canal de eventos precisa ser criado ANTES da oferta, com este nome
    voz.canal = voz.pc.createDataChannel('oai-events');
    voz.canal.addEventListener('message', (e) => tratarEventoVoz(JSON.parse(e.data)));

    voz.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(voz.pc?.connectionState) && voz.ativa) {
        encerrarVoz().then(() =>
          ativarModoTexto('A ligação caiu. Você pode continuar escrevendo aqui embaixo.')
        );
      }
    };

    // 3. Oferta → nosso servidor → OpenAI → resposta
    await voz.pc.setLocalDescription(await voz.pc.createOffer());
    await esperarICE(voz.pc);
    const resposta = await api('/api/voz/sessao', { sdp: voz.pc.localDescription.sdp });
    await voz.pc.setRemoteDescription({ type: 'answer', sdp: resposta.sdp });
  } catch (erro) {
    console.error('Falha na voz:', erro);
    await encerrarVoz();
    ativarModoTexto('Não consegui ligar a conversa por voz agora. Você pode escrever sua história aqui embaixo.');
  }
}

// Espera o navegador terminar de reunir os caminhos de rede (com limite de tempo)
function esperarICE(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const fim = () => { pc.removeEventListener('icegatheringstatechange', checar); resolve(); };
    const checar = () => pc.iceGatheringState === 'complete' && fim();
    pc.addEventListener('icegatheringstatechange', checar);
    setTimeout(fim, 5000);
  });
}

function tratarEventoVoz(evento) {
  switch (evento.type) {
    case 'session.started':
      voz.ativa = true;
      statusVoz('bloqueado');
      // Garantia: se a IA não falar ou a medição falhar, libera mesmo assim
      voz.timerIntro = setTimeout(liberarMicrofone, LIMITE_INTRO_MS);
      break;

    case 'session.input_transcript.delta':   // fala da pessoa
      adicionarTrecho('user', evento.delta);
      statusTemporario('pessoa-falando');
      break;

    case 'session.output_transcript.delta':  // fala da IA
      adicionarTrecho('assistant', evento.delta);
      statusTemporario('ia-falando');
      // Plano B: se a medição de volume não funcionar neste navegador,
      // libera 4s depois da última palavra transcrita da apresentação.
      if (!voz.microfoneLiberado) {
        clearTimeout(voz.timerIntroTexto);
        voz.timerIntroTexto = setTimeout(liberarMicrofone, 4000);
      }
      break;

    case 'session.closed':
      voz.ativa = false;
      break;

    case 'error':
      console.error('Erro na sessão de voz:', evento);
      break;
  }
}

// Junta os pedaços de transcrição em falas. Quando muda quem está falando,
// a fala anterior é fechada e guardada no histórico.
function adicionarTrecho(role, trecho) {
  if (!trecho) return;
  if (!voz.falaAtual || voz.falaAtual.role !== role) {
    fecharFalaAtual();
    voz.falaAtual = { role, texto: '', balao: mostrarBalao(role, '') };
  }
  voz.falaAtual.texto += trecho; // os pedaços já trazem os espaços certos
  voz.falaAtual.balao.textContent = voz.falaAtual.texto;
  voz.falaAtual.balao.scrollIntoView({ block: 'end' });
}

function fecharFalaAtual() {
  const fala = voz.falaAtual;
  voz.falaAtual = null;
  if (!fala) return;

  const texto = fala.texto.trim();
  if (!texto) { fala.balao.remove(); return; }
  estado.mensagens.push({ role: fala.role, content: texto });

  // A IA avisa que a história está completa dizendo "Criar meu livro"
  if (fala.role === 'assistant' && semAcentos(texto).includes(semAcentos(estado.frasePronto))) {
    estado.conversaPronta = true;
  }
  atualizarBotaoCriar();
}

const semAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Encerra a ligação com educação (session.close) e libera o microfone
async function encerrarVoz() {
  fecharFalaAtual();
  clearTimeout(voz.timerStatus);
  clearTimeout(voz.timerIntro);
  clearTimeout(voz.timerIntroTexto);
  clearInterval(voz.timerVolume);
  voz.contextoAudio?.close().catch(() => {});
  voz.contextoAudio = null;

  if (voz.canal?.readyState === 'open' && voz.ativa) {
    voz.canal.send(JSON.stringify({ type: 'session.close' }));
    // espera a confirmação por até 3 segundos
    await new Promise((resolve) => {
      const inicio = Date.now();
      const checar = () => (!voz.ativa || Date.now() - inicio > 3000 ? resolve() : setTimeout(checar, 100));
      checar();
    });
  }

  voz.ativa = false;
  voz.microfone?.getTracks().forEach((t) => t.stop());
  voz.pc?.close();
  if (voz.audio) voz.audio.srcObject = null;
  Object.assign(voz, { pc: null, canal: null, microfone: null, audio: null });
  if (estado.modo === 'voz') statusVoz('encerrado');
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

async function recomecar() {
  await encerrarVoz();
  estado.mensagens = [];
  estado.roteiro = null;
  estado.paginas = [];
  estado.conversaPronta = false;
  irPara('tela-inicio');
}

iniciar();
