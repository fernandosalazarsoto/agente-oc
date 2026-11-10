import { describe, expect, it } from 'vitest';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';
import { cargarPrompt } from '@/src/agent/agente';

describe('Configuración', () => {
  it('aplica valores por defecto y trata vacíos como no definidos', () => {
    const c = leerConfig({ ANTHROPIC_API_KEY: '', NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(c.AGENT_MODEL).toBe('claude-sonnet-5-5');
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('en producción exige clave del LLM y secreto de aprobaciones', () => {
    const c = leerConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(diagnosticoConfig(c)).toHaveLength(2);
  });

  it('rechaza secretos de aprobación débiles', () => {
    expect(() => leerConfig({ TOOL_APPROVAL_SECRET: 'corto', NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('Límite de peticiones', () => {
  it('bloquea al superar el máximo y se restablece con la ventana', () => {
    let t = 0;
    const l = new LimitePeticiones(2, 1000, () => t);
    expect(l.permitir('ip')).toBe(true);
    expect(l.permitir('ip')).toBe(true);
    expect(l.permitir('ip')).toBe(false);
    expect(l.permitir('otra-ip')).toBe(true);
    t = 1000;
    expect(l.permitir('ip')).toBe(true);
  });
});

describe('System prompt', () => {
  it('existe y contiene las reglas de confirmación humana', () => {
    const p = cargarPrompt();
    expect(p).toMatch(/confirmación humana/i);
    expect(p).toMatch(/crear_orden_compra/);
  });
});
