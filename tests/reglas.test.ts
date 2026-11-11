import { describe, expect, it } from 'vitest';
import { normalizarPaquete, parsearCotizacion, parsearFactura, type ArchivosCaso } from '@/src/domain/paquete';
import { validarPaquete, type Validacion } from '@/src/domain/reglas';
import { construirOrden, esquemaOrdenCompra } from '@/src/domain/orden';
import { generarEvidencia } from '@/src/domain/evidencia';
import { archivosDe, maestros } from './ayudas';

/** Valida un caso de los fixtures, opcionalmente modificado en memoria. */
function validar(caso: string, mod?: (a: ArchivosCaso & { solicitud: Record<string, unknown>; aprobacion: Record<string, unknown> | null }) => void): Validacion {
  const archivos = archivosDe(caso) as ArchivosCaso & { solicitud: Record<string, unknown>; aprobacion: Record<string, unknown> | null };
  mod?.(archivos);
  return validarPaquete(normalizarPaquete(caso, archivos), maestros());
}
const bloqueos = (v: Validacion) => v.bloqueos.map((b) => b.codigo);
const confirmaciones = (v: Validacion) => v.confirmaciones.map((c) => c.codigo);

describe('Lectura de documentos (PRD §7.1, §7.2)', () => {
  it('extrae de la cotización proveedor, NIT sin DV, total, referencia y validez', () => {
    const c = parsearCotizacion(archivosDe('sol-001').cotizacion!)!;
    expect(c.proveedor).toBe('TecnoSuministros S.A.S.');
    expect(c.nit).toBe('900555111');
    expect(c.total).toBe(11_400_000);
    expect(c.moneda).toBe('COP');
    expect(c.referencia).toBe('COT-TS-2026-0451');
    expect(c.validez_hasta).toBe('2026-09-17');
  });

  it('no confunde el subtotal del ítem con el TOTAL de la cotización', () => {
    expect(parsearCotizacion(archivosDe('sol-004').cotizacion!)!.total).toBe(26_500_000);
  });

  it('extrae número, fecha y total de la factura', () => {
    expect(parsearFactura(archivosDe('sol-005').factura!)).toEqual({ numero: 'FC-88231', fecha: '2026-08-10', total: 3_200_000 });
  });

  it('normaliza la aprobación y detecta "Aprobado"', () => {
    const p = normalizarPaquete('sol-001', archivosDe('sol-001'));
    expect(p.aprobacion?.aprobado).toBe(true);
    expect(p.aprobacion?.de).toBe('mlopez@periferia-ficticia.com');
    expect(p.factura).toBeNull();
    expect(p.faltantes).toEqual([]);
  });
});

describe('RC1 · Proveedor existe y activo', () => {
  it('cumple con NIT existente y activo (sol-001)', () => {
    expect(bloqueos(validar('sol-001'))).not.toContain('RC1');
  });
  it('bloquea un NIT inexistente (sol-002)', () => {
    const v = validar('sol-002');
    expect(bloqueos(v)).toEqual(['RC1']);
    expect(v.bloqueos[0]!.detalle).toContain('901999000');
    expect(v.bloqueos[0]!.accion_sugerida.length).toBeGreaterThan(10);
  });
  it('bloquea un proveedor inactivo', () => {
    const v = validar('sol-001', (a) => { a.solicitud.proveedor_nit = '901777888'; });
    expect(bloqueos(v)).toContain('RC1');
  });
  it('sin NIT busca por nombre normalizado (sol-006)', () => {
    expect(bloqueos(validar('sol-006'))).not.toContain('RC1');
    const v = validar('sol-006', (a) => { a.solicitud.proveedor_nombre = 'tecnosuministros sas'; });
    expect(bloqueos(v)).not.toContain('RC1');
  });
  it('acepta NIT con puntos y dígito de verificación', () => {
    const v = validar('sol-001', (a) => { a.solicitud.proveedor_nit = '900.555.111-2'; });
    expect(bloqueos(v)).not.toContain('RC1');
  });
});

