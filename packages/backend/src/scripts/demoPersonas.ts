import pg from 'pg';
import { resolverCertificado } from '../conexion.js';
import { designarPrincipal } from './principal.js';

/**
 * Datos de MUESTRA (solo demostración, D-37): varias personas en dos clientes para
 * mostrar el Anexo C con más de una cuenta por rol. Se puede correr más de una vez:
 * lo que ya existe no se toca.
 *
 *   npm run demo:personas -w packages/backend            (con DATABASE_URL)
 *   npm run demo:personas -w packages/backend -- --seco  (solo muestra qué haría)
 *
 * Contraseñas: cada cuenta nueva COPIA el hash de una cuenta del seed (la misma
 * contraseña que esa cuenta tenga hoy). Ninguna contraseña pasa por este script.
 * Clientes: «Cliente inicial» pasa a llamarse «Agrícola Los Aromos» (torres A y B) y
 * se crea «Huerta Norte» con la Torre C (se permite porque viene del Cliente inicial).
 * Ana Administradora pasa a Administrador principal (su sesión abierta se cierra en ≤30 s).
 */
const CLIENTE_1 = 'Agrícola Los Aromos';
const CLIENTE_2 = 'Huerta Norte';
const TORRE_C = 'Torre C · Frutilla';

type Persona = { nombre: string; email: string; rol: 'administrador' | 'supervisor' | 'encargado' | 'tecnico'; copiaDe: string; cliente?: string; torres?: string[]; atiende?: string[] };
export const PERSONAS: Persona[] = [
  { nombre: 'Rodrigo Rojas', email: 'admin2@aquaplants.cl', rol: 'administrador', copiaDe: 'admin@aquaplants.cl' },
  { nombre: 'Carla Muñoz', email: 'supervisor2@aquaplants.cl', rol: 'supervisor', copiaDe: 'supervisor@aquaplants.cl', cliente: CLIENTE_2 },
  { nombre: 'Marcela Díaz', email: 'encargado3@aquaplants.cl', rol: 'encargado', copiaDe: 'encargado@aquaplants.cl', cliente: CLIENTE_1, torres: ['Torre B · Albahaca'] },
  { nombre: 'Diego Pérez', email: 'encargado4@aquaplants.cl', rol: 'encargado', copiaDe: 'encargado@aquaplants.cl', cliente: CLIENTE_2, torres: [TORRE_C] },
  { nombre: 'Teo Técnico', email: 'tecnico@aquaplants.cl', rol: 'tecnico', copiaDe: 'supervisor@aquaplants.cl', atiende: [CLIENTE_1, CLIENTE_2] },
  { nombre: 'Paula Soto', email: 'tecnico2@aquaplants.cl', rol: 'tecnico', copiaDe: 'supervisor@aquaplants.cl', atiende: [CLIENTE_2] },
];
/** GPS de muestra (Santiago); AquaBrain-C queda sin ubicación para mostrar ambos casos. */
const GPS: Record<string, [number, number]> = { 'AquaBrain-A': [-33.4489, -70.6693], 'AquaBrain-B': [-33.4492, -70.6688] };

