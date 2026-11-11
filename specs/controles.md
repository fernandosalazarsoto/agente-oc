# Especificación de controles · Reto 03

> Fuente de verdad: `PRD.md` (v2.0, 2026-09-03) y `fixtures/reto-03/`. Cada control se traza a una sección del PRD y a sus tests.
> Escrita y validada antes de implementar (SDD). Los supuestos de interpretación están en `specs/supuestos.md`.

## Convenciones (PRD §5 HU-2, §7.3)

- **Tipo** `BLOQUEO`: impide crear la OC (`apta = false`).
- **Tipo** `CONFIRMACION`: la OC solo se crea con `confirmado = true` dado por la usuaria en el chat (CA3).
- **Tipo** `DERIVADO`: valor completado desde maestros que el agente debe informar.
- `apta = bloqueos.length === 0`.
- `oc_crear` procede solo si `apta` y (`confirmaciones` vacío **o** `confirmado = true`) (HU-5).
- `retroactiva = true` cuando aplica RC8; se registra en `out/control.csv` en todo intento.
- Montos en centavos enteros; fechas como fecha calendario en America/Bogota.

## Matriz de controles

| Id | Control | Regla | Fuente de datos | Tipo | PRD § | Tests |
|----|---------|-------|-----------------|------|-------|-------|
| RC1 | Proveedor existe y activo | Buscar por `solicitud.proveedor_nit` (solo dígitos, sin DV); si no hay NIT, por nombre normalizado. Debe existir y `activo = true` | solicitud, maestro.proveedores | BLOQUEO | 7.3 | `tests/reglas.test.ts` RC1 |
| RC2 | Aprobación válida | `aprobacion` existe, el cuerpo contiene "Aprobado" (no negado) y `aprobacion.de` es aprobador del `centro_costo` | aprobacion, maestro.centros-costo | BLOQUEO | 7.3 | RC2 |
| RC3 | Monto dentro del tope | `valor_total ≤ tope` del aprobador en ese centro | solicitud, maestro.centros-costo | BLOQUEO | 7.3 | RC3 |
| RC4 | Subárea del centro | `subarea ∈ centro_costo.subareas` (y el centro existe) | solicitud, maestro.centros-costo | BLOQUEO | 7.3 | RC4 |
| RC5 | Cotización vs solicitud | `abs(cot.total − sol.valor_total) / sol.valor_total ≤ 2 %`. Si excede: confirmación con ambos valores. Sin cotización: confirmación | cotizacion, solicitud | CONFIRMACION | 7.3 | RC5 |
| RC6 | Indicador de IVA | Si falta `indicador_iva`: se deriva de `proveedor.indicador_iva_default` y se pide confirmación | solicitud, maestro.proveedores | CONFIRMACION + DERIVADO | 7.3 | RC6 |
| RC7 | Condiciones de pago | Si faltan `condiciones_pago`: se derivan de `proveedor.condiciones_pago_default`. Solo se informa | solicitud, maestro.proveedores | DERIVADO | 7.3 | RC7 |
| RC8 | OC retroactiva | Existe `factura` con `fecha < fecha_solicitud` → `retroactiva = true` y confirmación | factura, solicitud | CONFIRMACION | 7.3, O4 | RC8 |
| RC9 | Fecha de aprobación | `fecha(aprobacion) ≥ fecha_solicitud`; si no, confirmación | aprobacion, solicitud | CONFIRMACION | 7.3 | RC9 |
| RC10 | Aritmética de la solicitud | `abs(cantidad × valor_unitario − valor_total) ≤ 1` (unidad monetaria) | solicitud | BLOQUEO | 7.3 | RC10 |
| EST | Estructura del paquete | Archivo ausente → `null` con el nombre del faltante (HU-1); JSON malformado o monto no numérico → `{ ok: false, error }` legible (HU-6) | paquete | BLOQUEO / error | HU-1, HU-6 | `tests/tools.test.ts` |

## Criterios de aceptación

### RC1 · Proveedor existe y activo
- **Dado** `proveedor_nit = "900555111"` y el maestro con ese NIT activo, **cuando** se valida, **entonces** no hay bloqueo y `derivados.proveedor = { codigo_sap: "100234", ... }`.
- **Dado** un NIT inexistente (sol-002, `901999000`), **entonces** bloqueo RC1 con el NIT y la acción "dar de alta al proveedor en el maestro o corregir el NIT".
- **Dado** que no hay NIT (sol-006), **entonces** se busca por nombre normalizado (sin tildes, mayúsculas ni puntuación).
- **Dado** un proveedor existente con `activo = false` (Consultores Ágiles), **entonces** bloqueo RC1.
- Borde: NIT con puntos o dígito de verificación (`900.555.111-2`) se compara por la base.

### RC2 · Aprobación válida
- **Dado** `aprobacion.de` listado en `centro_costo.aprobadores` y cuerpo con "Aprobado", **entonces** cumple.
- **Dado** un aprobador que no pertenece al centro (sol-003: `fvargas` para CC-2020), **entonces** bloqueo RC2.
- Borde: sin `aprobacion.json` → bloqueo RC2 ("falta la aprobación"); cuerpo "No aprobado" → bloqueo.

