# SOLUCIÓN · Reto 03 · Agente conversacional "Órdenes de Compra SAP"

- **URL pública:** https://agente-oc.vercel.app (acceso: ver README)
- **Repositorio:** https://github.com/fernandosalazarsoto/agente-oc
- **Verificación sin LLM:** `npm run demo` → 6/6 casos conformes con `specs/esperados/reto-03.json`
- **Pruebas:** `npm test` → 110 pruebas en verde · `npm run verify` (typecheck + tests + demo) · build sin warnings · CI en GitHub Actions

---

## 1. Problema en una frase

La analista administrativa digita a mano cada OC en SAP y valida de memoria proveedor, aprobador, tope, centro de costo e IVA; eso cuesta tiempo, genera errores que se corrigen en el cierre contable y oculta cuántas OC se crean después de la factura. Le duele a la analista (digitación), a Contabilidad y Auditoría (control y evidencia) y a la dirección (no puede medir el desvío de proceso).

## 2. Arquitectura

```
┌───────────────────────┐ POST /api/chat {sessionId,message}  ┌──────────────────────────────────────────────┐
│ Front (app/page.tsx)  │ ──────────────────────────────────► │ Backend (Next.js, Node 20+, app/api/*)       │
│ - historial           │ ◄────────────────────────────────── │ - chat/route.ts: Basic Auth, límites, zod    │
│ - tarjeta por tool    │ {reply,toolCalls[],needsConfirmation}│ - src/agent/ciclo.ts: ciclo del agente       │
│   (nombre, args,      │                                      │     topes, confirmación CA3 en servidor      │
│   resumen, matriz)    │ GET /api/sessions/:id (historial)    │ - src/agent/sesiones.ts: memoria + archivo   │
│ - tarjeta de          │ GET /api/health {ok,provider,model}  │ - src/llm/adapter.ts: enviar(mensajes, tools)│
│   confirmación con    │                                      │   src/llm/anthropic.ts: Messages API (fetch) │
│   la OC propuesta     │                                      └──────────────┬───────────────────────────────┘
└───────────────────────┘                                                     │ execute(args, ctx) → string
                                                                              ▼
                                   ┌─────────────────────────────────────────────────────────────────┐
                                   │ src/tools/oc.ts (zod): oc_leer_paquete · oc_validar ·           │
                                   │ oc_construir_payload · oc_generar_evidencia · oc_crear          │
                                   │ (+ oc_listar_casos)                                             │
                                   └───────┬───────────────────────────┬─────────────────────────────┘
                                           │                           │
                       src/domain/ (puro)  │                           │ src/sap/adapter.ts (SapAdapter)
                       paquete · reglas    │                           │ src/sap/mock.ts
                       RC1-RC10 · orden ·  │                           │
                       evidencia           │                           │
                                           ▼                           ▼
                        fixtures/reto-03/ (solo lectura)     out/ (escritura): sap/ordenes.jsonl,
                        maestros + solicitudes               control.csv, log.jsonl, <caso>/trazabilidad.json,
                                                             <caso>/aprobacion.txt y .pdf, sesiones/
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, principios (CA2, CA3), sección de **Alcance**, flujo y formato de respuesta |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Proceso, reglas RC1-RC10, retroactivas, acciones sugeridas. Se concatena al prompt en tiempo de ejecución |
| **Ejecución** | `src/tools/oc.ts` + `src/domain/` | Herramientas tipadas y reglas deterministas. Un cambio de reglas de negocio no toca el servidor |

En Vercel el sistema de archivos del bundle es de solo lectura: `out/` se escribe en `/tmp/out` (efímero por instancia). En local, `out/` en la raíz. Configurable con `OUT_DIR`.

## 3. Ciclo del agente

Implementado a mano en `src/agent/ciclo.ts` (sin framework de agentes), contra la interfaz propia `AdaptadorLLM.enviar(mensajes, herramientas)`:

1. El servidor agrega el mensaje de la usuaria a la sesión y arma la ventana de mensajes (empieza siempre en un mensaje de la usuaria).
2. Llama `llm.enviar([sistema, ...ventana], definiciones)`. Las definiciones salen de los esquemas zod (`z.toJSONSchema`), con el nombre `oc_<export>`.
3. Si el modelo pide herramientas, el servidor las ejecuta: `execute` valida los argumentos con zod, devuelve `{ ok, data }` o `{ ok: false, error }` y nunca lanza. Cada llamada queda en el historial visible y en `out/log.jsonl` (CA4). El resultado vuelve al modelo como `tool_result`.
4. Repite hasta que el modelo responde sin herramientas o se alcanza el tope.

**Topes (CA1, PRD §8 Costo):** `AGENT_MAX_ITERACIONES` (12 por turno), presupuesto de 30 s por turno (más el timeout de la última llamada, dentro de los 60 s de la función serverless), `AGENT_MAX_TOKENS_SESION` (300.000 por sesión), `AGENT_MAX_TOKENS_SALIDA` (1.500 por paso), `LLM_TIMEOUT_MS` (25 s), 10 peticiones por minuto por IP y 120 por hora por instancia. Al alcanzar el tope, el agente responde con las herramientas ejecutadas y lo que falta.

**Confirmación humana (CA3), verificada en el servidor y no en el prompt:**
- Cuando `oc_validar` devuelve confirmaciones o `oc_crear` responde `requiere_confirmacion`, la sesión guarda un **pendiente** `{ caso, confirmaciones, propuesta }` y la respuesta trae `needsConfirmation: true`.
- La UI resalta el estado con una tarjeta que muestra la OC propuesta (proveedor, NIT, descripción, cantidad × precio, total, centro y subárea, IVA, pago, aprobador) y las excepciones, y **bloquea el campo de texto** hasta que la usuaria confirme o rechace (evita mezclar casos).
- En el turno siguiente, un detector determinista (`src/agent/confirmacion.ts`) decide si el mensaje confirma ese caso. Solo entonces `oc_crear` con `confirmado=true` se ejecuta para ese caso; cualquier intento del modelo de autoconfirmarse se bloquea en el servidor y se le devuelve el error.
- **Errores (CA5):** un fallo o timeout del proveedor se informa en lenguaje claro, la conversación vuelve a su estado previo y la sesión sigue viva.

## 4. Elección del modelo

| Aspecto | Decisión |
|---|---|
| Proveedor | Anthropic, Messages API, con adaptador propio por `fetch` (`src/llm/anthropic.ts`). Cambiar de proveedor es escribir otro `src/llm/<proveedor>.ts`; el ciclo no cambia |
| Modelo | `claude-sonnet-5-5` por defecto (`AGENT_MODEL`); `claude-haiku-5-5` como alternativa de menor costo |
| Por qué | El flujo exige encadenar 4 a 6 llamadas de herramientas, copiar el payload sin alterarlo y respetar el orden de la respuesta en español. Se priorizó robustez en el uso de herramientas sobre costo; `temperature: 0` |
| Costo | Precios vigentes de Sonnet 5.5: USD 2 por millón de tokens de entrada, USD 10 de salida, USD 0,10 en lectura de caché ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). El prompt de sistema y las herramientas (~4.000 tokens) van con prompt caching |
| Costo estimado por caso | Un caso completo usa 4 a 5 llamadas al modelo: ~15.000 tokens de entrada no cacheados, ~16.000 en caché y ~1.500 de salida ≈ **USD 0,05 por caso** (≈ USD 0,08 si requiere confirmación, por el segundo turno). Con Haiku 5.5, menos de USD 0,005. Los tokens reales por paso se registran en los logs de Vercel (`[ciclo] ... tokens_entrada/tokens_salida`) |

## 5. Matriz de controles

Código: `src/domain/reglas/index.ts` (puro: sin IO, sin fecha del sistema, montos en centavos, fechas calendario en America/Bogota). Especificación con criterios Dado/Cuando/Entonces: `specs/controles.md`. Pruebas: `tests/reglas.test.ts`.

| Regla | Implementación | Tipo | 001 | 002 | 003 | 004 | 005 | 006 |
|---|---|---|---|---|---|---|---|---|
| RC1 | Búsqueda por NIT base (sin puntos ni dígito de verificación); sin NIT, por nombre normalizado (sin tildes ni puntuación); debe estar `activo` | Bloqueo | ✓ | **Bloqueo** | ✓ | ✓ | ✓ | ✓ (por nombre) |
| RC2 | Aprobación presente, "Aprobado" no negado, remitente en `aprobadores` del centro | Bloqueo | ✓ | ✓ | **Bloqueo** | ✓ | ✓ | ✓ |
| RC3 | `valor_total ≤ tope` del aprobador en ese centro; si RC2 no identifica aprobador, queda NO_EVALUABLE | Bloqueo | ✓ | ✓ | n/e | ✓ | ✓ | ✓ |
| RC4 | Centro existe y la subárea le pertenece | Bloqueo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| RC5 | `|cot − sol| × 100 ≤ 2 × sol` en centavos (sin coma flotante); sin cotización legible: confirmación | Confirmación | ✓ | ✓ | ✓ | **6 %** | ✓ | ✓ |
| RC6 | IVA ausente → `indicador_iva_default` del proveedor + confirmación | Conf. + derivado | ✓ | ✓ | ✓ | ✓ | ✓ | **C1** |
| RC7 | Condiciones ausentes → `condiciones_pago_default`, solo se informan | Derivado | ✓ | ✓ | ✓ | ✓ | ✓ | **Z030** |
| RC8 | `fecha(factura) < fecha_solicitud` → `retroactiva = true` + confirmación | Confirmación | ✓ | ✓ | ✓ | ✓ | **Retroactiva** | ✓ |
| RC9 | `fecha(aprobación) ≥ fecha_solicitud` por fecha calendario | Confirmación | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| RC10 | `|cantidad × valor_unitario − valor_total| ≤ 1` en centavos | Bloqueo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Resultado de los casos (salida real de `npm run demo`):**

| Caso | apta | Bloqueos | Confirmaciones | Retroactiva | Resultado |
|---|---|---|---|---|---|
| sol-001 | true | ninguno | ninguna | false | OC **4500000001** sin intervención; repetir devuelve la misma (idempotente) |
| sol-002 | false | RC1 | ninguna | false | No se crea. NIT 901999000 no existe. Acción: crear el proveedor en el maestro o corregir el NIT |
| sol-003 | false | RC2 | ninguna | false | No se crea. fvargas no aprueba CC-2020; su único aprobador (rtorres) tiene tope de 30 M para una compra de 74 M: escalar |
| sol-004 | true | ninguno | RC5 | false | Pendiente; tras la confirmación, OC **4500000002** por 25 M (valor aprobado) con la excepción registrada |
| sol-005 | true | ninguno | RC8 | **true** | Pendiente; tras la confirmación, OC **4500000003**, marcada retroactiva en `out/control.csv` |
| sol-006 | true | ninguno | RC6 | false | Pendiente; tras la confirmación, OC **4500000004** con IVA C1 y pago Z030 derivados |

**La regla más difícil: RC2 y RC3 en sol-003.** El aprobador existe, aprueba y tiene tope suficiente, pero en otro centro (CC-3030). Leído literalmente, RC3 no se puede evaluar porque fvargas no tiene tope en CC-2020; marcarlo como segundo bloqueo duplicaría el motivo. Se decidió un solo bloqueo (RC2), RC3 como NO_EVALUABLE y una acción sugerida útil: el único aprobador de CC-2020 tampoco tiene tope para 74 M, así que hay que escalar o actualizar la matriz. Le sigue RC5: el límite exacto del 2 % se compara en enteros para evitar errores de coma flotante en el borde.

## 6. Diseño del adaptador SAP real (PRD §7.5)

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` expuesto a través de SAP BTP (Destination + Cloud Connector si el sistema es on-premise), con BAPI `BAPI_PO_CREATE1` vía SAP Integration Suite como alternativa si el sistema es ECC.**
Por qué, dada una viabilidad no confirmada: es la API estándar liberada para crear pedidos, no requiere desarrollo ABAP, el contrato es estable y la misma interfaz `SapAdapter` se implementa sin tocar herramientas ni dominio. La carga por archivo queda como Plan B, no como camino principal, porque no da número de OC en línea ni idempotencia. RFC directo desde una función serverless se descarta (librerías nativas, red privada).

