/**
 * Genera modulo/ (PRD §9.4) desde las MISMAS fuentes que usa la aplicación:
 * - modulo/agent.md                    ← agent/prompt.md (comportamiento)
 * - modulo/skill/ordenes-compra/SKILL.md ← src/knowledge/ordenes-compra.md (conocimiento)
 * - modulo/tools/oc.ts                 → reexporta src/tools/oc.ts (ejecución, sin copia)
 * Uso: npm run modulo. tests/extras.test.ts falla si alguna pieza diverge.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();
const leer = (...p: string[]) => readFileSync(path.join(raiz, ...p), 'utf8').trim();
const escribir = (contenido: string, ...p: string[]) => {
  mkdirSync(path.dirname(path.join(raiz, ...p)), { recursive: true });
  writeFileSync(path.join(raiz, ...p), contenido, 'utf8');
};

escribir(
  [
    '---',
    'description: Agente de órdenes de compra SAP. Lee el paquete, valida RC1-RC10, construye la OC, genera la evidencia y la crea con confirmación humana.',
    'mode: primary',
    'permission:',
    '  edit: deny',
    '  bash: deny',
    '---',
    leer('agent', 'prompt.md'),
    '',
  ].join('\n'),
  'modulo',
  'agent.md',
);

escribir(
  [
    '---',
    'name: ordenes-compra',
    'description: Conocimiento del proceso de órdenes de compra de Periferia (reglas RC1-RC10, creación de OC, retroactivas y acciones sugeridas). Usar al procesar solicitudes de compra.',
    '---',
    leer('src', 'knowledge', 'ordenes-compra.md'),
    '',
  ].join('\n'),
  'modulo',
  'skill',
  'ordenes-compra',
  'SKILL.md',
);

console.log('modulo/ actualizado desde agent/prompt.md y src/knowledge/ordenes-compra.md');
