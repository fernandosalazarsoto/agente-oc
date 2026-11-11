import { describe, expect, it } from 'vitest';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';

describe('Configuración', () => {
  it('usa reto-03 y claude-sonnet-5-5 por defecto, con topes de costo configurables', () => {
    const c = leerConfig({ NODE_ENV: 'test' });
    expect(c.DATASET).toBe('reto-03');
    expect(c.AGENT_MODEL).toBe('claude-sonnet-5-5');
    expect(c.AGENT_MAX_ITERACIONES).toBe(12);
    expect(c.AGENT_MAX_TOKENS_SESION).toBeGreaterThan(0);
    expect(leerConfig({ NODE_ENV: 'test', AGENT_MAX_ITERACIONES: '5' }).AGENT_MAX_ITERACIONES).toBe(5);
  });

  it('solo exige la clave del modelo para atender el chat', () => {
    expect(diagnosticoConfig(leerConfig({ NODE_ENV: 'production' }))).toEqual(['ANTHROPIC_API_KEY no configurada']);
    expect(diagnosticoConfig(leerConfig({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'x' }))).toEqual([]);
  });
});

describe('Límite de peticiones', () => {
  it('bloquea al superar el máximo de la ventana', () => {
    const l = new LimitePeticiones(2, 60_000);
    expect(l.permitir('ip')).toBe(true);
    expect(l.permitir('ip')).toBe(true);
    expect(l.permitir('ip')).toBe(false);
    expect(l.permitir('otra')).toBe(true);
  });
});
