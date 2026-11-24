import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autorizado, FUNCIONALIDADES, puedeGestionarRol, rolesAsignables, ROLES } from './permisos.js';
import { LoteSchema } from './schemas/telemetria.js';
import { UmbralSchema, HistoricoSchema } from './schemas/api.js';
import { granularidadPara } from './granularidad.js';

test('Tabla 48: Encargado no resuelve críticas, Supervisor sí', () => {
  assert.equal(autorizado('encargado', 'alertas.resolver_critica'), false);
  assert.equal(autorizado('supervisor', 'alertas.resolver_critica'), true);
  assert.equal(autorizado('encargado', 'alertas.resolver_advertencia'), true);
});

test('Tabla 48: solo lectura de umbrales para Encargado y Supervisor', () => {
  assert.equal(autorizado('encargado', 'umbrales.gestionar', 'leer'), true);
  assert.equal(autorizado('encargado', 'umbrales.gestionar', 'escribir'), false);
  assert.equal(autorizado('supervisor', 'infraestructura.gestionar', 'escribir'), false);
  assert.equal(autorizado('administrador', 'umbrales.gestionar', 'escribir'), true);
});

test('Tabla 48: telemetría solo para dispositivo; Encargado no gestiona usuarios', () => {
  for (const r of ROLES) assert.equal(autorizado(r, 'telemetria.enviar'), false);
  assert.equal(autorizado('dispositivo', 'telemetria.enviar'), true);
  assert.equal(autorizado('encargado', 'usuarios.gestionar', 'leer'), false);
  assert.equal(autorizado('supervisor', 'cultivos.gestionar', 'escribir'), false);
  assert.equal(autorizado('encargado', 'cultivos.gestionar', 'escribir'), true);
  assert.equal(Object.keys(FUNCIONALIDADES).length, 18);
});

test('Anexo C (Tabla 70): Técnico, Supervisor y Administrador principal', () => {
  // Técnico: incidencias sí; alertas de cultivo, cultivos, exportar y usuarios no.
  assert.equal(autorizado('tecnico', 'incidencias.atender'), true);
  assert.equal(autorizado('tecnico', 'alertas.ver', 'leer'), false);
  assert.equal(autorizado('tecnico', 'cultivos.gestionar', 'leer'), false);
  assert.equal(autorizado('tecnico', 'historicos.comparar_exportar', 'leer'), false);
  assert.equal(autorizado('tecnico', 'usuarios.gestionar', 'leer'), false);
  assert.equal(autorizado('tecnico', 'infraestructura.gestionar', 'leer'), true);
  assert.equal(autorizado('tecnico', 'infraestructura.gestionar', 'escribir'), false);
  // Supervisor: lee incidencias, gestiona usuarios (solo Encargados: alcance en el servicio).
  assert.equal(autorizado('supervisor', 'incidencias.atender', 'leer'), true);
  assert.equal(autorizado('supervisor', 'incidencias.atender', 'escribir'), false);
  assert.equal(autorizado('supervisor', 'usuarios.gestionar'), true);
  assert.equal(autorizado('supervisor', 'auditoria.consultar', 'leer'), false);
  assert.equal(autorizado('encargado', 'incidencias.atender', 'leer'), false);
  // Clientes: ambos administradores; Administradores: solo el principal.
  assert.equal(autorizado('administrador', 'clientes.gestionar'), true);
  assert.equal(autorizado('supervisor', 'clientes.gestionar', 'leer'), false);
  assert.equal(autorizado('administrador', 'administradores.gestionar'), false);
  assert.equal(autorizado('administrador_principal', 'administradores.gestionar'), true);
  // El principal tiene todo lo del Administrador.
  for (const f of Object.keys(FUNCIONALIDADES) as (keyof typeof FUNCIONALIDADES)[]) {
    if (FUNCIONALIDADES[f].administrador === 'si') assert.equal(autorizado('administrador_principal', f), true, f);
  }
  // Rol desconocido (p. ej. un JWT antiguo manipulado): nada.
  assert.equal(autorizado('otro' as never, 'estado.ver', 'leer'), false);
});

test('RN-12: cada nivel gestiona solo niveles inferiores', () => {
  assert.deepEqual(rolesAsignables('supervisor'), ['encargado']);
  assert.deepEqual(rolesAsignables('administrador'), ['encargado', 'supervisor', 'tecnico']);
  assert.deepEqual(rolesAsignables('administrador_principal'), ['encargado', 'supervisor', 'tecnico', 'administrador']);
  assert.deepEqual(rolesAsignables('encargado'), []);
  assert.deepEqual(rolesAsignables('tecnico'), []);
  assert.equal(puedeGestionarRol('administrador_principal', 'administrador_principal'), false);
  assert.equal(puedeGestionarRol('administrador', 'administrador'), false);
});

test('LoteSchema valida el contrato del ES2', () => {
  const ok = LoteSchema.safeParse({
    id_lote: '3b1f7c2e-8a4d-4c1e-9b7a-1f2d3c4b5a69',
    id_dispositivo: 7,
    lecturas: [{ id_sensor: 31, ts: '2026-11-03T14:04:00Z', valor: 6.12 }],
  });
  assert.equal(ok.success, true);
  assert.equal(LoteSchema.safeParse({ id_lote: 'x', id_dispositivo: 7, lecturas: [] }).success, false);
  assert.equal(
    LoteSchema.safeParse({ id_lote: '3b1f7c2e-8a4d-4c1e-9b7a-1f2d3c4b5a69', id_dispositivo: 7, lecturas: [{ id_sensor: 1, ts: 'ayer', valor: 1 }] }).success,
    false,
  );
});

test('UmbralSchema exige min < max; HistoricoSchema limita a 90 días', () => {
  assert.equal(UmbralSchema.safeParse({ severidad: 'critica', valor_min: 7, valor_max: 5 }).success, false);
  assert.equal(
    HistoricoSchema.safeParse({ sensor: '1', desde: '2026-01-01T00:00:00Z', hasta: '2026-06-01T00:00:00Z' }).success,
    false,
  );
});

test('granularidad según rango', () => {
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 3600_000)).etiqueta, 'crudo');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 3 * 86400_000)).etiqueta, '15 min');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 20 * 86400_000)).etiqueta, '1 h');
  assert.equal(granularidadPara(d, new Date(d.getTime() + 60 * 86400_000)).etiqueta, '1 día');
});

test('Nombre automático de torre: sigue la serie del cliente y no repite', async () => {
  const { siguienteNombreTorre } = await import('./nombres.js');
  assert.equal(siguienteNombreTorre([]), 'Torre 1');
  assert.equal(siguienteNombreTorre(['Torre A', 'Torre B']), 'Torre C');
  assert.equal(siguienteNombreTorre(['torre a', 'Torre C']), 'Torre D');
  assert.equal(siguienteNombreTorre(['Torre 1', 'Torre 2', 'Invernadero']), 'Torre 3');
  assert.equal(siguienteNombreTorre(['Torre Z']), 'Torre 1');
  assert.equal(siguienteNombreTorre(['Torre 2', 'Torre 3', 'Torre 4']), 'Torre 5');
  // Nombres reales con el cultivo agregado.
  assert.equal(siguienteNombreTorre(['Torre A · Lechuga', 'Torre B · Albahaca']), 'Torre C');
  assert.equal(siguienteNombreTorre(['Torre C · Frutilla']), 'Torre D');
  assert.equal(siguienteNombreTorre(['Torre 1 - Norte', 'simom']), 'Torre 2');
  assert.equal(siguienteNombreTorre(['Torreón', 'Torre Alta']), 'Torre 1');
});
