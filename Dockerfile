# Shared base — install deps to /deps, symlink to /node_modules for resolution
FROM oven/bun:1 AS base
WORKDIR /deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install && ln -s /deps/node_modules /node_modules
ENV PATH="/deps/node_modules/.bin:$PATH"
WORKDIR /app

# Dev target — source is bind-mounted read-only, deps resolve from /node_modules
FROM base AS dev
EXPOSE 3000 3001-3020 5173
CMD ["sh", "-c", "bun --watch src/server/index.ts & vite --host 0.0.0.0 & wait"]

# Production build — compile frontend
FROM base AS build
COPY . .
RUN vite build --outDir dist/client

# Production runtime — only what's needed to run
FROM oven/bun:1 AS production
WORKDIR /deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install --production && ln -s /deps/node_modules /node_modules
ENV PATH="/deps/node_modules/.bin:$PATH"
WORKDIR /app
COPY --from=build /app/dist/client dist/client
COPY src/server src/server
COPY src/shared src/shared
EXPOSE 3000 3001-3020
CMD ["bun", "src/server/index.ts"]