export async function cargarPersonas(url: string, seco = false): Promise<string[]> {
  const hecho: string[] = [];
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    // Clientes
    const c1 = await c.query<{ nombre: string }>(`SELECT nombre FROM cliente WHERE id_cliente = 1`);
    if (c1.rows[0]?.nombre === 'Cliente inicial') {
      await c.query(`UPDATE cliente SET nombre = $1 WHERE id_cliente = 1`, [CLIENTE_1]);
      hecho.push(`Cliente #1 renombrado a «${CLIENTE_1}»`);
    }
    let r = await c.query<{ id: number }>(`SELECT id_cliente AS id FROM cliente WHERE lower(nombre) = lower($1)`, [CLIENTE_2]);
    if (!r.rows[0]) {
      r = await c.query(`INSERT INTO cliente (nombre) VALUES ($1) RETURNING id_cliente AS id`, [CLIENTE_2]);
      hecho.push(`Cliente «${CLIENTE_2}» creado`);
    }
    const idCliente: Record<string, number> = { [CLIENTE_1]: 1, [CLIENTE_2]: r.rows[0].id };

    // Torre C (con su Encargado actual) pasa a Huerta Norte, solo si sigue en el cliente 1.
    const tc = await c.query<{ id: number; id_cliente: number }>(`SELECT id_instalacion AS id, id_cliente FROM instalacion WHERE nombre = $1 AND estado = 'activo'`, [TORRE_C]);
    if (tc.rows[0]?.id_cliente === 1) {
      await c.query(`UPDATE instalacion SET id_cliente = $2 WHERE id_instalacion = $1`, [tc.rows[0].id, idCliente[CLIENTE_2]]);
      const mov = await c.query(
        `UPDATE usuario SET id_cliente = $2, version_token = version_token + 1
          WHERE id_cliente = 1 AND id_usuario IN (SELECT ui.id_usuario FROM usuario_instalacion ui WHERE ui.id_instalacion = $1)
            AND NOT EXISTS (SELECT 1 FROM usuario_instalacion o WHERE o.id_usuario = usuario.id_usuario AND o.id_instalacion <> $1)`,
        [tc.rows[0].id, idCliente[CLIENTE_2]],
      );
      hecho.push(`${TORRE_C} pasa a «${CLIENTE_2}» (con ${mov.rowCount} Encargado${mov.rowCount === 1 ? '' : 's'})`);
    }

    // Personas
    for (const p of PERSONAS) {
      const ya = await c.query(`SELECT 1 FROM usuario WHERE lower(email) = lower($1)`, [p.email]);
      if (ya.rowCount) continue;
      const base = await c.query<{ hash_password: string }>(`SELECT hash_password FROM usuario WHERE lower(email) = lower($1)`, [p.copiaDe]);
      if (!base.rows[0]) throw new Error(`No existe la cuenta base ${p.copiaDe}`);
      const u = await c.query<{ id: number }>(
        `INSERT INTO usuario (nombre, email, hash_password, id_rol, debe_cambiar_password, aviso_alertas, id_cliente)
         VALUES ($1, $2, $3, (SELECT id_rol FROM rol WHERE nombre = $4::text), false,
                 CASE WHEN $4::text IN ('administrador','tecnico') THEN 'ninguna' ELSE 'todas' END, $5)
         RETURNING id_usuario AS id`,
        [p.nombre, p.email, base.rows[0].hash_password, p.rol, p.cliente ? idCliente[p.cliente] : null],
      );
      for (const t of p.torres ?? []) {
        await c.query(
          `INSERT INTO usuario_instalacion (id_usuario, id_instalacion) SELECT $1, id_instalacion FROM instalacion WHERE nombre = $2 AND id_cliente = $3`,
          [u.rows[0].id, t, idCliente[p.cliente!]],
        );
      }
      for (const cl of p.atiende ?? []) await c.query(`INSERT INTO tecnico_cliente (id_usuario, id_cliente) VALUES ($1, $2)`, [u.rows[0].id, idCliente[cl]]);
      hecho.push(`${p.nombre} <${p.email}> creado (${p.rol}${p.cliente ? `, ${p.cliente}` : ''}${p.atiende ? `, atiende ${p.atiende.join(' y ')}` : ''})`);
    }

    // GPS de muestra, solo si el dispositivo no tiene.
    for (const [nombre, [lat, lon]] of Object.entries(GPS)) {
      const g = await c.query(`UPDATE dispositivo SET latitud = $2, longitud = $3 WHERE nombre = $1 AND latitud IS NULL`, [nombre, lat, lon]);
      if (g.rowCount) hecho.push(`GPS de muestra en ${nombre}`);
    }

    if (hecho.length) {
      await c.query(`INSERT INTO log_auditoria (id_usuario, accion, entidad, detalle) VALUES (NULL, 'demo_personas', 'sistema', $1)`, [JSON.stringify({ origen: 'script', cambios: hecho.length })]);
    }
    await c.query(seco ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
  // Administrador principal: Ana (se hace aparte porque usa su propia transacción).
  if (!seco) {
    try {
      hecho.push(await designarPrincipal(url, 'admin@aquaplants.cl', false));
    } catch (e) {
      const m = (e as Error).message;
      if (!/Solo una cuenta de Administrador/.test(m)) hecho.push(`Administrador principal: ${m}`);
    }
  } else hecho.push('admin@aquaplants.cl pasaría a Administrador principal');
  return hecho;
}

const esPrincipal = process.argv[1] && /demoPersonas\.(t|j)s$/.test(process.argv[1]);
if (esPrincipal) {
  const url = resolverCertificado(process.env.DATABASE_URL);
  if (!url) {
    console.error('Defina DATABASE_URL');
    process.exit(1);
  }
  const seco = process.argv.includes('--seco');
  cargarPersonas(url, seco)
    .then((h) => {
      console.log(seco ? '[demo] EN SECO (nada se guardó):' : '[demo] listo:');
      for (const l of h.length ? h : ['nada que hacer: ya estaba cargado']) console.log(' -', l);
    })
    .catch((e) => {
      console.error('[demo]', (e as Error).message);
      process.exit(1);
    });
}
