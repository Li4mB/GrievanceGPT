import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __grievancePrisma: PrismaClient | undefined;
}

export const prisma =
  global.__grievancePrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__grievancePrisma = prisma;
}
