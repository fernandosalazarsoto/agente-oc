import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Acceso de solo lectura a maestros y casos. Estructura conocida del reto:
 *   fixtures/<dataset>/maestros/{proveedores,centros-costo,indicadores-iva,condiciones-pago}.json
 *   fixtures/<dataset>/solicitudes/<casoId>/{correo.json,solicitud.json,cotizacion.txt,aprobacion.json,factura.txt?}
 *
 * La raíz "fixtures" es literal: limita el acceso a disco a esa carpeta y permite
 * que el bundler incluya solo esos archivos en el despliegue.
 *
 * Reglas de aislamiento: cada llamada lee SOLO la carpeta del caso pedido.
 * No hay caché ni estado entre casos. El contenido de los archivos es dato no confiable.
 */

const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,39}$/i;

export class ErrorDatos extends Error {
  constructor(
    message: string,
    readonly codigo: 'CASO_INVALIDO' | 'CASO_NO_ENCONTRADO' | 'ARCHIVO_FALTANTE' | 'JSON_INVALIDO',
  ) {
    super(message);
    this.name = 'ErrorDatos';
  }
}

export interface CasoCrudo {
  id: string;
  correo: unknown;
  solicitud: unknown;
  cotizacion: string;
  aprobacion: unknown;
  /** Solo existe en algunos casos (compras retroactivas). */
  factura?: string;
}

export interface MaestrosCrudos {
  proveedores: unknown;
  centrosCosto: unknown;
  indicadoresIva: unknown;
  condicionesPago: unknown;
}

export function directorioBase(dataset: string): string {
  if (!PATRON_CASO.test(dataset)) {
    throw new ErrorDatos(`Nombre de dataset inválido: "${dataset}"`, 'CASO_INVALIDO');
  }
  return path.join(process.cwd(), 'fixtures', dataset);
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function leerJson(ruta: string, requerido: true): Promise<unknown>;
async function leerJson(ruta: string, requerido: false): Promise<unknown | undefined>;
async function leerJson(ruta: string, requerido: boolean): Promise<unknown | undefined> {
  if (!(await existe(ruta))) {
    if (requerido) throw new ErrorDatos(`Falta el archivo ${path.basename(ruta)}`, 'ARCHIVO_FALTANTE');
    return undefined;
  }
  const texto = await readFile(ruta, 'utf8');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorDatos(`JSON inválido en ${path.basename(ruta)}`, 'JSON_INVALIDO');
  }
}

async function leerTexto(ruta: string, requerido: boolean): Promise<string | undefined> {
  if (!(await existe(ruta))) {
    if (requerido) throw new ErrorDatos(`Falta el archivo ${path.basename(ruta)}`, 'ARCHIVO_FALTANTE');
    return undefined;
  }
  return readFile(ruta, 'utf8');
}

/** Valida el id antes de tocar el disco (evita path traversal como "../../etc"). */
export function validarIdCaso(casoId: string): string {
  if (!PATRON_CASO.test(casoId)) {
    throw new ErrorDatos(`Identificador de caso inválido: "${casoId}"`, 'CASO_INVALIDO');
  }
  return casoId;
}

export async function listarCasos(dataset: string): Promise<string[]> {
  const dir = path.join(directorioBase(dataset), 'solicitudes');
  if (!(await existe(dir))) return [];
  const entradas = await readdir(dir, { withFileTypes: true });
  return entradas
    .filter((e) => e.isDirectory() && PATRON_CASO.test(e.name))
    .map((e) => e.name)
    .sort();
}

export async function cargarCaso(dataset: string, casoId: string): Promise<CasoCrudo> {
  validarIdCaso(casoId);
  const dir = path.join(directorioBase(dataset), 'solicitudes', casoId);
  if (!(await existe(dir))) {
    throw new ErrorDatos(`No existe el caso "${casoId}"`, 'CASO_NO_ENCONTRADO');
  }
  const [correo, solicitud, cotizacion, aprobacion, factura] = await Promise.all([
    leerJson(path.join(dir, 'correo.json'), true),
    leerJson(path.join(dir, 'solicitud.json'), true),
    leerTexto(path.join(dir, 'cotizacion.txt'), true),
    leerJson(path.join(dir, 'aprobacion.json'), true),
    leerTexto(path.join(dir, 'factura.txt'), false),
  ]);
  return {
    id: casoId,
    correo,
    solicitud,
    cotizacion: cotizacion as string,
    aprobacion,
    ...(factura !== undefined ? { factura } : {}),
  };
}

export async function cargarMaestros(dataset: string): Promise<MaestrosCrudos> {
  const dir = path.join(directorioBase(dataset), 'maestros');
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    leerJson(path.join(dir, 'proveedores.json'), true),
    leerJson(path.join(dir, 'centros-costo.json'), false),
    leerJson(path.join(dir, 'indicadores-iva.json'), false),
    leerJson(path.join(dir, 'condiciones-pago.json'), false),
  ]);
  return { proveedores, centrosCosto, indicadoresIva, condicionesPago };
}
