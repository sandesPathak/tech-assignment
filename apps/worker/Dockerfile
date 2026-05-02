FROM node:20-alpine AS deps
WORKDIR /app
# Bring in the workspace manifests we depend on.
COPY package.json package-lock.json* ./
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/worker ./apps/worker
EXPOSE 3001
CMD ["node", "apps/worker/src/index.js"]
