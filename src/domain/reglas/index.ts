/**
 * Reglas de control RC1–RC10 (PRD §7.3). Puras y deterministas: no leen disco,
 * no usan la fecha del sistema y evalúan un solo caso a la vez.
 * Especificación y criterios de aceptación: specs/controles.md.
 */
import { aCentavos } from '../dinero';
import { compararFechas } from '../fechas';
import { type Maestros, type Paquete, type Proveedor, ErrorPaquete, nitBase } from '../paquete';
import { normalizar } from '../texto';

export type CodigoControl = 'RC1' | 'RC2' | 'RC3' | 'RC4' | 'RC5' | 'RC6' | 'RC7' | 'RC8' | 'RC9' | 'RC10' | 'EST';
export type EstadoControl = 'CUMPLE' | 'BLOQUEO' | 'CONFIRMACION' | 'DERIVADO' | 'NO_EVALUABLE';

export interface Bloqueo {
  codigo: CodigoControl;
  detalle: string;
  accion_sugerida: string;
}
export interface Confirmacion {
  codigo: CodigoControl;
  detalle: string;
  valores?: Record<string, string | number>;
}
export interface Derivado {
  valor: string;
  fuente: string;
}
export interface Validacion {
  apta: boolean;
  bloqueos: Bloqueo[];
  confirmaciones: Confirmacion[];
  derivados: { indicador_iva?: Derivado; condiciones_pago?: Derivado };
  retroactiva: boolean;
  controles: Array<{ codigo: CodigoControl; estado: EstadoControl; detalle: string }>;
  proveedor: { codigo_sap: string; nit: string; nombre: string } | null;
}

const COP = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n);
const nombreNormalizado = (s: string) => normalizar(s).replace(/[^a-z0-9]/g, '');

function buscarProveedor(m: Maestros, nombre: string, nit?: string): Proveedor | undefined {
  if (nit) return m.proveedores.find((p) => nitBase(p.nit) === nitBase(nit));
  return m.proveedores.find((p) => nombreNormalizado(p.nombre) === nombreNormalizado(nombre));
}

