import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Evidencia de aprobación en PDF (HU-4, P1) con el mismo contenido y sha256 que aprobacion.txt.
 * Fechas de metadatos fijas (fecha del correo) para que el resultado sea reproducible.
 */
const MARGEN = 50;
const TAMANO = 10;
const INTERLINEA = 14;
const ANCHO_MAX = 595.28 - MARGEN * 2; // A4

/** Las fuentes estándar usan WinAnsi: se reemplaza lo que no puede codificarse. */
function aWinAnsi(texto: string): string {
  return texto.replace(/[^ -~ -ÿ\n]/g, '?');
}

function partirLinea(linea: string, medir: (s: string) => number): string[] {
  if (medir(linea) <= ANCHO_MAX) return [linea];
  const palabras = linea.split(' ');
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    const candidata = actual ? `${actual} ${p}` : p;
    if (medir(candidata) > ANCHO_MAX && actual) {
      lineas.push(actual);
      actual = p;
    } else actual = candidata;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

export async function generarEvidenciaPdf(texto: string, fecha: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const fechaDoc = new Date(fecha);
  if (!Number.isNaN(fechaDoc.getTime())) {
    doc.setCreationDate(fechaDoc);
    doc.setModificationDate(fechaDoc);
  }
  doc.setTitle('Evidencia de aprobación de orden de compra');
  doc.setProducer('agente-oc');
  doc.setCreator('agente-oc');

  const medir = (s: string) => fuente.widthOfTextAtSize(s, TAMANO);
  const lineas = aWinAnsi(texto).split('\n').flatMap((l) => partirLinea(l, medir));
  let pagina = doc.addPage([595.28, 841.89]);
  let y = pagina.getHeight() - MARGEN;
  for (const linea of lineas) {
    if (y < MARGEN) {
      pagina = doc.addPage([595.28, 841.89]);
      y = pagina.getHeight() - MARGEN;
    }
    pagina.drawText(linea, { x: MARGEN, y, size: TAMANO, font: fuente, color: rgb(0.1, 0.1, 0.1) });
    y -= INTERLINEA;
  }
  return doc.save({ useObjectStreams: false });
}
