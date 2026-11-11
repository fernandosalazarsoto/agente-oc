import { describe, expect, it } from 'vitest';
import type { AdaptadorLLM, MensajeLLM, RespuestaLLM } from '@/src/llm/adapter';
import { crearSesion, ejecutarTurno, type OpcionesCiclo } from '@/src/agent/ciclo';
import { esConfirmacion, esRechazo } from '@/src/agent/confirmacion';
import { cargarPrompt } from '@/src/agent/prompt';
import { existeSalida, leerSalida, proyectoTemporal } from './ayudas';

/** Proveedor LLM falso: devuelve respuestas guionizadas y registra lo que recibe. */
function llmFalso(guion: Array<RespuestaLLM | Error>) {
  const recibidos: MensajeLLM[][] = [];
  const adaptador: AdaptadorLLM = {
    proveedor: 'falso',
    modelo: 'falso-1',
    async enviar(mensajes) {
      recibidos.push(structuredClone(mensajes));
      const siguiente = guion.shift();
      if (!siguiente) return { texto: 'Listo.', llamadas: [], uso: { entrada: 10, salida: 5 } };
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
  };
  return { adaptador, recibidos };
}

const texto = (t: string): RespuestaLLM => ({ texto: t, llamadas: [], uso: { entrada: 100, salida: 20 } });
const llamada = (nombre: string, args: Record<string, unknown>, id = nombre): RespuestaLLM => ({
  texto: '',
  llamadas: [{ id, nombre, args }],
  uso: { entrada: 100, salida: 20 },
});

const opciones: OpcionesCiclo = { topeIteraciones: 6, topeTokensSesion: 100_000, sistema: 'prompt de prueba' };

describe('Ciclo del agente (PRD §6.3)', () => {
  it('ejecuta herramientas, las deja visibles y responde', async () => {
    const ctx = proyectoTemporal();
    const { adaptador, recibidos } = llmFalso([llamada('oc_validar', { caso: 'sol-002' }), texto('sol-002 bloqueada por RC1.')]);
    const sesion = crearSesion('s-1');
    const r = await ejecutarTurno({ llm: adaptador, sesion, mensaje: 'Procesa sol-002', ctx, opciones });
    expect(r.reply).toBe('sol-002 bloqueada por RC1.');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ nombre: 'oc_validar', args: { caso: 'sol-002' }, ok: true });
    expect(r.needsConfirmation).toBe(false);
    // El modelo recibe el prompt de sistema y el resultado de la herramienta
    expect(recibidos[0]![0]).toMatchObject({ rol: 'sistema', texto: 'prompt de prueba' });
    expect(recibidos[1]!.at(-1)).toMatchObject({ rol: 'herramienta' });
    // CA4: la llamada queda en out/log.jsonl
    expect(leerSalida(ctx, 'log.jsonl')).toContain('oc_validar');
  });

  it('CA1: respeta el tope de iteraciones y dice lo que falta', async () => {
    const ctx = proyectoTemporal();
    const guion = Array.from({ length: 10 }, (_, i) => llamada('oc_leer_paquete', { caso: 'sol-001' }, `t${i}`));
    const { adaptador } = llmFalso(guion);
    const r = await ejecutarTurno({ llm: adaptador, sesion: crearSesion('s-2'), mensaje: 'x', ctx, opciones: { ...opciones, topeIteraciones: 3 } });
    expect(r.toolCalls).toHaveLength(3);
    expect(r.reply).toMatch(/tope/i);
  });

  it('valida los argumentos con zod antes de ejecutar y devuelve el error al modelo', async () => {
    const ctx = proyectoTemporal();
    const { adaptador, recibidos } = llmFalso([llamada('oc_validar', { caso: 42 }), texto('Corrijo.')]);
    const r = await ejecutarTurno({ llm: adaptador, sesion: crearSesion('s-3'), mensaje: 'x', ctx, opciones });
    expect(r.toolCalls[0]!.ok).toBe(false);
    expect(JSON.stringify(recibidos[1]!.at(-1))).toMatch(/caso/);
  });

  it('herramienta desconocida no rompe la sesión', async () => {
    const ctx = proyectoTemporal();
    const { adaptador } = llmFalso([llamada('borrar_todo', {}), texto('No existe.')]);
    const r = await ejecutarTurno({ llm: adaptador, sesion: crearSesion('s-4'), mensaje: 'x', ctx, opciones });
    expect(r.toolCalls[0]!.ok).toBe(false);
    expect(r.reply).toBe('No existe.');
  });

  it('CA3: el modelo no puede confirmar por su cuenta en el mismo turno', async () => {
    const ctx = proyectoTemporal();
    const { adaptador } = llmFalso([
      llamada('oc_crear', { caso: 'sol-004', payload: {}, confirmado: true }),
      texto('¿Confirmas la creación de la OC de sol-004?'),
    ]);
    const r = await ejecutarTurno({ llm: adaptador, sesion: crearSesion('s-5'), mensaje: 'Procesa sol-004 y créala', ctx, opciones });
    expect(r.toolCalls[0]!.ok).toBe(false);
    expect(r.toolCalls[0]!.resumen).toMatch(/confirmaci/i);
    expect(existeSalida(ctx, 'sap', 'ordenes.jsonl')).toBe(false);
  });

  it('CA3: pide confirmación, resalta el estado y crea solo tras "confirmo"', async () => {
    const ctx = proyectoTemporal();
    const { adaptador: llmPayload } = llmFalso([llamada('oc_construir_payload', { caso: 'sol-004' }), texto('ok')]);
    const sesion = crearSesion('s-6');
    const t0 = await ejecutarTurno({ llm: llmPayload, sesion, mensaje: 'arma el payload de sol-004', ctx, opciones });
    const payload = (JSON.parse(t0.toolCalls[0]!.resultado) as { data: { payload: unknown } }).data.payload;

    const { adaptador: llm1 } = llmFalso([llamada('oc_crear', { caso: 'sol-004', payload }), texto('Requiere confirmación RC5. ¿Confirmas?')]);
    const t1 = await ejecutarTurno({ llm: llm1, sesion, mensaje: 'crea la OC de sol-004', ctx, opciones });
    expect(t1.needsConfirmation).toBe(true);
    expect(t1.pendiente?.caso).toBe('sol-004');

    const { adaptador: llm2 } = llmFalso([llamada('oc_crear', { caso: 'sol-004', payload, confirmado: true }), texto('OC 4500000001 creada.')]);
    const t2 = await ejecutarTurno({ llm: llm2, sesion, mensaje: 'Confirmo', ctx, opciones });
    expect(t2.toolCalls[0]!.ok).toBe(true);
    expect(t2.needsConfirmation).toBe(false);
    expect(leerSalida(ctx, 'sap', 'ordenes.jsonl')).toContain('4500000001');
  });

  it('CA5: un error del proveedor LLM se informa y la sesión sigue viva', async () => {
    const ctx = proyectoTemporal();
    const sesion = crearSesion('s-7');
    const { adaptador } = llmFalso([new Error('timeout'), texto('Hola de nuevo.')]);
    const r1 = await ejecutarTurno({ llm: adaptador, sesion, mensaje: 'hola', ctx, opciones });
    expect(r1.reply).toMatch(/no fue posible/i);
    expect(r1.reply).not.toContain('timeout');
    const r2 = await ejecutarTurno({ llm: adaptador, sesion, mensaje: 'hola', ctx, opciones });
    expect(r2.reply).toBe('Hola de nuevo.');
  });

  it('corta por tope de tokens de la sesión sin llamar al modelo', async () => {
    const ctx = proyectoTemporal();
    const sesion = crearSesion('s-8');
    sesion.tokensUsados = 200_000;
    const { adaptador, recibidos } = llmFalso([texto('no debería')]);
    const r = await ejecutarTurno({ llm: adaptador, sesion, mensaje: 'hola', ctx, opciones });
    expect(recibidos).toHaveLength(0);
    expect(r.reply).toMatch(/límite/i);
  });

  it('el historial visible conserva mensajes y llamadas a herramientas', async () => {
    const ctx = proyectoTemporal();
    const sesion = crearSesion('s-9');
    const { adaptador } = llmFalso([llamada('oc_validar', { caso: 'sol-001' }), texto('Apta.')]);
    await ejecutarTurno({ llm: adaptador, sesion, mensaje: 'valida sol-001', ctx, opciones });
    expect(sesion.historial.map((h) => h.tipo)).toEqual(['usuario', 'asistente']);
    expect(sesion.historial[1]!.toolCalls).toHaveLength(1);
  });
});

describe('Detección de confirmación', () => {
  it.each(['Confirmo', 'sí, confirmo', 'Si', 'confirmado, procede', 'OK, adelante'])('"%s" confirma', (t) => {
    expect(esConfirmacion(t)).toBe(true);
  });
  it.each(['no confirmo', 'No', 'espera, revisa la cotización', '¿qué falta?'])('"%s" no confirma', (t) => {
    expect(esConfirmacion(t)).toBe(false);
  });
  it('detecta rechazos explícitos', () => {
    expect(esRechazo('No confirmo')).toBe(true);
    expect(esRechazo('confirmo')).toBe(false);
  });
});

describe('Prompt y conocimiento (PRD §6.5)', () => {
  it('carga agent/prompt.md con la sección de Alcance y el conocimiento de src/knowledge', () => {
    const p = cargarPrompt();
    expect(p).toMatch(/# Alcance/);
    expect(p).toMatch(/oc_crear/);
    expect(p).toMatch(/Conocimiento del proceso/);
  });
});
