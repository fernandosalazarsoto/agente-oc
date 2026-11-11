import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { type ArchivosCaso, type Maestros, parsearMaestros } from '../domain/paquete';

/**
 * Acceso de solo lectura a fixtures/<dataset>/ (PRD §7.1), resuelto desde la raíz
 * del proyecto (ctx.directory). Cada lectura toca SOLO la carpeta del caso pedido
 * y los maestros: sin caché ni estado entre casos. Protegido contra path traversal.
 */

const PATRON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;

export class ErrorDatos extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorDatos';
  }
}

export function directorioDataset(raiz: string, dataset: string): string {
  if (!PATRON_ID.test(dataset)) throw new ErrorDatos(`Nombre de dataset inválido: "${dataset}"`);
  return path.join(raiz, 'fixtures', dataset);
}

export function validarIdCaso(caso: string): string {
  if (!PATRON_ID.test(caso)) throw new ErrorDatos(`Identificador de caso inválido: "${caso}"`);
  return caso;
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function leerJson(ruta: string): Promise<unknown | null> {
  if (!(await existe(ruta))) return null;
  const texto = await readFile(ruta, 'utf8');
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new ErrorDatos(`${path.basename(ruta)} no es un JSON válido (archivo malformado): pida al solicitante reenviarlo`);
  }
}

async function leerTexto(ruta: string): Promise<string | null> {
  return (await existe(ruta)) ? readFile(ruta, 'utf8') : null;
}

export async function listarCasos(raiz: string, dataset: string): Promise<string[]> {
  const dir = path.join(directorioDataset(raiz, dataset), 'solicitudes');
  if (!(await existe(dir))) return [];
  const entradas = await readdir(dir, { withFileTypes: true });
  return entradas.filter((e) => e.isDirectory() && PATRON_ID.test(e.name)).map((e) => e.name).sort();
}

export async function leerArchivosCaso(raiz: string, dataset: string, caso: string): Promise<ArchivosCaso> {
  validarIdCaso(caso);
  const dir = path.join(directorioDataset(raiz, dataset), 'solicitudes', caso);
  if (!(await existe(dir))) throw new ErrorDatos(`No existe el caso "${caso}" en fixtures/${dataset}/solicitudes/`);
  const [correo, solicitud, cotizacion, aprobacion, factura] = await Promise.all([
    leerJson(path.join(dir, 'correo.json')),
    leerJson(path.join(dir, 'solicitud.json')),
    leerTexto(path.join(dir, 'cotizacion.txt')),
    leerJson(path.join(dir, 'aprobacion.json')),
    leerTexto(path.join(dir, 'factura.txt')),
  ]);
  return { correo, solicitud, cotizacion, aprobacion, factura };
}

export async function leerMaestros(raiz: string, dataset: string): Promise<Maestros> {
  const dir = path.join(directorioDataset(raiz, dataset), 'maestros');
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    leerJson(path.join(dir, 'proveedores.json')),
    leerJson(path.join(dir, 'centros-costo.json')),
    leerJson(path.join(dir, 'indicadores-iva.json')),
    leerJson(path.join(dir, 'condiciones-pago.json')),
  ]);
  return parsearMaestros({ proveedores, centrosCosto, indicadoresIva, condicionesPago });
}
