# Solución: Agente de órdenes de compra

> Marcadores `[COMPLETAR]`: se llenan con el PRD y los resultados reales del reto.

## 1. Resumen

[COMPLETAR: 4 a 6 líneas. Qué hace, decisión clave de diseño, resultado de la verificación (n/6 casos conformes), URL pública.]

- **URL pública:** [COMPLETAR]
- **Repositorio:** [COMPLETAR]
- **Verificación sin LLM:** `npm run demo` → [COMPLETAR] casos conformes
- **Tests automatizados:** `npm test` → [COMPLETAR] pruebas en verde

## 2. Arquitectura

```
Navegador (chat)                     Servidor (Next.js, Node 20+)
┌──────────────────┐   UI stream    ┌────────────────────────────────────────────┐
│ app/page.tsx     │ ◄────────────► │ app/api/chat/route.ts (capa delgada)        │
│ - mensajes       │                │  - límite de peticiones, validación cuerpo  │
│ - tool calls     │                │  - ToolLoopAgent (src/agent/agente.ts)      │
│ - aprobar/rechaz.│                │      prompt: agent/prompt.md                │
└──────────────────┘                │      tools: src/tools/oc.ts (zod)           │
        ▲  Basic Auth (proxy.ts)    │          │                                  │
        │                           │          ▼                                  │
        │                           │  src/domain/ (puro, determinista)           │
        │                           │   - motor de controles, reglas, dinero,     │
        │                           │     fechas, extracción de texto             │
        │                           │          │                                  │
        │                           │  src/data/repositorio.ts → fixtures/<set>/  │
        │                           │  src/adapters/sap/ (SapAdapter → SapMock)   │
        │                           └────────────────────────────────────────────┘
        │                                      │
        └──────────── LLM (Anthropic) ◄────────┘  (solo orquesta y redacta)
```

| Capa | Responsabilidad | Depende de |
|------|-----------------|------------|
| UI | Chat, render de herramientas, confirmación humana | API |
| API | Seguridad perimetral, streaming | Agente |
| Agente | Ciclo LLM ↔ herramientas, política de aprobación | Tools |
| Tools | Contrato zod, orquestación de dominio y SAP | Dominio, Datos, SAP |
| Dominio | Controles y decisión (sin IO) | Nada |
| Datos | Lectura aislada por caso | Sistema de archivos |
| SAP | Puerto + mock idempotente | Nada (mock) |

**Decisión principal:** el LLM no valida. Los controles son código determinista; el modelo decide qué herramienta llamar y explica el resultado. Por eso `demo.ts` obtiene los mismos resultados sin modelo.

## 3. Ciclo del agente

1. El usuario pide procesar un caso.
2. El modelo llama `validar_caso(casoId)`. El servidor carga solo los archivos de ese caso y los maestros, ejecuta los controles y devuelve matriz, decisión y propuesta de OC.
3. El modelo presenta la matriz. Si la decisión es APTA, llama `crear_orden_compra(casoId)`.
4. El SDK **no ejecuta** esa herramienta: emite una solicitud de aprobación firmada (HMAC) y el ciclo se detiene.
5. La UI muestra la tarjeta de confirmación. El usuario aprueba o rechaza.
6. En la siguiente petición el servidor verifica la firma; si es válida y aprobada, ejecuta la herramienta.
7. La herramienta **revalida el caso** y crea la OC solo si sigue siendo apta. El número de OC es idempotente por caso.
8. El modelo informa el resultado. Límite de 6 pasos y 800 tokens de salida por paso.

## 4. Matriz de controles

[COMPLETAR desde `specs/controles.md`]

| Id | Control | Regla | Severidad | Fuente | Resultado por caso (001 a 006) |
|----|---------|-------|-----------|--------|--------------------------------|

## 5. Resultados de los casos

[COMPLETAR con la salida de `npm run demo`]

