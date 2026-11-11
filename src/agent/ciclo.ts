/**
 * Ciclo del agente (PRD §6.3): prompt → modelo → herramientas → respuesta.
 * - CA1: tope de iteraciones y de tiempo por turno; al alcanzarlo responde con lo hecho y lo que falta.
 * - CA2: los valores salen de las herramientas; el modelo no recibe datos por otra vía.
 * - CA3: confirmación humana verificada en el servidor. oc_crear con confirmado=true solo se
 *   ejecuta si el mensaje de la usuaria de ESTE turno confirma el caso pendiente.
 * - CA4: cada llamada queda en el historial visible y en out/log.jsonl (lo escribe la herramienta).
 * - CA5: un error del proveedor se informa en lenguaje claro y la sesión sigue viva.
 * No conoce al proveedor: solo la interfaz AdaptadorLLM.
 */
import { z } from 'zod';
import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, MensajeLLM } from '../llm/adapter';
import { ErrorLLM } from '../llm/adapter';
import { type ContextoHerramienta, type NombreHerramienta, herramientasOC, nombreParaModelo } from '../tools/oc';
import { ahoraBogota, anexarLinea, salidaDe } from '../lib/salidas';
import { casosMencionados, esConfirmacion, esRechazo } from './confirmacion';

export interface LlamadaVisible {
  id: string;
  nombre: string;
  args: Record<string, unknown>;
  ok: boolean;
  resumen: string;
  /** Resultado completo (string JSON) tal como lo recibió el modelo. */
  resultado: string;
}

export interface Pendiente {
  caso: string;
  confirmaciones: Array<{ codigo: string; detalle: string }>;
  propuesta: unknown | null;
}

export interface EventoHistorial {
  tipo: 'usuario' | 'asistente';
  texto: string;
  ts: string;
  toolCalls?: LlamadaVisible[];
  needsConfirmation?: boolean;
}

export interface Sesion {
  id: string;
  mensajes: MensajeLLM[];
  historial: EventoHistorial[];
  pendiente: Pendiente | null;
  tokensUsados: number;
}

export interface OpcionesCiclo {
  topeIteraciones: number;
  topeTokensSesion: number;
  sistema: string;
  /** Mensajes de la conversación enviados al modelo (ventana). */
  maxMensajesModelo?: number;
  /** Presupuesto de tiempo por turno en ms (serverless). */
  presupuestoMs?: number;
}

export interface ResultadoTurno {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
  pendiente: Pendiente | null;
}

export function crearSesion(id: string): Sesion {
  return { id, mensajes: [], historial: [], pendiente: null, tokensUsados: 0 };
}

/** Definiciones para el modelo: oc_<export> con JSON Schema generado desde zod. */
export function definicionesHerramientas(): DefinicionHerramienta[] {
  return Object.entries(herramientasOC).map(([nombre, h]) => {
    const { $schema: _omitido, ...esquema } = z.toJSONSchema(z.object(h.args), { io: 'input' }) as Record<string, unknown>;
    return { nombre: nombreParaModelo(nombre), descripcion: h.description, esquema };
  });
}

const herramientaPorNombre = new Map(
  Object.entries(herramientasOC).map(([nombre, h]) => [nombreParaModelo(nombre), h] as const),
);

/** Ventana de mensajes para el modelo, empezando siempre en un mensaje de la usuaria. */
function ventana(mensajes: MensajeLLM[], max: number): MensajeLLM[] {
  if (mensajes.length <= max) return mensajes;
  let inicio = mensajes.length - max;
  while (inicio < mensajes.length && mensajes[inicio]!.rol !== 'usuario') inicio++;
  return inicio < mensajes.length ? mensajes.slice(inicio) : mensajes.slice(-1);
}

type ResultadoJson = { ok: boolean; data?: Record<string, unknown>; error?: string; requiere_confirmacion?: boolean; confirmaciones?: Pendiente['confirmaciones'] };

function resumir(nombre: string, r: ResultadoJson): string {
  if (!r.ok) return r.error ?? 'Error';
  const d = r.data ?? {};
  const cods = (x: unknown) => (Array.isArray(x) && x.length ? x.map((i: { codigo: string }) => i.codigo).join(', ') : 'ninguna');
  switch (nombre) {
    case 'oc_validar':
      return `apta=${String(d.apta)} · bloqueos: ${cods(d.bloqueos)} · confirmaciones: ${cods(d.confirmaciones)} · retroactiva=${String(d.retroactiva)}`;
    case 'oc_crear':
      return `OC ${String(d.numero_oc)}${d.idempotente ? ' (ya existía, idempotente)' : ' creada'} · ${String(d.fecha)}`;
    case 'oc_construir_payload': {
      const s = d.resumen as { proveedor: string; total: number; moneda: string } | undefined;
      return s ? `${s.proveedor} · ${s.moneda} ${s.total.toLocaleString('es-CO')} · ${String(d.ruta_trazabilidad)}` : 'Payload construido';
    }
    case 'oc_generar_evidencia':
      return `${String(d.ruta)} · sha256 ${String(d.sha256).slice(0, 12)}…`;
    case 'oc_leer_paquete': {
      const f = d.faltantes as string[] | undefined;
      return `Paquete leído${f?.length ? ` · faltan: ${f.join(', ')}` : ' · completo'}${d.factura ? ' · con factura' : ''}`;
    }
    case 'oc_listar_casos':
      return `Casos: ${(d.casos as string[] | undefined)?.join(', ') ?? ''}`;
    default:
      return 'OK';
  }
}

