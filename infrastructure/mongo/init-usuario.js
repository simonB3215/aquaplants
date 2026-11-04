// Usuario de aplicación con readWrite SOLO sobre la base aquaplants (ES2 §3.4).
db = db.getSiblingDB('aquaplants');
db.createUser({ user: process.env.MONGO_APP_USER, pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'aquaplants' }] });
