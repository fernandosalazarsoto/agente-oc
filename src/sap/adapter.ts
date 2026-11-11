/**
 * Puerto hacia SAP (PRD §7.4, interfaz obligatoria). Las herramientas dependen de
 * esta interfaz, no de una implementación: el mock escribe en out/sap/ y el
 * adaptador real (diseñado en SOLUCION.md §6) usaría OData API_PURCHASEORDER_PROCESS_SRV.
 */
import type { OrdenCompra } from '../domain/orden';

export type { OrdenCompra };

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>;
}
