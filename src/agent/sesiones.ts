import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { escribirArchivo } from '../lib/salidas';
import { crearSesion, type Sesion } from './ciclo';

/**
 * Sesiones en memoria con respaldo en archivo (out/sesiones/<id>.json), PRD §6.1.
 * En serverless la memoria es por instancia; el archivo en /tmp ayuda mientras la instancia vive.
 */
const PATRON_SESION = /^[A-Za-z0-9_-]{8,64}$/;
const memoria = new Map<string, Sesion>();

export function idSesionValido(id: string): boolean {
  return PATRON_SESION.test(id);
}

export async function obtenerSesion(id: string, dirOut: string): Promise<Sesion> {
  const enMemoria = memoria.get(id);
  if (enMemoria) return enMemoria;
  let sesion: Sesion;
  try {
    sesion = JSON.parse(await readFile(path.join(dirOut, 'sesiones', `${id}.json`), 'utf8')) as Sesion;
  } catch {
    sesion = crearSesion(id);
  }
  memoria.set(id, sesion);
  return sesion;
}

export async function guardarSesion(sesion: Sesion, dirOut: string): Promise<void> {
  memoria.set(sesion.id, sesion);
  await escribirArchivo(dirOut, path.join('sesiones', `${sesion.id}.json`), JSON.stringify(sesion));
}

export async function buscarSesion(id: string, dirOut: string): Promise<Sesion | null> {
  const s = memoria.get(id);
  if (s) return s;
  try {
    return JSON.parse(await readFile(path.join(dirOut, 'sesiones', `${id}.json`), 'utf8')) as Sesion;
  } catch {
    return null;
  }
}
