import { describe, expect, it } from 'vitest';
import { credencialesValidas, decodificarBasic } from '@/src/lib/acceso';

/** Codifica como lo hacen los navegadores: UTF-8 y luego base64. */
function basic(usuario: string, clave: string): string {
  return `Basic ${Buffer.from(`${usuario}:${clave}`, 'utf8').toString('base64')}`;
}

describe('Acceso HTTP Basic', () => {
  it('acepta credenciales correctas', () => {
    expect(credencialesValidas(basic('evaluador', 'Clave-Segura-2026'), 'evaluador', 'Clave-Segura-2026')).toBe(true);
  });

  it('rechaza clave o usuario incorrectos', () => {
    expect(credencialesValidas(basic('evaluador', 'otra'), 'evaluador', 'Clave-Segura-2026')).toBe(false);
    expect(credencialesValidas(basic('admin', 'Clave-Segura-2026'), 'evaluador', 'Clave-Segura-2026')).toBe(false);
  });

  it('acepta claves con ñ, tildes y otros caracteres UTF-8', () => {
    expect(credencialesValidas(basic('evaluador', 'Contraseña-Única'), 'evaluador', 'Contraseña-Única')).toBe(true);
  });

  it('tolera espacios accidentales en las variables de entorno', () => {
    expect(credencialesValidas(basic('evaluador', 'Clave-2026'), ' evaluador ', 'Clave-2026 \n')).toBe(true);
  });

  it('admite ":" dentro de la clave', () => {
    expect(credencialesValidas(basic('evaluador', 'a:b:c'), 'evaluador', 'a:b:c')).toBe(true);
  });

  it('rechaza cabeceras ausentes o mal formadas', () => {
    expect(credencialesValidas(null, 'evaluador', 'x')).toBe(false);
    expect(credencialesValidas('Bearer abc', 'evaluador', 'x')).toBe(false);
    expect(credencialesValidas('Basic !!!no-base64!!!', 'evaluador', 'x')).toBe(false);
    expect(decodificarBasic(`Basic ${Buffer.from('sin-separador').toString('base64')}`)).toBeNull();
  });
});
