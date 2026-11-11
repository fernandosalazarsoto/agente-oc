import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento del proceso
 * (src/knowledge/ordenes-compra.md). Un cambio de reglas de negocio no toca el servidor.
 */
export function cargarPrompt(raiz: string = process.cwd()): string {
  const comportamiento = readFileSync(path.join(raiz, 'agent', 'prompt.md'), 'utf8');
  const conocimiento = readFileSync(path.join(raiz, 'src', 'knowledge', 'ordenes-compra.md'), 'utf8');
  return `${comportamiento.trim()}\n\n# Conocimiento del proceso\n\n${conocimiento.trim()}\n`;
}
