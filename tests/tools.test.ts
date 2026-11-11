import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as oc from '@/src/tools/oc';
import { SapMock } from '@/src/sap/mock';
import { existeSalida, json, leerSalida, proyectoTemporal } from './ayudas';

const CONTRATO = ['leer_paquete', 'validar', 'construir_payload', 'generar_evidencia', 'crear'] as const;
type Data = Record<string, unknown>;

async function payloadDe(ctx: oc.ContextoHerramienta, caso: string): Promise<Data> {
  const r = json(await oc.construir_payload.execute({ caso }, ctx));
  expect(r.ok).toBe(true);
  return (r.data as Data).payload as Data;
}

async function crear(ctx: oc.ContextoHerramienta, caso: string, confirmado?: boolean) {
  const payload = await payloadDe(ctx, caso).catch(() => ({}));
  return json<{ ok: boolean; data?: Data; error?: string; requiere_confirmacion?: boolean }>(
    await oc.crear.execute({ caso, payload, ...(confirmado !== undefined ? { confirmado } : {}) }, ctx),
  );
}

describe('Contrato de herramientas (PRD §6.2)', () => {
  it('cada herramienta tiene description, args zod con .describe() y execute', () => {
    for (const nombre of CONTRATO) {
      const h = oc.herramientasOC[nombre];
      expect(h.description.length).toBeGreaterThan(10);
      for (const [campo, esquema] of Object.entries(h.args)) {
        expect((esquema as z.ZodType).description, `${nombre}.${campo}`).toBeTruthy();
      }
      expect(typeof h.execute).toBe('function');
    }
    expect(Object.keys(oc.herramientasOC)).toEqual(expect.arrayContaining([...CONTRATO]));
  });

  it('expone al modelo los nombres oc_<export>', () => {
    expect(oc.nombreParaModelo('leer_paquete')).toBe('oc_leer_paquete');
  });

  it('nunca lanza: path traversal y argumentos inválidos devuelven { ok: false, error }', async () => {
    const ctx = proyectoTemporal();
    for (const nombre of CONTRATO) {
      const h = oc.herramientasOC[nombre] as { execute: (a: unknown, c: oc.ContextoHerramienta) => Promise<string> };
      const r1 = json(await h.execute({ caso: '../../etc', payload: {} }, ctx));
      expect(r1.ok).toBe(false);
      expect(typeof r1.error).toBe('string');
      const r2 = json(await h.execute({ caso: 5 }, ctx));
      expect(r2.ok).toBe(false);
    }
  });
});

describe('HU-1 y HU-6 · Lectura del paquete y errores', () => {
  it('lee el paquete normalizado (sol-005 con factura)', async () => {
    const r = json(await oc.leer_paquete.execute({ caso: 'sol-005' }, proyectoTemporal()));
    expect(r.ok).toBe(true);
    const d = r.data as Data;
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['correo', 'solicitud', 'cotizacion', 'aprobacion', 'factura']));
    expect((d.factura as Data).numero).toBe('FC-88231');
  });

  it('un adjunto ausente se reporta como null con su nombre, sin excepción', async () => {
    const r = json(await oc.leer_paquete.execute({ caso: 'sol-x-sin-cot' }, proyectoTemporal()));
    expect(r.ok).toBe(true);
    expect((r.data as Data).cotizacion).toBeNull();
    expect((r.data as Data).faltantes).toContain('cotizacion.txt');
  });

  it('sin cotización, la validación pide confirmación RC5', async () => {
    const r = json(await oc.validar.execute({ caso: 'sol-x-sin-cot' }, proyectoTemporal()));
    expect(((r.data as Data).confirmaciones as Data[]).map((c) => c.codigo)).toContain('RC5');
  });

  it('JSON malformado devuelve un error legible que nombra el archivo', async () => {
    const r = json(await oc.leer_paquete.execute({ caso: 'sol-x-json' }, proyectoTemporal()));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('solicitud.json');
  });

  it('monto no numérico devuelve un error legible', async () => {
    const r = json(await oc.validar.execute({ caso: 'sol-x-monto' }, proyectoTemporal()));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/valor_total/);
  });

  it('caso inexistente devuelve error legible', async () => {
    const r = json(await oc.leer_paquete.execute({ caso: 'sol-999' }, proyectoTemporal()));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('sol-999');
  });
});

