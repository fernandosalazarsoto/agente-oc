import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdaptadorLLM, MensajeLLM, RespuestaLLM } from '@/src/llm/adapter';
import { firmarEstado, verificarEstado, type EstadoSesion } from '@/src/agent/estado';
import { crearSesion } from '@/src/agent/ciclo';
import { AlmacenSesiones } from '@/src/agent/sesiones';
import { atenderChat } from '@/src/agent/servicio';
import { proyectoTemporal } from './ayudas';

const SECRETO = 'x'.repeat(40);

/** Modelo falso con guion mínimo: procesa el caso del mensaje y crea la OC; confirma si el servidor lo indica. */
function llmGuion(): AdaptadorLLM {
  let n = 0;
  const llamada = (nombre: string, args: Record<string, unknown>): RespuestaLLM => ({
    texto: '', llamadas: [{ id: `t${++n}`, nombre, args }], uso: { entrada: 10, salida: 5 },
  });
  return {
    proveedor: 'falso',
    modelo: 'falso',
    async enviar(mensajes: MensajeLLM[]) {
      const ultimo = mensajes.at(-1)!;
      if (ultimo.rol === 'usuario') {
        const conf = ultimo.texto.match(/CONFIRMA las excepciones del caso (\S+?)\./);
        if (conf) {
          let payload: unknown = null;
          for (const m of mensajes) if (m.rol === 'herramienta') for (const r of m.resultados) {
            const d = JSON.parse(r.resultado) as { data?: { payload?: unknown; ruta_trazabilidad?: string } };
            if (d.data?.payload && d.data.ruta_trazabilidad?.includes(conf[1]!)) payload = d.data.payload;
          }
          return llamada('oc_crear', { caso: conf[1], payload, confirmado: true });
        }
        const caso = ultimo.texto.match(/sol-\d{3}/)?.[0];
        return caso ? llamada('oc_construir_payload', { caso }) : { texto: 'ok', llamadas: [], uso: { entrada: 1, salida: 1 } };
      }
      if (ultimo.rol === 'herramienta') {
        const r = JSON.parse(ultimo.resultados[0]!.resultado) as { ok: boolean; data?: { payload?: unknown } };
        const previo = mensajes.at(-2) as Extract<MensajeLLM, { rol: 'asistente' }>;
        const ll = previo.llamadas[0]!;
        if (ll.nombre === 'oc_construir_payload' && r.ok) return llamada('oc_crear', { caso: ll.args.caso, payload: r.data!.payload });
      }
      return { texto: 'fin del turno', llamadas: [], uso: { entrada: 1, salida: 1 } };
    },
  };
}

/** Una "instancia" de Vercel: memoria y /tmp propios. */
function instancia(raiz: string) {
  return {
    raiz,
    dirSalida: mkdtempSync(path.join(tmpdir(), 'instancia-')),
    sesiones: new AlmacenSesiones(),
    llm: llmGuion(),
    secreto: SECRETO,
    opciones: { topeIteraciones: 6, topeTokensSesion: 100_000, sistema: 'prompt' },
  };
}

describe('Estado de sesión firmado', () => {
  const estado: EstadoSesion = { v: 1, sesion: crearSesion('sesion-prueba-1'), archivos: { 'control.csv': 'a,b\n' } };

  it('firma y verifica el estado', () => {
    expect(verificarEstado(firmarEstado(estado, SECRETO), SECRETO)).toEqual(estado);
  });

  it('rechaza un estado alterado, con otra clave o mal formado', () => {
    const token = firmarEstado(estado, SECRETO);
    const [datos, firma] = token.split('.');
    const alterado = Buffer.from(JSON.stringify({ ...estado, archivos: { 'sap/ordenes.jsonl': 'falso' } })).toString('base64url');
    expect(verificarEstado(`${alterado}.${firma}`, SECRETO)).toBeNull();
    expect(verificarEstado(token, 'y'.repeat(40))).toBeNull();
    expect(verificarEstado(`${datos}`, SECRETO)).toBeNull();
    expect(verificarEstado('basura.basura', SECRETO)).toBeNull();
  });
});

describe('Continuidad entre instancias (hallazgo de producción)', () => {
  it('mantiene historial, confirmación pendiente, numeración e idempotencia al cambiar de instancia', async () => {
    const { directory } = proyectoTemporal();
    const id = 'sesion-continuidad-1';

    const a = instancia(directory);
    const t1 = await atenderChat({ sessionId: id, message: 'Procesa sol-001' }, a);
    expect(t1.toolCalls.find((t) => t.nombre === 'oc_crear')?.resumen).toContain('4500000001');

    const b = instancia(directory);
    const t2 = await atenderChat({ sessionId: id, message: 'Procesa sol-004', estado: t1.estado }, b);
    expect(t2.needsConfirmation).toBe(true);
    expect(t2.pendiente?.caso).toBe('sol-004');

    const c = instancia(directory);
    const t3 = await atenderChat({ sessionId: id, message: 'Confirmo la creación de la OC de sol-004', estado: t2.estado }, c);
    expect(t3.toolCalls[0]!.resumen).toContain('4500000002');
    expect(t3.needsConfirmation).toBe(false);

    const d = instancia(directory);
    const t4 = await atenderChat({ sessionId: id, message: 'Procesa sol-001', estado: t3.estado }, d);
    expect(t4.toolCalls.find((t) => t.nombre === 'oc_crear')?.resumen).toMatch(/4500000001.*idempotente/);
    expect(verificarEstado(t4.estado, SECRETO)!.sesion.historial.filter((h) => h.tipo === 'usuario')).toHaveLength(4);
  });

  it('ignora un estado forjado: no hay confirmación pendiente que aprovechar', async () => {
    const { directory } = proyectoTemporal();
    const id = 'sesion-forjada-1';
    const forjado: EstadoSesion = {
      v: 1,
      sesion: { ...crearSesion(id), pendiente: { caso: 'sol-004', confirmaciones: [], propuesta: null } },
      archivos: {},
    };
    const token = firmarEstado(forjado, 'otra-clave'.repeat(5));
    const r = await atenderChat({ sessionId: id, message: 'Confirmo la creación de la OC de sol-004', estado: token }, instancia(directory));
    expect(r.toolCalls.some((t) => t.nombre === 'oc_crear' && t.ok)).toBe(false);
  });
});
