import { describe, expect, it } from 'vitest';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';
import { LIMITES_AGENTE, cargarPrompt } from '@/src/agent/agente';
import { recortarHistorial } from '@/src/lib/historial';

describe('Controles de costo', () => {
  const u = (n: number) => ({ id: `u${n}`, role: 'user' });
  const a = (n: number) => ({ id: `a${n}`, role: 'assistant' });

  it('no recorta historiales cortos', () => {
    const h = [u(1), a(1)];
    expect(recortarHistorial(h, 12)).toEqual(h);
  });

  it('recorta conservando los últimos mensajes y empezando en un mensaje del usuario', () => {
    const h = [u(1), a(1), u(2), a(2), u(3), a(3)];
    // La ventana de 3 empezaría en a(2): debe avanzar hasta u(3)
    expect(recortarHistorial(h, 3).map((m) => m.id)).toEqual(['u3', 'a3']);
    expect(recortarHistorial(h, 4).map((m) => m.id)).toEqual(['u2', 'a2', 'u3', 'a3']);
  });

  it('sin usuario en la ventana conserva el último intercambio completo', () => {
    const h = [u(1), a(1), a(2), a(3)];
    expect(recortarHistorial(h, 2).map((m) => m.id)).toEqual(['u1', 'a1', 'a2', 'a3']);
  });

  it('el agente tiene topes de pasos y tokens de salida', () => {
    expect(LIMITES_AGENTE.pasosPorTurno).toBeLessThanOrEqual(6);
    expect(LIMITES_AGENTE.tokensSalidaPorPaso).toBeLessThanOrEqual(800);
  });
});

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
