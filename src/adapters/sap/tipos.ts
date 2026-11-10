/**
 * Puerto hacia SAP. El agente y las tools dependen de esta interfaz, no de una
 * implementación. En el reto se usa el mock; en producción se implementa un
 * adaptador real (OData de pedidos de compra o BAPI vía middleware) con el mismo contrato.
 */

export interface PosicionOC {
  descripcion: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  indicadorIva?: string;
  centroCosto?: string;
}

export interface SolicitudCreacionOC {
  /** Clave de idempotencia: el mismo caso nunca genera dos OC. */
  claveIdempotencia: string;
  proveedorNit: string;
  moneda: string;
  condicionPago?: string;
  posiciones: PosicionOC[];
  referenciaExterna: string;
}

export interface ResultadoCreacionOC {
  numeroOC: string;
  /** false si ya existía una OC para la misma clave (reintento idempotente). */
  creada: boolean;
  fechaRegistro: string;
}

export interface SapAdapter {
  crearOrdenCompra(solicitud: SolicitudCreacionOC): Promise<ResultadoCreacionOC>;
  consultarOrdenCompra(claveIdempotencia: string): Promise<ResultadoCreacionOC | undefined>;
}
