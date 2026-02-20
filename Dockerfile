FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install
COPY . .
RUN bunx vite build --outDir dist/client

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000 3001-3020
CMD ["bun", "run", "src/server/index.ts"]
