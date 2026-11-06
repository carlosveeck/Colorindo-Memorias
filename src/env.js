// Leitor mínimo de arquivo .env (evita depender do pacote "dotenv").
import { readFileSync } from 'node:fs';

export function loadEnv(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.warn('[env] Arquivo .env não encontrado — usando valores padrão.');
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Remove aspas opcionais: KEY="valor"
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);

    // Variáveis já definidas no terminal têm prioridade
    if (!(key in process.env)) process.env[key] = value;
  }
}
