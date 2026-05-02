# Hijack Poker — gateway image. Mirrors apps/worker/Dockerfile shape so
# fly.io machines stay consistent across services.
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/engine/package.json    packages/engine/package.json
COPY packages/protocol/package.json  packages/protocol/package.json
COPY apps/worker/package.json        apps/worker/package.json
COPY apps/gateway/package.json       apps/gateway/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY packages packages
COPY apps/worker apps/worker
COPY apps/gateway apps/gateway
WORKDIR /repo/apps/gateway
EXPOSE 3002
CMD ["node", "src/index.js"]
