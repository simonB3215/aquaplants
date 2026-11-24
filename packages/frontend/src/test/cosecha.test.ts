import { describe, expect, test } from 'vitest';
import { cosechaEstimada, duracionesPorEspecie, sumarDias, textoFaltan, type CultivoHistorial } from '../util/cosecha';

const c = (especie: string, fecha_inicio: string, fecha_fin: string | null): CultivoHistorial => ({ especie, fecha_inicio, fecha_fin, estado: fecha_fin ? 'finalizado' : 'en_curso' });

describe('Duración por especie (opción A: promedio de cosechas)', () => {
  test('promedio, mínimo y máximo solo con cultivos cosechados; orden alfabético', () => {
    const d = duracionesPorEspecie([
      c('Tomate', '2026-06-01', '2026-08-20'), // 80
      c('Lechuga', '2026-08-01', '2026-09-15'), // 45
      c('Lechuga', '2026-09-20', '2026-11-10'), // 51
      c('Lechuga', '2026-11-12', null), // en curso: no cuenta
      c('Albahaca', '2026-11-01', null),
    ]);
    expect([...d.keys()]).toEqual(['Lechuga', 'Tomate']);
    expect(d.get('Lechuga')).toEqual({ especie: 'Lechuga', promedio: 48, minimo: 45, maximo: 51, cosechas: 2 });
    expect(d.get('Tomate')!.promedio).toBe(80);
    expect(d.has('Albahaca')).toBe(false);
  });

  test('cosecha estimada = inicio + promedio; faltan, hoy y atrasada', () => {
    const tomate = duracionesPorEspecie([c('Tomate', '2026-06-01', '2026-08-20')]).get('Tomate');
    expect(sumarDias('2026-11-20', 80)).toBe('2027-02-08');
    expect(cosechaEstimada('2026-11-20', tomate, '2026-11-24')).toEqual({ fecha: '2027-02-08', faltan: 76 });
    expect(cosechaEstimada('2026-09-05', tomate, '2026-11-24')).toEqual({ fecha: '2026-11-24', faltan: 0 });
    expect(cosechaEstimada('2026-09-01', tomate, '2026-11-24')).toEqual({ fecha: '2026-11-20', faltan: -4 });
    expect(cosechaEstimada('2026-09-01', undefined)).toBeNull();
    expect([textoFaltan(22), textoFaltan(1), textoFaltan(0), textoFaltan(-4)]).toEqual(['faltan 22 días', 'falta 1 día', 'es hoy', 'atrasada 4 días']);
  });
});
