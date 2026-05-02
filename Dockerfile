# Build stage
FROM oven/bun:1 AS build
WORKDIR /src
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir=dist --target=bun

# Runtime stage
FROM oven/bun:1-slim
RUN groupadd -r app && useradd -r -g app -u 10001 -m app
USER app
WORKDIR /home/app
COPY --from=build --chown=app:app /src/dist/ /home/app/
COPY --from=build --chown=app:app /src/node_modules/ /home/app/node_modules/
ENTRYPOINT ["bun", "/home/app/index.js"]
