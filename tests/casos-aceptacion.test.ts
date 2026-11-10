import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SapMock } from '@/src/adapters/sap/mock';
import { listarCasos } from '@/src/data/repositorio';
import { crearHandlersOC } from '@/src/tools/oc';

/**
 * Pruebas de aceptación guiadas por la especificación (SDD).
 * El resultado esperado de cada caso se define en specs/esperados/<set>.json a
 * partir del PRD, ANTES de implementar los controles. Este test es el contrato.
 */
const DATASET = process.env.DATASET || 'ejemplo';
const SET = DATASET;

interface Esperado {
  decision: 'APTA' | 'REQUIERE_REVISION' | 'RECHAZADA';
  bloqueantes: string[];
  advertencias: string[];
  creaOC: boolean;
}

const esperados = JSON.parse(readFileSync(path.join('specs', 'esperados', `${SET}.json`), 'utf8')) as Record<string, Esperado>;

describe(`Aceptación: set "${SET}"`, () => {
  it('todos los casos del set tienen resultado esperado definido (y viceversa)', async () => {
    expect((await listarCasos(DATASET)).sort()).toEqual(Object.keys(esperados).sort());
  });

  for (const [casoId, esperado] of Object.entries(esperados)) {
    it(`${casoId} → ${esperado.decision}`, async () => {
      // SAP y handlers nuevos por caso: sin estado compartido entre casos.
      const sap = new SapMock(() => '2026-01-15T00:00:00.000Z');
      const h = crearHandlersOC({ dataset: DATASET, sap });

      const v = await h.validarCaso({ casoId });
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.decision).toBe(esperado.decision);
      expect([...v.bloqueantes].sort()).toEqual([...esperado.bloqueantes].sort());
      expect([...v.advertencias].sort()).toEqual([...esperado.advertencias].sort());

      const oc = await h.crearOrdenCompra({ casoId });
      expect(oc.ok).toBe(esperado.creaOC);
      expect(sap.totalOrdenes).toBe(esperado.creaOC ? 1 : 0);
    });
  }
});
