import { createAgentUIStreamResponse } from 'ai';
import { z } from 'zod';
import { crearAgenteDesdeEntorno } from '@/src/agent/runtime';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';

export const runtime = 'nodejs';
export const maxDuration = 60;

const limite = new LimitePeticiones(30, 60_000);

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
  if (!limite.permitir(ip)) return json(429, 'Demasiadas solicitudes. Intente en un minuto.');

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
    uiMessages: cuerpo.messages,
    // No se exponen detalles internos ni del proveedor al cliente.
    onError: (error) => {
      console.error('[chat] Error del agente:', error);
      return 'Ocurrió un error procesando la solicitud. Intente nuevamente.';
    },
  });
}
