import {
  IntegrationStatus,
  IntegrationType,
  MembershipRole,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../../../../src/lib/access";
import {
  getGorgiasWebhookUrl,
  normalizeGorgiasBaseUrl,
} from "../../../../../../src/lib/gorgias";
import { prisma } from "../../../../../../src/lib/prisma";
import {
  encryptString,
  generateStateToken,
} from "../../../../../../src/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sanitizeBaseUrl = (value: string): string => {
  const url = new URL(normalizeGorgiasBaseUrl(value));

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Gorgias base URL must use http or https.");
  }

  return url.toString().replace(/\/$/, "");
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { merchantId: string } },
): Promise<NextResponse> {
  try {
    await requireMerchantAccess({
      merchantId: params.merchantId,
      allowedRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    });

    const merchant = await prisma.merchant.findFirst({
      where: {
        id: params.merchantId,
      },
      select: {
        id: true,
        integrations: {
          where: {
            type: IntegrationType.GORGIAS,
          },
          select: {
            status: true,
            metadata: true,
            apiKeyEncrypted: true,
            apiSecretEncrypted: true,
            updatedAt: true,
          },
          take: 1,
        },
      },
    });

    if (!merchant) {
      return NextResponse.json({ error: "Merchant not found." }, { status: 404 });
    }

    const connection = merchant.integrations[0];
    const metadata =
      connection?.metadata && typeof connection.metadata === "object"
        ? (connection.metadata as Record<string, unknown>)
        : {};

    return NextResponse.json({
      connected: Boolean(connection?.apiKeyEncrypted),
      status: connection?.status ?? IntegrationStatus.PENDING,
      baseUrl: typeof metadata.baseUrl === "string" ? metadata.baseUrl : null,
      apiEmail: typeof metadata.apiEmail === "string" ? metadata.apiEmail : null,
      webhookUrl: getGorgiasWebhookUrl(params.merchantId),
      hasWebhookSecret: Boolean(connection?.apiSecretEncrypted),
      updatedAt: connection?.updatedAt ?? null,
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { merchantId: string } },
): Promise<NextResponse> {
  try {
    await requireMerchantAccess({
      merchantId: params.merchantId,
      allowedRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    });

    const body = (await request.json()) as {
      baseUrl?: string;
      apiEmail?: string;
      apiKey?: string;
      webhookSecret?: string;
    };

    if (!body.baseUrl || !body.apiEmail || !body.apiKey) {
      return NextResponse.json(
        { error: "baseUrl, apiEmail, and apiKey are required." },
        { status: 400 },
      );
    }

    const merchant = await prisma.merchant.findFirst({
      where: {
        id: params.merchantId,
      },
      select: {
        id: true,
      },
    });

    if (!merchant) {
      return NextResponse.json({ error: "Merchant not found." }, { status: 404 });
    }

    const existing = await prisma.integrationConnection.findUnique({
      where: {
        merchantId_type: {
          merchantId: params.merchantId,
          type: IntegrationType.GORGIAS,
        },
      },
      select: {
        apiSecretEncrypted: true,
      },
    });

    const webhookSecret =
      body.webhookSecret?.trim().length
        ? body.webhookSecret.trim()
        : existing?.apiSecretEncrypted
          ? null
          : generateStateToken();
    const apiSecretEncrypted =
      webhookSecret !== null
        ? encryptString(webhookSecret)
        : existing?.apiSecretEncrypted ?? encryptString(generateStateToken());

    await prisma.integrationConnection.upsert({
      where: {
        merchantId_type: {
          merchantId: params.merchantId,
          type: IntegrationType.GORGIAS,
        },
      },
      update: {
        status: IntegrationStatus.ACTIVE,
        apiKeyEncrypted: encryptString(body.apiKey),
        apiSecretEncrypted,
        metadata: {
          baseUrl: sanitizeBaseUrl(body.baseUrl),
          apiEmail: body.apiEmail.trim(),
        },
        installedAt: new Date(),
      },
      create: {
        merchantId: params.merchantId,
        type: IntegrationType.GORGIAS,
        status: IntegrationStatus.ACTIVE,
        apiKeyEncrypted: encryptString(body.apiKey),
        apiSecretEncrypted,
        metadata: {
          baseUrl: sanitizeBaseUrl(body.baseUrl),
          apiEmail: body.apiEmail.trim(),
        },
        installedAt: new Date(),
        scopes: [],
      },
    });

    return NextResponse.json({
      connected: true,
      webhookUrl: getGorgiasWebhookUrl(params.merchantId),
      webhookSecret,
      secretRotated:
        webhookSecret !== null && Boolean(existing?.apiSecretEncrypted),
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
