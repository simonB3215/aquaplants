import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EstadoConectividad, EstadoTorre, EstadoVariable } from '@aquaplants/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), usuario: { id_usuario: 1, rol: 'supervisor' } }));
vi.mock('../api/cliente', async (original) => {
  const real = await original<typeof import('../api/cliente')>();
  return { ...real, api: { ...real.api, get: m.get } };
});
vi.mock('../estado/sesion', () => ({ useSesion: () => ({ usuario: m.usuario, puede: () => true }) }));
vi.mock('../estado/conexion', () => ({ useConexion: () => 'en_linea' }));
vi.mock('../estado/avisos', () => ({ useAvisos: () => vi.fn() }));
vi.mock('../componentes/Layout', () => ({ BarraSuperior: () => null }));
vi.mock('../componentes/PanelHistorico', () => ({ PanelHistorico: () => null }));

import { Torres } from '../paginas/Torres';

const t = (id: number, nombre: string, especie: string | null, estado_general: EstadoVariable, conexiones: EstadoConectividad[], alertas_activas = 0, extra: Partial<EstadoTorre> = {}): EstadoTorre => ({
  id_instalacion: id, nombre, tipo: 'aeroponica', ubicacion: '', id_cliente: 1, cliente: 'Cliente inicial', estado_registro: 'activo',
  cultivo: especie ? { id_cultivo: id, especie, fecha_inicio: '2026-11-01' } : null,
  estado_general, alertas_activas, variables: [], ultima_lectura: null,
  dispositivos: conexiones.map((conectividad, i) => ({ id_dispositivo: id * 10 + i, nombre: `AquaBrain-${id}${i}`, estado_registro: 'activo', conectividad, ultima_comunicacion: null, segundos_sin_reportar: null, intervalo_muestreo_s: 60, umbral_sin_senal_s: 180, pendientes_reportados: null, datos_desactualizados: false, rssi_dbm: null, calidad_enlace: 'sin_dato', latitud: null, longitud: null })),
  ...extra,
});
let torres: EstadoTorre[];

async function mostrar() {
  render(<MemoryRouter><Torres /></MemoryRouter>);
  await screen.findByRole('search', { name: 'Filtrar torres' });
}
const filtros = () => within(screen.getByRole('search', { name: 'Filtrar torres' }));
const buscar = (value: string) => fireEvent.change(filtros().getByLabelText('Buscar torre, cultivo o dispositivo'), { target: { value } });
const elegir = (campo: 'Estado' | 'Conexión', value: string) => fireEvent.change(filtros().getByLabelText(campo), { target: { value } });
const nombres = () => [...document.querySelectorAll('article.torre h3')].map((e) => e.textContent);
const resumen = () => filtros().getByRole('status').textContent;

