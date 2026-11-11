/**
 * demo.ts: verificación determinista SIN modelo de lenguaje (PRD §6.6).
 * Procesa los 6 casos de fixtures/reto-03/solicitudes/ llamando DIRECTAMENTE a las
 * herramientas zod de src/tools/oc.ts (las mismas que usa el agente) y compara contra
 * specs/esperados/reto-03.json. La confirmación humana de la demo es SIMULADA.
 *
 * Uso:  npm run demo        (o: npx tsx demo.ts · bun run demo.ts)
 * Limpia out/ al inicio. Sale con código 1 si algún resultado no coincide con lo esperado.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { directorioSalida, limpiarSalida } from './src/lib/salidas';
import * as oc from './src/tools/oc';

type Resp = { ok: boolean; data?: Record<string, unknown>; error?: string; requiere_confirmacion?: boolean };
type Esperado = { apta: boolean; bloqueos: string[]; confirmaciones: string[]; derivados: string[]; retroactiva: boolean; creaOC: string };

const raiz = process.cwd();
const ctx: oc.ContextoHerramienta = { directory: raiz, sessionId: 'demo' };
const ctxConfirmado: oc.ContextoHerramienta = { ...ctx, confirmadoPor: 'demo (confirmación simulada)' };
const esperados = JSON.parse(readFileSync(path.join(raiz, 'specs', 'esperados', 'reto-03.json'), 'utf8')) as {
  casos: Record<string, Esperado>;
  secuenciaDemo: { ordenes: Record<string, string> };
};

const json = (s: string) => JSON.parse(s) as Resp;
const cods = (xs: unknown) => (xs as Array<{ codigo: string }>).map((x) => x.codigo);
const lista = (xs: string[]) => (xs.length ? xs.join(', ') : '-');
let fallos = 0;
function verificar(condicion: boolean, mensaje: string) {
  if (!condicion) {
    fallos++;
    console.log(`   ✗ NO COINCIDE: ${mensaje}`);
  }
}

async function crear(caso: string, confirmado?: boolean): Promise<Resp> {
  const payload = json(await oc.construir_payload.execute({ caso }, ctx)).data?.payload ?? {};
  return json(await (confirmado ? oc.crear.execute({ caso, payload, confirmado: true }, ctxConfirmado) : oc.crear.execute({ caso, payload }, ctx)));
}

async function main() {
  await limpiarSalida(directorioSalida(raiz));
  const { casos } = json(await oc.listar_casos.execute({}, ctx)).data as { casos: string[] };
  console.log(`\nDemo sin LLM · dataset ${oc.dataset()} · ${casos.length} casos · herramientas llamadas directamente\n${'='.repeat(78)}`);

  // 1) Cada caso: leer → validar → (si es apta) payload + evidencia → crear sin confirmar
  for (const caso of casos) {
    const e = esperados.casos[caso];
    const paquete = json(await oc.leer_paquete.execute({ caso }, ctx));
    const v = json(await oc.validar.execute({ caso }, ctx));
    if (!paquete.ok || !v.ok || !v.data) {
      console.log(`\n${caso}: ERROR ${paquete.error ?? v.error}`);
      fallos++;
      continue;
    }
    const d = v.data;
    const bloqueos = cods(d.bloqueos);
    const confirmaciones = cods(d.confirmaciones);
    const derivados = Object.entries(d.derivados as Record<string, { valor: string }>).map(([k, x]) => `${k}=${x.valor}`);
    console.log(`\n▶ ${caso} (${String(d.solicitud_id)})`);
    console.log(`   apta=${String(d.apta)} · bloqueos: ${lista(bloqueos)} · confirmaciones: ${lista(confirmaciones)} · retroactiva=${String(d.retroactiva)}`);
    if (derivados.length) console.log(`   derivados: ${derivados.join(', ')}`);

    let resultado: string;
    if (!d.apta) {
      const b = (d.bloqueos as Array<{ codigo: string; detalle: string; accion_sugerida: string }>)[0]!;
      resultado = `NO SE CREA · ${b.codigo}: ${b.detalle} → ${b.accion_sugerida}`;
    } else {
      const ev = json(await oc.generar_evidencia.execute({ caso }, ctx)).data as { ruta: string; sha256: string };
      const r = await crear(caso);
      resultado = r.ok
        ? `OC ${String(r.data?.numero_oc)} creada · evidencia ${ev.ruta}`
        : `PENDIENTE DE CONFIRMACIÓN · ${r.error ?? ''}`;
    }
    console.log(`   ${resultado}`);

    if (e) {
      verificar(d.apta === e.apta, `${caso} apta`);
      verificar(JSON.stringify(bloqueos) === JSON.stringify(e.bloqueos), `${caso} bloqueos ${lista(bloqueos)} vs ${lista(e.bloqueos)}`);
      verificar(JSON.stringify(confirmaciones) === JSON.stringify(e.confirmaciones), `${caso} confirmaciones`);
      verificar(d.retroactiva === e.retroactiva, `${caso} retroactiva`);
    } else verificar(false, `${caso} sin resultado esperado en specs/esperados/reto-03.json`);
  }

  // 2) Idempotencia: sol-001 por segunda vez devuelve el mismo número
  console.log(`\n${'-'.repeat(78)}\nIdempotencia: sol-001 por segunda vez`);
  const repetida = await crear('sol-001');
  console.log(`   OC ${String(repetida.data?.numero_oc)} · idempotente=${String(repetida.data?.idempotente)}`);
  verificar(repetida.data?.idempotente === true && repetida.data?.numero_oc === esperados.secuenciaDemo.ordenes['sol-001'], 'idempotencia sol-001');

  // 3) Confirmación explícita (simulada) de los casos con excepciones
  for (const caso of ['sol-004', 'sol-005', 'sol-006']) {
    console.log(`\nConfirmación explícita (simulada) de ${caso}: "Confirmo la creación de la OC de ${caso}"`);
    const r = await crear(caso, true);
    console.log(r.ok ? `   OC ${String(r.data?.numero_oc)} creada · retroactiva=${String(r.data?.retroactiva)} · evidencia ${String(r.data?.evidencia)}` : `   ERROR ${r.error}`);
    verificar(r.data?.numero_oc === esperados.secuenciaDemo.ordenes[caso], `${caso} número de OC`);
  }

  console.log(`\n${'='.repeat(78)}\nSalidas: out/sap/ordenes.jsonl · out/control.csv · out/log.jsonl · out/<caso>/{trazabilidad.json,aprobacion.txt}`);
  console.log(readFileSync(path.join(directorioSalida(raiz), 'control.csv'), 'utf8'));
  console.log(fallos === 0 ? '✔ Todos los resultados coinciden con specs/esperados/reto-03.json' : `✗ ${fallos} diferencia(s) con lo esperado`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('La demo falló:', error);
  process.exit(1);
});
