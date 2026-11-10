import { describe, expect, it } from 'vitest';
import { ErrorDatos, cargarCaso, cargarMaestros, listarCasos } from '@/src/data/repositorio';

const DIR = 'ejemplo';

describe('Repositorio de datos', () => {
  it('lista los casos disponibles ordenados', async () => {
    expect(await listarCasos(DIR)).toEqual(['ej-001', 'ej-002']);
  });

  it('carga un caso con todos sus documentos', async () => {
    const caso = await cargarCaso(DIR, 'ej-001');
    expect(caso.id).toBe('ej-001');
    expect(caso.cotizacion).toContain('COTIZACIÓN');
    expect(caso.factura).toBeUndefined();
  });

  it('incluye la factura solo cuando existe en el caso', async () => {
    const caso = await cargarCaso(DIR, 'ej-002');
    expect(caso.factura).toContain('FACTURA');
  });

  it('aísla los casos: cargar uno no altera otro', async () => {
    const a1 = await cargarCaso(DIR, 'ej-001');
    await cargarCaso(DIR, 'ej-002');
    const a2 = await cargarCaso(DIR, 'ej-001');
    expect(a2).toEqual(a1);
  });

  it.each(['../maestros', '../../etc/passwd', 'ej-001/../ej-002', '', 'a'.repeat(60)])(
    'rechaza identificadores inseguros: "%s"',
    async (id) => {
      await expect(cargarCaso(DIR, id)).rejects.toMatchObject({ codigo: 'CASO_INVALIDO' });
    },
  );

  it('informa caso inexistente con un error tipado', async () => {
    await expect(cargarCaso(DIR, 'no-existe')).rejects.toBeInstanceOf(ErrorDatos);
    await expect(cargarCaso(DIR, 'no-existe')).rejects.toMatchObject({ codigo: 'CASO_NO_ENCONTRADO' });
  });

  it('carga los maestros', async () => {
    const m = await cargarMaestros(DIR);
    expect(Array.isArray(m.proveedores)).toBe(true);
  });
});