describe('HU-3 y HU-4 · Payload, trazabilidad y evidencia en out/', () => {
  it('construye el payload y guarda out/<caso>/trazabilidad.json', async () => {
    const ctx = proyectoTemporal();
    const r = json(await oc.construir_payload.execute({ caso: 'sol-001' }, ctx));
    expect(r.ok).toBe(true);
    expect((r.data as Data).ruta_trazabilidad).toBe('out/sol-001/trazabilidad.json');
    const traz = JSON.parse(leerSalida(ctx, 'sol-001', 'trazabilidad.json')) as Data;
    expect(traz['proveedor.codigo_sap']).toBe('maestro.proveedores');
  });

  it('genera out/<caso>/aprobacion.txt y devuelve { ruta, sha256 }', async () => {
    const ctx = proyectoTemporal();
    const r = json(await oc.generar_evidencia.execute({ caso: 'sol-001' }, ctx));
    expect(r.ok).toBe(true);
    const d = r.data as { ruta: string; sha256: string };
    expect(d.ruta).toBe('out/sol-001/aprobacion.txt');
    expect(leerSalida(ctx, 'sol-001', 'aprobacion.txt')).toContain(`sha256: ${d.sha256}`);
  });

  it('el sha256 del payload coincide con el de la evidencia', async () => {
    const ctx = proyectoTemporal();
    const ev = json(await oc.generar_evidencia.execute({ caso: 'sol-004' }, ctx)).data as { sha256: string };
    const p = await payloadDe(ctx, 'sol-004');
    expect((p.aprobador as Data).evidencia_sha256).toBe(ev.sha256);
  });

  it('no construye payload de un caso bloqueado (sol-002)', async () => {
    const r = json(await oc.construir_payload.execute({ caso: 'sol-002' }, proyectoTemporal()));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RC1');
  });
});

describe('HU-5 · Crear la OC en el SAP simulado', () => {
  it('crea sol-001 desde 4500000001 y es idempotente', async () => {
    const ctx = proyectoTemporal();
    const r1 = await crear(ctx, 'sol-001');
    expect(r1.data).toMatchObject({ numero_oc: '4500000001', idempotente: false });
    expect(String(r1.data!.fecha)).toMatch(/-05:00$/);
    const r2 = await crear(ctx, 'sol-001');
    expect(r2.data).toMatchObject({ numero_oc: '4500000001', idempotente: true });
    expect(leerSalida(ctx, 'sap', 'ordenes.jsonl').trim().split('\n')).toHaveLength(1);
  });

  it('no crea un caso bloqueado y registra el intento', async () => {
    const ctx = proyectoTemporal();
    const r = json(await oc.crear.execute({ caso: 'sol-003', payload: await payloadDe(ctx, 'sol-001') }, ctx));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RC2');
    expect(existeSalida(ctx, 'sap', 'ordenes.jsonl')).toBe(false);
    expect(leerSalida(ctx, 'control.csv')).toMatch(/SOL-2026-003,BLOQUEADA,,false,RC2,,/);
  });

  it('con confirmaciones exige confirmado = true (sol-004)', async () => {
    const ctx = proyectoTemporal();
    const pendiente = await crear(ctx, 'sol-004');
    expect(pendiente.ok).toBe(false);
    expect(pendiente.requiere_confirmacion).toBe(true);
    expect(pendiente.error).toContain('RC5');
    const creada = await crear(ctx, 'sol-004', true);
    expect(creada.data).toMatchObject({ numero_oc: '4500000001', idempotente: false });
    const linea = JSON.parse(leerSalida(ctx, 'sap', 'ordenes.jsonl').trim()) as { orden: { excepciones: Data[] } };
    expect(linea.orden.excepciones[0]).toMatchObject({ codigo: 'RC5', confirmado_por: expect.any(String) });
  });

  it('rechaza un payload alterado por el modelo', async () => {
    const ctx = proyectoTemporal();
    const p = await payloadDe(ctx, 'sol-001');
    const posiciones = p.posiciones as Data[];
    posiciones[0]!.precio_unitario = 1;
    const r = json(await oc.crear.execute({ caso: 'sol-001', payload: p }, ctx));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/payload/i);
    expect(existeSalida(ctx, 'sap', 'ordenes.jsonl')).toBe(false);
  });

  it('registra cada intento en out/control.csv y marca la retroactiva (sol-005)', async () => {
    const ctx = proyectoTemporal();
    await crear(ctx, 'sol-005');
    await crear(ctx, 'sol-005', true);
    const filas = leerSalida(ctx, 'control.csv').trim().split('\n');
    expect(filas[0]).toBe('solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts');
    expect(filas[1]).toMatch(/^SOL-2026-005,PENDIENTE_CONFIRMACION,,true,,RC8,/);
    expect(filas[2]).toMatch(/^SOL-2026-005,CREADA,4500000001,true,,RC8,/);
  });

  it('cada llamada a herramienta queda en out/log.jsonl', async () => {
    const ctx = proyectoTemporal();
    await oc.leer_paquete.execute({ caso: 'sol-001' }, ctx);
    await oc.validar.execute({ caso: 'sol-001' }, ctx);
    const lineas = leerSalida(ctx, 'log.jsonl').trim().split('\n').map((l) => JSON.parse(l) as Data);
    expect(lineas.map((l) => l.herramienta)).toEqual(['oc_leer_paquete', 'oc_validar']);
    expect(lineas[0]).toMatchObject({ sessionId: 'test-sesion', ok: true });
  });
});

