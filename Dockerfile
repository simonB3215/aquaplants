# syntax=docker/dockerfile:1
# Imagen multietapa del monorepo. Objetivos: api (API + worker), web (Nginx + SPA), simulador.
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/simulador/package.json packages/simulador/
COPY packages/frontend/package.json packages/frontend/
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY packages ./packages
COPY database ./database
RUN npm run build:shared \
 && npm run build -w packages/backend \
 && npm run build -w packages/simulador \
 && npm run build -w packages/frontend

# ------------------------------------------------------------------ API / worker / migraciones
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/backend/package.json packages/backend/
RUN npm ci --omit=dev --no-audit --no-fund -w packages/shared -w packages/backend && npm i --no-save tsx@4.19.2
COPY --from=build /app/packages/shared/lib packages/shared/lib
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/backend/src packages/backend/src
COPY --from=build /app/database database
ENV MIGRATIONS_DIR=/app/database/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/backend/dist/server.js"]

# ------------------------------------------------------------------ Simulador AquaBrain
FROM node:22-bookworm-slim AS simulador
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/simulador/package.json packages/simulador/
RUN npm ci --omit=dev --no-audit --no-fund -w packages/shared -w packages/simulador
COPY --from=build /app/packages/shared/lib packages/shared/lib
COPY --from=build /app/packages/simulador/dist packages/simulador/dist
RUN mkdir -p /datos && chown node /datos
USER node
CMD ["node", "packages/simulador/dist/index.js"]

# ------------------------------------------------------------------ Web (Nginx + SPA)
FROM nginx:1.27-alpine AS web
COPY infrastructure/nginx/aquaplants.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
EXPOSE 8080
