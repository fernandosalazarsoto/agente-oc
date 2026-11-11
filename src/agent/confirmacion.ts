import { normalizar } from '../domain/texto';

/**
 * Detección determinista de la respuesta de la usuaria a una confirmación (CA3).
 * Conservadora: ante la duda, NO se considera confirmación.
 */
const limpiar = (t: string) => normalizar(t).replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

export function esRechazo(texto: string): boolean {
  return /^(no|cancela|cancelar|cancelado|rechazo|rechazar|rechazada|detente|alto)\b/.test(limpiar(texto));
}

export function esConfirmacion(texto: string): boolean {
  if (esRechazo(texto)) return false;
  return /^(si|confirmo|confirmado|confirmar|apruebo|aprobado|procede|proceder|adelante|ok|okay|dale|de acuerdo|hazlo|creala|crea la oc)\b/.test(limpiar(texto));
}

/** Casos (sol-xxx) mencionados en un texto. */
export function casosMencionados(texto: string): string[] {
  return [...new Set((texto.toLowerCase().match(/\b[a-z]{2,5}-\d{3}\b/g) ?? []))];
}
