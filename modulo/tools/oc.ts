/**
 * Herramientas del módulo reutilizable (PRD §9.4). No es una copia: reexporta las
 * mismas herramientas que usa la aplicación (src/tools/oc.ts), que no dependen del
 * servidor HTTP. Cada export { description, args, execute(args, ctx) } se expone
 * al modelo como oc_<export>.
 */
export { leer_paquete, validar, construir_payload, generar_evidencia, crear, listar_casos } from '../../src/tools/oc';
export type { ContextoHerramienta } from '../../src/tools/oc';
