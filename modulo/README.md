# Módulo reutilizable · agente de órdenes de compra

Empaqueta el agente para plataformas de agentes que cargan un agente en Markdown, herramientas TypeScript y skills, sin depender del servidor de esta aplicación (PRD §9.4).

| Pieza | Fuente única en la aplicación | Cómo se mantiene igual |
|---|---|---|
| `agent.md` (system prompt) | `agent/prompt.md` | Generado con `npm run modulo`; `tests/extras.test.ts` falla si diverge |
| `skill/ordenes-compra/SKILL.md` (conocimiento) | `src/knowledge/ordenes-compra.md` | Ídem |
| `tools/oc.ts` (herramientas zod) | `src/tools/oc.ts` | Reexporta los mismos objetos; el test verifica identidad |

Requisitos de uso: ejecutar en la raíz de un proyecto con `fixtures/reto-03/` (las herramientas resuelven rutas desde `ctx.directory`) y escritura en `out/`.

Limitación: en la aplicación, la confirmación humana (CA3) la verifica el servidor antes de ejecutar `oc_crear` con `confirmado=true`. En otra plataforma, esa garantía debe darla su mecanismo de permisos (por ejemplo, pedir aprobación para `oc_crear`).
