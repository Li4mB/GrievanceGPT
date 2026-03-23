import { MembershipRole, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../../../src/lib/access";
import { logger } from "../../../../../src/lib/logger";
import { parseMerchantPolicy } from "../../../../../src/lib/policy";
import { prisma } from "../../../../../src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { merchantId: string } },
): Promise<NextResponse> {
  try {
    await requireMerchantAccess({
      merchantId: params.merchantId,
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
        MembershipRole.VIEWER,
      ],
    });

    const merchant = await prisma.merchant.findFirst({
      where: {
        id: params.merchantId,
      },
      select: {
        id: true,
        policyText: true,
        policyJson: true,
        updatedAt: true,
      },
    });

    if (!merchant) {
      return NextResponse.json({ error: "Merchant not found." }, { status: 404 });
    }

    return NextResponse.json({
      merchantId: merchant.id,
      policyText: merchant.policyText,
      policyJson: merchant.policyJson,
      updatedAt: merchant.updatedAt,
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logger.error(
      {
        error,
        merchantId: params.merchantId,
      },
      "Failed to fetch merchant policy",
    );

    return NextResponse.json(
      { error: "Failed to fetch policy." },
      { status: 500 },
    );
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
      policyText?: string;
    };

    if (!body.policyText || body.policyText.trim().length === 0) {
      return NextResponse.json(
        { error: "policyText is required." },
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

    const parsedPolicy = await parseMerchantPolicy(body.policyText.trim());

    await prisma.merchant.update({
      where: {
        id: params.merchantId,
      },
      data: {
        policyText: body.policyText.trim(),
        policyJson: parsedPolicy as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info(
      {
        merchantId: params.merchantId,
      },
      "Updated merchant policy",
    );

    return NextResponse.json({
      merchantId: params.merchantId,
      policyText: body.policyText.trim(),
      policyJson: parsedPolicy,
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logger.error(
      {
        error,
        merchantId: params.merchantId,
      },
      "Failed to update merchant policy",
    );

    const message =
      error instanceof Error &&
      error.message.includes("OPENAI_API_KEY")
        ? "Policy parser is unavailable because OPENAI_API_KEY is not configured."
        : "Failed to save policy.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
