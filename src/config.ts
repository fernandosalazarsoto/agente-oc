import { z } from 'zod';

/**
 * Configuración leída del entorno y validada con zod.
 * Los secretos solo existen en el servidor; nunca se envían al cliente.
 */
const esquemaConfig = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Sonnet por defecto: más robusto siguiendo el flujo de herramientas sin afinar el prompt.
  AGENT_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  TOOL_APPROVAL_SECRET: z.string().min(32).optional(),
  DATASET: z.string().min(1).default('ejemplo'),
  APP_ACCESS_USER: z.string().min(1).default('evaluador'),
  APP_ACCESS_PASSWORD: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof esquemaConfig>;

/** Convierte cadenas vacías en undefined para que los opcionales funcionen con .env vacíos. */
function limpiarEntorno(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
}

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return esquemaConfig.parse(limpiarEntorno(env));
}

/** Problemas de configuración que impiden atender el chat (sin exponer valores). */
export function diagnosticoConfig(config: Config): string[] {
  const problemas: string[] = [];
  if (!config.ANTHROPIC_API_KEY) problemas.push('ANTHROPIC_API_KEY no configurada');
  if (config.NODE_ENV === 'production' && !config.TOOL_APPROVAL_SECRET) {
    problemas.push('TOOL_APPROVAL_SECRET no configurado (obligatorio en producción)');
  }
  return problemas;
}
