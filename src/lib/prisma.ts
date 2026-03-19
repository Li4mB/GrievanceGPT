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
  const normalized =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  try {
    const parsed = new URL(normalized);
    const isSupabaseTransactionPooler =
      parsed.hostname.endsWith("pooler.supabase.com") && parsed.port === "6543";

    if (isSupabaseTransactionPooler) {
      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
      }

      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1");
      }
    }

    process.env[name] = parsed.toString();
  } catch {
    process.env[name] = normalized;
  }
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