**Mapeo del payload §7.4** (validar nombres contra el `$metadata` del sistema destino):

| Payload | OData (`A_PurchaseOrder` / `A_PurchaseOrderItem` / imputación) | BAPI_PO_CREATE1 |
|---|---|---|
| `sociedad` | `CompanyCode` | `POHEADER-COMP_CODE` |
| `organizacion_compras` | `PurchasingOrganization` (+ `PurchasingGroup` por configuración) | `POHEADER-PURCH_ORG` / `PUR_GROUP` |
| clase de pedido (constante por configuración) | `PurchaseOrderType` | `POHEADER-DOC_TYPE` |
| `proveedor.codigo_sap` | `Supplier` | `POHEADER-VENDOR` |
| `moneda` | `DocumentCurrency` | `POHEADER-CURRENCY` |
| `condiciones_pago` | `PaymentTerms` | `POHEADER-PMNTTRMS` |
| `referencia.solicitud_id` (clave de idempotencia) | `CorrespncExternalReference` o campo de extensión acordado | `POHEADER-REF_1` |
| `posiciones[].numero / descripcion / cantidad / unidad` | `PurchaseOrderItem`, `PurchaseOrderItemText`, `OrderQuantity`, `PurchaseOrderQuantityUnit` | `POITEM-PO_ITEM / SHORT_TEXT / QUANTITY / PO_UNIT` |
| `precio_unitario` | `NetPriceAmount` (ver riesgo de IVA incluido, S-05) | `POITEM-NET_PRICE` |
| `indicador_iva` | `TaxCode` | `POITEM-TAX_CODE` |
| `centro_costo` | Imputación `K`: `CostCenter` + `GLAccount` | `POACCOUNT-COSTCENTER / GL_ACCOUNT` |
| `subarea` | Sin campo estándar: orden interna, centro de beneficio o campo de extensión, a definir con Finanzas | Ídem (`ORDERID` o extensión) |
| `aprobador`, `excepciones` | Texto de cabecera (notas) + registro de auditoría propio | `POTEXTHEADER` |
| evidencia (`aprobacion.txt`, P1 PDF) | Servicio de adjuntos (`API_CV_ATTACHMENT_SRV`, objeto de pedido) | GOS / servicio de adjuntos |

