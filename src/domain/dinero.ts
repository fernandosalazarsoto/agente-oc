/**
 * Utilidades monetarias deterministas. Todo cálculo se hace en centavos enteros
 * para evitar errores de coma flotante en IVA, totales y topes.
 */

export type Centavos = number & { readonly __brand: 'Centavos' };

export function aCentavos(valor: number): Centavos {
  if (!Number.isFinite(valor)) throw new Error(`Monto inválido: ${valor}`);
  return Math.round(valor * 100) as Centavos;
}

export function desdeCentavos(c: Centavos): number {
  return c / 100;
}

/** Aplica una tasa porcentual (ej. 19 para 19 %) con redondeo half-up al centavo. */
export function aplicarTasa(base: Centavos, tasaPorcentaje: number): Centavos {
  return Math.round((base * tasaPorcentaje) / 100) as Centavos;
}

export function sumar(...valores: Centavos[]): Centavos {
  return valores.reduce((a, b) => a + b, 0) as Centavos;
}

/** Igualdad con tolerancia explícita en centavos (por defecto exacta). */
export function iguales(a: Centavos, b: Centavos, toleranciaCentavos = 0): boolean {
  return Math.abs(a - b) <= toleranciaCentavos;
}

/** Interpreta montos escritos en texto: "$ 1.234.567,89", "1,234,567.89", "1234567". */
export function parsearMonto(texto: string): number {
  const limpio = texto.replace(/[^\d.,-]/g, '');
  if (!limpio) throw new Error(`No se encontró un monto en "${texto}"`);
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  let normalizado: string;
  if (ultimaComa > ultimoPunto) {
    // Formato latino: puntos de miles, coma decimal
    normalizado = limpio.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPunto > ultimaComa && ultimaComa !== -1) {
    // Formato anglosajón: comas de miles, punto decimal
    normalizado = limpio.replace(/,/g, '');
  } else if (ultimoPunto !== -1 && limpio.split('.').length > 2) {
    // Solo puntos repetidos: separadores de miles
    normalizado = limpio.replace(/\./g, '');
  } else if (ultimoPunto !== -1 && limpio.length - ultimoPunto - 1 === 3) {
    // "1.234" sin decimales: se asume separador de miles
    normalizado = limpio.replace(/\./g, '');
  } else {
    normalizado = limpio.replace(/,/g, '');
  }
  const n = Number(normalizado);
  if (!Number.isFinite(n)) throw new Error(`Monto no interpretable: "${texto}"`);
  return n;
}

export function formatearCOP(c: Centavos): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(desdeCentavos(c));
}
