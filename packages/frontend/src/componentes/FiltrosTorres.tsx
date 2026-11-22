import { NOMBRE_CONECTIVIDAD, NOMBRE_ESTADO_VARIABLE } from '@aquaplants/shared';
import { CONEXIONES_TORRE, ESTADOS_TORRE, hayFiltrosTorres, SIN_FILTROS_TORRES, type FiltroTorres } from '../util/torres';
import { BarraFiltros } from './BarraFiltros';
import { Campo, Selector } from './ui';

/** Buscador y filtros de Torres. Solo filtra lo que la API ya dejó ver al usuario (RN-10). */
export function FiltrosTorres({ filtro, alCambiar, visibles, total }: { filtro: FiltroTorres; alCambiar: (f: FiltroTorres) => void; visibles: number; total: number }) {
  return (
    <BarraFiltros etiqueta="Filtrar torres" activos={hayFiltrosTorres(filtro)} visibles={visibles} total={total} unidad={['torre', 'torres']} alLimpiar={() => alCambiar(SIN_FILTROS_TORRES)}>
      <Campo etiqueta="Buscar torre, cultivo o dispositivo" type="search" autoComplete="off" value={filtro.texto} onChange={(e) => alCambiar({ ...filtro, texto: e.target.value })} />
      <Selector etiqueta="Estado" value={filtro.estado} onChange={(e) => alCambiar({ ...filtro, estado: e.target.value as FiltroTorres['estado'] })}>
        <option value="">Todos</option>
        <option value="alertas">Con alertas activas</option>
        {ESTADOS_TORRE.map((e) => (
          <option key={e} value={e}>
            {NOMBRE_ESTADO_VARIABLE[e]}
          </option>
        ))}
      </Selector>
      <Selector etiqueta="Conexión" value={filtro.conexion} onChange={(e) => alCambiar({ ...filtro, conexion: e.target.value as FiltroTorres['conexion'] })}>
        <option value="">Todas</option>
        {CONEXIONES_TORRE.map((c) => (
          <option key={c} value={c}>
            {NOMBRE_CONECTIVIDAD[c]}
          </option>
        ))}
      </Selector>
    </BarraFiltros>
  );
}
