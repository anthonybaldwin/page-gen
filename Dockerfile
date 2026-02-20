# Shared base — install deps once
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install

# Dev target — source is bind-mounted, Vite runs in dev mode with HMR
FROM base AS dev
EXPOSE 3000 3001-3020 5173
CMD ["sh", "-c", "bun --watch src/server/index.ts & bunx vite --host 0.0.0.0 & wait"]

# Production build
FROM base AS build
COPY . .
RUN bunx vite build --outDir dist/client

FROM oven/bun:1 AS production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000 3001-3020
CMD ["bun", "run", "src/server/index.ts"]
