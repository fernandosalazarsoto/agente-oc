/**
 * Paquete de una solicitud (PRD §7.1 y §7.2). Funciones puras: reciben el
 * contenido crudo de los archivos y devuelven el paquete normalizado.
 * El contenido de correos, cotizaciones y facturas es dato no confiable.
 */
import { z } from 'zod';
import { parsearMonto } from './dinero';
import { fechaCalendario } from './fechas';
import { normalizar, soloDigitos } from './texto';

/** Error de datos del paquete con mensaje legible para la usuaria (HU-6). */
export class ErrorPaquete extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorPaquete';
  }
}

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'fecha en formato AAAA-MM-DD');

export const esquemaSolicitud = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().positive(),
  moneda: z.enum(['COP', 'USD']),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: fechaIso,
});
export type Solicitud = z.infer<typeof esquemaSolicitud>;

const esquemaCorreo = z.object({ id: z.string().min(1), de: z.string(), asunto: z.string(), fecha: z.string() });
const esquemaAprobacionArchivo = z.object({
  de: z.string().min(1),
  para: z.string().default(''),
  fecha: z.string().min(1),
  asunto: z.string().default(''),
  cuerpo: z.string(),
});

export const esquemaProveedor = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});
export const esquemaCentroCosto = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
});
const esquemaIndicadorIva = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() });
const esquemaCondicionPago = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() });

export type Proveedor = z.infer<typeof esquemaProveedor>;
export type CentroCosto = z.infer<typeof esquemaCentroCosto>;

export interface Maestros {
  proveedores: Proveedor[];
  centrosCosto: CentroCosto[];
  indicadoresIva: z.infer<typeof esquemaIndicadorIva>[];
  condicionesPago: z.infer<typeof esquemaCondicionPago>[];
}

export interface Cotizacion {
  proveedor: string;
  nit: string | null;
  total: number;
  moneda: string;
  validez_hasta: string | null;
  referencia: string | null;
  fecha: string | null;
  item: string | null;
  texto: string;
}

export interface Factura {
  numero: string;
  fecha: string;
  total: number;
}

export interface AprobacionPaquete {
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  aprobado: boolean;
  texto: string;
}

/** Contenido crudo de los archivos del caso; null si el archivo no existe. */
export interface ArchivosCaso {
  correo: unknown | null;
  solicitud: unknown | null;
  cotizacion: string | null;
  aprobacion: unknown | null;
  factura: string | null;
}

export interface Paquete {
  caso: string;
  correo: { id: string; de: string; asunto: string; fecha: string } | null;
  solicitud: Solicitud | null;
  cotizacion: Cotizacion | null;
  aprobacion: AprobacionPaquete | null;
  factura: Factura | null;
  /** Nombres de los archivos ausentes (HU-1). */
  faltantes: string[];
}

function describirError(archivo: string, error: z.ZodError): string {
  const detalle = error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
  return `${archivo} no tiene la estructura esperada (${detalle})`;
}

function parsear<T>(archivo: string, esquema: z.ZodType<T>, valor: unknown): T {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new ErrorPaquete(describirError(archivo, r.error));
  return r.data;
}

function linea(texto: string, patron: RegExp): string | null {
  return texto.match(patron)?.[1]?.trim() ?? null;
}

