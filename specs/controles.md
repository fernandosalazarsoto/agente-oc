# Especificación de controles

> Fuente de verdad: `PRD.md`. Cada control se traza a una sección del PRD y a sus tests.
> Completar ANTES de implementar. Los ejemplos EJ-0x son de la plantilla y se eliminan.

## Convenciones

- **Estado:** CUMPLE · NO_CUMPLE · ALERTA · NO_APLICA
- **Severidad:** BLOQUEANTE (impide crear OC) · ADVERTENCIA (requiere revisión humana)
- **Decisión:** RECHAZADA si hay un bloqueante incumplido; REQUIERE_REVISION si hay alertas o advertencias; APTA en otro caso. *(Confirmar contra el PRD.)*

## Matriz de controles

| Id | Control | Regla | Fuente de datos | Severidad | PRD § | Tests |
|----|---------|-------|-----------------|-----------|-------|-------|
| C-01 | | | | | | |
| C-02 | | | | | | |
| C-03 | | | | | | |

## Criterios de aceptación

### C-01: <nombre>

- **Dado** <contexto del caso>
- **Cuando** se valida la solicitud
- **Entonces** el control queda <estado> con evidencia "<qué se comparó>"

Casos borde:
- <valor exactamente en el tope>
- <dato ausente o mal formado>

## Trazabilidad caso → controles

| Caso | Decisión esperada | Bloqueantes | Advertencias | Crea OC | Justificación (PRD §) |
|------|-------------------|-------------|--------------|---------|------------------------|
| sol-001 | | | | | |
| sol-002 | | | | | |
| sol-003 | | | | | |
| sol-004 | | | | | |
| sol-005 | | | | | |
| sol-006 | | | | | |