export function validarPaquete(p: Paquete, m: Maestros): Validacion {
  const s = p.solicitud;
  if (!s) throw new ErrorPaquete('Falta solicitud.json: pida al solicitante el Excel de solicitud de compra');

  const bloqueos: Bloqueo[] = [];
  const confirmaciones: Confirmacion[] = [];
  const derivados: Validacion['derivados'] = {};
  const controles: Validacion['controles'] = [];
  const registrar = (codigo: CodigoControl, estado: EstadoControl, detalle: string) => controles.push({ codigo, estado, detalle });
  const bloquear = (codigo: CodigoControl, detalle: string, accion_sugerida: string) => {
    bloqueos.push({ codigo, detalle, accion_sugerida });
    registrar(codigo, 'BLOQUEO', detalle);
  };
  const confirmar = (codigo: CodigoControl, detalle: string, valores?: Confirmacion['valores']) => {
    confirmaciones.push({ codigo, detalle, ...(valores ? { valores } : {}) });
    registrar(codigo, 'CONFIRMACION', detalle);
  };

  // RC1 · Proveedor existe y activo (por NIT; sin NIT, por nombre normalizado)
  const prov = buscarProveedor(m, s.proveedor_nombre, s.proveedor_nit);
  const idProv = `"${s.proveedor_nombre}" (NIT ${s.proveedor_nit ?? 'no informado'})`;
  if (!prov) {
    bloquear('RC1', `El proveedor ${idProv} no existe en el maestro de proveedores`,
      'Solicitar a Compras la creación del proveedor en SAP o corregir el NIT en la solicitud, y reprocesar');
  } else if (!prov.activo) {
    bloquear('RC1', `El proveedor ${prov.nombre} (código SAP ${prov.codigo_sap}) está inactivo`,
      'Reactivar el proveedor en el maestro o cambiar a un proveedor activo');
  } else {
    registrar('RC1', 'CUMPLE', `${prov.nombre} (código SAP ${prov.codigo_sap}) existe y está activo`);
  }

  // RC2 · Aprobación válida para el centro de costo
  const centro = m.centrosCosto.find((c) => c.centro_costo === s.centro_costo);
  const ap = p.aprobacion;
  const aprobador = ap && centro?.aprobadores.find((a) => normalizar(a.email) === normalizar(ap.de));
  const conTope = centro?.aprobadores.filter((a) => a.tope >= s.valor_total) ?? [];
  const sugerirAprobador = conTope.length
    ? `Solicitar la aprobación a ${conTope.map((a) => a.email).join(' o ')}`
    : `Ningún aprobador de ${s.centro_costo} tiene tope para COP ${COP(s.valor_total)} (${centro?.aprobadores.map((a) => `${a.email}: ${COP(a.tope)}`).join(', ') || 'sin aprobadores'}): escalar a Dirección o actualizar la matriz de aprobación`;
  if (!ap) {
    bloquear('RC2', 'No hay correo de aprobación del líder', 'Pedir al líder del centro de costo que responda el correo con "Aprobado"');
  } else if (!ap.aprobado) {
    bloquear('RC2', `El correo de ${ap.de} no contiene una aprobación ("Aprobado")`, 'Pedir al líder una respuesta explícita con "Aprobado"');
  } else if (!aprobador) {
    bloquear('RC2', `${ap.de} no es aprobador del centro de costo ${s.centro_costo}`, sugerirAprobador);
  } else {
    registrar('RC2', 'CUMPLE', `${ap.de} es aprobador de ${s.centro_costo} y el correo dice "Aprobado"`);
  }

  // RC3 · Valor dentro del tope del aprobador para ese centro (S-03: no se duplica el bloqueo de RC2)
  if (!aprobador) {
    registrar('RC3', 'NO_EVALUABLE', 'Sin aprobador válido del centro (ver RC2)');
  } else if (s.valor_total > aprobador.tope) {
    bloquear('RC3', `Valor COP ${COP(s.valor_total)} supera el tope de ${aprobador.email} en ${s.centro_costo} (COP ${COP(aprobador.tope)})`, sugerirAprobador);
  } else {
    registrar('RC3', 'CUMPLE', `COP ${COP(s.valor_total)} ≤ tope COP ${COP(aprobador.tope)}`);
  }

  // RC4 · Subárea del centro de costo
  if (!centro) {
    bloquear('RC4', `El centro de costo ${s.centro_costo} no existe en el maestro`, 'Corregir el centro de costo en la solicitud');
  } else if (!centro.subareas.includes(s.subarea)) {
    bloquear('RC4', `La subárea "${s.subarea}" no pertenece a ${s.centro_costo} (${centro.subareas.join(', ')})`, 'Corregir la subárea en la solicitud');
  } else {
    registrar('RC4', 'CUMPLE', `"${s.subarea}" pertenece a ${s.centro_costo}`);
  }

  // RC5 · Cotización vs solicitud (≤ 2 %), comparación exacta en centavos
  const cot = p.cotizacion;
  if (!cot) {
    confirmar('RC5', 'No hay cotización legible: confirmar la creación sin cotización');
  } else {
    const sol = aCentavos(s.valor_total);
    const dif = Math.abs(aCentavos(cot.total) - sol);
    if (dif * 100 > 2 * sol) {
      const pct = Math.round((dif / sol) * 10000) / 100;
      confirmar('RC5', `Cotización COP ${COP(cot.total)} vs solicitud COP ${COP(s.valor_total)}: diferencia ${pct} % (> 2 %)`,
        { solicitud: s.valor_total, cotizacion: cot.total, diferencia_pct: pct });
    } else {
      registrar('RC5', 'CUMPLE', `Cotización COP ${COP(cot.total)} vs solicitud COP ${COP(s.valor_total)} (≤ 2 %)`);
    }
  }

  // RC6 · Indicador de IVA (derivado + confirmación si falta)
  if (s.indicador_iva) {
    if (!m.indicadoresIva.some((i) => i.codigo === s.indicador_iva)) {
      bloquear('EST', `Indicador de IVA "${s.indicador_iva}" no existe en el maestro`, 'Corregir el indicador de IVA en la solicitud');
    } else registrar('RC6', 'CUMPLE', `Indicador de IVA ${s.indicador_iva} informado en la solicitud`);
  } else if (prov) {
    derivados.indicador_iva = { valor: prov.indicador_iva_default, fuente: 'maestro.proveedores.indicador_iva_default' };
    confirmar('RC6', `La solicitud no informa IVA: se propone ${prov.indicador_iva_default} (default de ${prov.nombre})`,
      { indicador_iva: prov.indicador_iva_default });
  } else registrar('RC6', 'NO_EVALUABLE', 'IVA no informado y proveedor no encontrado (ver RC1)');

  // RC7 · Condiciones de pago (derivado, solo se informa)
  if (s.condiciones_pago) {
    if (!m.condicionesPago.some((c) => c.codigo === s.condiciones_pago)) {
      bloquear('EST', `Condición de pago "${s.condiciones_pago}" no existe en el maestro`, 'Corregir la condición de pago en la solicitud');
    } else registrar('RC7', 'CUMPLE', `Condiciones de pago ${s.condiciones_pago} informadas en la solicitud`);
  } else if (prov) {
    derivados.condiciones_pago = { valor: prov.condiciones_pago_default, fuente: 'maestro.proveedores.condiciones_pago_default' };
    registrar('RC7', 'DERIVADO', `Condiciones de pago ${prov.condiciones_pago_default} tomadas del proveedor ${prov.nombre}`);
  } else registrar('RC7', 'NO_EVALUABLE', 'Condiciones no informadas y proveedor no encontrado (ver RC1)');

  // RC8 · Factura anterior a la solicitud → retroactiva
  const retroactiva = p.factura !== null && compararFechas(p.factura.fecha, s.fecha_solicitud) < 0;
  if (retroactiva && p.factura) {
    confirmar('RC8', `OC retroactiva: la factura ${p.factura.numero} (${p.factura.fecha}) es anterior a la solicitud (${s.fecha_solicitud})`,
      { factura: p.factura.numero, fecha_factura: p.factura.fecha, fecha_solicitud: s.fecha_solicitud });
  } else registrar('RC8', 'CUMPLE', p.factura ? 'La factura no es anterior a la solicitud' : 'Sin factura en el paquete');

  // RC9 · Fecha de aprobación ≥ fecha de solicitud
  if (ap && compararFechas(ap.fecha, s.fecha_solicitud) < 0) {
    confirmar('RC9', `La aprobación (${ap.fecha}) es anterior a la solicitud (${s.fecha_solicitud})`,
      { fecha_aprobacion: ap.fecha, fecha_solicitud: s.fecha_solicitud });
  } else registrar('RC9', ap ? 'CUMPLE' : 'NO_EVALUABLE', ap ? 'Aprobación posterior o igual a la solicitud' : 'Sin aprobación (ver RC2)');

  // RC10 · cantidad × valor_unitario = valor_total (± 1 unidad monetaria)
  const calculado = Math.round(s.cantidad * aCentavos(s.valor_unitario));
  if (Math.abs(calculado - aCentavos(s.valor_total)) > 100) {
    bloquear('RC10', `${s.cantidad} × ${COP(s.valor_unitario)} = ${COP(calculado / 100)} ≠ valor total ${COP(s.valor_total)}`,
      'Pedir al solicitante corregir cantidad, valor unitario o valor total');
  } else registrar('RC10', 'CUMPLE', `${s.cantidad} × ${COP(s.valor_unitario)} = ${COP(s.valor_total)}`);

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
    controles,
    proveedor: prov && prov.activo ? { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre } : null,
  };
}