beforeEach(() => {
  sessionStorage.clear();
  m.usuario.id_usuario = 1;
  torres = [
    t(1, 'Torre A', 'Lechuga', 'critico', ['conectado'], 2),
    t(2, 'Torre B', 'Albahaca', 'advertencia', ['sin_senal', 'conectado']),
    t(3, 'Torre C', 'Rúcula', 'normal', ['sincronizando'], 1, { tipo: 'hidroponica', ubicacion: 'Invernadero Ñuñoa' }),
    t(4, 'Torre D', null, 'sin_datos', ['nunca_conectado']),
    t(5, 'Torre E', 'Espinaca', 'sin_clasificar', []),
  ];
  m.get.mockReset().mockImplementation(async (ruta: string) => (ruta === '/cultivos' ? [] : { generado_en: new Date().toISOString(), torres }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Filtros de torres', () => {
  test('sin filtros muestra todas y no ofrece limpiar', async () => {
    await mostrar();
    expect(nombres()).toHaveLength(5);
    expect(resumen()).toBe('5 torres');
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  test.each([
    ['torre a', 'Torre A'],
    ['torre b', 'Torre B'],
    ['RUCULA', 'Torre C'],
    ['hidroponica', 'Torre C'],
    ['nunoa', 'Torre C'],
    ['aquabrain-40', 'Torre D'],
    ['lechuga torre', 'Torre A'],
  ])('busca «%s»', async (texto, esperada) => {
    await mostrar();
    buscar(texto);
    expect(nombres()).toEqual([esperada]);
  });

  test.each([
    { valor: 'critico', esperadas: ['Torre A'] },
    { valor: 'advertencia', esperadas: ['Torre B'] },
    { valor: 'normal', esperadas: ['Torre C'] },
    { valor: 'sin_datos', esperadas: ['Torre D'] },
    { valor: 'sin_clasificar', esperadas: ['Torre E'] },
    { valor: 'alertas', esperadas: ['Torre A', 'Torre C'] },
  ])('estado $valor', async ({ valor, esperadas }) => {
    await mostrar();
    elegir('Estado', valor);
    expect(nombres()).toEqual(esperadas);
  });

  test.each([
    { valor: 'conectado', esperadas: ['Torre A', 'Torre B'] },
    { valor: 'sin_senal', esperadas: ['Torre B'] },
    { valor: 'sincronizando', esperadas: ['Torre C'] },
    { valor: 'nunca_conectado', esperadas: ['Torre D'] },
  ])('conexión $valor: basta un dispositivo', async ({ valor, esperadas }) => {
    await mostrar();
    elegir('Conexión', valor);
    expect(nombres()).toEqual(esperadas);
  });

  test('combina los tres filtros', async () => {
    await mostrar();
    buscar('torre');
    elegir('Estado', 'alertas');
    elegir('Conexión', 'conectado');
    expect(nombres()).toEqual(['Torre A']);
    expect(resumen()).toBe('1 de 5 torres');
  });

  test('sin coincidencias no dice «sin torres asignadas», y limpiar restaura', async () => {
    await mostrar();
    buscar('zzzz');
    expect(screen.getByText('Ninguna torre coincide')).toBeTruthy();
    expect(screen.queryByText('No tiene torres asignadas')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(nombres()).toHaveLength(5);
    expect(document.activeElement).toBe(filtros().getByLabelText('Buscar torre, cultivo o dispositivo'));
  });

  test('sin torres asignadas no muestra filtros', async () => {
    torres = [];
    render(<MemoryRouter><Torres /></MemoryRouter>);
    expect(await screen.findByText('No tiene torres asignadas')).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
  });

  test('se conserva al salir y volver', async () => {
    await mostrar();
    elegir('Estado', 'critico');
    cleanup();
    await mostrar();
    expect(nombres()).toEqual(['Torre A']);
  });

  test('otro usuario en la misma pestaña no lo hereda', async () => {
    await mostrar();
    elegir('Estado', 'critico');
    cleanup();
    m.usuario.id_usuario = 2;
    await mostrar();
    expect(nombres()).toHaveLength(5);
  });

  test('un valor guardado inválido se ignora', async () => {
    sessionStorage.setItem('aq_filtros_torres_1', '{"estado":"otro","conexion":7,"texto":null}');
    await mostrar();
    expect(resumen()).toBe('5 torres');
  });

  test('el refresco automático respeta el filtro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mostrar();
    elegir('Estado', 'critico');
    torres = torres.map((x) => (x.id_instalacion === 2 ? { ...x, estado_general: 'critico' } : x));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });
    expect(nombres()).toEqual(['Torre A', 'Torre B']);
  });
});

describe('Filtro por lectura (temperatura, pH…)', () => {
  const temp = (valor: number | null, sensor_activo = true) => ({
    variables: [{ id_sensor: 1, tipo_variable: 'Temperatura', id_tipo_variable: 2, unidad: '°C', valor, ts: null, estado: 'normal' as EstadoVariable, umbrales: [], sensor_activo }],
  });
  beforeEach(() => {
    torres = [
      t(1, 'Torre A', 'Lechuga', 'normal', ['conectado'], 0, temp(21.5)),
      t(2, 'Torre B', 'Albahaca', 'normal', ['conectado'], 0, temp(26)),
      t(3, 'Torre C', 'Rúcula', 'normal', ['conectado'], 0, temp(null)),
      t(4, 'Torre D', 'Espinaca', 'normal', ['conectado'], 0, temp(18.2)),
    ];
  });

  test('más alta y más baja primero (sin dato al final); mayor/menor o igual que un valor con coma decimal', async () => {
    await mostrar();
    fireEvent.change(filtros().getByLabelText('Variable'), { target: { value: 'Temperatura' } });
    expect(nombres()).toEqual(['Torre B', 'Torre A', 'Torre D', 'Torre C']);
    fireEvent.change(filtros().getByLabelText('Mostrar'), { target: { value: 'baja' } });
    expect(nombres()).toEqual(['Torre D', 'Torre A', 'Torre B', 'Torre C']);
    fireEvent.change(filtros().getByLabelText('Mostrar'), { target: { value: 'mayor' } });
    fireEvent.change(filtros().getByLabelText('Valor (°C)'), { target: { value: '21,5' } });
    expect(nombres()).toEqual(['Torre B', 'Torre A']);
    expect(resumen()).toBe('2 de 4 torres');
    fireEvent.change(filtros().getByLabelText('Mostrar'), { target: { value: 'menor' } });
    expect(nombres()).toEqual(['Torre D', 'Torre A']);
    fireEvent.change(filtros().getByLabelText('Valor (°C)'), { target: { value: 'abc' } });
    expect(filtros().getByText('Ingrese un número')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(nombres()).toEqual(['Torre A', 'Torre B', 'Torre C', 'Torre D']);
  });
});

describe('Tiempo de cosecha (días de cultivo)', () => {
  test('diasDeCultivo: hasta la cosecha o hasta hoy, sin negativos', async () => {
    const { diasDeCultivo, textoDias } = await import('../util/formato');
    expect(diasDeCultivo('2026-10-01', '2026-11-20')).toBe(50);
    expect(diasDeCultivo('2026-02-27', '2026-03-01')).toBe(2);
    expect(diasDeCultivo('2026-11-01', null, '2026-11-24')).toBe(23);
    expect(diasDeCultivo('2026-11-25', null, '2026-11-24')).toBe(0);
    expect([textoDias(1), textoDias(23)]).toEqual(['1 día', '23 días']);
  });

  test('la tarjeta muestra los días y el filtro ordena por días de cultivo (sin cultivo al final)', async () => {
    const { diasDeCultivo } = await import('../util/formato');
    torres = [
      t(1, 'Torre A', 'Lechuga', 'normal', ['conectado'], 0, { cultivo: { id_cultivo: 1, especie: 'Lechuga', fecha_inicio: '2026-11-10' } }),
      t(2, 'Torre B', 'Albahaca', 'normal', ['conectado'], 0, { cultivo: { id_cultivo: 2, especie: 'Albahaca', fecha_inicio: '2026-10-01' } }),
      t(3, 'Torre C', null, 'normal', ['conectado']),
    ];
    await mostrar();
    const dias = diasDeCultivo('2026-11-10');
    expect(document.querySelector('article.torre p')!.textContent).toContain('Lechuga desde 2026-11-10 (' + dias + (dias === 1 ? ' día)' : ' días)'));
    fireEvent.change(filtros().getByLabelText('Variable'), { target: { value: 'Días de cultivo' } });
    expect(nombres()).toEqual(['Torre B', 'Torre A', 'Torre C']);
    fireEvent.change(filtros().getByLabelText('Mostrar'), { target: { value: 'baja' } });
    expect(nombres()).toEqual(['Torre A', 'Torre B', 'Torre C']);
  });
});

describe('Cosecha estimada (opción A)', () => {
  test('la tarjeta muestra la fecha estimada con el promedio de la especie y la tabla resume la duración', async () => {
    const { sumarDias } = await import('../util/cosecha');
    torres = [
      t(1, 'Torre A', 'Lechuga', 'normal', ['conectado'], 0, { cultivo: { id_cultivo: 9, especie: 'Lechuga', fecha_inicio: '2026-11-10' } }),
      t(2, 'Torre B', 'Tomate', 'normal', ['conectado'], 0, { cultivo: { id_cultivo: 8, especie: 'Tomate', fecha_inicio: '2026-11-01' } }),
    ];
    const historial = [
      { id_cultivo: 1, especie: 'Lechuga', fecha_inicio: '2026-08-01', fecha_fin: '2026-09-15', estado: 'finalizado' },
      { id_cultivo: 2, especie: 'Lechuga', fecha_inicio: '2026-09-20', fecha_fin: '2026-11-10', estado: 'finalizado' },
    ];
    m.get.mockImplementation(async (ruta: string) => (ruta === '/cultivos' ? historial : { generado_en: new Date().toISOString(), torres }));
    await mostrar();
    await screen.findByText('Duración por especie');
    const tarjeta = (n: string) => document.getElementById(`torre-${n}`)!.closest('article')!.textContent!;
    expect(tarjeta('1')).toContain(`Cosecha estimada ${sumarDias('2026-11-10', 48)}`);
    expect(tarjeta('2')).toContain('Sin cosechas previas de Tomate para estimar');
    const fila = screen.getByText('Lechuga', { selector: 'td strong' }).closest('tr')!;
    expect(fila.textContent).toBe('Lechuga48 días45 – 51 días2');
  });
});
