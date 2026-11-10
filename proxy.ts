import { NextResponse, type NextRequest } from 'next/server';

/**
 * Control de acceso básico a la URL pública. Si APP_ACCESS_PASSWORD está definida,
 * se exige autenticación HTTP Basic en la UI y en la API (excepto /api/health).
 * Protege el consumo de la API key frente a uso no autorizado.
 */
function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const usuario = process.env.APP_ACCESS_USER || 'evaluador';
  const cabecera = request.headers.get('authorization') ?? '';
  if (cabecera.startsWith('Basic ')) {
    const [u, ...resto] = atob(cabecera.slice(6)).split(':');
    if (comparacionSegura(u ?? '', usuario) && comparacionSegura(resto.join(':'), password)) {
      return NextResponse.next();
    }
  }
  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Agente OC", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico).*)'],
};
