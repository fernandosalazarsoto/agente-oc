import { cpSync, mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ArchivosCaso, Maestros } from '@/src/domain/paquete';
import { parsearMaestros } from '@/src/domain/paquete';
import type { ContextoHerramienta } from '@/src/tools/oc';

/** Raíz de los fixtures entregados (solo lectura). */
export const RAIZ_FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'reto-03');

function leerJsonOpcional(ruta: string): unknown | null {
  return existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null;
}
function leerTextoOpcional(ruta: string): string | null {
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
}

/** Archivos crudos de un caso, como copia independiente que el test puede modificar. */
export function archivosDe(caso: string): ArchivosCaso {
  const dir = path.join(RAIZ_FIXTURES, 'solicitudes', caso);
  return structuredClone({
    correo: leerJsonOpcional(path.join(dir, 'correo.json')),
    solicitud: leerJsonOpcional(path.join(dir, 'solicitud.json')),
    cotizacion: leerTextoOpcional(path.join(dir, 'cotizacion.txt')),
    aprobacion: leerJsonOpcional(path.join(dir, 'aprobacion.json')),
    factura: leerTextoOpcional(path.join(dir, 'factura.txt')),
  });
}

export function maestros(): Maestros {
  const dir = path.join(RAIZ_FIXTURES, 'maestros');
  return parsearMaestros({
    proveedores: leerJsonOpcional(path.join(dir, 'proveedores.json')),
    centrosCosto: leerJsonOpcional(path.join(dir, 'centros-costo.json')),
    indicadoresIva: leerJsonOpcional(path.join(dir, 'indicadores-iva.json')),
    condicionesPago: leerJsonOpcional(path.join(dir, 'condiciones-pago.json')),
  });
}

/**
 * Proyecto temporal con una copia de fixtures/reto-03 y casos defectuosos
 * adicionales. Cada test usa su propio directorio: out/ nunca se comparte.
 */
export function proyectoTemporal(): ContextoHerramienta {
  const raiz = mkdtempSync(path.join(tmpdir(), 'agente-oc-'));
  const destino = path.join(raiz, 'fixtures', 'reto-03');
  cpSync(RAIZ_FIXTURES, destino, { recursive: true });

  const sol = (nombre: string) => {
    const dir = path.join(destino, 'solicitudes', nombre);
    cpSync(path.join(destino, 'solicitudes', 'sol-001'), dir, { recursive: true });
    return dir;
  };
  // Paquete incompleto: sin cotizacion.txt (HU-1, RC5)
  const sinCot2 = path.join(destino, 'solicitudes', 'sol-x-sin-cot');
  mkdirSync(sinCot2, { recursive: true });
  for (const f of ['correo.json', 'solicitud.json', 'aprobacion.json']) {
    cpSync(path.join(destino, 'solicitudes', 'sol-001', f), path.join(sinCot2, f));
  }
  // JSON malformado (HU-6)
  writeFileSync(path.join(sol('sol-x-json'), 'solicitud.json'), '{ "solicitud_id": "SOL-X", ');
  // Monto no numérico (HU-6)
  const dirMonto = sol('sol-x-monto');
  const s = JSON.parse(readFileSync(path.join(dirMonto, 'solicitud.json'), 'utf8')) as Record<string, unknown>;
  s.valor_total = 'once millones';
  writeFileSync(path.join(dirMonto, 'solicitud.json'), JSON.stringify(s));

  return { directory: raiz, sessionId: 'test-sesion' };
}

export function leerSalida(ctx: ContextoHerramienta, ...partes: string[]): string {
  return readFileSync(path.join(ctx.directory, 'out', ...partes), 'utf8');
}

export function existeSalida(ctx: ContextoHerramienta, ...partes: string[]): boolean {
  return existsSync(path.join(ctx.directory, 'out', ...partes));
}

/** Parsea la respuesta string de una herramienta. */
export function json<T = { ok: boolean; data?: Record<string, unknown>; error?: string }>(s: string): T {
  return JSON.parse(s) as T;
}
