# Agente de órdenes de compra

Agente conversacional en TypeScript que lee solicitudes de compra, valida controles de forma determinista y crea órdenes de compra en un SAP simulado, con confirmación humana obligatoria.

> **Base técnica:** el chat, el despliegue, el motor genérico de controles, la seguridad perimetral y la CI se prepararon antes de la prueba. Las especificaciones, los controles de negocio, las herramientas específicas y sus pruebas se desarrollaron durante la prueba. Ver `specs/supuestos.md`.

## Requisitos

- Node.js 20 o superior
- Clave de API de Anthropic (solo para el chat; tests y demo no la usan)

## Inicio rápido

```bash
npm install
cp .env.example .env.local    # completar ANTHROPIC_API_KEY y TOOL_APPROVAL_SECRET
npm run verify                # typecheck + tests + demo sin LLM
npm run dev                   # http://localhost:3000
```

## Comandos

| Comando | Qué hace |
|---------|----------|
| `npm test` | Pruebas automatizadas (Vitest) |
| `npm run demo` | Procesa todos los casos llamando a las herramientas, sin LLM, y compara con lo esperado |
| `npm run verify` | Typecheck + tests + demo |
| `npm run build` | Build de producción |

Para otro set de datos: `DATASET=reto-03 npm run demo` (carpeta `fixtures/reto-03/`, resultados esperados en `specs/esperados/reto-03.json`).

## Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `ANTHROPIC_API_KEY` | Sí (chat) | Clave del proveedor LLM. Solo servidor |
| `TOOL_APPROVAL_SECRET` | Sí en producción | Secreto HMAC (≥ 32 caracteres) para firmar aprobaciones. `openssl rand -base64 32` |
| `AGENT_MODEL` | No | Modelo del agente. Por defecto `claude-sonnet-5-5` |
| `DATASET` | No | Set de datos dentro de `fixtures/`. Por defecto `ejemplo` |
| `APP_ACCESS_PASSWORD` | No | Si se define, la URL exige Basic Auth |
| `APP_ACCESS_USER` | No | Usuario de Basic Auth. Por defecto `evaluador` |

## Despliegue (Vercel)

1. Importar el repositorio en Vercel (framework Next.js detectado automáticamente).
2. Configurar las variables de entorno anteriores en *Settings → Environment Variables*.
3. Desplegar y verificar `GET /api/health`: debe responder `"ok": true`.

## Estructura

```
agent/prompt.md            System prompt
app/                       UI de chat y rutas API (chat, health)
src/agent/                 Agente (ciclo, política de aprobación) y composición
src/tools/oc.ts            Herramientas tipadas con zod
src/domain/                Motor de controles y reglas (puro, determinista)
src/data/                  Lectura aislada de maestros y casos
src/adapters/sap/          Puerto SAP y mock idempotente
fixtures/<dataset>/        Maestros y solicitudes
specs/                     Especificación (SDD): controles, esperados, supuestos
tests/                     Pruebas automatizadas
demo.ts                    Verificación sin LLM
SOLUCION.md                Documentación técnica
```
