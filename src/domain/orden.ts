/**
 * Orden de compra (PRD §7.4): esquema zod y construcción determinista desde el
 * paquete validado. Cada campo queda trazado a su fuente (HU-3).
 */
import { z } from 'zod';
import { type Maestros, type Paquete, ErrorPaquete } from './paquete';
import type { Validacion } from './reglas';
import { normalizar } from './texto';

export const esquemaOrdenCompra = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal('1000'),
  organizacion_compras: z.literal('1000'),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(['COP', 'USD']),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().max(40),
        cantidad: z.number(),
        unidad: z.enum(['UN', 'H', 'MES']),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});
export type OrdenCompra = z.infer<typeof esquemaOrdenCompra>;

/** Fuente de cada campo del payload: solicitud, cotizacion, maestro.<nombre>, derivado, etc. */
export type Trazabilidad = Record<string, string>;

/** Texto breve SAP de 40 caracteres, cortando en palabra cuando es posible (S-07). */
export function textoBreve(texto: string, max = 40): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max + 1).lastIndexOf(' ');
  return (corte > max * 0.6 ? limpio.slice(0, corte) : limpio.slice(0, max)).trim();
}

/** Unidad de medida derivada del texto (S-06). */
export function derivarUnidad(...textos: Array<string | null | undefined>): 'UN' | 'H' | 'MES' {
  const t = normalizar(textos.filter(Boolean).join(' '));
  if (/\bhoras?\b/.test(t)) return 'H';
  if (/\bpor mes\b|\bmensualidad\b/.test(t)) return 'MES';
  return 'UN';
}

export function construirOrden(
  p: Paquete,
  m: Maestros,
  v: Validacion,
  evidenciaSha256: string,
): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  if (!v.apta || !v.proveedor) {
    throw new ErrorPaquete(`No se construye la OC: la solicitud tiene bloqueos (${v.bloqueos.map((b) => b.codigo).join(', ')})`);
  }
  const s = p.solicitud;
  if (!s || !p.correo || !p.aprobacion) {
    throw new ErrorPaquete(`No se construye la OC: faltan documentos (${p.faltantes.join(', ')})`);
  }
  const condiciones = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor;
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor;
  if (!condiciones || !iva) throw new ErrorPaquete('No se pudieron determinar IVA o condiciones de pago');
  if (!m.indicadoresIva.some((i) => i.codigo === iva) || !m.condicionesPago.some((c) => c.codigo === condiciones)) {
    throw new ErrorPaquete(`IVA ${iva} o condiciones ${condiciones} no existen en los maestros`);
  }

  const orden: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: '1000',
    organizacion_compras: '1000',
    proveedor: { ...v.proveedor },
    moneda: s.moneda,
    condiciones_pago: condiciones,
    aprobador: { email: p.aprobacion.de, fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: textoBreve(s.descripcion),
        cantidad: s.cantidad,
        unidad: derivarUnidad(p.cotizacion?.item, s.descripcion),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  };

  const trazabilidad: Trazabilidad = {
    'referencia.solicitud_id': 'solicitud',
    'referencia.correo_id': 'correo',
    'referencia.cotizacion_ref': p.cotizacion?.referencia ? 'cotizacion' : 'derivado (sin cotización)',
    sociedad: 'constante',
    organizacion_compras: 'constante',
    'proveedor.codigo_sap': 'maestro.proveedores',
    'proveedor.nit': 'maestro.proveedores',
    'proveedor.nombre': 'maestro.proveedores',
    moneda: 'solicitud',
    condiciones_pago: s.condiciones_pago ? 'solicitud' : 'derivado',
    'aprobador.email': 'aprobacion',
    'aprobador.fecha_aprobacion': 'aprobacion',
    'aprobador.evidencia_sha256': 'evidencia (sha256 de out/<caso>/aprobacion.txt)',
    'posiciones[0].numero': 'constante',
    'posiciones[0].descripcion': 'solicitud (texto breve de 40 caracteres)',
    'posiciones[0].cantidad': 'solicitud',
    'posiciones[0].unidad': 'derivado (texto de cotización y solicitud)',
    'posiciones[0].precio_unitario': 'solicitud',
    'posiciones[0].centro_costo': 'solicitud',
    'posiciones[0].subarea': 'solicitud',
    'posiciones[0].indicador_iva': s.indicador_iva ? 'solicitud' : 'derivado',
    excepciones: 'derivado (confirmaciones de oc_validar)',
  };

  return { orden: esquemaOrdenCompra.parse(orden), trazabilidad };
}

/** Huella para comparar payloads ignorando quién confirmó (integridad, PRD §10). */
export function huellaOrden(orden: OrdenCompra): string {
  const o = esquemaOrdenCompra.parse(orden);
  return JSON.stringify({ ...o, excepciones: o.excepciones.map((e) => ({ codigo: e.codigo, detalle: e.detalle })) });
}
