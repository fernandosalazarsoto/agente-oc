import { z } from 'zod';

/**
 * Configuración leída del entorno y validada con zod.
 * Los secretos solo existen en el servidor; nunca se envían al cliente ni a los logs.
 */
const entero = (porDefecto: number) => z.coerce.number().int().positive().default(porDefecto);

const esquemaConfig = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Opcional: gateway o proxy compatible con la Messages API (también usado en pruebas E2E locales).
  ANTHROPIC_BASE_URL: z.url().optional(),
  // Sonnet por defecto: más robusto siguiendo el flujo de herramientas.
  AGENT_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  DATASET: z.string().min(1).default('reto-03'),
  // Topes de costo (PRD §8): iteraciones por turno, tokens por sesión, salida por paso y timeout.
  AGENT_MAX_ITERACIONES: entero(12),
  AGENT_MAX_TOKENS_SESION: entero(300_000),
  AGENT_MAX_TOKENS_SALIDA: entero(1_500),
  LLM_TIMEOUT_MS: entero(25_000),
  APP_ACCESS_USER: z.string().min(1).default('evaluador'),
  APP_ACCESS_PASSWORD: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof esquemaConfig>;

/** Convierte cadenas vacías en undefined para que los opcionales funcionen con .env vacíos. */
function limpiarEntorno(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));
}

export function leerConfig(env: Record<string, string | undefined> = process.env): Config {
  return esquemaConfig.parse(limpiarEntorno(env));
}

/** Problemas de configuración que impiden atender el chat (sin exponer valores). */
export function diagnosticoConfig(config: Config): string[] {
  return config.ANTHROPIC_API_KEY ? [] : ['ANTHROPIC_API_KEY no configurada'];
}
