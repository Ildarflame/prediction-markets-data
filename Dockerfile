# Build stage
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY services/worker/package.json ./services/worker/

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core/ ./packages/core/
COPY packages/db/ ./packages/db/
COPY services/worker/ ./services/worker/

# Generate Prisma client and build
RUN pnpm --filter @data-module/db db:generate
RUN pnpm build

# Production stage - single stage with all deps
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app ./

# Set environment
ENV NODE_ENV=production

# Default command
CMD ["node", "services/worker/dist/cli.js", "ingest", "-v", "polymarket", "-m", "loop"]
