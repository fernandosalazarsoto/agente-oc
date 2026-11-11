import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Sesion } from './ciclo';

/**
 * Estado de sesión firmado (HMAC-SHA256) que viaja entre navegador y servidor.
 * Permite que cualquier instancia serverless continúe la conversación con el mismo
 * historial, la misma confirmación pendiente y el mismo SAP simulado de la sesión.
 * La firma impide forjar confirmaciones u órdenes desde el cliente.
 */
export interface EstadoSesion {
  v: 1;
  sesion: Sesion;
  /** Archivos de la sesión en out/sesiones/<id>/ (sap/ordenes.jsonl, control.csv, log.jsonl). */
  archivos: Record<string, string>;
}

const esquemaEstado = z.object({
  v: z.literal(1),
  sesion: z.object({
    id: z.string(),
    mensajes: z.array(z.unknown()),
    historial: z.array(z.unknown()),
    pendiente: z.unknown().nullable(),
    tokensUsados: z.number(),
  }),
  archivos: z.record(z.string(), z.string()),
});

const SECRETO_PROCESO = randomBytes(32).toString('hex');

/** SESSION_SECRET, o TOOL_APPROVAL_SECRET ya configurado en Vercel; en local, uno aleatorio por proceso. */
export function secretoSesion(env: Record<string, string | undefined> = process.env): string {
  return env.SESSION_SECRET || env.TOOL_APPROVAL_SECRET || SECRETO_PROCESO;
}

const firmar = (datos: string, secreto: string) => createHmac('sha256', secreto).update(datos).digest('base64url');

export function firmarEstado(estado: EstadoSesion, secreto: string): string {
  const datos = Buffer.from(JSON.stringify(estado), 'utf8').toString('base64url');
  return `${datos}.${firmar(datos, secreto)}`;
}

export function verificarEstado(token: string, secreto: string): EstadoSesion | null {
  const [datos, firma, ...resto] = token.split('.');
  if (!datos || !firma || resto.length > 0) return null;
  const esperada = Buffer.from(firmar(datos, secreto));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const r = esquemaEstado.safeParse(JSON.parse(Buffer.from(datos, 'base64url').toString('utf8')));
    return r.success ? (r.data as unknown as EstadoSesion) : null;
  } catch {
    return null;
  }
}
