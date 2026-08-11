import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __kodoPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__kodoPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__kodoPrisma = prisma;
}

export * from '@prisma/client';
