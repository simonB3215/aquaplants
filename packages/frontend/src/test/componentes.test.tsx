import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EstadoTorre } from '@aquaplants/shared';
import { InsigniaConectividad, InsigniaEstado } from '../componentes/ui';
import { TarjetaTorre } from '../componentes/TarjetaTorre';
import { RestablecerContrasena } from '../paginas/Recuperar';

const torre: EstadoTorre = {
  id_instalacion: 1, nombre: 'Torre A', tipo: 'aeroponica', ubicacion: '', estado_registro: 'activo',
  cultivo: { id_cultivo: 1, especie: 'Lechuga', fecha_inicio: '2026-10-01' }, estado_general: 'critico', alertas_activas: 1,
  dispositivos: [{ id_dispositivo: 1, nombre: 'AquaBrain-A', estado_registro: 'sin_senal', conectividad: 'sin_senal', ultima_comunicacion: new Date(Date.now() - 300_000).toISOString(), segundos_sin_reportar: 300, intervalo_muestreo_s: 60, umbral_sin_senal_s: 180, pendientes_reportados: null, datos_desactualizados: true, rssi_dbm: -88, calidad_enlace: 'debil' }],
  variables: [{ id_sensor: 1, tipo_variable: 'pH', id_tipo_variable: 1, unidad: 'pH', valor: 4.2, ts: new Date().toISOString(), estado: 'critico', umbrales: [{ severidad: 'critica', valor_min: 5.1, valor_max: 6.7 }], sensor_activo: true }],
  ultima_lectura: null,
};

describe('Estados accesibles (color + ícono + texto)', () => {
  test('la insignia de estado incluye texto, no solo color', () => {
    render(<InsigniaEstado estado="critico" />);
    expect(screen.getByText('Crítico')).toBeInTheDocument();
  });
  test('conectividad «Sin señal» se muestra como texto', () => {
    render(<InsigniaConectividad estado="sin_senal" />);
    expect(screen.getByText('Sin señal')).toBeInTheDocument();
  });
});

describe('TarjetaTorre (CU-03)', () => {
  test('muestra valor, unidad, umbral y aviso de datos desactualizados sin atribuir causa', () => {
    render(<MemoryRouter><TarjetaTorre torre={torre} /></MemoryRouter>);
    expect(screen.getByText('Torre A')).toBeInTheDocument();
    expect(screen.getByText(/Crítico <5,1 >6,7/)).toBeInTheDocument();
    expect(screen.getByText(/Datos desactualizados/)).toBeInTheDocument();
    expect(screen.getByText(/La causa no se puede determinar/)).toBeInTheDocument();
  });
  test('con el servidor caído no declara la torre «sin señal» por esa causa', () => {
    render(<MemoryRouter><TarjetaTorre torre={{ ...torre, dispositivos: [{ ...torre.dispositivos[0], conectividad: 'conectado', datos_desactualizados: false }] }} servidorCaido /></MemoryRouter>);
    expect(screen.getByText(/No hay conexión con el servidor/)).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });
});

describe('¿Olvidó su contraseña?', () => {
  test('sin token en el enlace muestra «Enlace no válido» y ofrece pedir otro', () => {
    window.history.replaceState(null, '', '/restablecer-contrasena');
    render(<MemoryRouter><RestablecerContrasena /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Enlace no válido' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solicitar un enlace nuevo' })).toHaveAttribute('href', '/olvide-contrasena');
  });
  test('con token muestra el formulario y lo quita de la barra de direcciones', () => {
    window.history.replaceState(null, '', `/restablecer-contrasena#token=${'a'.repeat(43)}`);
    render(<MemoryRouter><RestablecerContrasena /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Elegir contraseña nueva' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});