**Autenticación y credenciales:** OAuth 2.0 client credentials (o certificado X.509) contra BTP; usuario técnico con mínimo privilegio (crear pedidos solo en la sociedad 1000 y su organización de compras). Las credenciales viven en el gestor de secretos de la plataforma (variables cifradas de Vercel o Destination de BTP), las lee únicamente el adaptador en el servidor y nunca llegan al agente, al prompt, al front ni a los logs. El modelo no puede invocar SAP: solo `oc_crear`, que revalida el caso.

**Idempotencia y reintentos:**
1. Antes de crear, `buscarOrdenPorReferencia(solicitud_id)` consulta SAP por la referencia externa; si existe, devuelve ese número (igual que el mock).
2. Registro de idempotencia en el middleware (`solicitud_id → estado PENDIENTE/CREADA, numero_oc`) para cubrir la ventana entre el POST y su respuesta.
3. Reintentos solo ante errores transitorios (timeout, 5xx, 429) con backoff exponencial, **siempre precedidos de la consulta por referencia**: si el POST llegó a SAP pero la respuesta se perdió, se recupera el número en lugar de duplicar.
4. Token CSRF en OData V2 (GET previo y reutilización en el POST).

**Error parcial:** la creación por *deep insert* (cabecera + posiciones + imputación en una sola petición) es atómica: o se crea la OC completa o no se crea. El escenario parcial real es "OC creada, adjunto o nota fallidos" o "OC creada con advertencias". Se registra la OC como `CREADA_SIN_EVIDENCIA` en el log de control, se reintenta el adjunto de forma idempotente y se avisa en el chat. En BAPI, cualquier mensaje tipo E/A en `RETURN` implica `BAPI_TRANSACTION_ROLLBACK`; solo con éxito se hace `BAPI_TRANSACTION_COMMIT`. Los mensajes de SAP se traducen a errores legibles (proveedor bloqueado, centro cerrado, sin autorización).