### RC3 · Monto dentro del tope
- **Dado** aprobador del centro con `tope ≥ valor_total`, **entonces** cumple (igualdad exacta cumple).
- **Dado** `valor_total > tope`, **entonces** bloqueo RC3 con monto y tope.
- **Dado** que RC2 no identificó un aprobador del centro, **entonces** RC3 queda `NO_EVALUABLE` (no se duplica el bloqueo) y la evidencia informa el tope del aprobador válido del centro, si existe (ver S-03).

### RC4 · Subárea del centro
- **Dado** `subarea ∈ subareas` del centro, **entonces** cumple. Si el centro no existe o la subárea no pertenece: bloqueo.

### RC5 · Cotización vs solicitud
- **Dado** diferencia ≤ 2 %, **entonces** cumple. Borde: exactamente 2 % cumple.
- **Dado** sol-004 (cotización 26.500.000 vs solicitud 25.000.000 = 6 %), **entonces** confirmación con ambos valores y el porcentaje.
- **Dado** que falta `cotizacion.txt` o no tiene total legible, **entonces** confirmación "sin cotización".

### RC6 · Indicador de IVA
- **Dado** `indicador_iva` ausente (sol-006), **entonces** `derivados.indicador_iva = "C1"` (default del proveedor) y confirmación RC6.
- **Dado** un `indicador_iva` informado que no existe en el maestro, **entonces** bloqueo de estructura (ver S-10).

### RC7 · Condiciones de pago
- **Dado** `condiciones_pago` ausentes (sol-006), **entonces** `derivados.condiciones_pago = "Z030"` sin confirmación.

### RC8 · OC retroactiva
- **Dado** sol-005 (factura 2026-08-10 < solicitud 2026-08-27), **entonces** `retroactiva = true`, confirmación RC8 y fila en `out/control.csv` con `retroactiva = true`.
- **Dado** que no hay factura, **entonces** `retroactiva = false`.

### RC9 · Fecha de aprobación
- **Dado** aprobación el mismo día o posterior a la solicitud, **entonces** cumple (comparación de fecha calendario en Bogotá).
- **Dado** aprobación anterior a la solicitud, **entonces** confirmación RC9.

### RC10 · Aritmética
- **Dado** `cantidad × valor_unitario = valor_total ± 1`, **entonces** cumple; si no, bloqueo con los tres valores.

## Contrato de herramientas (PRD §6.2)

| Herramienta (modelo) | Export en `src/tools/oc.ts` | Entrada | Salida `data` |
|---|---|---|---|
| `oc_leer_paquete` | `leer_paquete` | `{ caso }` | Paquete normalizado §7.2 + `faltantes[]` |
| `oc_validar` | `validar` | `{ caso, paquete? }` | `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }` |
| `oc_construir_payload` | `construir_payload` | `{ caso, paquete?, derivados? }` | `OrdenCompra` §7.4 + `ruta_trazabilidad` |
| `oc_generar_evidencia` | `generar_evidencia` | `{ caso }` | `{ ruta, sha256 }` |
| `oc_crear` | `crear` | `{ caso, payload, confirmado? }` | `{ numero_oc, fecha, idempotente }` o `{ ok: false, error }` |

Regla de integridad: el servidor **relee y revalida** el caso en `oc_validar`, `oc_construir_payload` y `oc_crear`; el `paquete`, los `derivados` y el `payload` que envía el modelo no se usan como fuente. `oc_crear` rechaza un `payload` que difiera del construido en servidor (PRD §10, riesgo "el modelo arregle un monto").

## Trazabilidad caso → controles

| Caso | Resultado esperado | Bloqueos | Confirmaciones | Derivados | Retroactiva | Crea OC | Justificación (PRD §) |
|------|--------------------|----------|----------------|-----------|-------------|---------|------------------------|
| sol-001 | OC creada sin intervención | — | — | — | false | Sí | O1; todos los controles cumplen |
| sol-002 | Bloqueada | RC1 | — | — | false | No | O2; NIT 901999000 no existe en proveedores |
| sol-003 | Bloqueada | RC2 | — | — | false | No | O2; fvargas no es aprobador de CC-2020 (solo rtorres, tope 30 M < 74 M) |
| sol-004 | OC con confirmación | — | RC5 | — | false | Sí, tras confirmar | O3; cotización 26,5 M vs solicitud 25 M = 6 % > 2 % |
| sol-005 | OC con confirmación, retroactiva | — | RC8 | — | true | Sí, tras confirmar | O4; factura 2026-08-10 < solicitud 2026-08-27 |
| sol-006 | OC con confirmación | — | RC6 | indicador_iva C1, condiciones_pago Z030 | false | Sí, tras confirmar | O3; IVA y condiciones no informados, se derivan del proveedor |