describe('SAP simulado (src/sap/mock.ts)', () => {
  it('consulta proveedores del maestro y busca órdenes por referencia', async () => {
    const ctx = proyectoTemporal();
    const sap = new SapMock(path.join(ctx.directory, 'out', 'sap'), path.join(ctx.directory, 'fixtures', 'reto-03'));
    expect(await sap.consultarProveedor('900.555.111-2')).toEqual({ codigo_sap: '100234', activo: true });
    expect(await sap.consultarProveedor('901999000')).toBeNull();
    expect(await sap.buscarOrdenPorReferencia('SOL-2026-001')).toBeNull();
  });

  it('registra la fecha en hora de Bogotá (offset -05:00)', () => {
    const fecha = SapMock.fechaBogota(new Date('2026-11-11T00:24:00Z'));
    expect(fecha).toBe('2026-11-10T19:24:00-05:00');
  });
});

describe('Aceptación por caso (specs/esperados/reto-03.json)', () => {
  const esperados = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'specs', 'esperados', 'reto-03.json'), 'utf8')) as {
    casos: Record<string, { apta: boolean; bloqueos: string[]; confirmaciones: string[]; derivados: string[]; retroactiva: boolean; creaOC: string }>;
    secuenciaDemo: { ordenes: Record<string, string> };
  };

  for (const [caso, e] of Object.entries(esperados.casos)) {
    it(`${caso}: ${e.creaOC}`, async () => {
      const ctx = proyectoTemporal();
      const r = json(await oc.validar.execute({ caso }, ctx));
      const d = r.data as { apta: boolean; bloqueos: Data[]; confirmaciones: Data[]; derivados: Data; retroactiva: boolean };
      expect(d.apta).toBe(e.apta);
      expect(d.bloqueos.map((b) => b.codigo)).toEqual(e.bloqueos);
      expect(d.confirmaciones.map((c) => c.codigo)).toEqual(e.confirmaciones);
      expect(Object.keys(d.derivados).sort()).toEqual([...e.derivados].sort());
      expect(d.retroactiva).toBe(e.retroactiva);

      const sinConfirmar = await crear(ctx, caso);
      expect(sinConfirmar.ok).toBe(e.creaOC === 'SIN_CONFIRMACION');
      if (e.creaOC === 'CON_CONFIRMACION') expect((await crear(ctx, caso, true)).ok).toBe(true);
    });
  }

  it('secuencia de la demo: numeración e idempotencia', async () => {
    const ctx = proyectoTemporal();
    for (const caso of Object.keys(esperados.casos)) await crear(ctx, caso);
    expect((await crear(ctx, 'sol-001')).data).toMatchObject({ numero_oc: '4500000001', idempotente: true });
    for (const caso of ['sol-004', 'sol-005', 'sol-006']) {
      expect((await crear(ctx, caso, true)).data?.numero_oc).toBe(esperados.secuenciaDemo.ordenes[caso]);
    }
  });
});
