import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ToolLoopAgent, isStepCount, type LanguageModel } from 'ai';
import { crearToolsOC, type DependenciasOC } from '../tools/oc';

/** Herramientas que siempre requieren confirmación humana antes de ejecutarse. */
export const TOOLS_CON_APROBACION = ['crear_orden_compra'] as const;

/** Límites de consumo del modelo por turno de conversación. */
export const LIMITES_AGENTE = {
  pasosPorTurno: 6,
  tokensSalidaPorPaso: 800,
} as const;

/** System prompt versionado en agent/prompt.md (ruta estática para el bundler). */
export function cargarPrompt(): string {
  return readFileSync(path.join(process.cwd(), 'agent', 'prompt.md'), 'utf8');
}

export interface OpcionesAgente extends DependenciasOC {
  model: LanguageModel;
  /** Secreto HMAC: firma cada solicitud de aprobación y rechaza aprobaciones forjadas. */
  approvalSecret?: string;
  instrucciones?: string;
}

export function crearAgente({ model, approvalSecret, instrucciones, ...deps }: OpcionesAgente) {
  return new ToolLoopAgent({
    model,
    instructions: instrucciones ?? cargarPrompt(),
    tools: crearToolsOC(deps),
    // La aprobación humana se aplica en el servidor, no depende del prompt.
    toolApproval: { crear_orden_compra: 'user-approval' },
    experimental_toolApprovalSecret: approvalSecret,
    // Topes de costo: pocos pasos por turno y salidas cortas (la UI ya muestra la matriz).
    stopWhen: isStepCount(LIMITES_AGENTE.pasosPorTurno),
    maxOutputTokens: LIMITES_AGENTE.tokensSalidaPorPaso,
    temperature: 0,
  });
}

export type AgenteOC = ReturnType<typeof crearAgente>;
