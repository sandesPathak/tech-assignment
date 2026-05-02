FROM node:20-alpine AS deps
WORKDIR /app
# Workspace manifests we depend on.
COPY package.json package-lock.json* ./
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/observability/package.json ./packages/observability/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/coach/package.json ./apps/coach/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/coach ./apps/coach
CMD ["node", "apps/coach/src/index.js"]
