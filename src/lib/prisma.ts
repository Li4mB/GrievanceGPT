import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __grievancePrisma: PrismaClient | undefined;
}

const normalizeDatabaseUrl = (name: "DATABASE_URL" | "DIRECT_URL"): void => {
  const value = process.env[name];

  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    process.env[name] = trimmed.slice(1, -1).trim();
    return;
  }

  process.env[name] = trimmed;
};

normalizeDatabaseUrl("DATABASE_URL");
normalizeDatabaseUrl("DIRECT_URL");

export const prisma =
  global.__grievancePrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__grievancePrisma = prisma;
}
