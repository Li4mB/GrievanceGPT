import { NextResponse } from "next/server";

import { prisma } from "../../../../src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const describeUrl = (rawValue: string | undefined) => {
  if (!rawValue) {
    return {
      present: false,
    };
  }

  const trimmed = rawValue.trim();
  const unwrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  try {
    const parsed = new URL(unwrapped);

    return {
      present: true,
      protocol: parsed.protocol.replace(":", ""),
      hostType: parsed.hostname.endsWith("pooler.supabase.com")
        ? "supabase-pooler"
        : "other",
      port: parsed.port || null,
      hasPgbouncer: parsed.searchParams.get("pgbouncer") === "true",
      connectionLimit: parsed.searchParams.get("connection_limit"),
    };
  } catch {
    return {
      present: true,
      parseable: false,
    };
  }
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
};

export async function GET(): Promise<NextResponse> {
  const diagnostics = {
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      null,
    databaseUrl: describeUrl(process.env.DATABASE_URL),
    directUrl: describeUrl(process.env.DIRECT_URL),
  };

  try {
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;

    return NextResponse.json(
      {
        ok: true,
        diagnostics,
        result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostics,
        error: serializeError(error),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
