import { almacenSesiones, dirSesion, idSesionValido } from '@/src/agent/sesiones';
import { directorioSalida } from '@/src/lib/salidas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/:id → historial completo de la sesión (mensajes y llamadas a herramientas).
 * En serverless responde la instancia que la atendió; el navegador conserva además el estado firmado.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSesionValido(id)) return Response.json({ error: 'sessionId inválido' }, { status: 400 });
  const sesion = await almacenSesiones.buscar(id, dirSesion(directorioSalida(process.cwd()), id));
  if (!sesion) return Response.json({ error: 'Sesión no encontrada en esta instancia' }, { status: 404 });
  return Response.json({
    id: sesion.id,
    historial: sesion.historial,
    pendiente: sesion.pendiente,
    needsConfirmation: sesion.pendiente !== null,
    tokensUsados: sesion.tokensUsados,
  });
}
