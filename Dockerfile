# Shared base — install deps once
FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install

# Dev target — source is bind-mounted, Vite runs in dev mode with HMR
FROM base AS dev
EXPOSE 3000 3001-3020 4001-4020 5173
COPY scripts/dev-server.sh /usr/local/bin/dev-server
RUN chmod +x /usr/local/bin/dev-server
CMD ["sh", "-c", "dev-server & bunx vite --host 0.0.0.0 & wait"]

# Production build — compile frontend
FROM base AS build
COPY . .
RUN bunx vite build --outDir dist/client

# Production runtime — API on :3000, pre-built frontend via Vite preview on :5173
FROM oven/bun:1 AS production
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --production
COPY --from=build /app/dist/client dist/client
COPY --from=build /app/vite.config.ts vite.config.ts
COPY src/server src/server
COPY src/shared src/shared
EXPOSE 3000 3001-3020 4001-4020 5173
CMD ["sh", "-c", "bun src/server/index.ts & bunx vite preview --host 0.0.0.0 --outDir dist/client & wait"]
