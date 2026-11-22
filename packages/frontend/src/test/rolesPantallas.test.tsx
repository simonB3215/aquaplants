import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { autorizado, type Incidencia, type Rol } from '@aquaplants/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** Anexo C (D-37): menú y pantallas por rol, con la matriz real de permisos (no un `puede` falso). */
const m = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  usuario: { id_usuario: 9, nombre: 'Teo Técnico', email: 'teo@example.cl', rol: 'tecnico' as string, debe_cambiar_password: false, id_cliente: null as number | null, cliente: null as string | null },
}));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get, patch: m.patch } };
});
vi.mock('../estado/sesion', () => ({
  useSesion: () => ({ usuario: m.usuario, puede: (f: never, a: 'leer' | 'escribir' = 'escribir') => autorizado(m.usuario.rol as Rol, f, a), cerrar: vi.fn() }),
}));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));

import { BarraSuperior, Layout } from '../componentes/Layout';
import { Incidencias } from '../paginas/Incidencias';

const inc = (extra: Partial<Incidencia> = {}): Incidencia => ({
  id_incidencia: 5, id_dispositivo: 3, dispositivo: 'AquaBrain-B', id_instalacion: 2, torre: 'Torre B', cliente: 'Huerta Norte',
  tipo: 'sin_senal', estado: 'abierta', abierta_en: new Date(Date.now() - 600_000).toISOString(), ocurrencias: 1,
  senal_recuperada_en: null, sigue_sin_senal: true, atendida_por: null, atendida_en: null, cerrada_por: null, cerrada_en: null,
  comentario_cierre: null, latitud: -33.45, longitud: -70.66, ...extra,
});
let lista: Incidencia[];

const mostrar = (pagina: 'barra' | 'incidencias') =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout demoHabilitada />}>
          <Route index element={pagina === 'barra' ? <BarraSuperior /> : <Incidencias />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
const menu = () => [...within(screen.getByRole('complementary', { name: 'Navegación principal' })).getAllByRole('link')].map((a) => a.textContent?.trim());

beforeEach(() => {
  lista = [inc()];
  m.get.mockReset().mockImplementation(async (ruta: string) => (ruta.startsWith('/incidencias') ? { datos: lista, total: lista.length, pagina: 1, por_pagina: 20 } : { datos: [], total: 0, pagina: 1, por_pagina: 1 }));
  m.patch.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('Menú por rol (Anexo C)', () => {
  test('Técnico: sin Alertas ni Usuarios; campana de incidencias', async () => {
    m.usuario.rol = 'tecnico';
    mostrar('barra');
    const campana = await screen.findByRole('link', { name: '1 incidencia activa. Ver incidencias' });
    expect(campana.getAttribute('href')).toBe('/incidencias');
    expect(m.get.mock.calls.some(([r]) => String(r).startsWith('/alertas'))).toBe(false);
    const items = menu();
    expect(items.some((t) => t?.startsWith('Incidencias'))).toBe(true);
    expect(items.some((t) => t?.startsWith('Alertas'))).toBe(false);
    expect(items).not.toContain('Usuarios');
    expect(items).not.toContain('Clientes');
    expect(items).not.toContain('Demostración');
  });

  test('Supervisor: «Mis Encargados», Alertas e Incidencias, sin Clientes', async () => {
    m.usuario.rol = 'supervisor';
    mostrar('barra');
    await screen.findByRole('link', { name: /Ver alertas$/ });
    const items = menu();
    expect(items).toContain('Mis Encargados');
    expect(items).toContain('Incidencias');
    expect(items).not.toContain('Clientes');
    expect(items).not.toContain('Demostración');
  });

  test('Administrador: Clientes y Demostración, sin «Mis Encargados»', async () => {
    m.usuario.rol = 'administrador';
    mostrar('barra');
    await screen.findByRole('link', { name: /Ver alertas$/ });
    const items = menu();
    expect(items).toContain('Clientes');
    expect(items).toContain('Usuarios');
    expect(items).toContain('Demostración');
  });

  test('Encargado: ni Incidencias ni gestión', async () => {
    m.usuario.rol = 'encargado';
    mostrar('barra');
    await screen.findByRole('link', { name: /Ver alertas$/ });
    const items = menu();
    expect(items.some((t) => t?.startsWith('Incidencias'))).toBe(false);
    expect(items).not.toContain('Usuarios');
  });
});

describe('Incidencias (RN-13)', () => {
  test('Técnico: atiende una incidencia abierta; no puede cerrarla mientras siga sin señal', async () => {
    m.usuario.rol = 'tecnico';
    mostrar('incidencias');
    await screen.findByRole('heading', { name: /AquaBrain-B · Torre B/ });
    expect(within(screen.getByRole('article')).getByText('Sin atender')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver ubicación -33\.45000, -70\.66000/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cerrar' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Atender' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/incidencias/5/atender');
  });

  test('Técnico: cierra con comentario cuando la señal volvió', async () => {
    m.usuario.rol = 'tecnico';
    lista = [inc({ estado: 'en_atencion', sigue_sin_senal: false, senal_recuperada_en: new Date().toISOString(), atendida_por: 'Teo Técnico', atendida_en: new Date().toISOString() })];
    mostrar('incidencias');
    await screen.findByRole('heading', { name: /AquaBrain-B/ });
    expect(within(screen.getByRole('article')).getByText('En atención')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar incidencia' }));
    expect(await within(dialogo).findByText('Indique qué se hizo')).toBeTruthy();
    expect(m.patch).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByLabelText('¿Qué se hizo?'), { target: { value: 'Se reinició el router' } });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar incidencia' }));
    });
    expect(m.patch).toHaveBeenCalledWith('/incidencias/5/cerrar', { comentario: 'Se reinició el router' });
  });

  test('Supervisor: solo lectura, sin botones', async () => {
    m.usuario.rol = 'supervisor';
    mostrar('incidencias');
    await screen.findByRole('heading', { name: /AquaBrain-B · Torre B/ });
    expect(screen.queryByRole('button', { name: 'Atender' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
  });
});
