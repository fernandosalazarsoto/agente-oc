/**
 * Interfaz propia del proveedor LLM (PRD §6.1): enviar(mensajes, herramientas) → respuesta.
 * El ciclo del agente solo conoce estos tipos; cambiar de proveedor es escribir otra
 * implementación (src/llm/<proveedor>.ts) sin tocar src/agent/ciclo.ts.
 */

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  args: Record<string, unknown>;
}

export type MensajeLLM =
  | { rol: 'sistema'; texto: string }
  | { rol: 'usuario'; texto: string }
  | { rol: 'asistente'; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: 'herramienta'; resultados: Array<{ id: string; nombre: string; resultado: string; error: boolean }> };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos (generado desde zod). */
  esquema: Record<string, unknown>;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
  uso: { entrada: number; salida: number };
}

export interface AdaptadorLLM {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(mensajes: MensajeLLM[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}

/** Error del proveedor con detalle solo para logs del servidor (nunca al cliente). */
export class ErrorLLM extends Error {
  constructor(message: string, readonly detalle?: string) {
    super(message);
    this.name = 'ErrorLLM';
  }
}
