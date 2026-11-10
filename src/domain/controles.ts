/**
 * Motor genérico de controles. Puro y determinista: sin IO, sin fecha del sistema,
 * sin estado compartido. Cada control recibe el contexto de UN caso y devuelve
 * su resultado con evidencia. La decisión final se calcula aquí, nunca en el LLM.
 *
 * Los controles concretos del reto se definen en src/domain/reglas/ a partir del PRD.
 */

export type EstadoControl = 'CUMPLE' | 'NO_CUMPLE' | 'ALERTA' | 'NO_APLICA';
export type Severidad = 'BLOQUEANTE' | 'ADVERTENCIA';
export type Decision = 'APTA' | 'REQUIERE_REVISION' | 'RECHAZADA';

export interface ResultadoControl {
  id: string;
  nombre: string;
  severidad: Severidad;
  estado: EstadoControl;
  /** Explicación legible y verificable del resultado (qué se comparó con qué). */
  evidencia: string;
  /** Datos estructurados opcionales para auditoría. */
  detalle?: Record<string, unknown>;
}

export interface Control<Ctx> {
  id: string;
  nombre: string;
  severidad: Severidad;
  evaluar(ctx: Ctx): Pick<ResultadoControl, 'estado' | 'evidencia' | 'detalle'>;
}

export interface ResultadoValidacion {
  decision: Decision;
  controles: ResultadoControl[];
  bloqueantes: string[];
  advertencias: string[];
}

export function ejecutarControles<Ctx>(ctx: Ctx, controles: readonly Control<Ctx>[]): ResultadoValidacion {
  const resultados: ResultadoControl[] = controles.map((c) => {
    try {
      const r = c.evaluar(ctx);
      return { id: c.id, nombre: c.nombre, severidad: c.severidad, ...r };
    } catch (error) {
      // Un control que falla por datos inesperados nunca se da por cumplido.
      return {
        id: c.id,
        nombre: c.nombre,
        severidad: c.severidad,
        estado: 'NO_CUMPLE' as const,
        evidencia: `Error al evaluar el control: ${(error as Error).message}`,
      };
    }
  });

  return { ...decidir(resultados), controles: resultados };
}

export function decidir(resultados: readonly ResultadoControl[]): Omit<ResultadoValidacion, 'controles'> {
  const bloqueantes = resultados
    .filter((r) => r.estado === 'NO_CUMPLE' && r.severidad === 'BLOQUEANTE')
    .map((r) => r.id);
  const advertencias = resultados
    .filter((r) => r.estado === 'ALERTA' || (r.estado === 'NO_CUMPLE' && r.severidad === 'ADVERTENCIA'))
    .map((r) => r.id);

  const decision: Decision =
    bloqueantes.length > 0 ? 'RECHAZADA' : advertencias.length > 0 ? 'REQUIERE_REVISION' : 'APTA';

  return { decision, bloqueantes, advertencias };
}
