import { NextResponse, type NextRequest } from 'next/server';
import { credencialesValidas } from './src/lib/acceso';

/**
 * Control de acceso básico a la URL pública. Si APP_ACCESS_PASSWORD está definida,
 * se exige autenticación HTTP Basic en la UI y en la API (excepto /api/health).
 * Protege el consumo de la API key frente a uso no autorizado.
 */
export function proxy(request: NextRequest) {
  const clave = process.env.APP_ACCESS_PASSWORD?.trim();
  if (!clave) return NextResponse.next();

  const usuario = process.env.APP_ACCESS_USER?.trim() || 'evaluador';
  if (credencialesValidas(request.headers.get('authorization'), usuario, clave)) {
    return NextResponse.next();
  }
  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Agente OC", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico).*)'],
};