/** Actualiza la confirmación pendiente según el resultado de una herramienta. */
function actualizarPendiente(sesion: Sesion, nombre: string, args: Record<string, unknown>, r: ResultadoJson) {
  const caso = typeof args.caso === 'string' ? args.caso : null;
  if (!caso) return;
  const d = r.data ?? {};
  const mismo = sesion.pendiente?.caso === caso;
  if (nombre === 'oc_validar' && r.ok) {
    const conf = d.confirmaciones as Pendiente['confirmaciones'];
    if (d.apta === true && conf.length > 0) {
      sesion.pendiente = { caso, confirmaciones: conf.map(({ codigo, detalle }) => ({ codigo, detalle })), propuesta: mismo ? sesion.pendiente!.propuesta : null };
    } else if (mismo) sesion.pendiente = null;
  }
  if (nombre === 'oc_construir_payload' && r.ok && mismo) sesion.pendiente!.propuesta = d.payload ?? null;
  if (nombre === 'oc_crear') {
    if (r.ok && mismo) sesion.pendiente = null;
    if (!r.ok && r.requiere_confirmacion) {
      sesion.pendiente = {
        caso,
        confirmaciones: (r.confirmaciones ?? []).map(({ codigo, detalle }) => ({ codigo, detalle })),
        propuesta: args.payload ?? (mismo ? sesion.pendiente!.propuesta : null),
      };
    }
  }
}

