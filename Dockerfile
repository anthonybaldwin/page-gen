# Shared base — install deps once
FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install

# Dev target — source is bind-mounted, Bun serves frontend + backend in one process
FROM base AS dev
EXPOSE 3000 3001-3020 4001-4020
COPY scripts/dev-server.sh /usr/local/bin/dev-server
RUN chmod +x /usr/local/bin/dev-server
CMD ["sh", "-c", "bun install --frozen-lockfile && dev-server"]

# Production build — compile frontend
FROM base AS build
COPY . .
RUN bun build src/client/index.html --outdir dist/client --minify

# Production runtime — single process serves API + static frontend
FROM oven/bun:1 AS production
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --production
COPY --from=build /app/dist/client dist/client
COPY src/server src/server
COPY src/shared src/shared
EXPOSE 3000 3001-3020 4001-4020
CMD ["bun", "src/server/index.ts"]
