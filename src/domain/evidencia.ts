/**
 * Evidencia de aprobación (HU-4, P0): texto con encabezados, cuerpo y sha256 del contenido.
 * Determinista: el mismo correo produce siempre el mismo sha256.
 */
import { createHash } from 'node:crypto';
import type { AprobacionPaquete } from './paquete';

export function generarEvidencia(a: AprobacionPaquete): { contenido: string; sha256: string; texto: string } {
  const contenido = [
    'EVIDENCIA DE APROBACIÓN DE ORDEN DE COMPRA',
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    '',
    a.texto,
    '',
  ].join('\n');
  const sha256 = createHash('sha256').update(contenido, 'utf8').digest('hex');
  return { contenido, sha256, texto: `${contenido}---\nsha256: ${sha256}\n` };
}
