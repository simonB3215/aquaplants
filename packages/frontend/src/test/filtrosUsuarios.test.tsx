import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get, patch: m.patch } };
});
vi.mock('../estado/sesion', () => ({ useSesion: () => ({ usuario: { id_usuario: 1 }, puede: () => true }) }));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));
vi.mock('../componentes/Layout', () => ({ BarraSuperior: () => null }));

import { Usuarios } from '../paginas/Gestion';

const u = (id_usuario: number, nombre: string, email: string, rol: string, extra = {}) => ({ id_usuario, nombre, email, rol, activo: true, bloqueado: false, debe_cambiar_password: false, torres: [], ...extra });
let usuarios: ReturnType<typeof u>[];

async function mostrar() {
  render(<Usuarios />);
  await screen.findByRole('search', { name: 'Filtrar usuarios' });
}
const filtros = () => within(screen.getByRole('search', { name: 'Filtrar usuarios' }));
const buscar = (value: string) => fireEvent.change(filtros().getByLabelText('Buscar por nombre o email'), { target: { value } });
const elegir = (campo: 'Rol' | 'Estado', value: string) => fireEvent.change(filtros().getByLabelText(campo), { target: { value } });
const nombres = () => [...document.querySelectorAll('table.tabla tbody tr td:first-child strong')].map((e) => e.textContent);
const resumen = () => filtros().getByRole('status').textContent;

beforeEach(() => {
  usuarios = [
    u(1, 'Ana Administradora', 'admin@aquaplants.cl', 'administrador'),
    u(2, 'Sergio Supervisor', 'supervisor@aquaplants.cl', 'supervisor'),
    u(3, 'Tomás Núñez', 'tomas@ejemplo.cl', 'encargado'),
    u(4, 'Elena Encargada', 'elena@aquaplants.cl', 'encargado', { bloqueado: true }),
    u(5, 'Pedro Antiguo', 'pedro@aquaplants.cl', 'encargado', { activo: false, bloqueado: true }),
  ];
  m.get.mockReset().mockImplementation(async (ruta: string) => (ruta === '/usuarios' ? usuarios : []));
  m.patch.mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Filtros de usuarios', () => {
  test('sin filtros muestra a todos y no ofrece limpiar', async () => {
    await mostrar();
    expect(nombres()).toHaveLength(5);
    expect(resumen()).toBe('5 usuarios');
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  test('busca sin distinguir tildes ni mayúsculas', async () => {
    await mostrar();
    buscar('TOMAS nunez');
    expect(nombres()).toEqual(['Tomás Núñez']);
  });

  test('busca por parte del email', async () => {
    await mostrar();
    buscar('@ejemplo');
    expect(nombres()).toEqual(['Tomás Núñez']);
  });

  test('las palabras pueden ir en otro orden', async () => {
    await mostrar();
    buscar('supervisor sergio');
    expect(nombres()).toEqual(['Sergio Supervisor']);
  });

  test('solo espacios no cuenta como filtro', async () => {
    await mostrar();
    buscar('   ');
    expect(resumen()).toBe('5 usuarios');
  });

  test.each([
    ['administrador', 1],
    ['supervisor', 1],
    ['encargado', 3],
  ])('rol %s', async (rol, n) => {
    await mostrar();
    elegir('Rol', rol as string);
    expect(nombres()).toHaveLength(n as number);
  });

  test.each([
    { estado: 'activo', esperados: ['Ana Administradora', 'Sergio Supervisor', 'Tomás Núñez'] },
    { estado: 'bloqueado', esperados: ['Elena Encargada'] },
    { estado: 'inactivo', esperados: ['Pedro Antiguo'] },
  ])('estado $estado, igual que la insignia', async ({ estado, esperados }) => {
    await mostrar();
    elegir('Estado', estado);
    expect(nombres()).toEqual(esperados);
  });

  test('combina texto, rol y estado', async () => {
    await mostrar();
    buscar('aquaplants');
    elegir('Rol', 'encargado');
    elegir('Estado', 'inactivo');
    expect(nombres()).toEqual(['Pedro Antiguo']);
    expect(resumen()).toBe('1 de 5 usuarios');
  });

  test('sin coincidencias lo dice y limpiar restaura todo con el foco en el buscador', async () => {
    await mostrar();
    buscar('nadie');
    elegir('Rol', 'supervisor');
    expect(screen.getByText('Ningún usuario coincide')).toBeTruthy();
    expect(resumen()).toBe('0 de 5 usuarios');
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(nombres()).toHaveLength(5);
    expect(document.activeElement).toBe(filtros().getByLabelText('Buscar por nombre o email'));
  });

  test('con la lista filtrada desactiva al usuario correcto y conserva el filtro', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mostrar();
    elegir('Estado', 'activo');
    buscar('tomas');
    usuarios = usuarios.map((x) => (x.id_usuario === 3 ? { ...x, activo: false } : x));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/usuarios/3', { activo: false });
    expect(await screen.findByText('Ningún usuario coincide')).toBeTruthy();
    expect(resumen()).toBe('0 de 5 usuarios');
  });
});
