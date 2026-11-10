/**
 * PUNTO DE EXTENSIÓN DEL RETO.
 * Aquí viven los esquemas de los archivos, el contexto de validación y la lista
 * de controles. Lo actual es un EJEMPLO mínimo para probar la tubería de punta a
 * punta; se reemplaza por los controles derivados del PRD (ver specs/controles.md).
 */
import { z } from 'zod';
import type { CasoCrudo, MaestrosCrudos } from '../../data/repositorio';
import { type Control, type ResultadoValidacion, ejecutarControles } from '../controles';
import { type Centavos, aCentavos, iguales, parsearMonto, formatearCOP } from '../dinero';
import { extraerCampo, mismoNit } from '../texto';

// ---------- Esquemas de entrada (ajustar a los archivos reales) ----------

export const esquemaProveedor = z.object({
  nit: z.string(),
  nombre: z.string(),
  estado: z.string(),
});

export const esquemaSolicitud = z.object({
  id: z.string(),
  nitProveedor: z.string(),
  monto: z.number().nonnegative(),
  moneda: z.string().default('COP'),
  descripcion: z.string(),
});

export const esquemaAprobacion = z.object({
  aprobador: z.string(),
  aprobado: z.boolean(),
  fecha: z.string(),
});

// ---------- Contexto de un caso ----------

export interface ContextoValidacion {
  casoId: string;
  solicitud: z.infer<typeof esquemaSolicitud>;
  aprobacion: z.infer<typeof esquemaAprobacion>;
  proveedor?: z.infer<typeof esquemaProveedor>;
  cotizacion: { nit?: string; total?: Centavos; textoTotal?: string };
  tieneFactura: boolean;
}

export function construirContexto(caso: CasoCrudo, maestros: MaestrosCrudos): ContextoValidacion {
  const solicitud = esquemaSolicitud.parse(caso.solicitud);
  const aprobacion = esquemaAprobacion.parse(caso.aprobacion);
  const proveedores = z.array(esquemaProveedor).parse(maestros.proveedores);

  const textoTotal = extraerCampo(caso.cotizacion, ['total', 'valor total']);
  const nitCotizacion = extraerCampo(caso.cotizacion, ['nit']);

  return {
    casoId: caso.id,
    solicitud,
    aprobacion,
    proveedor: proveedores.find((p) => mismoNit(p.nit, solicitud.nitProveedor)),
    cotizacion: {
      nit: nitCotizacion,
      textoTotal,
      total: textoTotal ? aCentavos(parsearMonto(textoTotal)) : undefined,
    },
    tieneFactura: caso.factura !== undefined,
  };
}

// ---------- Controles (EJEMPLO) ----------

export const controles: readonly Control<ContextoValidacion>[] = [
  {
    id: 'EJ-01',
    nombre: 'Proveedor existe en maestro y está activo',
    severidad: 'BLOQUEANTE',
    evaluar: ({ proveedor, solicitud }) => {
      if (!proveedor) {
        return { estado: 'NO_CUMPLE', evidencia: `NIT ${solicitud.nitProveedor} no existe en el maestro de proveedores` };
      }
      return proveedor.estado.toUpperCase() === 'ACTIVO'
        ? { estado: 'CUMPLE', evidencia: `${proveedor.nombre} (NIT ${proveedor.nit}) está ACTIVO` }
        : { estado: 'NO_CUMPLE', evidencia: `${proveedor.nombre} está en estado ${proveedor.estado}` };
    },
  },
  {
    id: 'EJ-02',
    nombre: 'Total de la cotización coincide con el monto solicitado',
    severidad: 'BLOQUEANTE',
    evaluar: ({ cotizacion, solicitud }) => {
      if (cotizacion.total === undefined) {
        return { estado: 'NO_CUMPLE', evidencia: 'No se encontró el total en la cotización' };
      }
      const solicitado = aCentavos(solicitud.monto);
      return iguales(cotizacion.total, solicitado)
        ? { estado: 'CUMPLE', evidencia: `Cotización ${formatearCOP(cotizacion.total)} = solicitud ${formatearCOP(solicitado)}` }
        : { estado: 'NO_CUMPLE', evidencia: `Cotización ${formatearCOP(cotizacion.total)} ≠ solicitud ${formatearCOP(solicitado)}` };
    },
  },
  {
    id: 'EJ-03',
    nombre: 'Existe aprobación registrada',
    severidad: 'BLOQUEANTE',
    evaluar: ({ aprobacion }) =>
      aprobacion.aprobado
        ? { estado: 'CUMPLE', evidencia: `Aprobado por ${aprobacion.aprobador} el ${aprobacion.fecha}` }
        : { estado: 'NO_CUMPLE', evidencia: `La aprobación de ${aprobacion.aprobador} no está otorgada` },
  },
];

// ---------- Propuesta de OC (se construye solo desde datos validados) ----------

export interface PropuestaOC {
  casoId: string;
  proveedorNit: string;
  proveedorNombre: string;
  montoCentavos: number;
  moneda: string;
  descripcion: string;
}

export interface ResultadoCaso extends ResultadoValidacion {
  casoId: string;
  propuesta?: PropuestaOC;
}

export function validarCaso(caso: CasoCrudo, maestros: MaestrosCrudos): ResultadoCaso {
  let ctx: ContextoValidacion;
  try {
    ctx = construirContexto(caso, maestros);
  } catch (error) {
    // Datos que no cumplen el esquema: rechazo explícito, nunca se adivina.
    return {
      casoId: caso.id,
      decision: 'RECHAZADA',
      bloqueantes: ['ESTRUCTURA'],
      advertencias: [],
      controles: [
        {
          id: 'ESTRUCTURA',
          nombre: 'Estructura de los archivos del caso',
          severidad: 'BLOQUEANTE',
          estado: 'NO_CUMPLE',
          evidencia: error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message,
        },
      ],
    };
  }

  const resultado = ejecutarControles(ctx, controles);
  const propuesta: PropuestaOC | undefined =
    resultado.decision === 'RECHAZADA' || !ctx.proveedor
      ? undefined
      : {
          casoId: ctx.casoId,
          proveedorNit: ctx.proveedor.nit,
          proveedorNombre: ctx.proveedor.nombre,
          montoCentavos: aCentavos(ctx.solicitud.monto),
          moneda: ctx.solicitud.moneda,
          descripcion: ctx.solicitud.descripcion,
        };

  return { casoId: ctx.casoId, ...resultado, ...(propuesta ? { propuesta } : {}) };
}
