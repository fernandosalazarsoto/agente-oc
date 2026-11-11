# Agente de órdenes de compra SAP · Reto 03

Agente conversacional en TypeScript que lee el paquete de una solicitud de compra, lo valida contra los maestros (RC1-RC10), construye la OC con trazabilidad, genera la evidencia de aprobación y crea la OC en un SAP simulado, con confirmación humana para las excepciones. Planteamiento completo en [SOLUCION.md](SOLUCION.md).

> **Transparencia:** la base técnica (Next.js, despliegue, acceso básico, utilidades y CI) se preparó antes de la prueba. Las especificaciones, reglas, herramientas del contrato, ciclo del agente y tests de negocio se desarrollaron durante la prueba (ver `specs/supuestos.md`, S-01).

## Link de prueba

- **URL:** https://agente-oc.vercel.app
- **Acceso:** HTTP Basic (el navegador pide usuario y contraseña). Las credenciales están en este enlace de Password Pusher: https://eu.pwpush.com/p/saprcueokask_9zuwcq/r
- **Salud:** https://agente-oc.vercel.app/api/health (público, sin credenciales)

Cómo obtener las credenciales:

1. Abre el enlace. En el centro de la pantalla aparece un mensaje para continuar: haz clic en él.
2. Se muestra un campo para la palabra clave. Escribe `prueba llm periferia` tal cual: con un espacio entre palabras y sin espacios al inicio ni al final.
3. Las credenciales aparecen difuminadas. Usa la opción de copiar el mensaje y pégalo en un bloc de notas para leerlas.
4. Entra a la URL con ese usuario y esa contraseña. Ninguno de los dos tiene espacios al inicio ni al final.

Cada apertura del enlace cuenta como una vista y el enlace caduca. Si ya no está disponible, las credenciales van también en el correo de entrega.

Límites de uso (protegen la clave del modelo; detalle en el anexo de [SOLUCION.md](SOLUCION.md)):

- 10 mensajes por minuto por IP y 120 por hora.
- 1.000.000 de tokens por sesión, unos 12 casos. Al alcanzarlo, el chat pide iniciar otra con "Nueva sesión".
- Cada turno tiene un tope de 12 iteraciones y 30 segundos.

## Arranque local (un comando)

Requisitos: Node.js 20+ (o Bun). La clave del modelo solo se necesita para el chat; tests y demo no la usan.

```bash
npm install
cp .env.example .env.local     # completar ANTHROPIC_API_KEY
npm run dev                    # front + backend en http://localhost:3000
```

Con Bun: `bun install && bun run dev`.

## Verificación sin modelo (`demo.ts`)

```bash
npm run demo          # o: npx tsx demo.ts · bun run demo.ts
npm run verify        # typecheck + 114 tests + demo
```

`demo.ts` limpia `out/`, procesa los 6 casos llamando directamente a las herramientas zod, muestra la idempotencia (sol-001 dos veces) y la confirmación explícita (simulada) de sol-004, sol-005 y sol-006, y compara contra `specs/esperados/reto-03.json`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (chat) | Clave del proveedor. Solo servidor; nunca en el front, el repo ni los logs |
| `AGENT_MODEL` | No | Por defecto `claude-sonnet-5-5`; alternativa `claude-haiku-5-5` |
| `DATASET` | No | Carpeta en `fixtures/`. Por defecto `reto-03` |
| `AGENT_MAX_ITERACIONES` | No | Tope de iteraciones herramienta → modelo por turno. Por defecto 12 |
| `AGENT_MAX_TOKENS_SESION` | No | Tope de tokens por sesión (entrada más salida). Por defecto 1000000, unos 12 casos |
| `AGENT_MAX_TOKENS_SALIDA` | No | Tokens de salida por llamada. Por defecto 1500 |
| `LLM_TIMEOUT_MS` | No | Timeout por llamada al modelo. Por defecto 25000 (el turno tiene un presupuesto de 30 s para caber en los 60 s de la función) |
| `APP_ACCESS_PASSWORD` / `APP_ACCESS_USER` | No | Si se define la clave, la URL exige Basic Auth (usuario por defecto `evaluador`) |
| `OUT_DIR` | No | Carpeta de salida. Por defecto `out/` (en Vercel, `/tmp/out`) |
| `SESSION_SECRET` | No | Clave HMAC del estado de sesión (32+ caracteres). Si falta se usa `TOOL_APPROVAL_SECRET`; en local, una aleatoria por proceso |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message, estado? }` → `{ reply, toolCalls[], needsConfirmation, pendiente, estado }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (mensajes, llamadas a herramientas, pendiente) |
| `GET` | `/api/health` | `{ ok, provider, model, dataset, casosDisponibles, ... }` sin claves |

`toolCalls[]`: `{ id, nombre, args, ok, resumen, resultado }`. `sessionId`: 8 a 64 caracteres `[A-Za-z0-9_-]`.

## Herramientas (`src/tools/oc.ts`)

| Modelo | Entrada | Salida (`data`) |
|---|---|---|
| `oc_leer_paquete` | `{ caso }` | Paquete normalizado (PRD §7.2) + `faltantes` |
| `oc_validar` | `{ caso, paquete? }` | `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva, controles[] }` |
| `oc_construir_payload` | `{ caso, paquete?, derivados? }` | `{ payload: OrdenCompra, ruta_trazabilidad }` |
| `oc_generar_evidencia` | `{ caso }` | `{ ruta, sha256, ruta_pdf }` |
| `oc_crear` | `{ caso, payload, confirmado? }` | `{ numero_oc, fecha, idempotente }` o `{ ok: false, error }` |
| `oc_listar_casos` | `{}` | `{ casos[] }` |

## Salidas en `out/`

`sap/ordenes.jsonl` (SAP simulado) · `control.csv` (cada intento: `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`) · `log.jsonl` (cada llamada a herramienta) · `<caso>/trazabilidad.json` · `<caso>/aprobacion.txt` y `<caso>/aprobacion.pdf`.

`demo.ts` escribe en `out/`. En el chat, cada sesión tiene los mismos archivos en `out/sesiones/<id>/` (en Vercel, `/tmp/out/...`). Su estado viaja firmado (`estado`, HMAC con `SESSION_SECRET` o `TOOL_APPROVAL_SECRET`) para que cualquier instancia serverless continúe la sesión con la misma numeración.

## Estructura

```
agent/prompt.md                  comportamiento (system prompt)
src/knowledge/ordenes-compra.md  conocimiento del proceso
src/tools/oc.ts                  herramientas zod (ejecución)
src/domain/                      paquete, reglas RC1-RC10, orden, evidencia (puro)
src/sap/adapter.ts, mock.ts      interfaz SapAdapter y SAP simulado sobre out/sap/
src/llm/adapter.ts, anthropic.ts interfaz enviar() y proveedor Anthropic
src/agent/                       ciclo del agente, confirmación, sesiones, prompt
app/                             chat (page.tsx) y API (chat, sessions, health)
modulo/                          bonus PRD 9.4: agent.md, tools/oc.ts, skill/ordenes-compra/SKILL.md (npm run modulo)
fixtures/reto-03/                maestros y solicitudes (sin modificar)
specs/                           SDD: controles, esperados, supuestos
tests/                           Vitest
demo.ts                          verificación sin modelo
```