describe('RC2 · Aprobación válida', () => {
  it('bloquea un aprobador que no pertenece al centro (sol-003)', () => {
    expect(bloqueos(validar('sol-003'))).toEqual(['RC2']);
  });
  it('bloquea si falta la aprobación', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.aprobacion = null; }))).toContain('RC2');
  });
  it('bloquea si el cuerpo dice "No aprobado"', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.aprobacion!.cuerpo = 'No aprobado, falta presupuesto.'; }))).toContain('RC2');
  });
});

describe('RC3 · Monto dentro del tope del aprobador', () => {
  it('bloquea si el valor supera el tope (mlopez 50 M)', () => {
    const v = validar('sol-001', (a) => { a.solicitud.cantidad = 600; a.solicitud.valor_total = 57_000_000; });
    expect(bloqueos(v)).toContain('RC3');
  });
  it('cumple exactamente en el tope', () => {
    const v = validar('sol-001', (a) => { a.solicitud.cantidad = 500; a.solicitud.valor_unitario = 100_000; a.solicitud.valor_total = 50_000_000; });
    expect(bloqueos(v)).not.toContain('RC3');
  });
  it('no duplica el bloqueo cuando el aprobador es ajeno al centro (S-03)', () => {
    const v = validar('sol-003');
    expect(bloqueos(v)).not.toContain('RC3');
    expect(v.controles.find((c) => c.codigo === 'RC3')?.estado).toBe('NO_EVALUABLE');
  });
});

describe('RC4 · Subárea del centro de costo', () => {
  it('bloquea una subárea que no pertenece al centro', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.solicitud.subarea = 'Marketing'; }))).toContain('RC4');
  });
  it('bloquea un centro de costo inexistente', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.solicitud.centro_costo = 'CC-9999'; }))).toContain('RC4');
  });
});

describe('RC5 · Cotización vs solicitud (2 %)', () => {
  it('pide confirmación con ambos valores si excede (sol-004)', () => {
    const v = validar('sol-004');
    expect(confirmaciones(v)).toEqual(['RC5']);
    expect(v.confirmaciones[0]!.valores).toMatchObject({ solicitud: 25_000_000, cotizacion: 26_500_000 });
    expect(v.apta).toBe(true);
  });
  it('cumple con diferencia exactamente del 2 %', () => {
    const v = validar('sol-001', (a) => { a.cotizacion = a.cotizacion!.replace('TOTAL (IVA incluido): COP 11.400.000', 'TOTAL (IVA incluido): COP 11.628.000'); });
    expect(confirmaciones(v)).not.toContain('RC5');
  });
  it('pide confirmación si no hay cotización', () => {
    expect(confirmaciones(validar('sol-001', (a) => { a.cotizacion = null; }))).toContain('RC5');
  });
});

describe('RC6 y RC7 · Valores derivados del proveedor', () => {
  it('deriva el IVA con confirmación y las condiciones de pago solo informadas (sol-006)', () => {
    const v = validar('sol-006');
    expect(confirmaciones(v)).toEqual(['RC6']);
    expect(v.derivados.indicador_iva?.valor).toBe('C1');
    expect(v.derivados.condiciones_pago?.valor).toBe('Z030');
  });
  it('no deriva cuando la solicitud trae ambos valores', () => {
    expect(validar('sol-001').derivados).toEqual({});
  });
});

describe('RC8 · OC retroactiva', () => {
  it('marca retroactiva y pide confirmación (sol-005)', () => {
    const v = validar('sol-005');
    expect(v.retroactiva).toBe(true);
    expect(confirmaciones(v)).toEqual(['RC8']);
  });
  it('no es retroactiva si la factura es del mismo día', () => {
    const v = validar('sol-005', (a) => { a.factura = a.factura!.replace('2026-08-10', '2026-08-27'); });
    expect(v.retroactiva).toBe(false);
  });
});

describe('RC9 · Fecha de aprobación', () => {
  it('pide confirmación si la aprobación es anterior a la solicitud', () => {
    expect(confirmaciones(validar('sol-001', (a) => { a.aprobacion!.fecha = '2026-08-19T10:00:00-05:00'; }))).toContain('RC9');
  });
  it('cumple si es el mismo día', () => {
    expect(confirmaciones(validar('sol-001', (a) => { a.aprobacion!.fecha = '2026-08-20T08:00:00-05:00'; }))).not.toContain('RC9');
  });
});

