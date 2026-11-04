// Usuarios de MongoDB con mínimo privilegio (ES2 §3.4). Idempotente: se ejecuta en
// la primera inicialización del volumen (docker-entrypoint-initdb.d) y también con
// el servicio «mongo-usuarios» en cada «docker compose up» (volúmenes existentes).
//  · app    : readWrite SOLO sobre la base aquaplants (API y worker).
//  · backup : read SOLO sobre la base aquaplants (mongodump).
const base = db.getSiblingDB('aquaplants');
function asegurar(usuario, clave, rol) {
  if (!usuario || !clave) return;
  const roles = [{ role: rol, db: 'aquaplants' }];
  if (base.getUser(usuario)) base.updateUser(usuario, { pwd: clave, roles });
  else base.createUser({ user: usuario, pwd: clave, roles });
  print(`[mongo] usuario ${usuario}: ${rol} en aquaplants`);
}
asegurar(process.env.MONGO_APP_USER, process.env.MONGO_APP_PASSWORD, 'readWrite');
asegurar(process.env.MONGO_BACKUP_USER, process.env.MONGO_BACKUP_PASSWORD, 'read');
