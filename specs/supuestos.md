# Supuestos y decisiones

Registro de ambigüedades del PRD y cómo se resolvieron. Cada supuesto indica su impacto y si quedó validado.

| # | Tema | Supuesto adoptado | Alternativa descartada | Impacto si es incorrecto | Estado |
|---|------|-------------------|------------------------|--------------------------|--------|
| S-01 | Base técnica | Se partió de una base técnica preparada antes de la prueba (chat, despliegue, motor de controles genérico, CI). Specs, controles, tools de negocio y tests de negocio se desarrollaron durante la prueba. | Crear todo desde cero en la sesión | Ninguno funcional; se declara por transparencia | Declarado |
| S-02 | Decisiones que permiten OC | Solo `APTA` habilita crear OC | Permitir `REQUIERE_REVISION` con aprobación | Se crearían OC sin revisión de excepciones | Por validar con PRD |