describe('RC10 · Cantidad × valor unitario = valor total (± 1)', () => {
  it('bloquea si no cuadra', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.solicitud.valor_total = 11_400_002; }))).toContain('RC10');
  });
  it('tolera una unidad monetaria', () => {
    expect(bloqueos(validar('sol-001', (a) => { a.solicitud.valor_total = 11_400_001; }))).not.toContain('RC10');
  });
});

describe('Payload de la OC (PRD §7.4) y evidencia (HU-4)', () => {
  const sha = 'a'.repeat(64);
  const orden = (caso: string) => {
    const p = normalizarPaquete(caso, archivosDe(caso));
    const m = maestros();
    return construirOrden(p, m, validarPaquete(p, m), sha);
  };

  it('construye una OC válida contra el esquema zod con trazabilidad completa (sol-001)', () => {
    const { orden: o, trazabilidad } = orden('sol-001');
    expect(esquemaOrdenCompra.parse(o)).toEqual(o);
    expect(o.proveedor).toEqual({ codigo_sap: '100234', nit: '900555111', nombre: 'TecnoSuministros S.A.S.' });
    expect(o.condiciones_pago).toBe('Z030');
    expect(o.referencia).toEqual({ solicitud_id: 'SOL-2026-001', correo_id: 'sol-001-correo', cotizacion_ref: 'COT-TS-2026-0451' });
    expect(o.posiciones[0]).toMatchObject({ numero: 10, cantidad: 120, unidad: 'UN', precio_unitario: 95_000, centro_costo: 'CC-1010', subarea: 'Infraestructura', indicador_iva: 'C1' });
    expect(o.posiciones[0]!.descripcion.length).toBeLessThanOrEqual(40);
    expect(o.aprobador).toEqual({ email: 'mlopez@periferia-ficticia.com', fecha_aprobacion: '2026-08-21T10:02:00-05:00', evidencia_sha256: sha });
    expect(o.excepciones).toEqual([]);
    for (const fuente of Object.values(trazabilidad)) {
      expect(fuente).toMatch(/^(solicitud|cotizacion|correo|aprobacion|evidencia|maestro\.[a-z-]+|derivado|constante)/);
    }
    expect(trazabilidad['proveedor.codigo_sap']).toBe('maestro.proveedores');
  });

  it('usa los valores aprobados de la solicitud y registra la excepción (sol-004, S-04)', () => {
    const { orden: o } = orden('sol-004');
    expect(o.posiciones[0]).toMatchObject({ unidad: 'H', cantidad: 100, precio_unitario: 250_000 });
    expect(o.excepciones.map((e) => e.codigo)).toEqual(['RC5']);
    expect(o.excepciones[0]!.confirmado_por).toBeNull();
  });

  it('completa IVA y condiciones derivados (sol-006)', () => {
    const { orden: o, trazabilidad } = orden('sol-006');
    expect(o.condiciones_pago).toBe('Z030');
    expect(o.posiciones[0]!.indicador_iva).toBe('C1');
    expect(trazabilidad['condiciones_pago']).toBe('derivado');
  });

  it('no construye OC si hay bloqueos (sol-002)', () => {
    expect(() => orden('sol-002')).toThrow();
  });

  it('genera la evidencia con encabezados, cuerpo y sha256 del contenido', () => {
    const p = normalizarPaquete('sol-001', archivosDe('sol-001'));
    const e = generarEvidencia(p.aprobacion!);
    expect(e.texto).toContain('De: mlopez@periferia-ficticia.com');
    expect(e.texto).toContain('Para: juan.camargo@periferia-ficticia.com');
    expect(e.texto).toContain('Asunto: RE: Solicitud de orden de compra SOL-001');
    expect(e.texto).toContain('Aprobado, proceder con la orden de compra.');
    expect(e.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(e.texto).toContain(`sha256: ${e.sha256}`);
    expect(generarEvidencia(p.aprobacion!).sha256).toBe(e.sha256);
  });
});
