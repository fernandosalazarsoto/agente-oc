import { createHash } from 'node:crypto';
import type { ResultadoCreacionOC, SapAdapter, SolicitudCreacionOC } from './tipos';

/**
 * SAP simulado. Determinista e idempotente:
 * - El número de OC se deriva de la clave de idempotencia (rango 45xxxxxxxx).
 * - Repetir la creación con la misma clave devuelve la misma OC con creada=false.
 * - La fecha de registro se inyecta para que demo y tests sean reproducibles.
 * El estado en memoria es por instancia; en serverless puede reiniciarse, pero el
 * número de OC sigue siendo el mismo para el mismo caso.
 */
export class SapMock implements SapAdapter {
  private readonly ordenes = new Map<string, ResultadoCreacionOC>();

  constructor(private readonly reloj: () => string = () => new Date().toISOString()) {}

  static numeroPara(clave: string): string {
    const hash = createHash('sha256').update(clave).digest();
    const n = hash.readUInt32BE(0) % 100_000_000;
    return `45${n.toString().padStart(8, '0')}`;
  }

  async crearOrdenCompra(solicitud: SolicitudCreacionOC): Promise<ResultadoCreacionOC> {
    if (solicitud.posiciones.length === 0) throw new Error('La OC debe tener al menos una posición');
    const existente = this.ordenes.get(solicitud.claveIdempotencia);
    if (existente) return { ...existente, creada: false };

    const resultado: ResultadoCreacionOC = {
      numeroOC: SapMock.numeroPara(solicitud.claveIdempotencia),
      creada: true,
      fechaRegistro: this.reloj(),
    };
    this.ordenes.set(solicitud.claveIdempotencia, resultado);
    return resultado;
  }

  async consultarOrdenCompra(clave: string): Promise<ResultadoCreacionOC | undefined> {
    return this.ordenes.get(clave);
  }

  get totalOrdenes(): number {
    return this.ordenes.size;
  }
}