**Plan B si la conexión no es viable:** el agente conserva el 80 % del valor, porque lo costoso hoy es reunir y validar los datos, no pulsar "guardar":
- Mantiene lectura, validación RC1-RC10, trazabilidad, evidencia y log de control tal como están.
- Implementa un `SapAdapter` "manual" que genera la **OC lista para pegar** en ME21N (campos en el orden de la transacción) y un **archivo de carga masiva** (CSV para la plantilla de migración o LSMW) con todas las OC aptas del día.
- La analista registra el número que devuelve SAP con una herramienta `oc_registrar_numero` y el log de control queda completo.

## 7. Lectura del proceso: OC retroactivas (para la dirección)

**Qué muestran los datos.** En la muestra del reto, 1 de 6 solicitudes es retroactiva (sol-005): la factura FC-88231 de Papelería Central es del **2026-08-10**; la solicitud es del **2026-08-27** (17 días después) y la aprobación del **2026-08-28**, con el texto "Ya llegó la factura, por favor crear la OC para poder radicarla". Hubo cotización (2026-08-05), pero la compra se comprometió sin OC ni aprobación. La aprobación se usó para regularizar una compra ya hecha, no para autorizarla. La muestra es pequeña y no permite inferir la tasa real; su valor es mostrar que el patrón existe y que ahora se mide.

