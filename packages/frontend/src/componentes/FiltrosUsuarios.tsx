import { ETIQUETA_ROL, ROLES, type Rol } from '@aquaplants/shared';
import { ESTADOS_USUARIO, hayFiltros, SIN_FILTROS, type EstadoUsuario, type FiltroUsuarios } from '../util/usuarios';
import { BarraFiltros } from './BarraFiltros';
import { Campo, Selector } from './ui';

/**
 * Buscador y filtros de la lista de usuarios. Es solo interfaz: el acceso lo valida el backend.
 * El filtro de rol ofrece solo los roles presentes en la lista (el Supervisor ve solo Encargados:
 * con un único rol el selector sobra y no se muestra).
 */
export function FiltrosUsuarios({ filtro, alCambiar, visibles, total, roles = ROLES }: { filtro: FiltroUsuarios; alCambiar: (f: FiltroUsuarios) => void; visibles: number; total: number; roles?: readonly Rol[] }) {
  const opciones = ROLES.filter((r) => roles.includes(r) || r === filtro.rol);
  return (
    <BarraFiltros etiqueta="Filtrar usuarios" activos={hayFiltros(filtro)} visibles={visibles} total={total} unidad={['usuario', 'usuarios']} alLimpiar={() => alCambiar(SIN_FILTROS)}>
      <Campo etiqueta="Buscar por nombre o email" type="search" autoComplete="off" value={filtro.texto} onChange={(e) => alCambiar({ ...filtro, texto: e.target.value })} />
      {opciones.length > 1 && (
        <Selector etiqueta="Rol" value={filtro.rol} onChange={(e) => alCambiar({ ...filtro, rol: e.target.value as Rol | '' })}>
          <option value="">Todos</option>
          {opciones.map((r) => (
            <option key={r} value={r}>
              {ETIQUETA_ROL[r]}
            </option>
          ))}
        </Selector>
      )}
      <Selector etiqueta="Estado" value={filtro.estado} onChange={(e) => alCambiar({ ...filtro, estado: e.target.value as EstadoUsuario | '' })}>
        <option value="">Todos</option>
        {Object.entries(ESTADOS_USUARIO).map(([valor, { texto }]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </Selector>
    </BarraFiltros>
  );
}
