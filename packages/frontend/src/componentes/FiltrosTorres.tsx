import { NOMBRE_CONECTIVIDAD, NOMBRE_ESTADO_VARIABLE } from '@aquaplants/shared';
import type { EstadoTorre } from '@aquaplants/shared';
import { CONEXIONES_TORRE, errorFiltroValor, ESTADOS_TORRE, hayFiltrosTorres, MODOS_VALOR, SIN_FILTROS_TORRES, variablesDeTorres, type FiltroTorres, type FiltroValor, type ModoValor } from '../util/torres';
import { BarraFiltros } from './BarraFiltros';
import { Campo, Selector } from './ui';

/** Buscador y filtros de Torres. Solo filtra lo que la API ya dejó ver al usuario (RN-10). */
export function FiltrosTorres({ filtro, alCambiar, visibles, total, torres }: { filtro: FiltroTorres; alCambiar: (f: FiltroTorres) => void; visibles: number; total: number; torres: EstadoTorre[] }) {
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
      <CamposFiltroValor filtro={filtro} alCambiar={(v) => alCambiar({ ...filtro, ...v })} torres={torres} />
    </BarraFiltros>
  );
}

/**
 * Variable (temperatura, pH…) + «más alta / más baja primero» o «mayor / menor o igual que» un valor.
 * Usa la última lectura de cada torre. Se comparte entre Torres y el CRUD (Torres y equipos).
 */
export function CamposFiltroValor({ filtro, alCambiar, torres }: { filtro: FiltroValor; alCambiar: (f: FiltroValor) => void; torres: EstadoTorre[] }) {
  const variables = variablesDeTorres(torres);
  const unidad = variables.find((v) => v.nombre === filtro.variable)?.unidad;
  const conValor = filtro.modo === 'mayor' || filtro.modo === 'menor';
  return (
    <>
      <Selector etiqueta="Variable" value={filtro.variable} onChange={(e) => alCambiar({ ...filtro, variable: e.target.value })}>
        <option value="">Sin ordenar</option>
        {variables.map((v) => (
          <option key={v.nombre} value={v.nombre}>
            {v.nombre} ({v.unidad})
          </option>
        ))}
      </Selector>
      {filtro.variable && (
        <Selector etiqueta="Mostrar" value={filtro.modo} onChange={(e) => alCambiar({ ...filtro, modo: e.target.value as ModoValor })}>
          {MODOS_VALOR.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.texto}
            </option>
          ))}
        </Selector>
      )}
      {filtro.variable && conValor && (
        <Campo
          etiqueta={`Valor${unidad ? ` (${unidad})` : ''}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej.: 25"
          value={filtro.valor}
          onChange={(e) => alCambiar({ ...filtro, valor: e.target.value })}
          error={errorFiltroValor(filtro)}
        />
      )}
    </>
  );
}