| Caso | Decisión | Bloqueantes | Advertencias | OC | Conforme |
|------|----------|-------------|--------------|----|----------|

## 6. Seguridad

| Riesgo | Control implementado |
|--------|----------------------|
| Exposición de la API key | Solo en variables de entorno del servidor; nunca en cliente, repo ni logs |
| Uso no autorizado / consumo | Basic Auth (`proxy.ts`), 10 peticiones por minuto por IP y 120 por hora por instancia, historial recortado a 12 mensajes, tope de pasos y tokens, Haiku por defecto, límite de gasto en el workspace de la API |
| Creación de OC sin consentimiento | `toolApproval` en servidor + firma HMAC de aprobaciones (`TOOL_APPROVAL_SECRET`); aprobaciones forjadas se rechazan (test) |
| Prompt injection en documentos | Contenido tratado como dato; la OC solo recibe `casoId` y se construye desde datos validados en servidor (test con ej-002) |
| Path traversal | Ids de caso y dataset validados con patrón estricto; raíz `fixtures/` literal |
| Fuga de información en errores | Mensajes genéricos al cliente; detalle solo en logs |
| Cabeceras | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `noindex` |

## 7. Pruebas automatizadas

| Suite | Cubre |
|-------|-------|
| `controles.test.ts` | Motor de decisión, determinismo, controles que fallan por excepción |
| `utilidades.test.ts` | Montos, IVA en centavos, fechas en Bogotá, extracción de texto |
| `repositorio.test.ts` | Aislamiento por caso, path traversal, archivos faltantes |
| `tools.test.ts` | Herramientas: positivos, negativos, idempotencia, revalidación |
| `casos-aceptacion.test.ts` | Contrato SDD: cada caso contra `specs/esperados/<set>.json` |
| `agente.test.ts` | Ciclo con modelo simulado: aprobación, rechazo, firma forjada, caso no apto |
| `plataforma.test.ts` | Configuración, límite de peticiones, prompt |

CI (GitHub Actions): typecheck, tests, demo y build en cada push.

## 8. Diseño del adaptador SAP para producción

### 8.1 Opciones de integración

| Opción | Cuándo | Ventajas | Riesgos |
|--------|--------|----------|---------|
| **A. OData de pedidos de compra en S/4HANA** (servicio de API de Purchase Order, OData V2 o V4 según versión) vía SAP BTP | S/4HANA Cloud u on-premise reciente | API estándar liberada, contrato estable, sin código ABAP | Requiere conectividad gestionada (BTP + Cloud Connector si es on-premise) |
| **B. BAPI_PO_CREATE1 expuesta por middleware** (SAP Integration Suite u otro iPaaS) como REST | ECC o S/4 sin APIs liberadas para el escenario | Cobertura funcional completa, modo de prueba (TESTRUN) | Más piezas, mapeo de BAPIRET2 |
| C. RFC directo desde Node | No recomendado | | Librerías nativas, no apto para serverless, superficie de red |

**Recomendación:** opción A cuando el sistema la soporte; B como alternativa. Nunca exponer SAP directamente a la función serverless: el tráfico pasa por BTP (Destination + Cloud Connector) o API Management con mTLS u OAuth2 client credentials. *(Verificar nombre y versión exactos del servicio contra el sistema destino.)*

### 8.2 Contrato

`SapAdapter` (ya definido en `src/adapters/sap/tipos.ts`) se implementa como `SapODataAdapter` sin cambiar tools ni dominio.

### 8.3 Flujo de creación