**Qué le diría a la dirección.**
1. Una OC retroactiva no es un problema de digitación: es gasto comprometido sin control previo. Se pierde la validación de presupuesto y tope antes de contratar, la negociación de precio y la verificación del proveedor, y se abre espacio a fraccionamiento y pagos sin respaldo.
2. El agente no decide la política (tolerar con marca o rechazar), pero desde hoy cada intento queda en `out/control.csv` con `retroactiva=true`, solicitud, resultado y fecha. Con un mes de operación se tendrá la tasa real por área, proveedor y aprobador.
3. Automatizar sin cambiar el proceso tiene un riesgo: si crear la OC tarde es fácil, el desvío se vuelve invisible. Por eso la retroactiva exige confirmación explícita y queda marcada; no se normaliza.

**Cambio de proceso propuesto.**
- **Sin OC no se radica factura**, con excepciones tipificadas (servicios públicos, urgencias) y un aprobador de nivel superior para toda retroactiva.
- **Órdenes abiertas o contratos marco** para compras recurrentes como papelería trimestral o licencias, de modo que la OC exista antes del consumo.
- **Hacer más rápido el camino correcto**: con el agente, crear una OC apta toma minutos; ya no hay excusa de lentitud.
- **Indicador mensual**: porcentaje de OC retroactivas, días entre factura y OC, y reincidencia por área y proveedor, con revisión de causa raíz de los reincidentes.
- Comunicar a los proveedores que toda factura debe citar el número de OC.

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | Ciclo del agente propio sobre una interfaz `enviar()` y adaptador por `fetch` | Mantener el `ToolLoopAgent` del AI SDK de la base técnica | El PRD exige un adaptador propio y que cambiar de proveedor no toque el ciclo. Además, la aprobación del SDK (aprobar la llamada a la herramienta) no es la confirmación por el siguiente mensaje de la usuaria que pide CA3. Costo: más código propio y sin streaming |
| D2 | Confirmación verificada en el servidor (pendiente en la sesión + detector determinista del mensaje) | Confiar en el `confirmado=true` que envía el modelo | Un modelo o un documento con instrucciones maliciosas podría autoconfirmar. Costo: el detector es conservador; frases ambiguas no confirman y se vuelve a preguntar |
| D3 | El modelo envía `paquete`, `derivados` y `payload` por contrato, pero el servidor relee el caso y `oc_crear` rechaza un payload distinto del validado (huella) | Usar lo que envía el modelo | Riesgo explícito del PRD §10: que el modelo "arregle" un monto. Costo: el modelo debe copiar el payload exacto (más tokens) |
| D4 | La OC de sol-004 se crea por el valor de la solicitud (25 M) y la diferencia con la cotización queda como excepción confirmada | Usar el precio de la cotización (26,5 M) | El líder aprobó "25 millones según la solicitud". Costo: la factura llegará por 26,5 M y requerirá ajuste o nueva aprobación (dentro del tope de dgarcia) |
| D5 | Respuesta JSON por turno con indicador de "pensando" | Streaming (SSE) | Más simple y robusto en serverless; el streaming es opcional en el PRD. Costo: la respuesta aparece completa al final del turno |
| D6 | `out/` en `/tmp` en Vercel | Almacenamiento externo (Blob, KV, base de datos) | El PRD excluye base de datos y no se agregan cuentas ni dependencias en 2 horas. Costo: numeración y sesiones efímeras por instancia en la URL pública (en local y en la demo es determinista) |
| D7 | Sonnet 5.5 por defecto | Haiku 5.5 (unas 20 veces más barato) | Robustez en cadenas de herramientas y en copiar el payload exacto. Configurable con `AGENT_MODEL` |

