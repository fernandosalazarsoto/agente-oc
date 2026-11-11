import { appendFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Escritura en out/ (PRD §6.1): trazabilidad, evidencia, log de control y log de herramientas.
 * En local: <raíz>/out. En Vercel el sistema de archivos del bundle es de solo lectura,
 * por eso se usa /tmp/out (efímero por instancia; ver specs/supuestos.md S-11).
 */
export function directorioSalida(raiz: string): string {
  if (process.env.OUT_DIR) return path.resolve(process.env.OUT_DIR);
  return process.env.VERCEL ? '/tmp/out' : path.join(raiz, 'out');
}

/** Carpeta de salida de una ejecución: la de la sesión del chat (ctx.outDir) o out/ global. */
export function salidaDe(ctx: { directory: string; outDir?: string }): string {
  return ctx.outDir ?? directorioSalida(ctx.directory);
}

/** Ruta que se muestra al modelo y a la usuaria (relativa al proyecto, nunca absoluta). */
export function rutaVisible(ctx: { outDir?: string; sessionId: string }, relativa: string): string {
  return ctx.outDir ? `out/sesiones/${ctx.sessionId}/${relativa}` : `out/${relativa}`;
}

/** Fecha y hora en America/Bogota con offset explícito (UTC-5, sin horario de verano). */
export function ahoraBogota(fecha: Date = new Date()): string {
  return `${new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 19)}-05:00`;
}

export async function escribirArchivo(dirOut: string, relativa: string, contenido: string): Promise<void> {
  const ruta = path.join(dirOut, relativa);
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido, 'utf8');
}

export async function escribirBinario(dirOut: string, relativa: string, contenido: Uint8Array): Promise<void> {
  const ruta = path.join(dirOut, relativa);
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
}

export async function anexarLinea(dirOut: string, relativa: string, linea: string): Promise<void> {
  const ruta = path.join(dirOut, relativa);
  await mkdir(path.dirname(ruta), { recursive: true });
  await appendFile(ruta, `${linea}\n`, 'utf8');
}

export async function limpiarSalida(dirOut: string): Promise<void> {
  await rm(dirOut, { recursive: true, force: true });
}

export type ResultadoControl = 'CREADA' | 'IDEMPOTENTE' | 'PENDIENTE_CONFIRMACION' | 'BLOQUEADA' | 'RECHAZADA_INTEGRIDAD';

export interface FilaControl {
  solicitud_id: string;
  resultado: ResultadoControl;
  numero_oc: string | null;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
}

const ENCABEZADO_CONTROL = 'solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts';

/** Agrega una fila a out/control.csv por cada intento (HU-5). Códigos separados por "|". */
export async function registrarControl(dirOut: string, f: FilaControl): Promise<void> {
  const ruta = path.join(dirOut, 'control.csv');
  const nuevo = await stat(ruta).then(() => false, () => true);
  if (nuevo) await anexarLinea(dirOut, 'control.csv', ENCABEZADO_CONTROL);
  const celdas = [f.solicitud_id, f.resultado, f.numero_oc ?? '', String(f.retroactiva), f.bloqueos.join('|'), f.confirmaciones.join('|'), ahoraBogota()];
  await anexarLinea(dirOut, 'control.csv', celdas.map((c) => c.replace(/[,\n\r]/g, ' ')).join(','));
}
