/**
 * Fechas deterministas. Las comparaciones se hacen sobre fechas calendario
 * (YYYY-MM-DD) en America/Bogota, nunca contra la fecha actual del sistema,
 * para que demo y tests den siempre el mismo resultado.
 */

const ZONA = 'America/Bogota';

/** Normaliza ISO con o sin hora a fecha calendario en Bogotá: '2026-03-01'. */
export function fechaCalendario(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: "${valor}"`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Interpreta fechas en texto: '2026-03-01', '01/03/2026' (dd/mm/aaaa). */
export function parsearFechaTexto(texto: string): string {
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  throw new Error(`No se encontró una fecha en "${texto}"`);
}

/** -1 si a < b, 0 si iguales, 1 si a > b (comparación de fechas calendario). */
export function compararFechas(a: string, b: string): -1 | 0 | 1 {
  const fa = fechaCalendario(a);
  const fb = fechaCalendario(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}
