# Shared base — install deps once
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install

# Dev target — source is bind-mounted, Vite runs in dev mode with HMR
FROM base AS dev
EXPOSE 3000 3001-3020 4001-4020 5173
CMD ["sh", "-c", "while true; do bun --watch src/server/index.ts; echo '[dev] server exited, restarting in 2s...'; sleep 2; done & bunx vite --host 0.0.0.0 & wait"]

# Production build — compile frontend
FROM base AS build
COPY . .
RUN bunx vite build --outDir dist/client

# Production runtime — only what's needed to run
FROM oven/bun:1 AS production
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --production
COPY --from=build /app/dist/client dist/client
COPY src/server src/server
COPY src/shared src/shared
EXPOSE 3000 3001-3020 4001-4020
CMD ["bun", "src/server/index.ts"]
