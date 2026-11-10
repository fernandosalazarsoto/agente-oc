import { beforeEach, describe, expect, it } from 'vitest';
import { SapMock } from '@/src/adapters/sap/mock';
import { type HandlersOC, crearHandlersOC } from '@/src/tools/oc';

let sap: SapMock;
let h: HandlersOC;

beforeEach(() => {
  sap = new SapMock(() => '2026-01-15T00:00:00.000Z');
  h = crearHandlersOC({ dataset: 'ejemplo', sap });
});

describe('Herramientas OC', () => {
  it('validar_caso: caso positivo es APTA y trae propuesta', async () => {
    const r = await h.validarCaso({ casoId: 'ej-001' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision).toBe('APTA');
    expect(r.propuesta?.montoCentavos).toBe(119_000_000);
  });

  it('validar_caso: proveedor bloqueado se RECHAZA sin propuesta', async () => {
    const r = await h.validarCaso({ casoId: 'ej-002' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision).toBe('RECHAZADA');
    expect(r.bloqueantes).toContain('EJ-01');
    expect(r.propuesta).toBeUndefined();
  });

  it('crear_orden_compra: crea la OC para un caso APTA', async () => {
    const r = await h.crearOrdenCompra({ casoId: 'ej-001' });
    expect(r).toMatchObject({ ok: true, oc: { creada: true, numeroOC: expect.stringMatching(/^45\d{8}$/) } });
    expect(sap.totalOrdenes).toBe(1);
  });

  it('crear_orden_compra: es idempotente, el mismo caso no duplica la OC', async () => {
    const r1 = await h.crearOrdenCompra({ casoId: 'ej-001' });
    const r2 = await h.crearOrdenCompra({ casoId: 'ej-001' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok || !('oc' in r1) || !('oc' in r2)) return;
    expect(r2.oc.numeroOC).toBe(r1.oc.numeroOC);
    expect(r2.oc.creada).toBe(false);
    expect(sap.totalOrdenes).toBe(1);
  });

  it('crear_orden_compra: revalida en servidor y se niega con un caso RECHAZADO', async () => {
    const r = await h.crearOrdenCompra({ casoId: 'ej-002' });
    expect(r).toMatchObject({ ok: false, decision: 'RECHAZADA' });
    expect(sap.totalOrdenes).toBe(0);
  });

  it('errores de datos se devuelven estructurados, sin excepciones al modelo', async () => {
    expect(await h.validarCaso({ casoId: 'no-existe' })).toMatchObject({ ok: false, error: 'CASO_NO_ENCONTRADO' });
    expect(await h.validarCaso({ casoId: '../x' })).toMatchObject({ ok: false });
  });

  it('el número de OC es determinista por caso', () => {
    expect(SapMock.numeroPara('caso:ej-001')).toBe(SapMock.numeroPara('caso:ej-001'));
    expect(SapMock.numeroPara('caso:ej-001')).not.toBe(SapMock.numeroPara('caso:ej-002'));
  });
});
