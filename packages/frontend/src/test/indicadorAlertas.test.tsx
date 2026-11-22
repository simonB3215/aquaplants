import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Alerta } from '@aquaplants/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  usuario: { id_usuario: 1, nombre: 'Ana Pérez', email: 'ana@example.cl', rol: 'supervisor', debe_cambiar_password: false },
}));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get, patch: m.patch } };
});
vi.mock('../estado/sesion', () => ({ useSesion: () => ({ usuario: m.usuario, puede: () => true, cerrar: vi.fn() }) }));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));

import { ApiError } from '../api/cliente';
import { BarraSuperior, Layout } from '../componentes/Layout';
import { ListaAlertas } from '../componentes/PanelAlertas';

const alerta = (severidad: 'critica' | 'advertencia') =>
  ({ id_alerta: 7, severidad, estado: 'activa', tipo_variable: 'pH', torre: 'Torre A', unidad: 'pH', valor: 4.2, valor_min: 5, valor_max: 7, ocurrencias: 1, fecha_generacion: new Date().toISOString() }) as Alerta;
const responde = (total: number, severidad?: 'critica' | 'advertencia') =>
  m.get.mockResolvedValue({ datos: severidad ? [alerta(severidad)] : [], total, pagina: 1, por_pagina: 1 });

const mostrar = (conLista = false) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout demoHabilitada={false} />}>
          <Route index element={<><BarraSuperior />{conLista && <ListaAlertas alertas={[alerta('advertencia')]} alResolver={vi.fn()} />}</>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  m.get.mockReset();
  m.patch.mockReset();
  m.usuario.debe_cambiar_password = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Indicador de alertas', () => {
  test('pide solo una fila de las alertas activas', async () => {
    responde(0);
    mostrar();
    await screen.findByRole('link', { name: 'Sin alertas activas. Ver alertas' });
    expect(m.get.mock.calls[0][0]).toBe('/alertas?estado=activa&pagina=1&por_pagina=1');
  });

  test('sin alertas: 0 en tono neutro', async () => {
    responde(0);
    mostrar();
    const campana = await screen.findByRole('link', { name: /^Sin alertas activas/ });
    expect(campana).toHaveTextContent('0');
    expect(campana).toHaveClass('e-neutro');
  });

  test('solo advertencias: número en ámbar, sin el texto Hay críticas', async () => {
    responde(3, 'advertencia');
    mostrar();
    const campana = await screen.findByRole('link', { name: /^3 alertas activas/ });
    expect(campana).toHaveClass('e-advertencia');
    expect(campana).not.toHaveTextContent('Hay críticas');
  });

  test('con una crítica: rojo, con texto además del color, y enlaza a Alertas', async () => {
    responde(1, 'critica');
    mostrar();
    const campana = await screen.findByRole('link', { name: '1 alerta activa, hay críticas. Ver alertas' });
    expect(campana).toHaveClass('e-critico');
    expect(campana).toHaveTextContent('Hay críticas');
    expect(campana).toHaveAttribute('href', '/alertas');
  });

  test('más de 99 se abrevia, pero el nombre accesible da el total', async () => {
    responde(120, 'advertencia');
    mostrar();
    expect(await screen.findByRole('link', { name: /^120 alertas activas/ })).toHaveTextContent('99+');
  });

  test('sin respuesta no inventa un 0', async () => {
    m.get.mockRejectedValue(new ApiError(503, 'X', 'Sin conexión con el servidor'));
    mostrar();
    const campana = await screen.findByRole('link', { name: /^Alertas activas: sin datos/ });
    expect(campana).toHaveTextContent('—');
  });

  test('se actualiza cada 10 s y conserva el dato si el servidor falla', async () => {
    vi.useFakeTimers();
    responde(1, 'advertencia');
    mostrar();
    await act(() => vi.advanceTimersByTimeAsync(0));
    responde(2, 'critica');
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('link', { name: /^2 alertas activas, hay críticas/ })).toBeInTheDocument();
    m.get.mockRejectedValue(new ApiError(503, 'X', 'Sin conexión con el servidor'));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('link', { name: /^2 alertas activas.*dato desactualizado/ })).toHaveTextContent('2');
  });

  test('al resolver una alerta baja de inmediato', async () => {
    responde(1, 'advertencia');
    m.patch.mockResolvedValue({});
    mostrar(true);
    await screen.findByRole('link', { name: /^1 alerta activa/ });
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    responde(0);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resuelta' }));
    expect(await screen.findByRole('link', { name: /^Sin alertas activas/ })).toBeInTheDocument();
  });

  test('con cambio de contraseña pendiente no se muestra ni consulta', () => {
    m.usuario.debe_cambiar_password = true;
    mostrar();
    expect(screen.queryByRole('link', { name: /Ver alertas/ })).toBeNull();
    expect(m.get).not.toHaveBeenCalled();
  });
});

describe('Número de alertas en el menú', () => {
  test('con críticas aparece en el menú lateral y en la barra móvil, con texto accesible', async () => {
    responde(3, 'critica');
    mostrar();
    const enlaces = await screen.findAllByRole('link', { name: /^Alertas.*3 alertas activas, hay críticas/ });
    expect(enlaces).toHaveLength(2);
    for (const e of enlaces) {
      const numero = e.querySelector('.numero-nav');
      expect(numero).toHaveTextContent('3');
      expect(numero).toHaveClass('e-critico');
      expect(numero?.querySelector('svg')).not.toBeNull();
    }
  });

  test('solo advertencias: ámbar y sin ícono de crítica', async () => {
    responde(120, 'advertencia');
    mostrar();
    const [enlace] = await screen.findAllByRole('link', { name: /^Alertas.*120 alertas activas/ });
    const numero = enlace.querySelector('.numero-nav');
    expect(numero).toHaveTextContent('99+');
    expect(numero).toHaveClass('e-advertencia');
    expect(numero?.querySelector('svg')).toBeNull();
  });

  test('sin alertas no aparece', async () => {
    responde(0);
    mostrar();
    await screen.findByRole('link', { name: /^Sin alertas activas/ });
    expect(document.querySelector('.numero-nav')).toBeNull();
  });

  test('sin datos no aparece', async () => {
    m.get.mockRejectedValue(new ApiError(503, 'X', 'Sin conexión con el servidor'));
    mostrar();
    await screen.findByRole('link', { name: /sin datos/ });
    expect(document.querySelector('.numero-nav')).toBeNull();
  });

  test('una sola consulta alimenta la campana y los dos menús', async () => {
    responde(2, 'advertencia');
    mostrar();
    await screen.findAllByRole('link', { name: /^Alertas.*2 alertas activas/ });
    expect(m.get).toHaveBeenCalledTimes(1);
  });
});
