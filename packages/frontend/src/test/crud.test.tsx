import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), permitido: (_f: string): boolean => true }));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get, post: m.post, patch: m.patch } };
});
vi.mock('../estado/sesion', () => ({
  useSesion: () => ({ usuario: { id_usuario: 1, nombre: 'Ana Administradora', rol: 'administrador' }, puede: (f: string) => m.permitido(f), cerrar: vi.fn() }),
}));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));

import { Crud, CultivosTodos, type CultivoFila } from '../paginas/Crud';

let cultivos: CultivoFila[];
beforeEach(() => {
  m.permitido = () => true;
  cultivos = [
    { id_cultivo: 7, id_instalacion: 1, torre: 'Torre A', id_especie: 1, especie: 'Lechuga', fecha_inicio: '2026-10-01', fecha_fin: null, estado: 'en_curso' },
    { id_cultivo: 3, id_instalacion: 2, torre: 'Torre B', id_especie: 1, especie: 'Lechuga', fecha_inicio: '2026-06-01', fecha_fin: '2026-08-01', estado: 'finalizado' },
  ];
  m.get.mockReset().mockImplementation(async (ruta: string) => {
    if (ruta === '/cultivos') return cultivos;
    if (ruta === '/torres')
      return [
        { id_instalacion: 1, nombre: 'Torre A', cliente: 'Huerta Norte', estado: 'activo' },
        { id_instalacion: 2, nombre: 'Torre B', cliente: 'Huerta Norte', estado: 'activo' },
        { id_instalacion: 3, nombre: 'Torre C', cliente: 'Huerta Sur', estado: 'baja' },
      ];
    if (ruta === '/catalogos') return { especies: [{ id_especie: 1, nombre: 'Lechuga' }, { id_especie: 2, nombre: 'Rúcula' }], tipos_variable: [], rangos_referencia: [] };
    return [];
  });
  m.post.mockReset().mockResolvedValue({ id_cultivo: 9 });
  m.patch.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

const fila = (texto: string) => screen.getByText(texto).closest('tr') as HTMLElement;

describe('Apartado CRUD', () => {
  test('muestra solo las pestañas permitidas, una barra superior y abre la pestaña de ?tab=', async () => {
    m.permitido = (f) => f !== 'usuarios.gestionar' && f !== 'auditoria.consultar';
    render(
      <MemoryRouter initialEntries={['/crud?tab=cultivos']}>
        <Crud />
      </MemoryRouter>,
    );
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Clientes', 'Especies', 'Torres y equipos', 'Umbrales', 'Cultivos', 'Incidencias']);
    expect(screen.getByRole('tab', { name: 'Cultivos' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'CRUD' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Cultivos' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  test('las flechas mueven entre pestañas', async () => {
    render(
      <MemoryRouter initialEntries={['/crud']}>
        <Crud />
      </MemoryRouter>,
    );
    const lista = screen.getByRole('tablist');
    fireEvent.keyDown(lista, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Auditoría' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(lista, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Clientes' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Cultivos de todas las torres', () => {
  const mostrar = async () => {
    render(
      <MemoryRouter>
        <CultivosTodos />
      </MemoryRouter>,
    );
    await screen.findByText('Torre A');
  };

  test('filtra por fecha de inicio (rango y mes) y por especie', async () => {
    await mostrar();
    expect(screen.getByRole('status').textContent).toBe('2 cultivos');
    fireEvent.change(screen.getByLabelText('Iniciado desde'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('status').textContent).toBe('1 de 2 cultivos');
    expect(screen.queryByText('Torre B')).toBeNull();
    fireEvent.change(screen.getByLabelText('Iniciado hasta'), { target: { value: '2026-08-01' } });
    expect(screen.getByText('Debe ser igual o posterior a «Iniciado desde»')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.getByRole('status').textContent).toBe('2 cultivos');
    const junio = (screen.getByLabelText('Mes de inicio') as HTMLSelectElement).querySelector('option[value="2026-06"]');
    if (junio) {
      fireEvent.change(screen.getByLabelText('Mes de inicio'), { target: { value: '2026-06' } });
      expect(screen.getByRole('status').textContent).toBe('1 de 2 cultivos');
      expect(screen.queryByText('Torre A')).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    fireEvent.change(screen.getByLabelText('Especie'), { target: { value: '2' } });
    expect(screen.getByText('Ningún cultivo coincide con los filtros')).toBeTruthy();
  });

  test('nuevo cultivo: solo ofrece torres activas sin cultivo en curso', async () => {
    await mostrar();
    expect(within(fila('2026-08-01')).queryByRole('button', { name: 'Cerrar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo cultivo' }));
    const d = await screen.findByRole('dialog', { name: 'Nuevo cultivo' });
    const torre = within(d).getByLabelText('Torre') as HTMLSelectElement;
    expect([...torre.options].map((o) => o.textContent)).toEqual(['Seleccione…', 'Torre B · Huerta Norte']);
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    expect(await within(d).findByText('Seleccione una torre')).toBeTruthy();
    fireEvent.change(torre, { target: { value: '2' } });
    fireEvent.change(within(d).getByLabelText('Especie'), { target: { value: '2' } });
    fireEvent.change(within(d).getByLabelText('Fecha de inicio'), { target: { value: '2026-11-01' } });
    await act(async () => {
      fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    });
    expect(m.post).toHaveBeenCalledWith('/cultivos', { id_instalacion: 2, id_especie: 2, fecha_inicio: '2026-11-01' });
  });

  test('corregir y cerrar el cultivo en curso', async () => {
    await mostrar();
    fireEvent.click(within(fila('2026-10-01')).getByRole('button', { name: 'Corregir' }));
    let d = await screen.findByRole('dialog', { name: 'Corregir cultivo' });
    expect((within(d).getByLabelText('Especie') as HTMLSelectElement).value).toBe('1');
    fireEvent.change(within(d).getByLabelText('Especie'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/cultivos/7', { id_especie: 2, fecha_inicio: '2026-10-01' });

    fireEvent.click(within(fila('2026-10-01')).getByRole('button', { name: 'Cerrar' }));
    d = await screen.findByRole('dialog', { name: 'Cerrar cultivo' });
    fireEvent.change(within(d).getByLabelText('Fecha de fin (cosecha)'), { target: { value: '2026-09-01' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    expect(await within(d).findByText('Debe ser igual o posterior a la fecha de inicio')).toBeTruthy();
    fireEvent.change(within(d).getByLabelText('Fecha de fin (cosecha)'), { target: { value: '2026-11-20' } });
    await act(async () => {
      fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/cultivos/7/cerrar', { fecha_fin: '2026-11-20' });
  });
});
