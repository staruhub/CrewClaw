# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies
WORKDIR /app

# Match package.json#packageManager exactly. The repository is pnpm-only, so the image uses the
# committed pnpm lockfile as its dependency truth.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=crewclaw-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .

# This Fly image serves only the website and package-download API. The Rust CLI has its own
# cross-platform CI/release gate; keeping it out of this image avoids requiring a Rust toolchain in
# a web-server build while still producing the same Vite and bundled Hono artifacts as `pnpm build`.
RUN pnpm run validate:all-experts && \
    pnpm run build:web && \
    test -f dist/public/index.html && \
    test -f dist/boot.js && \
    test -f dist/employee-packages/ai-adoption-whale.tar.gz

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# dist/ is self-contained JavaScript, while registry/ and experts/ are runtime data used by the
# real /api/employees/:slug/package endpoint. The start shim sets production mode before importing
# the bundled server.
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/scripts/start-production.mjs ./scripts/start-production.mjs
COPY --chown=node:node --from=build /app/registry/experts.json ./registry/experts.json
COPY --chown=node:node --from=build /app/experts ./experts

USER node
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
