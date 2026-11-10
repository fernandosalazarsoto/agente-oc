'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Parte = UIMessage['parts'][number];

interface FilaControl {
  id: string;
  nombre: string;
  estado: string;
  severidad: string;
  evidencia: string;
}

const ACCIONES_RAPIDAS = ['Lista los casos disponibles', 'Procesa el caso ej-001', 'Procesa el caso ej-002'];

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  'input-streaming': { texto: 'preparando', clase: '' },
  'input-available': { texto: 'ejecutando', clase: '' },
  'approval-requested': { texto: 'esperando aprobación', clase: 'warn' },
  'approval-responded': { texto: 'respuesta enviada', clase: '' },
  'output-available': { texto: 'completada', clase: 'ok' },
  'output-error': { texto: 'error', clase: 'bad' },
  'output-denied': { texto: 'rechazada por el usuario', clase: 'bad' },
};

function claseControl(estado: string): string {
  if (estado === 'CUMPLE') return 'ok';
  if (estado === 'ALERTA') return 'warn';
  if (estado === 'NO_CUMPLE') return 'bad';
  return '';
}

function MatrizControles({ salida }: { salida: { decision?: string; controles?: FilaControl[] } }) {
  if (!Array.isArray(salida.controles)) return null;
  return (
    <>
      <div className="tool-cabecera">
        Decisión: <span className={`estado ${salida.decision === 'APTA' ? 'ok' : salida.decision === 'RECHAZADA' ? 'bad' : 'warn'}`}>{salida.decision}</span>
      </div>
      <table className="matriz">
        <thead>
          <tr><th>Control</th><th>Estado</th><th>Evidencia</th></tr>
        </thead>
        <tbody>
          {salida.controles.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.id}</strong> {c.nombre}</td>
              <td><span className={`estado ${claseControl(c.estado)}`}>{c.estado}</span></td>
              <td>{c.evidencia}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ParteHerramienta({
  parte,
  responder,
  ocupado,
}: {
  parte: Extract<Parte, { toolCallId: string }>;
  responder: (id: string, aprobado: boolean) => void;
  ocupado: boolean;
}) {
  const nombre = parte.type === 'dynamic-tool' ? parte.toolName : parte.type.replace(/^tool-/, '');
  const etiqueta = ETIQUETA_ESTADO[parte.state] ?? { texto: parte.state, clase: '' };

  if (parte.state === 'approval-requested' && !parte.approval.isAutomatic) {
    return (
      <div className="aprobacion" role="alertdialog" aria-label="Confirmación requerida">
        <h3>Confirmación requerida: {nombre}</h3>
        <p>El agente solicita ejecutar esta acción con los siguientes datos. Revise antes de aprobar.</p>
        <pre>{JSON.stringify(parte.input, null, 2)}</pre>
        <div className="botones">
          <button className="boton" disabled={ocupado} onClick={() => responder(parte.approval.id, true)}>
            Aprobar
          </button>
          <button className="boton secundario" disabled={ocupado} onClick={() => responder(parte.approval.id, false)}>
            Rechazar
          </button>
        </div>
      </div>
    );
  }

  const salida = parte.state === 'output-available' ? (parte.output as Record<string, unknown>) : undefined;

  return (
    <div className="tool">
      <div className="tool-cabecera">
        <span className="tool-nombre">{nombre}</span>
        <span className={`estado ${etiqueta.clase}`}>{etiqueta.texto}</span>
      </div>
      {salida && nombre === 'validar_caso' && <MatrizControles salida={salida as never} />}
      <details>
        <summary>Entrada</summary>
        <pre>{JSON.stringify(parte.input ?? {}, null, 2)}</pre>
      </details>
      {salida && (
        <details>
          <summary>Resultado</summary>
          <pre>{JSON.stringify(salida, null, 2)}</pre>
        </details>
      )}
      {parte.state === 'output-error' && <div className="error">{parte.errorText}</div>}
    </div>
  );
}

export default function Pagina() {
  const [texto, setTexto] = useState('');
  const { messages, sendMessage, addToolApprovalResponse, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const ocupado = status === 'submitted' || status === 'streaming';

  function enviar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || ocupado) return;
    sendMessage({ text: limpio });
    setTexto('');
  }

  function responder(id: string, aprobado: boolean) {
    addToolApprovalResponse({
      id,
      approved: aprobado,
      reason: aprobado ? 'Aprobado por el usuario en la interfaz' : 'Rechazado por el usuario en la interfaz',
    });
  }

  return (
    <main className="app">
      <header className="encabezado">
        <div>
          <h1>Agente de Órdenes de Compra</h1>
          <p>Validación determinista de controles · SAP simulado · Confirmación humana obligatoria</p>
        </div>
        <div className="acciones">
          {ACCIONES_RAPIDAS.map((a) => (
            <button key={a} className="chip" disabled={ocupado} onClick={() => enviar(a)}>
              {a}
            </button>
          ))}
        </div>
      </header>

      <section className="mensajes" aria-live="polite">
        {messages.length === 0 && (
          <p className="vacio">Indique el caso a procesar o use una acción rápida.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mensaje ${m.role === 'user' ? 'usuario' : 'asistente'}`}>
            {m.parts.map((parte, i) => {
              if (parte.type === 'text') {
                return parte.text.trim() ? (
                  <div key={i} className="burbuja">
                    {m.role === 'user' ? parte.text : <ReactMarkdown remarkPlugins={[remarkGfm]}>{parte.text}</ReactMarkdown>}
                  </div>
                ) : null;
              }
              if ('toolCallId' in parte) {
                return <ParteHerramienta key={parte.toolCallId} parte={parte} responder={responder} ocupado={ocupado} />;
              }
              return null;
            })}
          </div>
        ))}
        {error && <div className="error">No fue posible completar la solicitud. Intente nuevamente.</div>}
      </section>

      <form
        className="entrada"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej.: Procesa el caso sol-001"
          maxLength={2000}
          aria-label="Mensaje"
        />
        {ocupado ? (
          <button type="button" className="boton secundario" onClick={() => stop()}>Detener</button>
        ) : (
          <button type="submit" className="boton" disabled={!texto.trim()}>Enviar</button>
        )}
      </form>
    </main>
  );
}
