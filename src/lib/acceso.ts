/**
 * Validación de credenciales HTTP Basic para la URL pública.
 * - Decodifica UTF-8 (los navegadores envían así usuario y clave con ñ o tildes).
 * - Ignora espacios accidentales al inicio o final de las variables de entorno.
 * - Compara en tiempo constante para no filtrar información por tiempos de respuesta.
 */

export function comparacionSegura(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= (ba[i] as number) ^ (bb[i] as number);
  return diff === 0;
}

export function decodificarBasic(cabecera: string | null): { usuario: string; clave: string } | null {
  if (!cabecera || !cabecera.startsWith('Basic ')) return null;
  try {
    const binario = atob(cabecera.slice(6).trim());
    const texto = new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
    const separador = texto.indexOf(':');
    if (separador === -1) return null;
    return { usuario: texto.slice(0, separador), clave: texto.slice(separador + 1) };
  } catch {
    return null;
  }
}

export function credencialesValidas(cabecera: string | null, usuarioEsperado: string, claveEsperada: string): boolean {
  const c = decodificarBasic(cabecera);
  if (!c) return false;
  // Se evalúan ambas comparaciones siempre (sin cortocircuito).
  const usuarioOk = comparacionSegura(c.usuario.trim(), usuarioEsperado.trim());
  const claveOk = comparacionSegura(c.clave, claveEsperada.trim());
  return usuarioOk && claveOk;
}
