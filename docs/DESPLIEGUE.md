# Despliegue, respaldos y restauración

> «Preparado para desplegar» ≠ «desplegado». Este proyecto **no** ha sido desplegado en la nube en esta sesión.

## Cloud (estrategia ES2: droplet DigitalOcean + Docker Compose)
1. Droplet Ubuntu LTS (2 vCPU / 4 GiB), firewall: 443 y 80 públicos, 22 solo desde la IP del administrador.
2. Instalar Docker Engine + Compose; clonar el repositorio; crear `.env` con secretos nuevos, `NODE_ENV=production`, `DEMO_MODE=false`, `SEMBRAR_DATOS_PRUEBA=false`.
3. `docker compose up -d --build` (sin perfil `demo`).
4. TLS: colocar delante un Nginx/Caddy con certificado Let's Encrypt (TLS 1.3 preferido, HSTS) que haga proxy a `web:8080`, o agregar un bloque `listen 443 ssl` en `infrastructure/nginx/aquaplants.conf` con los certificados montados.
5. Crear el primer Administrador: ejecutar el seed solo en un entorno controlado o insertar el usuario con un hash bcrypt y `debe_cambiar_password = true`.
6. Configurar SMTP para alertas críticas (opcional, RF-11).

## Respaldo
```bash
docker compose --profile backup run --rm backup     # → ./respaldos/aquaplants_<fecha>.dump + .sha256
```
Programar diariamente (cron del host, 02:00). Para MongoDB (payload crudo, TTL 90 días): `docker compose exec mongo mongodump --gzip --archive=/data/db/respaldo.gz -u $MONGO_ROOT_USER -p … --authenticationDatabase admin`. Cifrar y copiar fuera del servidor (ES2 Tabla 16: `age` + bucket privado).

## Restauración (prueba CP-29)
```bash
docker compose --profile backup run --rm --entrypoint /bin/sh backup /scripts/restaurar.sh /respaldos/<archivo>.dump
```
Verifica la suma SHA-256, restaura en `aquaplants_restaurada` y muestra conteos para comparar con el origen.

## TimescaleDB: políticas
`002_timescale.sql` convierte `medicion` en hipertabla (chunks de 7 días). Las políticas de compresión y retención de 2 años (Tabla 40) **no se activan automáticamente** porque `alerta` referencia mediciones por FK y el ES2 exige copiar antes la evidencia; ver pendientes en `ESTADO_PROYECTO.md`.

## Dispositivo físico futuro
El simulador implementa la cola como archivos con `fsync` + `rename` atómico. En un AquaBrain real (ESP32 u otro compatible) la misma lógica se adapta a **LittleFS** en flash: un archivo por lote, borrar solo tras 201/200-duplicado, registro de descartes, NTP antes de enviar, reinicio seguro validando la cola. La cifra de 512 KB ≈ 40 h es un supuesto a verificar con el tamaño real del lote.
