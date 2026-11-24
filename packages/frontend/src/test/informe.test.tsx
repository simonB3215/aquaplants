import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), admin: true }));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get } };
});
vi.mock('../estado/sesion', () => ({
  useSesion: () => ({ usuario: { id_usuario: 1, nombre: 'Ana Administradora', rol: m.admin ? 'administrador' : 'supervisor' }, puede: (f: string) => m.admin || f !== 'clientes.gestionar', cerrar: vi.fn() }),
}));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));
// Chart.js necesita canvas: en jsdom se reemplaza por un marcador con los datos.
vi.mock('../componentes/Graficos', () => ({
  GraficoConteoDiario: ({ dias, series }: { dias: string[]; series: { etiqueta: string; valores: number[] }[] }) => (
    <div data-testid="grafico">{`${dias.length} días · ${series.map((s) => s.etiqueta).join(' / ')}`}</div>
  ),
}));

import { Informe, type InformeGestion } from '../paginas/Informe';
import { hoyISO, mesesRecientes } from '../util/formato';

const base = (desde: string, hasta: string, auditoria = true): InformeGestion => ({
  generado_en: '2026-11-23T15:00:00.000Z',
  periodo: { desde, hasta },
  cliente: null,
  inventario: { clientes: 2, torres: 3, dispositivos: 3, dispositivos_sin_senal: 1, sensores: 22, cultivos_en_curso: 3, usuarios: 10 },
  telemetria: { lecturas: 327112, sensores_con_datos: 22 },
  alertas: { total: 6, criticas: 3, advertencias: 3, resueltas: 5, activas: 1, horas_resolucion: 101.4, pct_resueltas: 83 },
  incidencias: { total: 3, cerradas: 1, abiertas: 2, horas_cierre: 5.5, pct_cerradas: 33 },
  cultivos: { iniciados: 1, finalizados: 0, por_especie: [{ especie: 'Lechuga', en_curso: 1, iniciados: 1, finalizados: 0 }] },
  por_torre: [
    { id_instalacion: 1, torre: 'Torre A', cliente: 'Huerta Norte', estado: 'activo', cultivo: 'Lechuga', lecturas: 123925, alertas: 3, criticas: 3, incidencias: 1, ultima_comunicacion: null },
  ],
  por_dia: [
    { dia: desde, alertas: 2, incidencias: 0 },
    { dia: hasta, alertas: 1, incidencias: 1 },
  ],
  auditoria: auditoria ? [{ accion: 'crear_especie', total: 3 }] : null,
});

beforeEach(() => {
  m.admin = true;
  m.get.mockReset().mockImplementation(async (ruta: string) => {
    if (ruta === '/clientes') return [{ id_cliente: 4, nombre: 'Huerta Norte', estado: 'activo' }];
    const q = new URLSearchParams(ruta.split('?')[1]);
    return base(q.get('desde')!, q.get('hasta')!, m.admin);
  });
});
afterEach(cleanup);

const mostrar = async () => {
  render(
    <MemoryRouter>
      <Informe />
    </MemoryRouter>,
  );
  await screen.findByText('1. Resumen del periodo');
};
const ultimaRuta = () => m.get.mock.calls.map((c) => c[0] as string).filter((r) => r.startsWith('/informes')).at(-1)!;

describe('mesesRecientes', () => {
  test('mes en curso hasta hoy, meses anteriores completos y cambio de año', () => {
    const m = mesesRecientes(13, '2026-11-24');
    expect(m[0]).toEqual({ valor: '2026-11', texto: 'Noviembre 2026', desde: '2026-11-01', hasta: '2026-11-24' });
    expect(m[1]).toMatchObject({ valor: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' });
    expect(m.find((x) => x.valor === '2026-02')!.hasta).toBe('2026-02-28');
    expect(m[11]).toMatchObject({ valor: '2025-12', texto: 'Diciembre 2025', hasta: '2025-12-31' });
    expect(m).toHaveLength(13);
  });
});

describe('Informe de gestión', () => {
  test('elegir un mes genera el informe de ese mes y editar las fechas vuelve a «Por fechas»', async () => {
    await mostrar();
    const anterior = mesesRecientes(2)[1];
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Mes'), { target: { value: anterior.valor } });
    });
    const q = new URLSearchParams(ultimaRuta().split('?')[1]);
    expect([q.get('desde'), q.get('hasta')]).toEqual([anterior.desde, anterior.hasta]);
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe(anterior.desde);
    expect((screen.getByLabelText('Mes') as HTMLSelectElement).value).toBe(anterior.valor);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: anterior.desde.replace(/01$/, '05') } });
    expect((screen.getByLabelText('Mes') as HTMLSelectElement).value).toBe('');
  });

  test('al entrar genera los últimos 30 días y muestra indicadores, gráfico, torres y actividad', async () => {
    await mostrar();
    const q = new URLSearchParams(ultimaRuta().split('?')[1]);
    expect(q.get('hasta')).toBe(hoyISO());
    expect((Date.parse(q.get('hasta')!) - Date.parse(q.get('desde')!)) / 86_400_000).toBe(29);
    expect(screen.getByText('327.112')).toBeTruthy();
    expect(screen.getByText(/3 críticas · 83 % resueltas · 4,2 días prom\./)).toBeTruthy();
    expect(screen.getByTestId('grafico').textContent).toBe('2 días · Alertas de cultivo / Incidencias de equipos');
    expect(within(screen.getByText('Torre A').closest('tr')!).getByText('3 (3)')).toBeTruthy();
    expect(screen.getByText('5. Actividad de usuarios')).toBeTruthy();
    expect(screen.getByText('crear especie')).toBeTruthy();
  });

  test('filtra por cliente y valida el periodo antes de pedirlo', async () => {
    await mostrar();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generar informe' }));
    });
    expect(ultimaRuta()).toContain('cliente=4');
    const llamadas = m.get.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar informe' }));
    expect(await screen.findByText('Debe ser igual o posterior a «Desde»')).toBeTruthy();
    expect(m.get.mock.calls.length).toBe(llamadas);
  });

  test('el Supervisor no elige cliente ni ve la actividad de usuarios', async () => {
    m.admin = false;
    await mostrar();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    expect(screen.queryByText('5. Actividad de usuarios')).toBeNull();
    expect(m.get.mock.calls.some((c) => c[0] === '/clientes')).toBe(false);
  });
});
