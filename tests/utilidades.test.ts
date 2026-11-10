import { describe, expect, it } from 'vitest';
import { aCentavos, aplicarTasa, iguales, parsearMonto, sumar } from '@/src/domain/dinero';
import { compararFechas, fechaCalendario, parsearFechaTexto } from '@/src/domain/fechas';
import { extraerCampo, mismoNit } from '@/src/domain/texto';

describe('Dinero', () => {
  it.each([
    ['$ 1.190.000', 1190000],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['COP 500000', 500000],
    ['1.234', 1234],
    ['99.5', 99.5],
  ])('parsea "%s" como %d', (texto, esperado) => {
    expect(parsearMonto(texto)).toBe(esperado);
  });

  it('rechaza textos sin monto', () => {
    expect(() => parsearMonto('sin valor')).toThrow();
  });

  it('calcula IVA en centavos sin errores de coma flotante', () => {
    const base = aCentavos(0.1 + 0.2);
    expect(base).toBe(30);
    expect(aplicarTasa(aCentavos(1_000_000), 19)).toBe(aCentavos(190_000));
    expect(sumar(aCentavos(1_000_000), aCentavos(190_000))).toBe(aCentavos(1_190_000));
  });

  it('compara con tolerancia explícita', () => {
    expect(iguales(aCentavos(100), aCentavos(100.01))).toBe(false);
    expect(iguales(aCentavos(100), aCentavos(100.01), 1)).toBe(true);
  });
});

describe('Fechas', () => {
  it('normaliza a fecha calendario en America/Bogota', () => {
    expect(fechaCalendario('2026-01-10')).toBe('2026-01-10');
    // 02:00 UTC del 11 = 21:00 del 10 en Bogotá
    expect(fechaCalendario('2026-01-11T02:00:00Z')).toBe('2026-01-10');
  });

  it('parsea fechas en texto ISO y dd/mm/aaaa', () => {
    expect(parsearFechaTexto('Fecha: 2026-01-05')).toBe('2026-01-05');
    expect(parsearFechaTexto('Fecha: 5/1/2026')).toBe('2026-01-05');
  });

  it('compara fechas calendario', () => {
    expect(compararFechas('2026-01-05', '2026-01-10')).toBe(-1);
    expect(compararFechas('2026-01-10T23:00:00-05:00', '2026-01-10')).toBe(0);
  });
});

describe('Texto', () => {
  const cotizacion = 'COTIZACIÓN\nNIT: 900.000.001-1\nValor Total: $ 1.190.000\n';

  it('extrae campos por etiqueta sin importar tildes ni mayúsculas', () => {
    expect(extraerCampo(cotizacion, ['nit'])).toBe('900.000.001-1');
    expect(extraerCampo(cotizacion, ['total'])).toBe('$ 1.190.000');
    expect(extraerCampo(cotizacion, ['moneda'])).toBeUndefined();
  });

  it('no confunde "Subtotal" con "Total"', () => {
    const t = 'Subtotal: $ 1.000.000\nIVA 19%: $ 190.000\nTotal: $ 1.190.000';
    expect(extraerCampo(t, ['total'])).toBe('$ 1.190.000');
  });

  it('compara NIT ignorando formato y dígito de verificación', () => {
    expect(mismoNit('900.000.001-1', '900000001')).toBe(true);
    expect(mismoNit('900000002', '900000001')).toBe(false);
  });
});