/** NIT sin puntos ni dígito de verificación: "900.555.111-2" → "900555111". */
export function nitBase(nit: string): string {
  return soloDigitos(nit.split('-')[0] ?? nit);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lee la cotización en texto (proveedor, NIT, total, validez). Devuelve null si no hay TOTAL legible. */
export function parsearCotizacion(texto: string): Cotizacion | null {
  const totalTexto = linea(texto, /^\s*TOTAL\b[^:\n]*:\s*(.+)$/im);
  if (!totalTexto) return null;
  const fecha = linea(texto, /^\s*Fecha:\s*(\d{4}-\d{2}-\d{2})/im);
  const dias = linea(texto, /^\s*Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im);
  const nit = linea(texto, /^\s*NIT:\s*([\d.\-]+)/im);
  return {
    proveedor: linea(texto, /^\s*Proveedor:\s*(.+)$/im) ?? '',
    nit: nit ? nitBase(nit) : null,
    total: parsearMonto(totalTexto),
    moneda: totalTexto.match(/\b(COP|USD)\b/)?.[1] ?? 'COP',
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    referencia: linea(texto, /COTIZACI[ÓO]N\s+([A-Z0-9][A-Z0-9-]*)/i),
    fecha,
    item: linea(texto, /^\s*\d+\.\s*([^|\n]+)\|/m),
    texto,
  };
}

/** Lee la factura en texto (número, fecha de emisión, total). */
export function parsearFactura(texto: string): Factura {
  const numero = linea(texto, /\bNo\.\s*([A-Z0-9-]+)/i);
  const fecha = linea(texto, /Fecha(?: de emisi[óo]n)?:\s*(\d{4}-\d{2}-\d{2})/i);
  const total = linea(texto, /^\s*TOTAL\s*:\s*(.+)$/im);
  if (!numero || !fecha || !total) {
    throw new ErrorPaquete('factura.txt no tiene número, fecha de emisión o total legibles');
  }
  return { numero, fecha, total: parsearMonto(total) };
}

/** "Aprobado" sin distinguir mayúsculas ni tildes y no precedido de "no" (S-08). */
export function contieneAprobado(cuerpo: string): boolean {
  const t = normalizar(cuerpo);
  return /(^|[^a-z])aprobad[oa]\b/.test(t) && !/\bno\s+(esta\s+)?aprobad/.test(t);
}

export function normalizarPaquete(caso: string, archivos: ArchivosCaso): Paquete {
  const faltantes: string[] = [];
  if (archivos.correo === null) faltantes.push('correo.json');
  if (archivos.solicitud === null) faltantes.push('solicitud.json');
  if (archivos.cotizacion === null) faltantes.push('cotizacion.txt');
  if (archivos.aprobacion === null) faltantes.push('aprobacion.json');

  const correo = archivos.correo === null ? null : parsear('correo.json', esquemaCorreo, archivos.correo);
  const solicitud = archivos.solicitud === null ? null : parsear('solicitud.json', esquemaSolicitud, archivos.solicitud);
  const aprobacionArchivo =
    archivos.aprobacion === null ? null : parsear('aprobacion.json', esquemaAprobacionArchivo, archivos.aprobacion);

  let cotizacion: Cotizacion | null = null;
  if (archivos.cotizacion !== null) {
    try {
      cotizacion = parsearCotizacion(archivos.cotizacion);
    } catch {
      cotizacion = null;
    }
    if (!cotizacion) faltantes.push('cotizacion.txt (sin TOTAL legible)');
  }

  return {
    caso,
    correo: correo ? { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha } : null,
    solicitud,
    cotizacion,
    aprobacion: aprobacionArchivo
      ? {
          de: aprobacionArchivo.de,
          para: aprobacionArchivo.para,
          asunto: aprobacionArchivo.asunto,
          fecha: aprobacionArchivo.fecha,
          aprobado: contieneAprobado(aprobacionArchivo.cuerpo),
          texto: aprobacionArchivo.cuerpo,
        }
      : null,
    factura: archivos.factura === null ? null : parsearFactura(archivos.factura),
    faltantes,
  };
}

/** Valida y tipa los maestros. */
export function parsearMaestros(crudos: {
  proveedores: unknown;
  centrosCosto: unknown;
  indicadoresIva: unknown;
  condicionesPago: unknown;
}): Maestros {
  return {
    proveedores: parsear('maestros/proveedores.json', z.array(esquemaProveedor), crudos.proveedores),
    centrosCosto: parsear('maestros/centros-costo.json', z.array(esquemaCentroCosto), crudos.centrosCosto),
    indicadoresIva: parsear('maestros/indicadores-iva.json', z.array(esquemaIndicadorIva), crudos.indicadoresIva),
    condicionesPago: parsear('maestros/condiciones-pago.json', z.array(esquemaCondicionPago), crudos.condicionesPago),
  };
}

/** Fecha calendario en Bogotá de un valor ISO (con o sin hora). */
export function dia(valor: string): string {
  return fechaCalendario(valor);
}
