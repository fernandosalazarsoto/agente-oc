import { z } from 'zod';
import { secretoSesion } from '@/src/agent/estado';
import { cargarPrompt } from '@/src/agent/prompt';
import { atenderChat } from '@/src/agent/servicio';
import { almacenSesiones, idSesionValido } from '@/src/agent/sesiones';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { LimitePeticiones } from '@/src/lib/limite-peticiones';
import { directorioSalida } from '@/src/lib/salidas';
import { AdaptadorAnthropic } from '@/src/llm/anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Controles de consumo de la API del LLM (por instancia del servidor).
const limitePorIp = new LimitePeticiones(10, 60_000);
const limiteGlobal = new LimitePeticiones(120, 60 * 60_000);

const esquemaCuerpo = z.object({
  sessionId: z.string().refine(idSesionValido, 'sessionId inválido'),
  message: z.string().trim().min(1).max(2_000),
  // Estado firmado devuelto en el turno anterior (continuidad entre instancias serverless).
  estado: z.string().max(1_500_000).optional(),
});

const error = (status: number, mensaje: string) => Response.json({ error: mensaje }, { status });

/**
 * POST /api/chat { sessionId, message, estado? } → { reply, toolCalls[], needsConfirmation, pendiente, estado }
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!limitePorIp.permitir(ip)) return error(429, 'Demasiadas solicitudes. Intente en un minuto.');
  if (!limiteGlobal.permitir('global')) return error(429, 'Capacidad horaria agotada. Intente más tarde.');

  const config = leerConfig();
  const problemas = diagnosticoConfig(config);
  if (problemas.length > 0) {
    console.error('[chat] Configuración incompleta:', problemas.join('; '));
    return error(503, 'Servicio no configurado. Contacte al administrador.');
  }

  let cuerpo: z.infer<typeof esquemaCuerpo>;
  try {
    const texto = await req.text();
    if (texto.length > 2_000_000) return error(413, 'Solicitud demasiado grande');
    cuerpo = esquemaCuerpo.parse(JSON.parse(texto));
  } catch {
    return error(400, 'Solicitud inválida: se espera { sessionId, message, estado? }');
  }

  const raiz = process.cwd();
  try {
    const resultado = await atenderChat(cuerpo, {
      raiz,
      dirSalida: directorioSalida(raiz),
      llm: new AdaptadorAnthropic(config.ANTHROPIC_API_KEY!, config.AGENT_MODEL, {
        maxTokensSalida: config.AGENT_MAX_TOKENS_SALIDA,
        timeoutMs: config.LLM_TIMEOUT_MS,
        ...(config.ANTHROPIC_BASE_URL ? { url: `${config.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages` } : {}),
      }),
      secreto: secretoSesion(),
      sesiones: almacenSesiones,
      opciones: {
        topeIteraciones: config.AGENT_MAX_ITERACIONES,
        topeTokensSesion: config.AGENT_MAX_TOKENS_SESION,
        sistema: cargarPrompt(raiz),
        presupuestoMs: 30_000, // 30 s + timeout de 25 s por llamada < maxDuration de 60 s
      },
    });
    return Response.json(resultado);
  } catch (e) {
    console.error('[chat] Error no controlado:', e);
    return Response.json({
      reply: 'Ocurrió un error interno procesando el mensaje. La sesión sigue activa: intenta de nuevo.',
      toolCalls: [],
      needsConfirmation: false,
      pendiente: null,
    });
  }
}
