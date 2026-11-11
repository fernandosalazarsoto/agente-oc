import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdaptadorLLM } from '../llm/adapter';
import { escribirArchivo } from '../lib/salidas';
import { type OpcionesCiclo, type ResultadoTurno, type Sesion, ejecutarTurno } from './ciclo';
import { firmarEstado, verificarEstado } from './estado';
import { type AlmacenSesiones, dirSesion } from './sesiones';

/**
 * Atiende un turno del chat: recupera la sesión (estado firmado o almacén local),
 * hidrata su SAP simulado, ejecuta el ciclo del agente y devuelve el nuevo estado firmado.
 */
export interface DependenciasChat {
  raiz: string;
  dirSalida: string;
  llm: AdaptadorLLM;
  secreto: string;
  sesiones: AlmacenSesiones;
  opciones: OpcionesCiclo;
}

/** Archivos de la sesión que viajan con el estado. */
export const ARCHIVOS_SESION = ['sap/ordenes.jsonl', 'control.csv', 'log.jsonl'] as const;

const MAX_MENSAJES = 40;
const MAX_HISTORIAL = 80;

/** Acota el tamaño del estado: conserva los últimos mensajes empezando en uno de la usuaria. */
function compactar(sesion: Sesion): void {
  if (sesion.mensajes.length > MAX_MENSAJES) {
    let inicio = sesion.mensajes.length - MAX_MENSAJES;
    while (inicio < sesion.mensajes.length && sesion.mensajes[inicio]!.rol !== 'usuario') inicio++;
    sesion.mensajes = sesion.mensajes.slice(inicio);
  }
  if (sesion.historial.length > MAX_HISTORIAL) sesion.historial = sesion.historial.slice(-MAX_HISTORIAL);
}

export async function atenderChat(
  entrada: { sessionId: string; message: string; estado?: string },
  deps: DependenciasChat,
): Promise<ResultadoTurno & { estado: string }> {
  const dir = dirSesion(deps.dirSalida, entrada.sessionId);
  const recibido = entrada.estado ? verificarEstado(entrada.estado, deps.secreto) : null;

  let sesion: Sesion;
  if (recibido && recibido.sesion.id === entrada.sessionId) {
    sesion = recibido.sesion;
    for (const relativa of ARCHIVOS_SESION) {
      const contenido = recibido.archivos[relativa];
      if (contenido !== undefined) await escribirArchivo(dir, relativa, contenido);
    }
  } else {
    if (entrada.estado) console.warn('[chat] Estado de sesión inválido o de otra sesión: se ignora');
    sesion = await deps.sesiones.obtener(entrada.sessionId, dir);
  }

  const resultado = await ejecutarTurno({
    llm: deps.llm,
    sesion,
    mensaje: entrada.message,
    ctx: { directory: deps.raiz, sessionId: sesion.id, outDir: dir },
    opciones: deps.opciones,
  });

  compactar(sesion);
  await deps.sesiones.guardar(sesion, dir);
  // Lecturas con nombre estático: la carpeta de salida queda fuera del trazado del bundle.
  const leer = (promesa: Promise<string>) => promesa.catch(() => undefined);
  const [ordenes, control, log] = await Promise.all([
    leer(readFile(path.join(dir, 'sap', 'ordenes.jsonl'), 'utf8')),
    leer(readFile(path.join(dir, 'control.csv'), 'utf8')),
    leer(readFile(path.join(dir, 'log.jsonl'), 'utf8')),
  ]);
  const archivos: Record<string, string> = {};
  if (ordenes !== undefined) archivos['sap/ordenes.jsonl'] = ordenes;
  if (control !== undefined) archivos['control.csv'] = control;
  if (log !== undefined) archivos['log.jsonl'] = log;
  return { ...resultado, estado: firmarEstado({ v: 1, sesion, archivos }, deps.secreto) };
}
