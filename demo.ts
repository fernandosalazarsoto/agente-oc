/**
 * demo.ts: verificación determinista SIN modelo de lenguaje.
 * Procesa todos los casos del set llamando directamente a las herramientas
 * (los mismos handlers que usa el agente), imprime la matriz de controles y
 * compara contra los resultados esperados de specs/esperados/<set>.json.
 *
 * Uso:  npm run demo                    (dataset por defecto: ejemplo)
 *       DATASET=reto-03 npm run demo
 * Sale con código 1 si algún caso no coincide con lo esperado.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SapMock } from './src/adapters/sap/mock';
import { listarCasos } from './src/data/repositorio';
import { crearHandlersOC } from './src/tools/oc';

const DATASET = process.env.DATASET || 'ejemplo';
const SET = DATASET;
const RUTA_ESPERADOS = path.join('specs', 'esperados', `${SET}.json`);
const FECHA_FIJA = '2026-01-15T00:00:00.000Z';

type Esperado = { decision: string; bloqueantes: string[]; advertencias: string[]; creaOC: boolean };

function mismoConjunto(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function main() {
  const esperados: Record<string, Esperado> = existsSync(RUTA_ESPERADOS)
    ? JSON.parse(readFileSync(RUTA_ESPERADOS, 'utf8'))
    : {};
  const casos = await listarCasos(DATASET);
  if (casos.length === 0) throw new Error(`No hay casos en ${DATASET}/solicitudes`);

  console.log(`\nSet: ${SET} · ${casos.length} casos · sin LLM\n${'='.repeat(72)}`);
  const resumen: Array<Record<string, string>> = [];
  let fallos = 0;

  for (const casoId of casos) {
    // Dependencias nuevas por caso: ningún estado se comparte entre casos.
    const sap = new SapMock(() => FECHA_FIJA);
    const h = crearHandlersOC({ dataset: DATASET, sap });

    console.log(`\n▶ ${casoId}`);
    const v = await h.validarCaso({ casoId });
    if (!v.ok) {
      console.log(`  ERROR ${v.error}: ${v.mensaje}`);
      fallos += 1;
      resumen.push({ caso: casoId, decision: 'ERROR', oc: '-', esperado: esperados[casoId]?.decision ?? '?', resultado: 'FALLA' });
      continue;
    }
    console.table(v.controles.map((c) => ({ control: c.id, estado: c.estado, severidad: c.severidad, evidencia: c.evidencia })));

    // Aprobación humana simulada: en el chat la otorga el usuario en la interfaz.
    const oc = await h.crearOrdenCompra({ casoId });
    const textoOC = oc.ok && 'oc' in oc ? oc.oc.numeroOC : 'no creada';
    console.log(`  Decisión: ${v.decision} · OC: ${textoOC}${!oc.ok && 'motivo' in oc ? ` (${oc.motivo})` : ''}`);

    const e = esperados[casoId];
    const coincide =
      e !== undefined &&
      e.decision === v.decision &&
      mismoConjunto(e.bloqueantes, v.bloqueantes) &&
      mismoConjunto(e.advertencias, v.advertencias) &&
      e.creaOC === oc.ok;
    if (!coincide) fallos += 1;
    resumen.push({
      caso: casoId,
      decision: v.decision,
      oc: textoOC,
      esperado: e?.decision ?? 'SIN ESPECIFICAR',
      resultado: coincide ? 'OK' : 'FALLA',
    });
  }

  console.log(`\n${'='.repeat(72)}\nResumen`);
  console.table(resumen);
  console.log(fallos === 0 ? `\n✔ ${casos.length}/${casos.length} casos conformes a la especificación\n` : `\n✘ ${fallos} caso(s) no conformes\n`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Error en demo:', error);
  process.exitCode = 1;
});
