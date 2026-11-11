import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { escribirArchivo } from '../lib/salidas';
import { crearSesion, type Sesion } from './ciclo';

/**
 * Sesiones en memoria con respaldo en archivo (out/sesiones/<id>/sesion.json), PRD §6.1.
 * En serverless la memoria y /tmp son por instancia: la continuidad entre instancias la da
 * el estado firmado que viaja con cada petición (src/agent/estado.ts).
 */
const PATRON_SESION = /^[A-Za-z0-9_-]{8,64}$/;

export function idSesionValido(id: string): boolean {
  return PATRON_SESION.test(id);
}

/** Carpeta de la sesión: allí viven su SAP simulado, su log de control y su log de herramientas. */
export function dirSesion(dirSalida: string, id: string): string {
  if (!idSesionValido(id)) throw new Error('sessionId inválido');
  return path.join(dirSalida, 'sesiones', id);
}

export class AlmacenSesiones {
  private readonly memoria = new Map<string, Sesion>();

  async buscar(id: string, dir: string): Promise<Sesion | null> {
    const enMemoria = this.memoria.get(id);
    if (enMemoria) return enMemoria;
    try {
      return JSON.parse(await readFile(path.join(dir, 'sesion.json'), 'utf8')) as Sesion;
    } catch {
      return null;
    }
  }

  async obtener(id: string, dir: string): Promise<Sesion> {
    const sesion = (await this.buscar(id, dir)) ?? crearSesion(id);
    this.memoria.set(id, sesion);
    return sesion;
  }

  async guardar(sesion: Sesion, dir: string): Promise<void> {
    this.memoria.set(sesion.id, sesion);
    await escribirArchivo(dir, 'sesion.json', JSON.stringify(sesion));
  }
}

/** Almacén único por instancia del servidor. */
export const almacenSesiones = new AlmacenSesiones();