export async function ejecutarTurno(params: {
  llm: AdaptadorLLM;
  sesion: Sesion;
  mensaje: string;
  ctx: ContextoHerramienta;
  opciones: OpcionesCiclo;
}): Promise<ResultadoTurno> {
  const { llm, sesion, mensaje, ctx, opciones } = params;
  const ahora = () => new Date().toISOString();
  const toolCalls: LlamadaVisible[] = [];
  const responder = (reply: string): ResultadoTurno => {
    const needsConfirmation = sesion.pendiente !== null;
    sesion.historial.push({ tipo: 'asistente', texto: reply, ts: ahora(), toolCalls, needsConfirmation });
    return { reply, toolCalls, needsConfirmation, pendiente: sesion.pendiente };
  };
  sesion.historial.push({ tipo: 'usuario', texto: mensaje, ts: ahora() });

  if (sesion.tokensUsados >= opciones.topeTokensSesion) {
    return responder('Se alcanzó el límite de consumo de esta sesión. Inicia una sesión nueva para continuar.');
  }

  // CA3: ¿este mensaje confirma o rechaza el caso pendiente?
  let confirmado: string | null = null;
  let nota = '';
  const p = sesion.pendiente;
  if (p) {
    const otros = casosMencionados(mensaje).filter((c) => c !== p.caso);
    if (esConfirmacion(mensaje) && otros.length === 0) {
      confirmado = p.caso;
      nota = `[Nota del servidor: este mensaje CONFIRMA las excepciones del caso ${p.caso}. Puedes llamar oc_crear con confirmado=true solo para ${p.caso}.]`;
    } else if (esRechazo(mensaje)) {
      sesion.pendiente = null;
      nota = `[Nota del servidor: la usuaria NO confirmó el caso ${p.caso}. No crees esa OC; informa que queda sin crear.]`;
    } else {
      nota = `[Nota del servidor: hay una confirmación pendiente del caso ${p.caso} y este mensaje no la confirma. No llames oc_crear con confirmado=true.]`;
    }
  }

  const respaldo = sesion.mensajes.length;
  sesion.mensajes.push({ rol: 'usuario', texto: nota ? `${mensaje}\n\n${nota}` : mensaje });
  const ctxTurno: ContextoHerramienta = confirmado
    ? { ...ctx, confirmadoPor: `usuaria del chat (sesión ${sesion.id})` }
    : ctx;
  const definiciones = definicionesHerramientas();
  const inicio = Date.now();

  for (let i = 0; i < opciones.topeIteraciones; i++) {
    if (sesion.tokensUsados >= opciones.topeTokensSesion) {
      return responder('Se alcanzó el límite de consumo de esta sesión durante el turno. Lo ejecutado quedó registrado; inicia una sesión nueva para continuar.');
    }
    if (opciones.presupuestoMs && Date.now() - inicio > opciones.presupuestoMs) break;

    let respuesta;
    try {
      respuesta = await llm.enviar(
        [{ rol: 'sistema', texto: opciones.sistema }, ...ventana(sesion.mensajes, opciones.maxMensajesModelo ?? 30)],
        definiciones,
      );
    } catch (error) {
      console.error('[ciclo] Error del proveedor LLM:', error instanceof ErrorLLM ? `${error.message} ${error.detalle ?? ''}` : error);
      sesion.mensajes.length = respaldo; // la conversación queda consistente para reintentar
      const motivo = error instanceof ErrorLLM ? ` (${error.message})` : '';
      return responder(`No fue posible obtener respuesta del modelo en este momento${motivo}. La sesión sigue activa: intenta de nuevo.`);
    }
    sesion.tokensUsados += respuesta.uso.entrada + respuesta.uso.salida;
    console.info(`[ciclo] sesion=${sesion.id} paso=${i + 1} tokens_entrada=${respuesta.uso.entrada} tokens_salida=${respuesta.uso.salida}`);
    sesion.mensajes.push({ rol: 'asistente', texto: respuesta.texto, llamadas: respuesta.llamadas });

    if (respuesta.llamadas.length === 0) return responder(respuesta.texto || 'Sin respuesta del modelo.');

    const resultados: Array<{ id: string; nombre: string; resultado: string; error: boolean }> = [];
    for (const llamada of respuesta.llamadas) {
      const resultado = await ejecutarLlamada(llamada, confirmado, ctxTurno);
      const r = JSON.parse(resultado) as ResultadoJson;
      actualizarPendiente(sesion, llamada.nombre, llamada.args, r);
      toolCalls.push({ id: llamada.id, nombre: llamada.nombre, args: resumirArgs(llamada.args), ok: r.ok, resumen: resumir(llamada.nombre, r), resultado });
      resultados.push({ id: llamada.id, nombre: llamada.nombre, resultado, error: !r.ok });
    }
    sesion.mensajes.push({ rol: 'herramienta', resultados });
  }

  // CA1: tope alcanzado
  const hechas = toolCalls.map((t) => `${t.nombre}(${String(t.args.caso ?? '')})`).join(', ') || 'ninguna';
  return responder(
    `Alcancé el tope de ${opciones.topeIteraciones} iteraciones o de tiempo de este turno. Herramientas ejecutadas: ${hechas}. ` +
      'Falta completar el procesamiento: escribe "continúa" para seguir.',
  );
}

/** El payload completo no se repite en el historial visible: se resume. */
function resumirArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { payload, paquete, derivados, ...resto } = args;
  return {
    ...resto,
    ...(payload !== undefined ? { payload: '(payload de oc_construir_payload)' } : {}),
    ...(paquete !== undefined ? { paquete: '(paquete)' } : {}),
    ...(derivados !== undefined ? { derivados: '(derivados)' } : {}),
  };
}

async function rechazar(llamada: LlamadaHerramienta, ctx: ContextoHerramienta, error: string): Promise<string> {
  try {
    await anexarLinea(salidaDe(ctx), 'log.jsonl', JSON.stringify({
      ts: ahoraBogota(), sessionId: ctx.sessionId, herramienta: llamada.nombre, args: { caso: llamada.args.caso }, ok: false, error,
    }));
  } catch (e) {
    console.error('[ciclo] No se pudo escribir out/log.jsonl:', e);
  }
  return JSON.stringify({ ok: false, error });
}

async function ejecutarLlamada(llamada: LlamadaHerramienta, confirmado: string | null, ctx: ContextoHerramienta): Promise<string> {
  const h = herramientaPorNombre.get(llamada.nombre);
  if (!h) return rechazar(llamada, ctx, `La herramienta ${llamada.nombre} no existe`);

  // Guarda CA3 en el servidor: el modelo no puede autoconfirmar.
  if (llamada.nombre === nombreParaModelo('crear' satisfies NombreHerramienta) && llamada.args.confirmado === true && llamada.args.caso !== confirmado) {
    return rechazar(
      llamada,
      ctx,
      'Bloqueado por el servidor: confirmado=true exige que la usuaria confirme este caso en su mensaje. ' +
        'Termina el turno con una pregunta de confirmación explícita.',
    );
  }
  // execute valida los args con zod antes de ejecutar, registra en out/log.jsonl y nunca lanza.
  return h.execute(llamada.args, ctx);
}
