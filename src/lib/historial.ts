/**
 * Recorta el historial que se envía al modelo para acotar los tokens de entrada.
 * Conserva los últimos `maximo` mensajes y hace que el recorte empiece siempre en
 * un mensaje del usuario, para no separar una llamada a herramienta de su resultado
 * ni de su aprobación (ambos viven dentro del mismo mensaje del asistente).
 */
export function recortarHistorial<T>(mensajes: readonly T[], maximo: number): T[] {
  if (mensajes.length <= maximo) return [...mensajes];
  const ventana = mensajes.slice(-maximo);
  const inicio = ventana.findIndex((m) => esDelUsuario(m));
  // Sin mensaje de usuario en la ventana: se conserva solo el último intercambio completo.
  if (inicio === -1) {
    const ultimoUsuario = findLastIndex(mensajes, esDelUsuario);
    return ultimoUsuario === -1 ? ventana : mensajes.slice(ultimoUsuario);
  }
  return ventana.slice(inicio);
}

function esDelUsuario(m: unknown): boolean {
  return typeof m === 'object' && m !== null && (m as { role?: unknown }).role === 'user';
}

function findLastIndex<T>(lista: readonly T[], pred: (x: T) => boolean): number {
  for (let i = lista.length - 1; i >= 0; i--) if (pred(lista[i] as T)) return i;
  return -1;
}
