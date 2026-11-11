import { buscarSesion, idSesionValido } from '@/src/agent/sesiones';
import { directorioSalida } from '@/src/lib/salidas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/sessions/:id → historial completo de la sesión (mensajes y llamadas a herramientas). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSesionValido(id)) return Response.json({ error: 'sessionId inválido' }, { status: 400 });
  const sesion = await buscarSesion(id, directorioSalida(process.cwd()));
  if (!sesion) return Response.json({ error: 'Sesión no encontrada' }, { status: 404 });
  return Response.json({
    id: sesion.id,
    historial: sesion.historial,
    pendiente: sesion.pendiente,
    needsConfirmation: sesion.pendiente !== null,
    tokensUsados: sesion.tokensUsados,
  });
}
