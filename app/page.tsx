'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface LlamadaVisible {
  id: string;
  nombre: string;
  args: Record<string, unknown>;
  ok: boolean;
  resumen: string;
  resultado: string;
}
interface Pendiente {
  caso: string;
  confirmaciones: Array<{ codigo: string; detalle: string }>;
  propuesta: Propuesta | null;
}
interface Propuesta {
  proveedor: { codigo_sap: string; nit: string; nombre: string };
  moneda: string;
  condiciones_pago: string;
  aprobador: { email: string; fecha_aprobacion: string };
  posiciones: Array<{ descripcion: string; cantidad: number; unidad: string; precio_unitario: number; centro_costo: string; subarea: string; indicador_iva: string }>;
}
interface Mensaje {
  tipo: 'usuario' | 'asistente';
  texto: string;
  toolCalls?: LlamadaVisible[];
}
interface RespuestaChat {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
  pendiente: Pendiente | null;
  estado?: string;
  error?: string;
}

const CASOS = ['sol-001', 'sol-002', 'sol-003', 'sol-004', 'sol-005', 'sol-006'];
const PROMPT_DEMO =
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.';
const CLAVE_SESION = 'agente-oc-sesion';
const CLAVE_ESTADO = 'agente-oc-estado';

function guardarLocal(clave: string, valor: string | null) {
  try {
    if (valor === null) sessionStorage.removeItem(clave);
    else sessionStorage.setItem(clave, valor);
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Lee (sin verificar: eso lo hace el servidor) el historial del estado firmado para restaurar la vista. */
function leerEstado(token: string): { historial: Mensaje[]; pendiente: Pendiente | null } | null {
  try {
    const datos = (token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(datos), (c) => c.charCodeAt(0)));
    const e = JSON.parse(json) as { sesion: { historial: Mensaje[]; pendiente: Pendiente | null } };
    return { historial: e.sesion.historial, pendiente: e.sesion.pendiente };
  } catch {
    return null;
  }
}

const formato = (n: number, moneda = 'COP') =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(n);

function nuevaSesion(): string {
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(CLAVE_SESION, id);
  } catch {
    /* almacenamiento no disponible: la sesión vive solo en memoria */
  }
  return id;
}

