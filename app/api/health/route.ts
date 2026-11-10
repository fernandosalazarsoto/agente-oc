import { listarCasos } from '@/src/data/repositorio';
import { cargarPrompt } from '@/src/agent/agente';
import { diagnosticoConfig, leerConfig } from '@/src/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Smoke test del despliegue. Solo expone booleanos y conteos, nunca valores de
 * configuración ni secretos.
 */
export async function GET() {
  const config = leerConfig();
  let casos = 0;
  let promptCargado = false;
  try {
    casos = (await listarCasos(config.DATASET)).length;
  } catch {
    casos = -1;
  }
  try {
    promptCargado = cargarPrompt().length > 0;
  } catch {
    promptCargado = false;
  }
  const problemas = diagnosticoConfig(config);
  return Response.json({
    ok: problemas.length === 0 && casos > 0 && promptCargado,
    modelo: config.AGENT_MODEL,
    claveLlmConfigurada: Boolean(config.ANTHROPIC_API_KEY),
    firmaAprobacionesConfigurada: Boolean(config.TOOL_APPROVAL_SECRET),
    accesoProtegido: Boolean(config.APP_ACCESS_PASSWORD),
    casosDisponibles: casos,
    promptCargado,
  });
}
