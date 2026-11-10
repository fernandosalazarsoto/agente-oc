import { describe, expect, it } from 'vitest';
import { type Control, decidir, ejecutarControles } from '@/src/domain/controles';

type Ctx = { valor: number };

const control = (
  id: string,
  severidad: 'BLOQUEANTE' | 'ADVERTENCIA',
  evaluar: Control<Ctx>['evaluar'],
): Control<Ctx> => ({ id, nombre: id, severidad, evaluar });

describe('Motor de controles', () => {
  it('decide APTA cuando todos los controles se cumplen', () => {
    const r = ejecutarControles({ valor: 1 }, [
      control('C1', 'BLOQUEANTE', () => ({ estado: 'CUMPLE', evidencia: 'ok' })),
      control('C2', 'ADVERTENCIA', () => ({ estado: 'NO_APLICA', evidencia: 'n/a' })),
    ]);
    expect(r.decision).toBe('APTA');
    expect(r.bloqueantes).toEqual([]);
    expect(r.advertencias).toEqual([]);
  });

  it('decide RECHAZADA si falla un control bloqueante, aunque haya advertencias', () => {
    const r = ejecutarControles({ valor: 1 }, [
      control('C1', 'BLOQUEANTE', () => ({ estado: 'NO_CUMPLE', evidencia: 'falla' })),
      control('C2', 'ADVERTENCIA', () => ({ estado: 'ALERTA', evidencia: 'revisar' })),
    ]);
    expect(r.decision).toBe('RECHAZADA');
    expect(r.bloqueantes).toEqual(['C1']);
    expect(r.advertencias).toEqual(['C2']);
  });

  it('decide REQUIERE_REVISION con alertas o advertencias incumplidas y sin bloqueantes', () => {
    expect(
      ejecutarControles({ valor: 1 }, [control('C1', 'ADVERTENCIA', () => ({ estado: 'NO_CUMPLE', evidencia: 'x' }))]).decision,
    ).toBe('REQUIERE_REVISION');
    expect(
      ejecutarControles({ valor: 1 }, [control('C1', 'BLOQUEANTE', () => ({ estado: 'ALERTA', evidencia: 'x' }))]).decision,
    ).toBe('REQUIERE_REVISION');
  });

  it('un control que lanza excepción se registra como NO_CUMPLE, nunca como cumplido', () => {
    const r = ejecutarControles({ valor: 1 }, [
      control('C1', 'BLOQUEANTE', () => {
        throw new Error('dato faltante');
      }),
    ]);
    expect(r.decision).toBe('RECHAZADA');
    expect(r.controles[0]?.estado).toBe('NO_CUMPLE');
    expect(r.controles[0]?.evidencia).toContain('dato faltante');
  });

  it('es determinista: misma entrada, mismo resultado', () => {
    const lista = [control('C1', 'BLOQUEANTE', ({ valor }) => ({ estado: valor > 0 ? 'CUMPLE' : 'NO_CUMPLE', evidencia: `${valor}` }))];
    expect(ejecutarControles({ valor: 5 }, lista)).toEqual(ejecutarControles({ valor: 5 }, lista));
  });

  it('decidir sin controles devuelve APTA (el set vacío debe evitarse en reglas)', () => {
    expect(decidir([]).decision).toBe('APTA');
  });
});