function MatrizControles({ resultado }: { resultado: string }) {
  let filas: Array<{ codigo: string; estado: string; detalle: string }> = [];
  try {
    filas = (JSON.parse(resultado) as { data?: { controles?: typeof filas } }).data?.controles ?? [];
  } catch {
    return null;
  }
  if (!filas.length) return null;
  const clase = (e: string) => (e === 'CUMPLE' ? 'ok' : e === 'BLOQUEO' ? 'bad' : e === 'CONFIRMACION' ? 'warn' : '');
  return (
    <table className="matriz">
      <thead>
        <tr><th>Regla</th><th>Estado</th><th>Detalle</th></tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={`${f.codigo}-${i}`}>
            <td>{f.codigo}</td>
            <td><span className={`estado ${clase(f.estado)}`}>{f.estado}</span></td>
            <td>{f.detalle}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TarjetaHerramienta({ t }: { t: LlamadaVisible }) {
  let legible = t.resultado;
  let pendiente = false;
  try {
    const r = JSON.parse(t.resultado) as { requiere_confirmacion?: boolean };
    pendiente = r.requiere_confirmacion === true;
    legible = JSON.stringify(r, null, 2);
  } catch {
    /* se muestra tal cual */
  }
  const estado = t.ok ? { clase: 'ok', texto: 'ok' } : pendiente ? { clase: 'warn', texto: 'requiere confirmación' } : { clase: 'bad', texto: 'error' };
  return (
    <div className="tool">
      <div className="tool-cabecera">
        <span className="tool-nombre">{t.nombre}</span>
        <code className="tool-args">{JSON.stringify(t.args)}</code>
        <span className={`estado ${estado.clase}`}>{estado.texto}</span>
      </div>
      <div className="tool-resumen">{t.resumen}</div>
      {t.nombre === 'oc_validar' && t.ok && <MatrizControles resultado={t.resultado} />}
      <details>
        <summary>Ver resultado completo</summary>
        <pre>{legible}</pre>
      </details>
    </div>
  );
}

function TarjetaConfirmacion({ p, ocupado, responder }: { p: Pendiente; ocupado: boolean; responder: (si: boolean) => void }) {
  const pos = p.propuesta?.posiciones?.[0];
  return (
    <div className="aprobacion" role="alertdialog" aria-label="Confirmación requerida">
      <h3>Confirmación requerida · {p.caso}</h3>
      {p.propuesta && pos && (
        <table className="matriz">
          <tbody>
            <tr><th>Proveedor</th><td>{p.propuesta.proveedor.nombre} · NIT {p.propuesta.proveedor.nit} · SAP {p.propuesta.proveedor.codigo_sap}</td></tr>
            <tr><th>Descripción</th><td>{pos.descripcion}</td></tr>
            <tr><th>Cantidad × precio</th><td>{pos.cantidad} {pos.unidad} × {formato(pos.precio_unitario, p.propuesta.moneda)}</td></tr>
            <tr><th>Total</th><td><strong>{formato(pos.cantidad * pos.precio_unitario, p.propuesta.moneda)}</strong></td></tr>
            <tr><th>Centro / subárea</th><td>{pos.centro_costo} · {pos.subarea}</td></tr>
            <tr><th>IVA · pago</th><td>{pos.indicador_iva} · {p.propuesta.condiciones_pago}</td></tr>
            <tr><th>Aprobador</th><td>{p.propuesta.aprobador.email}</td></tr>
          </tbody>
        </table>
      )}
      <ul>
        {p.confirmaciones.map((c) => (
          <li key={c.codigo}><strong>{c.codigo}</strong>: {c.detalle}</li>
        ))}
      </ul>
      <div className="botones">
        <button className="boton" disabled={ocupado} onClick={() => responder(true)}>Confirmo, crear la OC</button>
        <button className="boton secundario" disabled={ocupado} onClick={() => responder(false)}>No confirmo</button>
      </div>
    </div>
  );
}

export default function Pagina() {
  const [sesion, setSesion] = useState('');
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id = '';
    let guardado: string | null = null;
    try {
      id = sessionStorage.getItem(CLAVE_SESION) ?? '';
      guardado = sessionStorage.getItem(CLAVE_ESTADO);
    } catch {
      id = '';
    }
    if (!id) {
      setSesion(nuevaSesion());
      return;
    }
    setSesion(id);
    const restaurado = guardado ? leerEstado(guardado) : null;
    if (guardado && restaurado) {
      setEstado(guardado);
      setMensajes(restaurado.historial.map((h) => ({ tipo: h.tipo, texto: h.texto, toolCalls: h.toolCalls })));
      setPendiente(restaurado.pendiente);
      return;
    }
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { historial: Mensaje[]; pendiente: Pendiente | null } | null) => {
        if (d) {
          setMensajes(d.historial.map((h) => ({ tipo: h.tipo, texto: h.texto, toolCalls: h.toolCalls })));
          setPendiente(d.pendiente);
        }
      })
      .catch(() => undefined);
  }, []);

  // Cuerpo con llaves: scrollIntoView devuelve una promesa en Chrome reciente y React
  // la trataría como función de limpieza del efecto ("i is not a function").
  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, ocupado]);

  async function enviar(mensaje: string) {
    const limpio = mensaje.trim();
    if (!limpio || ocupado || !sesion) return;
    setError(null);
    setTexto('');
    setMensajes((m) => [...m, { tipo: 'usuario', texto: limpio }]);
    setOcupado(true);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sesion, message: limpio, ...(estado ? { estado } : {}) }),
      });
      const d = (await r.json()) as RespuestaChat;
      if (!r.ok) throw new Error(d.error ?? 'Error');
      if (d.estado) {
        setEstado(d.estado);
        guardarLocal(CLAVE_ESTADO, d.estado);
      }
      setMensajes((m) => [...m, { tipo: 'asistente', texto: d.reply, toolCalls: d.toolCalls }]);
      setPendiente(d.needsConfirmation ? d.pendiente : null);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'Error' ? e.message : 'No fue posible completar la solicitud. Intente nuevamente.');
    } finally {
      setOcupado(false);
    }
  }

  function reiniciar() {
    setEstado(null);
    guardarLocal(CLAVE_ESTADO, null);
    setSesion(nuevaSesion());
    setMensajes([]);
    setPendiente(null);
    setError(null);
  }

  const bloqueado = ocupado || pendiente !== null;

  return (
    <main className="app">
      <header className="encabezado">
        <div>
          <h1>Agente de órdenes de compra</h1>
          <p>Lee el paquete, valida RC1–RC10, construye la OC y la crea en el SAP simulado con confirmación humana.</p>
        </div>
        <div className="acciones">
          <button className="chip" disabled={bloqueado} onClick={() => enviar('Lista los casos disponibles')}>Listar casos</button>
          {CASOS.map((c) => (
            <button key={c} className="chip" disabled={bloqueado} onClick={() => enviar(`Procesa la solicitud ${c}`)}>Procesar {c}</button>
          ))}
          <button className="chip" disabled={bloqueado} onClick={() => enviar(PROMPT_DEMO)}>Demo PRD (sol-004)</button>
          <button className="chip" disabled={ocupado} onClick={reiniciar}>Nueva sesión</button>
        </div>
      </header>

      <section className="mensajes" aria-live="polite">
        {mensajes.length === 0 && <p className="vacio">Escribe "procesa la solicitud sol-001" o usa una acción rápida.</p>}
        {mensajes.map((m, i) => (
          <div key={i} className={`mensaje ${m.tipo}`}>
            {m.toolCalls?.map((t) => <TarjetaHerramienta key={t.id} t={t} />)}
            <div className="burbuja">
              {m.tipo === 'asistente' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.texto}</ReactMarkdown> : m.texto}
            </div>
          </div>
        ))}
        {ocupado && <div className="pensando">El agente está pensando y ejecutando herramientas…</div>}
        {pendiente && (
          <TarjetaConfirmacion
            p={pendiente}
            ocupado={ocupado}
            responder={(si) => enviar(si ? `Confirmo la creación de la OC de ${pendiente.caso}` : `No confirmo la OC de ${pendiente.caso}`)}
          />
        )}
        {error && <div className="error">{error}</div>}
        <div ref={fin} />
      </section>

      <form
        className="entrada"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={pendiente ? 'Responde la confirmación pendiente con los botones' : 'Escribe tu mensaje…'}
          disabled={bloqueado}
          maxLength={2000}
          aria-label="Mensaje"
        />
        <button type="submit" className="boton" disabled={bloqueado || !texto.trim()}>Enviar</button>
      </form>
    </main>
  );
}
