# Build stage
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY services/worker/package.json ./services/worker/

# Install all dependencies
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
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install OpenSSL for Prisma runtime
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app ./

# Set environment
ENV NODE_ENV=production

# Default command
CMD ["node", "services/worker/dist/cli.js", "ingest", "-v", "polymarket", "-m", "loop"]
