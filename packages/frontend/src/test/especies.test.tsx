import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get, post: m.post, patch: m.patch } };
});
vi.mock('../estado/sesion', () => ({ useSesion: () => ({ usuario: { id_usuario: 1, nombre: 'Ana Administradora', rol: 'administrador' }, puede: () => true, cerrar: vi.fn() }) }));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));

import { Especies, type EspecieFila } from '../paginas/Especies';

const tipos = [
  { id_tipo_variable: 1, nombre: 'pH', unidad: 'pH', min_fisico: 0, max_fisico: 14 },
  { id_tipo_variable: 2, nombre: 'Conductividad eléctrica', unidad: 'mS/cm', min_fisico: 0, max_fisico: 10 },
];
let especies: EspecieFila[];

beforeEach(() => {
  especies = [
    { id_especie: 1, nombre: 'Lechuga', descripcion: '', estado: 'activo', cultivos_en_curso: 1, cultivos_total: 1, rangos: [{ id_tipo_variable: 1, valor_min: 5.6, valor_max: 6.2 }] },
    { id_especie: 2, nombre: 'Rúcula', descripcion: 'Hoja', estado: 'baja', cultivos_en_curso: 0, cultivos_total: 2, rangos: [] },
  ];
  m.get.mockReset().mockImplementation(async (ruta: string) => (ruta === '/catalogos' ? { tipos_variable: tipos, especies: [], rangos_referencia: [] } : especies));
  m.post.mockReset().mockResolvedValue({ id_especie: 3 });
  m.patch.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

const mostrar = async () => {
  render(
    <MemoryRouter>
      <Especies />
    </MemoryRouter>,
  );
  await screen.findByText('Lechuga');
};
const fila = (nombre: string) => screen.getByText(nombre).closest('tr') as HTMLElement;

describe('Especies (CRUD)', () => {
  test('lista con rangos, uso y estado; no deja dar de baja con cultivos en curso', async () => {
    await mostrar();
    expect(within(fila('Lechuga')).getByText('5,6–6,2')).toBeTruthy();
    expect(within(fila('Lechuga')).getByText('Activa')).toBeTruthy();
    expect((within(fila('Lechuga')).getByRole('button', { name: 'Dar de baja' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(fila('Rúcula')).getByText('De baja')).toBeTruthy();
    expect(within(fila('Rúcula')).getByText('(2 en total)')).toBeTruthy();
  });

  test('crear: valida mínimo < máximo y envía solo las variables con rango', async () => {
    await mostrar();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva especie' }));
    const d = await screen.findByRole('dialog', { name: 'Nueva especie' });
    fireEvent.change(within(d).getByLabelText('Nombre'), { target: { value: 'Tomate' } });
    fireEvent.change(within(d).getByLabelText('pH mín. (pH)'), { target: { value: '6,5' } });
    fireEvent.change(within(d).getByLabelText('pH máx. (pH)'), { target: { value: '5.5' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    expect(await within(d).findByText('El mínimo debe ser menor que el máximo')).toBeTruthy();
    expect(m.post).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText('pH mín. (pH)'), { target: { value: '5,5' } });
    fireEvent.change(within(d).getByLabelText('pH máx. (pH)'), { target: { value: '6.5' } });
    await act(async () => {
      fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    });
    expect(m.post).toHaveBeenCalledWith('/especies', { nombre: 'Tomate', descripcion: '', rangos: [{ id_tipo_variable: 1, valor_min: 5.5, valor_max: 6.5 }] });
  });

  test('muestra el rango permitido de cada variable y rechaza valores fuera de él', async () => {
    await mostrar();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva especie' }));
    const d = await screen.findByRole('dialog', { name: 'Nueva especie' });
    expect(within(d).getByText('Permitido: 0 a 14 pH')).toBeTruthy();
    expect(within(d).getByText('Permitido: 0 a 10 mS/cm')).toBeTruthy();
    fireEvent.change(within(d).getByLabelText('Nombre'), { target: { value: 'Tomate' } });
    fireEvent.change(within(d).getByLabelText('pH mín. (pH)'), { target: { value: '5' } });
    fireEvent.change(within(d).getByLabelText('pH máx. (pH)'), { target: { value: '15' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    expect(await within(d).findByText('Fuera del rango permitido. Permitido: 0 a 14 pH')).toBeTruthy();
    expect(m.post).not.toHaveBeenCalled();
  });

  test('editar carga los rangos actuales y reactivar una especie de baja', async () => {
    await mostrar();
    fireEvent.click(within(fila('Lechuga')).getByRole('button', { name: 'Editar' }));
    const d = await screen.findByRole('dialog', { name: 'Editar especie' });
    expect((within(d).getByLabelText('pH mín. (pH)') as HTMLInputElement).value).toBe('5.6');
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await act(async () => {
      fireEvent.click(within(fila('Rúcula')).getByRole('button', { name: 'Reactivar' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/especies/2', { estado: 'activo' });
  });
});
