# syntax=docker/dockerfile:1

# ---- Build: install all dependencies, build client + server, then drop dev dependencies ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime: built output + production dependencies only ----
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/app.db

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
# Migrations run and the seed is applied (only if the database is empty) on startup.
CMD ["node", "dist/server/server/index.js"]
