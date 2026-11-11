---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia (reglas RC1-RC10, creación de OC, retroactivas y acciones sugeridas). Usar al procesar solicitudes de compra.
---
## Proceso de órdenes de compra (as-is y to-be)

- Cada compra llega a administración por correo con tres piezas: la solicitud (Excel), la cotización del proveedor y el correo de aprobación del líder. En los fixtures llegan normalizadas como `solicitud.json`, `cotizacion.txt` y `aprobacion.json`; `factura.txt` solo existe si la factura llegó antes que la OC.
- Hoy la analista digita en SAP: proveedor, descripción, centro de costo, subárea, valor, indicador de IVA, aprobador y condiciones de pago, y adjunta el correo de aprobación como PDF.
- El agente elimina la digitación en el flujo normal y convierte las dudas en confirmaciones explícitas.

## Reglas de control (PRD §7.3)

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo | Bloqueo |
| RC2 | La aprobación existe, dice "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización y solicitud no difieren más de 2 % (sin cotización: confirmar) | Confirmación |
| RC6 | Sin indicador de IVA: se toma el del proveedor y se confirma | Confirmación + derivado |
| RC7 | Sin condiciones de pago: se toman las del proveedor (solo se informa) | Derivado |
| RC8 | Factura anterior a la solicitud: OC retroactiva, se confirma y se marca | Confirmación |
| RC9 | La aprobación no puede ser anterior a la solicitud | Confirmación |
| RC10 | Cantidad × valor unitario = valor total (± 1) | Bloqueo |

## Cómo se crea la OC

- La OC se construye con los valores de la solicitud que aprobó el líder; si la cotización difiere, la diferencia queda como excepción confirmada en la OC.
- Datos fijos de la organización: sociedad 1000, organización de compras 1000.
- La evidencia de aprobación (`out/<caso>/aprobacion.txt`) lleva encabezados, cuerpo y sha256; ese sha256 va en la OC.
- El SAP simulado numera desde 4500000001 y es idempotente por solicitud: repetir la creación devuelve el mismo número.
- Cada intento (creada, idempotente, pendiente de confirmación o bloqueada) queda en `out/control.csv` con la marca de retroactiva; Contabilidad y Auditoría consumen ese archivo.

## OC retroactivas

- Son las OC creadas después de recibir la factura: el proceso se salta la cotización previa y la aprobación queda como trámite. La dirección quiere medir cuántas hay.
- El agente no decide la política (tolerar con marca o rechazar): las detecta, pide confirmación y las marca `retroactiva = true` en el log de control.

## Acciones sugeridas típicas

- Proveedor inexistente o inactivo: Compras debe crearlo o reactivarlo en el maestro, o corregir el NIT.
- Aprobador sin autoridad o tope insuficiente: pedir la aprobación a un aprobador del centro con tope suficiente, o escalar si ninguno lo tiene.
- Diferencia cotización vs solicitud: confirmar con el solicitante; si el valor real es el de la cotización, puede requerir nueva aprobación.
- Paquete incompleto o mal formado: pedir al solicitante el documento que falta o corregido.
