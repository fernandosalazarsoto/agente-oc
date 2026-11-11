import { type AdaptadorLLM, type DefinicionHerramienta, ErrorLLM, type MensajeLLM, type RespuestaLLM } from './adapter';

/**
 * Implementación del adaptador para la API Messages de Anthropic (fetch directo, sin SDK).
 * - La clave solo vive en el servidor y nunca se registra.
 * - Timeout por llamada con mensaje claro (PRD §8 Robustez).
 * - Prompt caching del system prompt y de las herramientas para bajar costo por caso.
 */

type Bloque =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type MensajeAnthropic = { role: 'user' | 'assistant'; content: Bloque[] };

interface RespuestaApi {
  content: Bloque[];
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

export interface OpcionesAnthropic {
  maxTokensSalida: number;
  timeoutMs: number;
  url?: string;
}

/** Convierte los mensajes neutrales al formato de la API, fusionando turnos consecutivos del mismo rol. */
export function aMensajesAnthropic(mensajes: MensajeLLM[]): MensajeAnthropic[] {
  const salida: MensajeAnthropic[] = [];
  const agregar = (role: 'user' | 'assistant', content: Bloque[]) => {
    const ultimo = salida.at(-1);
    if (ultimo && ultimo.role === role) ultimo.content.push(...content);
    else salida.push({ role, content: [...content] });
  };
  for (const m of mensajes) {
    if (m.rol === 'sistema') continue;
    if (m.rol === 'usuario') agregar('user', [{ type: 'text', text: m.texto || '(mensaje vacío)' }]);
    if (m.rol === 'asistente') {
      const bloques: Bloque[] = [];
      if (m.texto.trim()) bloques.push({ type: 'text', text: m.texto });
      for (const l of m.llamadas) bloques.push({ type: 'tool_use', id: l.id, name: l.nombre, input: l.args });
      agregar('assistant', bloques.length ? bloques : [{ type: 'text', text: '(sin texto)' }]);
    }
    if (m.rol === 'herramienta') {
      agregar('user', m.resultados.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.resultado, ...(r.error ? { is_error: true } : {}) })));
    }
  }
  return salida;
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly proveedor = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly modelo: string,
    private readonly opciones: OpcionesAnthropic,
  ) {}

  async enviar(mensajes: MensajeLLM[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const sistema = mensajes.filter((m) => m.rol === 'sistema').map((m) => m.texto).join('\n\n');
    const cuerpo = {
      model: this.modelo,
      max_tokens: this.opciones.maxTokensSalida,
      system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
      messages: aMensajesAnthropic(mensajes),
      tools: herramientas.map((h, i) => ({
        name: h.nombre,
        description: h.descripcion,
        input_schema: h.esquema,
        ...(i === herramientas.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
    };

    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), this.opciones.timeoutMs);
    let respuesta: Response;
    try {
      respuesta = await fetch(this.opciones.url ?? 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
    } catch (error) {
      const timeout = control.signal.aborted;
      throw new ErrorLLM(timeout ? 'El modelo no respondió a tiempo' : 'No hubo conexión con el proveedor del modelo', String(error));
    } finally {
      clearTimeout(temporizador);
    }

    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).slice(0, 500);
      throw new ErrorLLM(`El proveedor del modelo respondió HTTP ${respuesta.status}`, detalle);
    }
    const datos = (await respuesta.json()) as RespuestaApi;
    const u = datos.usage;
    return {
      texto: datos.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim(),
      llamadas: datos.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, nombre: b.name, args: b.input ?? {} }] : [])),
      uso: {
        entrada: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        salida: u.output_tokens,
      },
    };
  }
}
