import { createAnthropic } from '@ai-sdk/anthropic';
import { SapMock } from '../adapters/sap/mock';
import { type Config, leerConfig } from '../config';
import { crearAgente } from './agente';

/**
 * Composición de dependencias para el servidor (composition root).
 * El SAP simulado es único por instancia del servidor.
 */
const sap = new SapMock();

export function crearAgenteDesdeEntorno(config: Config = leerConfig()) {
  const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return crearAgente({
    model: anthropic(config.AGENT_MODEL),
    approvalSecret: config.TOOL_APPROVAL_SECRET,
    dataset: config.DATASET,
    sap,
  });
}
