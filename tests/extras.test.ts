import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as app from '@/src/tools/oc';
import * as modulo from '@/modulo/tools/oc';
import { json, leerSalida, proyectoTemporal } from './ayudas';

const raiz = path.resolve(__dirname, '..');
const leer = (...p: string[]) => readFileSync(path.join(raiz, ...p), 'utf8');

/** Separa frontmatter YAML y cuerpo de un archivo Markdown. */
function partes(md: string): { frontmatter: string; cuerpo: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('Sin frontmatter');
  return { frontmatter: m[1]!, cuerpo: m[2]! };
}

describe('HU-4 P1 · Evidencia en PDF', () => {
  it('genera out/<caso>/aprobacion.pdf junto al .txt y devuelve ruta_pdf', async () => {
    const ctx = proyectoTemporal();
    const r = json(await app.generar_evidencia.execute({ caso: 'sol-001' }, ctx));
    expect(r.ok).toBe(true);
    expect((r.data as { ruta_pdf: string }).ruta_pdf).toBe('out/sol-001/aprobacion.pdf');
    const pdf = leerSalida(ctx, 'sol-001', 'aprobacion.pdf');
    expect(pdf.startsWith('%PDF-')).toBe(true);
  });

  it('el PDF es reproducible para el mismo caso', async () => {
    const a = proyectoTemporal();
    const b = proyectoTemporal();
    await app.generar_evidencia.execute({ caso: 'sol-004' }, a);
    await app.generar_evidencia.execute({ caso: 'sol-004' }, b);
    expect(leerSalida(a, 'sol-004', 'aprobacion.pdf')).toBe(leerSalida(b, 'sol-004', 'aprobacion.pdf'));
  });
});

describe('PRD §9.4 · Módulo reutilizable sin copias divergentes', () => {
  it('agent.md: frontmatter requerido y cuerpo idéntico a agent/prompt.md', () => {
    const { frontmatter, cuerpo } = partes(leer('modulo', 'agent.md'));
    expect(frontmatter).toMatch(/^description: .+/m);
    expect(frontmatter).toMatch(/^mode: primary$/m);
    expect(frontmatter).toMatch(/^permission:\n\s+edit: deny\n\s+bash: deny$/m);
    expect(cuerpo.trim()).toBe(leer('agent', 'prompt.md').trim());
  });

  it('SKILL.md: frontmatter requerido y cuerpo idéntico a src/knowledge/ordenes-compra.md', () => {
    const { frontmatter, cuerpo } = partes(leer('modulo', 'skill', 'ordenes-compra', 'SKILL.md'));
    expect(frontmatter).toMatch(/^name: ordenes-compra$/m);
    expect(frontmatter).toMatch(/^description: .+/m);
    expect(cuerpo.trim()).toBe(leer('src', 'knowledge', 'ordenes-compra.md').trim());
  });

  it('tools/oc.ts exporta exactamente las mismas herramientas que la aplicación', () => {
    for (const nombre of ['leer_paquete', 'validar', 'construir_payload', 'generar_evidencia', 'crear'] as const) {
      expect(modulo[nombre]).toBe(app[nombre]);
    }
  });
});
