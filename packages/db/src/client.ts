import { PrismaClient } from '@prisma/client';

// Global Prisma client instance
let prisma: PrismaClient | null = null;

/**
 * Get or create Prisma client instance
 */
export function getClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    });
  }
  return prisma;
}

/**
 * Disconnect Prisma client
 */
export async function disconnect(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

// Re-export PrismaClient and types
export { PrismaClient };
export type { Prisma } from '@prisma/client';
