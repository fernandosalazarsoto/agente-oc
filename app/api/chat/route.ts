import { createAgentUIStreamResponse } from 'ai';
import { z } from 'zod';
import { crearAgenteDesdeEntorno } from '@/src/agent/runtime';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { recortarHistorial } from '@/src/lib/historial';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Controles de consumo de la API del LLM (por instancia del servidor).
const limitePorIp = new LimitePeticiones(10, 60_000);
const limiteGlobal = new LimitePeticiones(120, 60 * 60_000);
const MAX_MENSAJES_AL_MODELO = 12;

// Validación superficial del cuerpo: el SDK revalida la estructura de los mensajes.
const esquemaCuerpo = z.object({
  messages: z.array(z.unknown()).min(1).max(80),
});

const MAX_BYTES = 512 * 1024;

function json(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!limitePorIp.permitir(ip)) return json(429, 'Demasiadas solicitudes. Intente en un minuto.');
  if (!limiteGlobal.permitir('global')) return json(429, 'Capacidad horaria agotada. Intente más tarde.');

  const config = leerConfig();
  const problemas = diagnosticoConfig(config);
  if (problemas.length > 0) {
    console.error('[chat] Configuración incompleta:', problemas.join('; '));
    return json(503, 'Servicio no configurado. Contacte al administrador.');
  }

  const texto = await req.text();
  if (texto.length > MAX_BYTES) return json(413, 'Solicitud demasiado grande');

  let cuerpo: z.infer<typeof esquemaCuerpo>;
  try {
    cuerpo = esquemaCuerpo.parse(JSON.parse(texto));
  } catch {
    return json(400, 'Solicitud inválida');
  }

  return createAgentUIStreamResponse({
    agent: crearAgenteDesdeEntorno(config),
    uiMessages: recortarHistorial(cuerpo.messages, MAX_MENSAJES_AL_MODELO),
    // Registro de consumo por paso (solo conteos, sin contenido) para vigilar el gasto.
    onStepEnd: ({ usage }) => {
      console.info(
        `[chat] modelo=${config.AGENT_MODEL} tokens_entrada=${usage.inputTokens ?? 0} tokens_salida=${usage.outputTokens ?? 0}`,
      );
    },
    // No se exponen detalles internos ni del proveedor al cliente.
    onError: (error) => {
      console.error('[chat] Error del agente:', error);
      return 'Ocurrió un error procesando la solicitud. Intente nuevamente.';
    },
  });
}
