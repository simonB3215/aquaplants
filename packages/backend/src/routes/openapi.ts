/**
 * Documento OpenAPI 3 de la API v1. Los esquemas de validación reales son los
 * Zod de @aquaplants/shared; este documento los describe para consumidores.
 */
const err = (d: string) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (d: string) => ({ description: d });
const seg = [{ bearerUsuario: [] }];

export const openapi = {
  openapi: '3.0.3',
  info: { title: 'AquaPlants / AquaBrain API', version: '1.0.0', description: 'API REST v1 (CU-01 a CU-10 del informe ES2).' },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerUsuario: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de sesión (8 h).' },
      bearerDispositivo: { type: 'http', scheme: 'bearer', description: 'Credencial de 256 bits del dispositivo (solo telemetría).' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['codigo', 'mensaje'],
        properties: {
          codigo: { type: 'string' },
          mensaje: { type: 'string' },
          campos: { type: 'array', items: { type: 'object', properties: { campo: { type: 'string' }, mensaje: { type: 'string' } } } },
        },
      },
      Lote: {
        type: 'object',
        required: ['id_lote', 'id_dispositivo', 'lecturas'],
        properties: {
          id_lote: { type: 'string', format: 'uuid' },
          id_dispositivo: { type: 'integer' },
          lecturas: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: {
              type: 'object',
              required: ['id_sensor', 'ts', 'valor'],
              properties: { id_sensor: { type: 'integer' }, ts: { type: 'string', format: 'date-time' }, valor: { type: 'number' } },
            },
          },
          meta: { type: 'object', properties: { pendientes: { type: 'integer' }, recuperado: { type: 'boolean' }, firmware: { type: 'string' } } },
        },
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'Salud de API, PostgreSQL y MongoDB (RF-14)', responses: { 200: ok('Todo operativo'), 503: ok('Componente caído') } } },
    '/telemetria': {
      post: {
        summary: 'CU-01 Enviar mediciones (dispositivo)',
        security: [{ bearerDispositivo: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Lote' } } } },
        responses: {
          201: ok('Lote almacenado'),
          200: ok('Lote duplicado (ya procesado)'),
          400: err('JSON malformado'),
          401: err('Credencial inválida o dispositivo de baja'),
          422: err('Esquema, reglas RN-01/RN-09 o RELOJ_DESFASADO'),
          429: err('Límite de tasa'),
          503: err('Base de datos no disponible (Retry-After)'),
        },
      },
    },
    '/telemetria/eventos': { post: { summary: 'Evento informado por el dispositivo (reinicio, datos descartados)', security: [{ bearerDispositivo: [] }], responses: { 201: ok('Registrado'), 200: ok('Ya registrado') } } },
    '/auth/login': { post: { summary: 'CU-02 Iniciar sesión', responses: { 200: ok('Token JWT'), 401: err('Credenciales inválidas'), 422: err('Campos'), 423: err('Cuenta bloqueada'), 429: err('Exceso de intentos') } } },
    '/auth/logout': { post: { summary: 'Cerrar sesión', security: seg, responses: { 204: ok('Sesión cerrada') } } },
    '/auth/me': { get: { summary: 'Usuario actual', security: seg, responses: { 200: ok('Usuario') } } },
    '/auth/cambiar-password': { post: { summary: 'Cambiar contraseña', security: seg, responses: { 204: ok('Cambiada'), 422: err('Política') } } },
    '/torres/estado': { get: { summary: 'CU-03 Estado actual de las torres visibles', security: seg, responses: { 200: ok('EstadoTorre[]'), 401: err('Sesión') } } },
    '/torres/{id}/estado': { get: { summary: 'CU-03 Estado de una torre', security: seg, responses: { 200: ok('Estado'), 403: err('Torre no asignada (RN-10)') } } },
    '/alertas': { get: { summary: 'CU-04 Listar alertas (filtros estado, severidad, torre, paginación)', security: seg, responses: { 200: ok('Paginado') } } },
    '/alertas/{id}/resolver': { patch: { summary: 'CU-04 Resolver alerta', security: seg, responses: { 200: ok('Resuelta'), 403: err('Rol/severidad o torre'), 409: err('Ya resuelta'), 422: err('Comentario obligatorio (crítica)') } } },
    '/mediciones/historico': { get: { summary: 'CU-05 Histórico de un sensor (alias /historicos)', security: seg, responses: { 200: ok('Serie agregada'), 403: err('Torre no asignada'), 422: err('Rango inválido o > 90 días') } } },
    '/mediciones/comparar': { get: { summary: 'CU-06 Comparar una variable entre torres (máx. 4)', security: seg, responses: { 200: ok('Series'), 403: err('Encargado') } } },
    '/historicos/export': { get: { summary: 'CU-06 Exportar CSV (alias /mediciones/export)', security: seg, responses: { 200: ok('text/csv'), 403: err('Encargado') } } },
    '/sensores/{id}/umbrales': {
      get: { summary: 'CU-07 Umbrales del sensor (lectura)', security: seg, responses: { 200: ok('Umbrales') } },
      put: { summary: 'CU-07 Crear/editar umbral por severidad (Administrador)', security: seg, responses: { 200: ok('Umbral'), 403: err('Rol'), 409: err('Versión o existente'), 422: err('Rango') } },
    },
    '/umbrales/{id}': { put: { summary: 'CU-07 Editar umbral con versión', security: seg, responses: { 200: ok('Umbral'), 409: err('Versión') } } },
    '/umbrales/{id}/desactivar': { patch: { summary: 'CU-07 Desactivar umbral (baja lógica)', security: seg, responses: { 200: ok('Desactivado') } } },
    '/catalogos': { get: { summary: 'Tipos de variable, especies y rangos de referencia', security: seg, responses: { 200: ok('Catálogos') } } },
    '/torres': { get: { summary: 'CU-08 Listar torres', security: seg, responses: { 200: ok('Torres') } }, post: { summary: 'CU-08 Crear torre', security: seg, responses: { 201: ok('Creada'), 409: err('Nombre duplicado') } } },
    '/torres/{id}': { patch: { summary: 'CU-08 Editar torre', security: seg, responses: { 200: ok('Editada') } } },
    '/torres/{id}/baja': { patch: { summary: 'CU-08 Baja lógica de torre', security: seg, responses: { 200: ok('Baja') } } },
    '/torres/{id}/usuarios': { put: { summary: 'CU-08 Asignar responsables', security: seg, responses: { 200: ok('Asignados') } } },
    '/dispositivos': { get: { summary: 'CU-08 Listar', security: seg, responses: { 200: ok('Dispositivos') } }, post: { summary: 'CU-08 Alta con credencial (se muestra una vez)', security: seg, responses: { 201: ok('Creado') } } },
    '/dispositivos/{id}': { patch: { summary: 'CU-08 Editar', security: seg, responses: { 200: ok('Editado') } } },
    '/dispositivos/{id}/baja': { patch: { summary: 'CU-08 Baja lógica (revoca credencial)', security: seg, responses: { 200: ok('Baja'), 403: err('Rol'), 409: err('Ya de baja') } } },
    '/dispositivos/{id}/credencial': { post: { summary: 'CU-08 Regenerar credencial', security: seg, responses: { 200: ok('Nueva credencial') } } },
    '/sensores': { post: { summary: 'CU-08 Alta de sensor', security: seg, responses: { 201: ok('Creado') } } },
    '/sensores/{id}/baja': { patch: { summary: 'CU-08 Baja lógica de sensor', security: seg, responses: { 200: ok('Baja') } } },
    '/usuarios': { get: { summary: 'CU-09 Listar usuarios', security: seg, responses: { 200: ok('Usuarios') } }, post: { summary: 'CU-09 Crear usuario', security: seg, responses: { 201: ok('Creado'), 403: err('Rol'), 409: err('Email duplicado') } } },
    '/usuarios/{id}': { patch: { summary: 'CU-09 Editar/desactivar/cambiar rol', security: seg, responses: { 200: ok('Editado'), 409: err('Autoprotección o último administrador') } } },
    '/usuarios/{id}/restablecer-password': { post: { summary: 'CU-09 Contraseña temporal', security: seg, responses: { 200: ok('Temporal') } } },
    '/roles': { get: { summary: 'CU-09 Roles', security: seg, responses: { 200: ok('Roles') } } },
    '/auditoria': { get: { summary: 'CU-09 Auditoría paginada (solo lectura)', security: seg, responses: { 200: ok('Registros'), 403: err('Rol') } } },
    '/auditoria/{id}': { put: { summary: 'No permitido (RN-07)', responses: { 405: err('Solo inserción') } }, delete: { summary: 'No permitido (RN-07)', responses: { 405: err('Solo inserción') } } },
    '/cultivos': { get: { summary: 'CU-10 Listar cultivos', security: seg, responses: { 200: ok('Cultivos') } }, post: { summary: 'CU-10 Registrar cultivo', security: seg, responses: { 201: ok('Creado'), 403: err('Supervisor'), 409: err('En curso o torre de baja') } } },
    '/cultivos/{id}': { patch: { summary: 'CU-10 Corregir cultivo en curso', security: seg, responses: { 200: ok('Editado') } } },
    '/cultivos/{id}/cerrar': { patch: { summary: 'CU-10 Cerrar cultivo', security: seg, responses: { 200: ok('Finalizado'), 422: err('fecha_fin < fecha_inicio') } } },
    '/eventos': { get: { summary: 'Eventos operativos', security: seg, responses: { 200: ok('Paginado') } } },
    '/continuidad': { get: { summary: 'Panel de continuidad operativa', security: seg, responses: { 200: ok('Resumen') } } },
    '/demo/estado': { get: { summary: 'Modo demo (solo DEMO_MODE, Administrador)', security: seg, responses: { 200: ok('Estado') } } },
    '/demo/escenarios/{codigo}': { post: { summary: 'Ejecutar escenario A–G', security: seg, responses: { 200: ok('Resultado') } } },
  },
};
