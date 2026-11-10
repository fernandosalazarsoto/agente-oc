import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agente de Órdenes de Compra',
  description: 'Lectura, validación de controles y creación de órdenes de compra en un SAP simulado',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
