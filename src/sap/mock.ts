import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { anexarLinea, ahoraBogota } from '../lib/salidas';
import { nitBase, type Proveedor } from '../domain/paquete';
import type { OrdenCompra, SapAdapter } from './adapter';

/**
 * SAP simulado sobre archivos (PRD HU-5):
 * - Numeración secuencial desde 4500000001 en out/sap/ordenes.jsonl.
 * - Idempotente por solicitud_id: repetir devuelve el número existente.
 * - Fecha de registro en hora de Bogotá con offset -05:00.
 */
export class SapMock implements SapAdapter {
  static readonly PRIMER_NUMERO = 4_500_000_001;

  constructor(
    private readonly dirSap: string,
    private readonly dirDataset: string,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  static fechaBogota(fecha: Date): string {
    return ahoraBogota(fecha);
  }

  private async leerOrdenes(): Promise<Array<{ numero_oc: string; fecha: string; orden: OrdenCompra }>> {
    try {
      const texto = await readFile(path.join(this.dirSap, 'ordenes.jsonl'), 'utf8');
      return texto.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { numero_oc: string; fecha: string; orden: OrdenCompra });
    } catch {
      return [];
    }
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const texto = await readFile(path.join(this.dirDataset, 'maestros', 'proveedores.json'), 'utf8');
    const p = (JSON.parse(texto) as Proveedor[]).find((x) => nitBase(x.nit) === nitBase(nit));
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const o = (await this.leerOrdenes()).find((x) => x.orden.referencia.solicitud_id === solicitud_id);
    return o ? { numero_oc: o.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const ordenes = await this.leerOrdenes();
    const existente = ordenes.find((x) => x.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha };
    const ultimo = ordenes.reduce((max, o) => Math.max(max, Number(o.numero_oc)), SapMock.PRIMER_NUMERO - 1);
    const registro = { numero_oc: String(ultimo + 1), fecha: SapMock.fechaBogota(this.reloj()), orden };
    await anexarLinea(this.dirSap, 'ordenes.jsonl', JSON.stringify(registro));
    return { numero_oc: registro.numero_oc, fecha: registro.fecha };
  }
}