**Dependencias y justificación (PRD §8):**

| Dependencia | Para qué | Por qué esta |
|---|---|---|
| `next`, `react`, `react-dom` | Front de chat y API en un solo proyecto y un solo despliegue | Un comando levanta todo (`npm run dev`); despliegue nativo en Vercel |
| `zod` | Argumentos de herramientas, esquema de `OrdenCompra`, fixtures y configuración | Obligatorio en el PRD; genera el JSON Schema que ve el modelo |
| `react-markdown`, `remark-gfm` | Mostrar las tablas que redacta el agente | Render seguro de Markdown sin HTML arbitrario |
| `pdf-lib` | Evidencia en PDF (HU-4 P1) | JavaScript puro, sin binarios nativos; funciona en serverless |
| `typescript`, `tsx`, `vitest`, `@types/*` (desarrollo) | Tipado, `demo.ts` y scripts, pruebas | Estándar del ecosistema, sin configuración extra |

No se usa SDK de Anthropic ni framework de agentes: el adaptador es un `fetch` a la Messages API (menos dependencias y control total del ciclo). Se retiraron `ai`, `@ai-sdk/anthropic` y `@ai-sdk/react` de la base técnica.

**Mejoras incorporadas desde la prueba en producción de la base técnica:** respuesta limitada al caso en curso y bloqueo de la entrada con una confirmación pendiente (antes se mezclaban casos); tarjeta de confirmación con la OC propuesta (antes solo mostraba el id); orden obligatorio "resumen → OC → validaciones → derivados → pregunta"; fecha de SAP en hora de Bogotá (antes UTC); sección de Alcance en el prompt.

## 9. Supuestos

Detalle completo, alternativa descartada e impacto en `specs/supuestos.md`:
- **S-01** La base técnica (Next.js, despliegue, acceso básico, utilidades, CI) se preparó antes de la prueba; specs, reglas, herramientas del contrato, ciclo del agente y tests de negocio se hicieron durante la prueba.
- **S-02** Manda el PRD sobre la base técnica (contrato §6.2 y CA3).
- **S-03** sol-003: un solo bloqueo (RC2); RC3 queda NO_EVALUABLE.
- **S-04** sol-004: valores de la solicitud aprobada; la diferencia con la cotización va en `excepciones`.
- **S-05** Precios con IVA incluido se pasan tal cual; riesgo de doble IVA en SAP real.
- **S-06** Unidad derivada del texto: hora(s) → H, por mes → MES, si no UN.
- **S-07** Descripción recortada a 40 caracteres sin cortar palabras; el texto completo queda en la solicitud.
- **S-08** "Aprobado" sin distinguir mayúsculas ni tildes y no precedido de "no".
- **S-09** RC8 y RC9 comparan fechas calendario en America/Bogota.
- **S-10** Código de IVA o de pago informado que no existe en el maestro: bloqueo de estructura.
- **S-11** Numeración global desde 4500000001; en Vercel, efímera por instancia.
- **S-12** La confirmación en `demo.ts` es simulada.
- **S-13** La validez de la cotización se informa pero no es regla del PRD.
- **S-14** El servidor no usa como fuente el paquete, los derivados ni el payload que envía el modelo.

## 10. Cobertura

| Historia / requisito | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| HU-1 Leer el paquete | Hecho | `oc_leer_paquete`; ausentes en `null` + `faltantes` | Leer `.xlsx` y PDF reales (P1 `oc_leer_excel`) |
| HU-2 Validar RC1-RC10 | Hecho | `oc_validar`, 30+ pruebas por regla | Maestros consultados en SAP en tiempo real |
| HU-3 Payload + trazabilidad | Hecho | `oc_construir_payload`, esquema zod, `out/<caso>/trazabilidad.json` | OC con varias posiciones |
| HU-4 Evidencia | Hecho | P0: `out/<caso>/aprobacion.txt` con sha256. P1: `out/<caso>/aprobacion.pdf` (pdf-lib), mismo contenido y sha256, reproducible | Firma digital o adjuntar el `.eml` original si Auditoría lo exige |
| HU-5 Crear en SAP simulado | Hecho | Secuencia desde 4500000001, idempotencia, `out/sap/ordenes.jsonl`, `out/control.csv` | Adaptador real (§6) y almacenamiento persistente |
| HU-6 Errores | Hecho | JSON malformado, monto no numérico, caso inexistente: `{ ok: false, error }` legible | Notificación automática al solicitante |
| Front de chat | Hecho | Historial, "pensando", tarjeta por herramienta, matriz, confirmación resaltada | Streaming |
| Backend y API §6.4 | Hecho | `/api/chat`, `/api/sessions/:id`, `/api/health` | Autenticación real (SSO) y roles |
| `demo.ts` sin modelo | Hecho | 6/6 conformes, idempotencia y confirmación explícita | |
| P1 `oc_leer_excel` | No hecho | Los fixtures traen la solicitud normalizada en JSON | Lectura de `.xlsx` real (por ejemplo, SheetJS) |
| Bonus `modulo/` | Hecho | `agent.md` y `SKILL.md` generados desde `agent/prompt.md` y `src/knowledge/` (`npm run modulo`); `tools/oc.ts` reexporta las mismas herramientas; `tests/extras.test.ts` falla si divergen | En otra plataforma, CA3 depende de su mecanismo de permisos para `oc_crear` |

