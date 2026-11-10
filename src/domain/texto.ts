/**
 * Extracción determinista de campos desde texto libre (cotizaciones, facturas).
 * Patrón: una etiqueta conocida seguida de su valor en la misma línea.
 * Ajustar las etiquetas al formato real de los archivos .txt del reto.
 */

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Busca la primera línea cuya etiqueta coincida (sin tildes ni mayúsculas)
 * y devuelve el valor tras ':' o '='. Devuelve undefined si no aparece.
 */
export function extraerCampo(texto: string, etiquetas: readonly string[]): string | undefined {
  const objetivos = etiquetas.map(normalizar);
  for (const linea of texto.split(/\r?\n/)) {
    const sep = linea.search(/[:=]/);
    if (sep === -1) continue;
    const etiqueta = normalizar(linea.slice(0, sep)).trim();
    // Coincidencia exacta o por palabra final ("valor total" sí, "subtotal" no).
    if (objetivos.some((o) => etiqueta === o || etiqueta.endsWith(` ${o}`))) {
      const valor = linea.slice(sep + 1).trim();
      if (valor) return valor;
    }
  }
  return undefined;
}

/** Solo dígitos: útil para comparar NIT con o sin puntos y dígito de verificación. */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** Compara NIT ignorando formato; si uno trae DV ("900123456-7") se compara la base. */
export function mismoNit(a: string, b: string): boolean {
  const base = (v: string) => soloDigitos(v.split('-')[0] ?? v);
  return base(a) === base(b);
}
