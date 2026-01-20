# Build stage
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY services/worker/package.json ./services/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core/ ./packages/core/
COPY packages/db/ ./packages/db/
COPY services/worker/ ./services/worker/

# Generate Prisma client and build
RUN pnpm --filter @data-module/db db:generate
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy built application
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/services/worker/package.json ./services/worker/
COPY --from=builder /app/services/worker/dist ./services/worker/dist

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Generate Prisma client in production image
RUN pnpm --filter @data-module/db db:generate

# Set environment
ENV NODE_ENV=production

# Default command
CMD ["node", "services/worker/dist/cli.js", "ingest", "-v", "polymarket", "-m", "loop"]