## 11. Uso de IA

- **Asistente:** Claude (Opus 5.5) en un proyecto de claude.ai, con acceso al repositorio y al conector de Vercel.
- **Antes de la prueba:** preparó la base técnica declarada en S-01 (estructura Next.js, despliegue, seguridad perimetral, utilidades de dinero, fechas y texto, CI) y el procedimiento SDD (`CLAUDE.md`, plantillas de `specs/`).
- **Durante la prueba:** lectura del PRD y de los fixtures; especificación de RC1-RC10 con trazabilidad al PRD; propuesta de resultados esperados por caso, que revisé en una puerta de validación antes de escribir código; tests antes de la implementación; implementación de reglas, herramientas, adaptador LLM, ciclo, API y chat; borradores de esta documentación.
- **Qué se descartó de lo propuesto y por qué:**
  - Conservar el `toolApproval` + HMAC del AI SDK de la base: no cumple el contrato §6.2 ni CA3 (D1, D2).
  - Marcar RC2 y RC3 a la vez en sol-003: duplicaba el motivo (S-03).
  - Crear la OC de sol-004 con el precio de la cotización: contradice la aprobación (D4).
  - Confiar en el payload enviado por el modelo (D3).
- **Control humano:** decisiones de contrato y de interpretación del PRD validadas por mí en las puertas del proceso; verificación con `npm run verify`, build y prueba en la URL. Puedo explicar cada línea entregada.
- **En ejecución:** el agente desplegado usa `claude-sonnet-5-5`.

## 12. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| La conexión a SAP no es viable a corto plazo | Plan B (§6): OC lista para pegar y carga masiva, conservando validación y control |
| Maestros locales distintos de SAP (proveedor bloqueado en SAP, tope cambiado) | `consultarProveedor` y lectura de maestros contra SAP antes de crear; los fixtures solo valen para el reto |
| Prompt injection en correos, cotizaciones o facturas | Documentos tratados como datos; las reglas están en código; `oc_crear` revalida y rechaza payloads alterados; la confirmación no depende del modelo |
| Duplicados por reintentos o concurrencia | Idempotencia por `solicitud_id` en SAP y registro en el middleware; consulta antes de cada reintento |
| Estado efímero (`/tmp`, sesiones en memoria) | Almacenamiento persistente (base de datos o blob) para `out/`, sesiones y log de control |
| Consumo indebido de la clave del modelo | Basic Auth, límites por IP y por hora, tope de iteraciones y de tokens por sesión, límite de gasto en el workspace de la API; en producción, SSO y límite distribuido |
| Precio con IVA incluido frente a precio neto de SAP | Confirmar con Contabilidad y calcular el neto desde el indicador antes del adaptador real (S-05) |
| Validez de la evidencia ante auditoría | PDF con hash y, si se exige, firma digital o el `.eml` original como adjunto |
| Datos personales en correos (Ley 1581 de 2012) | Minimizar los datos en los logs (hoy solo caso y resultado), definir retención y acceso |
| Indisponibilidad o latencia del proveedor LLM | Timeout con mensaje claro, sesión que sobrevive, modelo alterno configurable; la validación funciona sin LLM (`demo.ts`) |
| Falsos positivos del detector de confirmación | Detector conservador y botones explícitos en la UI; la entrada libre queda bloqueada mientras haya un pendiente |
