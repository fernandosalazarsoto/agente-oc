import { cargarPrompt } from '@/src/agent/prompt';
import { diagnosticoConfig, leerConfig } from '@/src/config';
import { listarCasos } from '@/src/data/repositorio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health → { ok, provider, model } (PRD §6.4). Sin claves ni valores de configuración:
 * solo booleanos y conteos para el smoke test del despliegue.
 */
export async function GET() {
  const config = leerConfig();
  let casos = 0;
  let promptCargado = false;
  try {
    casos = (await listarCasos(process.cwd(), config.DATASET)).length;
  } catch {
    casos = -1;
  }
  try {
    promptCargado = cargarPrompt().length > 0;
  } catch {
    promptCargado = false;
  }
  return Response.json({
    ok: diagnosticoConfig(config).length === 0 && casos > 0 && promptCargado,
    provider: 'anthropic',
    model: config.AGENT_MODEL,
    dataset: config.DATASET,
    casosDisponibles: casos,
    promptCargado,
    claveConfigurada: Boolean(config.ANTHROPIC_API_KEY),
    accesoProtegido: Boolean(config.APP_ACCESS_PASSWORD),
  });
}