1. **Prevalidación de maestros en SAP** (estado del proveedor, centro de costo vigente, indicador de IVA) para detectar divergencias entre los maestros locales y SAP.
2. **Idempotencia:** antes de crear, buscar una OC con la referencia externa del caso (campo de referencia en cabecera o campo Z acordado). Si existe, devolverla.
3. **Token CSRF** (OData V2): obtener `x-csrf-token` con GET previo y reutilizarlo en el POST.
4. **Creación** con cabecera y posiciones (y asignación de imputación a centro de costo).
5. **Mapeo de errores** de SAP a errores de dominio (proveedor bloqueado, centro cerrado, autorización) con mensajes accionables.
6. **Reintentos** solo para errores transitorios (timeouts, 5xx, 429) con backoff exponencial, siempre precedidos por la consulta de idempotencia.
7. **Auditoría:** registrar caso, hash de la validación, aprobador, fecha de aprobación, número de OC y respuesta de SAP.

### 8.4 Mapeo de campos (referencial)

| Dominio | SAP (cabecera / posición / imputación) |
|---------|----------------------------------------|
| Sociedad | CompanyCode |
| Clase de pedido | PurchaseOrderType |
| Proveedor (NIT → código acreedor) | Supplier |
| Organización / grupo de compras | PurchasingOrganization / PurchasingGroup |
| Moneda | DocumentCurrency |
| Condición de pago | PaymentTerms |
| Descripción, cantidad, precio | PurchaseOrderItemText, OrderQuantity, NetPriceAmount |
| Indicador de IVA | TaxCode |
| Centro de costo | AccountAssignmentCategory = K, CostCenter, GLAccount |

*(Nombres según el modelo estándar de la API; validar contra el `$metadata` del sistema.)*

### 8.5 Operación

- Usuario técnico con mínimo privilegio (crear OC en las organizaciones de compra del alcance).
- Secretos en un gestor de secretos; rotación periódica.
- Observabilidad: latencia, tasa de error por código SAP, OC creadas por día, rechazos por control.
- Circuit breaker si SAP no responde; la solicitud queda en estado pendiente y se notifica.

## 9. Análisis crítico: órdenes retroactivas

[COMPLETAR con los casos concretos detectados: ids, fechas de factura vs. aprobación/solicitud, montos.]

**Hallazgo.** [COMPLETAR: en los casos X e Y la factura es anterior a la solicitud/aprobación: la compra ocurrió antes de existir la OC.]

**Por qué es un desvío y no un detalle formal.**
- El control de compras se basa en aprobar **antes** de comprometer el gasto. Una OC posterior a la factura convierte la aprobación en un trámite de regularización.
- Se pierde el control presupuestal previo, la negociación de precio y la validación del proveedor antes de contratar.
- Abre espacio a fraccionamiento, compras a proveedores no homologados y pagos sin respaldo.

**Qué hace el agente.** [COMPLETAR según el PRD: detecta la retroactividad con un control específico, la reporta con evidencia de fechas y la deriva a revisión; no la normaliza creando la OC como si fuera una compra regular.]

**Riesgo de automatizarlo mal.** Un agente que "resuelve" retroactivas creando la OC automáticamente acelera y oculta el desvío: mejora el indicador de tiempo de ciclo mientras degrada el control interno.

**Recomendaciones.**
1. Política explícita de "sin OC no hay pago" con excepciones tipificadas (urgencia, servicios públicos) y aprobador de nivel superior.
2. Flujo exprés para compras urgentes, de modo que la vía correcta sea también la más rápida.
3. Indicador de retroactividad por área, proveedor y aprobador, revisado mensualmente.
4. Análisis de causa raíz de los casos recurrentes (desconocimiento, tiempos de aprobación, proveedores sin catálogo).

## 10. Limitaciones y siguientes pasos

- El SAP simulado guarda estado en memoria por instancia; la idempotencia se garantiza por número determinista. En producción, persistencia y consulta en SAP.
- El límite de peticiones es por instancia; en producción, límite distribuido o WAF.
- [COMPLETAR: supuestos pendientes de validar (ver `specs/supuestos.md`).]

## 11. Uso de IA en el desarrollo

[COMPLETAR: herramientas usadas, cómo se usó la especificación para guiar la generación, qué se verificó manualmente.]
